// recordSubscription: a monthly checkout can be a customer's first-ever
// touchpoint (fresh signup -> immediate subscription, skipping
// /api/account/signup), so no CustomerLifecycle row exists yet. Regression
// coverage for PA-413 — the "Subscribed (Monthly)" funnel stage always
// reading 0 because updateMany silently matched zero rows.
//
// PA-415: recordFirstDeposit must credit the funnel milestone for monthly
// subscribers too, without corrupting currentBillingType for them.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpsert, mockUpdateMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerLifecycle: { upsert: mockUpsert, updateMany: mockUpdateMany },
  },
}));

import {
  recordSubscription,
  recordFirstDeposit,
  recordFirstWorkloadBatch,
} from "@/lib/lifecycle";

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue(undefined);
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("recordSubscription", () => {
  it("creates the CustomerLifecycle row first, so the milestone write actually matches it", async () => {
    await recordSubscription("cus_fresh_1", "fresh@example.com");

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: "cus_fresh_1" },
        create: expect.objectContaining({
          stripeCustomerId: "cus_fresh_1",
          email: "fresh@example.com",
        }),
        update: {},
      })
    );
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_fresh_1", subscribedAt: null },
      data: expect.objectContaining({ currentBillingType: "monthly" }),
    });
  });

  it("does not overwrite an existing row's other fields (write-once milestone)", async () => {
    // upsert's update clause is empty — an existing row (with its own
    // signedUpAt/attribution) is left untouched, only the updateMany below
    // can set subscribedAt, and only when it's still null.
    await recordSubscription("cus_existing_1", "existing@example.com");

    const upsertCall = mockUpsert.mock.calls[0][0];
    expect(upsertCall.update).toEqual({});
  });

  it("never throws even if the DB call rejects (fire-and-forget contract)", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("db down"));

    await expect(recordSubscription("cus_err", "err@example.com")).resolves.toBeUndefined();
  });
});

describe("recordFirstDeposit", () => {
  it("defaults to currentBillingType: hourly for a wallet deposit", async () => {
    await recordFirstDeposit("cus_1", 10000);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentBillingType: "hourly" }),
      })
    );
  });

  it("stamps currentBillingType: monthly for a monthly subscription payment", async () => {
    await recordFirstDeposit("cus_2", 29900, "monthly");

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalDepositsCents: { increment: 29900 },
          depositCount: { increment: 1 },
          currentBillingType: "monthly",
        }),
      })
    );
  });
});

// PA-693: activation milestone stamped by the GPU-metrics sweep.
describe("recordFirstWorkloadBatch", () => {
  it("stamps firstWorkloadAt only where still null, deduping and skipping 'unknown'", async () => {
    const at = new Date("2026-08-06T12:00:00Z");
    await recordFirstWorkloadBatch(["cus_a", "cus_b", "cus_a", "unknown", ""], at);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: { in: ["cus_a", "cus_b"] }, firstWorkloadAt: null },
      data: { firstWorkloadAt: at },
    });
  });

  it("no-ops on an empty (or all-filtered) batch", async () => {
    await recordFirstWorkloadBatch([]);
    await recordFirstWorkloadBatch(["unknown"]);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("never throws even if the DB call rejects (fire-and-forget contract)", async () => {
    mockUpdateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(recordFirstWorkloadBatch(["cus_a"])).resolves.toBeUndefined();
  });
});
