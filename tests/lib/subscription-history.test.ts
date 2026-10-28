// PA-354: SubscriptionHistory open/close/reconcile writers. Load-bearing
// behaviors: records are keyed PER POD (a quantity-N Stripe subscription has
// N pods → N records at the per-unit price), opens are idempotent per pod, a
// same-UTC-day close→reopen (redeploy) reopens the record instead of creating
// an overlapping window, closes never touch another pod's record, reconcile
// closes orphaned open records, and NOTHING here may ever throw — history
// bookkeeping must not break deploys or terminations.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPodFindUnique, mockPodFindMany, mockShFindFirst, mockShFindMany, mockShCreate, mockShUpdate, mockRetrieve } = vi.hoisted(() => ({
  mockPodFindUnique: vi.fn(),
  mockPodFindMany: vi.fn(),
  mockShFindFirst: vi.fn(),
  mockShFindMany: vi.fn(),
  mockShCreate: vi.fn(),
  mockShUpdate: vi.fn(),
  mockRetrieve: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findUnique: mockPodFindUnique, findMany: mockPodFindMany },
    subscriptionHistory: {
      findFirst: mockShFindFirst,
      findMany: mockShFindMany,
      create: mockShCreate,
      update: mockShUpdate,
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({ subscriptions: { retrieve: mockRetrieve } }),
}));

import {
  openSubscriptionHistory,
  closeSubscriptionHistory,
  reconcileOpenSubscriptionHistory,
} from "@/lib/subscription-history";

const monthlyPod = {
  id: "pm_1",
  subscriptionId: "instance-i-aaa",
  stripeCustomerId: "cus_a",
  stripeSubscriptionId: "sub_a",
  poolId: "60",
  billingType: "monthly",
  deployTime: new Date("2026-06-10T00:00:00Z"),
  createdAt: new Date("2026-06-10T01:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockShFindFirst.mockResolvedValue(null);
  mockShFindMany.mockResolvedValue([]);
  mockShCreate.mockResolvedValue({});
  mockShUpdate.mockResolvedValue({});
  mockRetrieve.mockResolvedValue({ items: { data: [{ price: { unit_amount: 29900 } }] } });
});

describe("openSubscriptionHistory", () => {
  it("creates a per-pod record with the customer's actual Stripe price", async () => {
    await openSubscriptionHistory(monthlyPod, 19900);
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeCustomerId: "cus_a",
        stripeSubscriptionId: "sub_a",
        podSubscriptionId: "instance-i-aaa",
        poolId: 60,
        startedAt: monthlyPod.deployTime,
        endedAt: null,
        billingType: "monthly",
        priceCents: 29900,
      }),
    });
  });

  it("does nothing for hourly pods", async () => {
    await openSubscriptionHistory({ ...monthlyPod, billingType: "hourly" });
    expect(mockShCreate).not.toHaveBeenCalled();
  });

  it("still creates a record when poolId is unresolved (backfilled at close)", async () => {
    await openSubscriptionHistory({ ...monthlyPod, poolId: null });
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ poolId: null, podSubscriptionId: "instance-i-aaa" }),
    });
  });

  it("is idempotent per pod — an open record for this pod blocks a duplicate", async () => {
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.podSubscriptionId === "instance-i-aaa" ? { id: "sh_1" } : null,
    );
    await openSubscriptionHistory(monthlyPod);
    expect(mockShCreate).not.toHaveBeenCalled();
    expect(mockShUpdate).not.toHaveBeenCalled();
  });

  it("opens a SECOND record for a second pod on the same quantity-N subscription", async () => {
    // Pod B of a qty-2 sub: pod A's record is open but keyed to pod A
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.podSubscriptionId === "instance-i-aaa" ? { id: "sh_a" } : null,
    );
    await openSubscriptionHistory({ ...monthlyPod, subscriptionId: "instance-i-bbb" });
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ podSubscriptionId: "instance-i-bbb", priceCents: 29900 }),
    });
  });

  it("reopens a record closed earlier the same UTC day (redeploy) instead of creating an overlap", async () => {
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.podSubscriptionId) return null; // new pod key — no open record
      if (args.where.stripeSubscriptionId && args.where.endedAt) {
        return { id: "sh_old", poolId: 60 }; // stale-cleanup closed it today
      }
      return null;
    });
    await openSubscriptionHistory({ ...monthlyPod, subscriptionId: "instance-i-new" });
    expect(mockShUpdate).toHaveBeenCalledWith({
      where: { id: "sh_old" },
      data: expect.objectContaining({ endedAt: null, podSubscriptionId: "instance-i-new" }),
    });
    expect(mockShCreate).not.toHaveBeenCalled();
  });

  it("does NOT reopen across pools — a cross-pool redeploy gets a fresh record", async () => {
    // Reopening would re-attribute the record's whole historical window
    // (startedAt stays at the original deploy) to the new pool's investor.
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.podSubscriptionId) return null;
      if (args.where.stripeSubscriptionId && args.where.endedAt) {
        return { id: "sh_old", poolId: 61 }; // closed today, but on a DIFFERENT pool
      }
      return null;
    });
    await openSubscriptionHistory({ ...monthlyPod, subscriptionId: "instance-i-new" }); // pool 60
    expect(mockShUpdate).not.toHaveBeenCalled();
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ podSubscriptionId: "instance-i-new", poolId: 60 }),
    });
  });

  it("falls back to the product price when Stripe lookup fails", async () => {
    mockRetrieve.mockRejectedValue(new Error("stripe down"));
    await openSubscriptionHistory(monthlyPod, 19900);
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ priceCents: 19900 }),
    });
  });

  it("never throws, even when the DB write fails", async () => {
    mockShCreate.mockRejectedValue(new Error("db down"));
    await expect(openSubscriptionHistory(monthlyPod)).resolves.toBeUndefined();
  });
});

describe("closeSubscriptionHistory", () => {
  it("closes the open record matched by pod key", async () => {
    mockPodFindUnique.mockResolvedValue(monthlyPod);
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.podSubscriptionId === "instance-i-aaa"
        ? { id: "sh_1", poolId: 60, podSubscriptionId: "instance-i-aaa" }
        : null,
    );
    await closeSubscriptionHistory({ id: "pm_1" });
    expect(mockPodFindUnique).toHaveBeenCalledWith({ where: { id: "pm_1" } });
    expect(mockShUpdate).toHaveBeenCalledWith({
      where: { id: "sh_1" },
      data: expect.objectContaining({ endedAt: expect.any(Date), priceCents: 29900 }),
    });
    expect(mockShCreate).not.toHaveBeenCalled();
  });

  it("never closes another pod's record on the same Stripe subscription", async () => {
    // Pod A terminates; only pod B's record (different pod key) is open.
    // The stripeSubscriptionId fallback is restricted to legacy records
    // WITHOUT a pod key, so nothing matches → retroactive create for pod A.
    mockPodFindUnique.mockResolvedValue(monthlyPod);
    mockShFindFirst.mockResolvedValue(null);
    await closeSubscriptionHistory({ id: "pm_1" });
    expect(mockShFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeSubscriptionId: "sub_a", podSubscriptionId: null }),
      }),
    );
    expect(mockShUpdate).not.toHaveBeenCalled();
    expect(mockShCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        podSubscriptionId: "instance-i-aaa",
        startedAt: monthlyPod.deployTime,
        endedAt: expect.any(Date),
        priceCents: 29900,
      }),
    });
  });

  it("backfills poolId and pod key onto a legacy record it closes", async () => {
    mockPodFindUnique.mockResolvedValue(monthlyPod);
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.podSubscriptionId === null && args.where.stripeSubscriptionId === "sub_a"
        ? { id: "sh_legacy", poolId: null, podSubscriptionId: null }
        : null,
    );
    await closeSubscriptionHistory({ subscriptionId: "instance-i-aaa" });
    expect(mockShUpdate).toHaveBeenCalledWith({
      where: { id: "sh_legacy" },
      data: expect.objectContaining({
        endedAt: expect.any(Date),
        poolId: 60,
        podSubscriptionId: "instance-i-aaa",
      }),
    });
  });

  it("does nothing for hourly or missing pods", async () => {
    mockPodFindUnique.mockResolvedValueOnce({ ...monthlyPod, billingType: "hourly" });
    await closeSubscriptionHistory({ id: "pm_1" });
    mockPodFindUnique.mockResolvedValueOnce(null);
    await closeSubscriptionHistory({ id: "pm_gone" });
    expect(mockShUpdate).not.toHaveBeenCalled();
    expect(mockShCreate).not.toHaveBeenCalled();
  });

  it("still closes when the price re-snapshot fails", async () => {
    mockPodFindUnique.mockResolvedValue(monthlyPod);
    mockShFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.podSubscriptionId === "instance-i-aaa"
        ? { id: "sh_1", poolId: 60, podSubscriptionId: "instance-i-aaa" }
        : null,
    );
    mockRetrieve.mockRejectedValue(new Error("stripe down"));
    await closeSubscriptionHistory({ id: "pm_1" });
    expect(mockShUpdate).toHaveBeenCalledWith({
      where: { id: "sh_1" },
      data: { endedAt: expect.any(Date) },
    });
  });

  it("never throws, even when the DB is down", async () => {
    mockPodFindUnique.mockRejectedValue(new Error("db down"));
    await expect(closeSubscriptionHistory({ id: "pm_1" })).resolves.toBeUndefined();
  });
});

describe("reconcileOpenSubscriptionHistory", () => {
  it("closes open records whose pod no longer exists and keeps live ones", async () => {
    mockShFindMany.mockResolvedValue([
      { id: "sh_live", podSubscriptionId: "instance-i-aaa", stripeSubscriptionId: "sub_a", stripeCustomerId: "cus_a", poolId: 60 },
      { id: "sh_orphan", podSubscriptionId: "instance-i-gone", stripeSubscriptionId: "sub_x", stripeCustomerId: "cus_x", poolId: 60 },
    ]);
    mockPodFindMany.mockResolvedValue([
      { subscriptionId: "instance-i-aaa", stripeSubscriptionId: "sub_a", stripeCustomerId: "cus_a", poolId: "60" },
    ]);
    const closed = await reconcileOpenSubscriptionHistory();
    expect(closed).toBe(1);
    expect(mockShUpdate).toHaveBeenCalledTimes(1);
    expect(mockShUpdate).toHaveBeenCalledWith({
      where: { id: "sh_orphan" },
      data: { endedAt: expect.any(Date) },
    });
  });

  it("matches legacy records (no pod key) by Stripe subscription", async () => {
    mockShFindMany.mockResolvedValue([
      { id: "sh_legacy", podSubscriptionId: null, stripeSubscriptionId: "sub_a", stripeCustomerId: "cus_a", poolId: 60 },
    ]);
    mockPodFindMany.mockResolvedValue([
      { subscriptionId: "instance-i-aaa", stripeSubscriptionId: "sub_a", stripeCustomerId: "cus_a", poolId: "60" },
    ]);
    expect(await reconcileOpenSubscriptionHistory()).toBe(0);
    expect(mockShUpdate).not.toHaveBeenCalled();
  });

  it("returns 0 and never throws when the DB is down", async () => {
    mockShFindMany.mockRejectedValue(new Error("db down"));
    await expect(reconcileOpenSubscriptionHistory()).resolves.toBe(0);
  });
});
