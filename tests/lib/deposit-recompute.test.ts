// One-time organic-deposit recompute: verifies the correction categorization
// (NEW / CLEARED / ADJUSTED / unchanged), the never-wipe-on-Stripe-error guard,
// existing-rows-only behavior, and the persisted run-once flag helpers.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBmFindMany, mockClFindMany, mockClUpdate, mockDerive, mockGetSetting, mockSetSetting } =
  vi.hoisted(() => ({
    mockBmFindMany: vi.fn(),
    mockClFindMany: vi.fn(),
    mockClUpdate: vi.fn(),
    mockDerive: vi.fn(),
    mockGetSetting: vi.fn(),
    mockSetSetting: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalOrder: { findMany: mockBmFindMany },
    customerLifecycle: { findMany: mockClFindMany, update: mockClUpdate },
  },
}));
vi.mock("@/lib/stripe-metrics", () => ({ deriveOrganicDeposits: mockDerive }));
vi.mock("@/lib/internal-accounts", () => ({
  getInternalExclusions: vi.fn().mockResolvedValue({ domains: [], emails: [] }),
  buildExcludeInternalWhere: () => ({}),
}));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }));

import {
  recomputeOrganicDepositsForExistingRows,
  getDepositRecomputeStatus,
  markDepositRecomputeDone,
  DEPOSIT_RECOMPUTE_KEY,
} from "@/lib/deposit-recompute";

const stripe = {} as never;
const D = (s: string) => new Date(s);

beforeEach(() => {
  vi.clearAllMocks();
  mockBmFindMany.mockResolvedValue([]);
  mockClUpdate.mockResolvedValue({});
  mockSetSetting.mockResolvedValue(undefined);
});

describe("recomputeOrganicDepositsForExistingRows", () => {
  it("categorizes NEW / CLEARED / ADJUSTED / unchanged and only writes changed rows", async () => {
    mockClFindMany.mockResolvedValue([
      // NEW: was null → now a real deposit
      { stripeCustomerId: "cus_new", firstDepositAt: null, totalDepositsCents: 0, depositCount: 0 },
      // CLEARED: was set (comped) → now null
      { stripeCustomerId: "cus_clr", firstDepositAt: D("2026-01-02T00:00:00Z"), totalDepositsCents: 500, depositCount: 1 },
      // ADJUSTED: amount corrected
      { stripeCustomerId: "cus_adj", firstDepositAt: D("2026-01-03T00:00:00Z"), totalDepositsCents: 1000, depositCount: 1 },
      // UNCHANGED: same day + same totals (a within-day timestamp shift is not a change)
      { stripeCustomerId: "cus_same", firstDepositAt: D("2026-01-04T09:00:00Z"), totalDepositsCents: 2000, depositCount: 2 },
    ]);
    mockDerive.mockImplementation((_s: unknown, id: string) => {
      switch (id) {
        case "cus_new":
          return { firstDepositAt: D("2026-02-01T00:00:00Z"), totalDepositsCents: 3000, depositCount: 1, ok: true };
        case "cus_clr":
          return { firstDepositAt: null, totalDepositsCents: 0, depositCount: 0, ok: true };
        case "cus_adj":
          return { firstDepositAt: D("2026-01-03T00:00:00Z"), totalDepositsCents: 1500, depositCount: 2, ok: true };
        case "cus_same":
          return { firstDepositAt: D("2026-01-04T23:59:00Z"), totalDepositsCents: 2000, depositCount: 2, ok: true };
        default:
          throw new Error("unexpected id");
      }
    });

    const s = await recomputeOrganicDepositsForExistingRows(stripe);

    expect(s).toMatchObject({
      scanned: 4,
      created: 1,
      cleared: 1,
      adjusted: 1,
      unchanged: 1,
      changed: 3,
      errors: 0,
    });
    // netDelta = (3000-0) + (0-500) + (1500-1000) = 3000
    expect(s.netDeltaCents).toBe(3000);
    // Only the 3 changed rows are written; the unchanged row is not touched.
    expect(mockClUpdate).toHaveBeenCalledTimes(3);
    const written = mockClUpdate.mock.calls.map((c) => c[0].where.stripeCustomerId).sort();
    expect(written).toEqual(["cus_adj", "cus_clr", "cus_new"]);
  });

  it("never wipes a row when Stripe fails for it (ok:false → skipped, counted as error)", async () => {
    mockClFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_fail", firstDepositAt: D("2026-01-02T00:00:00Z"), totalDepositsCents: 9999, depositCount: 3 },
    ]);
    mockDerive.mockResolvedValue({ firstDepositAt: null, totalDepositsCents: 0, depositCount: 0, ok: false });

    const s = await recomputeOrganicDepositsForExistingRows(stripe);

    expect(s).toMatchObject({ scanned: 1, errors: 1, changed: 0, unchanged: 0 });
    expect(mockClUpdate).not.toHaveBeenCalled();
  });

  it("passes each customer's bare-metal order amounts as the exclusion set", async () => {
    mockBmFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_bm", totalInvoiceCents: 12345 },
      { stripeCustomerId: "cus_bm", totalInvoiceCents: 67890 },
    ]);
    mockClFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_bm", firstDepositAt: null, totalDepositsCents: 0, depositCount: 0 },
    ]);
    mockDerive.mockResolvedValue({ firstDepositAt: null, totalDepositsCents: 0, depositCount: 0, ok: true });

    await recomputeOrganicDepositsForExistingRows(stripe);

    const exclusionSet = mockDerive.mock.calls[0][2];
    expect(exclusionSet).toBeInstanceOf(Set);
    expect([...exclusionSet].sort((a: number, b: number) => a - b)).toEqual([12345, 67890]);
  });
});

describe("deposit recompute flag helpers", () => {
  it("getDepositRecomputeStatus returns null when unset or corrupt", async () => {
    mockGetSetting.mockResolvedValueOnce(null);
    expect(await getDepositRecomputeStatus()).toBeNull();
    mockGetSetting.mockResolvedValueOnce("not json{");
    expect(await getDepositRecomputeStatus()).toBeNull();
    mockGetSetting.mockResolvedValueOnce(JSON.stringify({ status: "other" }));
    expect(await getDepositRecomputeStatus()).toBeNull();
  });

  it("getDepositRecomputeStatus parses a completed payload", async () => {
    const payload = { status: "done", at: "2026-07-14T00:00:00.000Z", scanned: 5, changed: 2, created: 1, cleared: 0, adjusted: 1, unchanged: 3, errors: 0, netDeltaCents: 100 };
    mockGetSetting.mockResolvedValueOnce(JSON.stringify(payload));
    expect(await getDepositRecomputeStatus()).toMatchObject(payload);
  });

  it("markDepositRecomputeDone persists the flag as JSON under the versioned key", async () => {
    const summary = { scanned: 3, changed: 1, created: 1, cleared: 0, adjusted: 0, unchanged: 2, errors: 0, netDeltaCents: 250 };
    const status = await markDepositRecomputeDone(summary, D("2026-07-14T12:00:00Z"));
    expect(status).toMatchObject({ status: "done", at: "2026-07-14T12:00:00.000Z", ...summary });
    expect(mockSetSetting).toHaveBeenCalledWith(DEPOSIT_RECOMPUTE_KEY, JSON.stringify(status));
  });
});
