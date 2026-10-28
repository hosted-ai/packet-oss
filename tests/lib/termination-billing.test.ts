// The early-termination credit used to exist only in the console terminate
// route, so API terminations kept the whole prepaid 30-minute block. These
// tests pin the shared reconciliation both routes now call.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateBalanceTransaction, mockListBalanceTransactions, mockWalletTransactionCreate } =
  vi.hoisted(() => ({
    mockCreateBalanceTransaction: vi.fn(),
    mockListBalanceTransactions: vi.fn(),
    mockWalletTransactionCreate: vi.fn(),
  }));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    customers: {
      createBalanceTransaction: mockCreateBalanceTransaction,
      listBalanceTransactions: mockListBalanceTransactions,
    },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { walletTransaction: { create: mockWalletTransactionCreate } },
}));

import { reconcileTerminationBilling } from "@/lib/termination-billing";

const NOW = new Date("2026-08-25T12:00:00.000Z");

function minutesFromNow(mins: number) {
  return new Date(NOW.getTime() + mins * 60 * 1000);
}

describe("reconcileTerminationBilling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockListBalanceTransactions.mockResolvedValue({ data: [] });
    mockCreateBalanceTransaction.mockResolvedValue({});
    mockWalletTransactionCreate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("credits the unused remainder of a paid block on early termination", async () => {
    // Block paid to now+20min → 10 min used, 20 min unused @ $5.90/hr = $1.97.
    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: { prepaidUntil: minutesFromNow(20), hourlyRateCents: 590, poolId: "163", deployStatus: "running" },
      ref: { instanceId: "i-abc" },
    });

    expect(result.creditedCents).toBe(197);
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith("cus_1", {
      amount: -197,
      currency: "usd",
      description: "GPU early termination credit: 20 mins unused",
      metadata: { instance_id: "i-abc" },
    });
    expect(mockWalletTransactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeCustomerId: "cus_1",
        type: "refund",
        amountCents: -197,
        subscriptionId: "i-abc",
        poolId: 163,
        billingMinutes: 20,
      }),
    });
  });

  it("charges unbilled time past prepaidUntil instead of crediting", async () => {
    // prepaidUntil 10 min ago @ $6.00/hr → $1.00 final charge.
    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: { prepaidUntil: minutesFromNow(-10), hourlyRateCents: 600, poolId: null, deployStatus: "running" },
      ref: { instanceId: "i-abc" },
    });

    expect(result.chargedCents).toBe(100);
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({
        amount: 100,
        description: "GPU final usage: 10 mins after prepaid period",
      }),
    );
  });

  it("keeps the legacy pool-subscription metadata shape and gpuCount", async () => {
    await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: { prepaidUntil: minutesFromNow(15), hourlyRateCents: 100, poolId: "7", deployStatus: "running" },
      ref: { subscriptionId: "12345" },
      gpuCount: 1,
    });

    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({
        metadata: {
          subscription_id: "12345",
          unused_minutes: "15",
          credit_back_cents: "25",
        },
      }),
    );
    expect(mockWalletTransactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ gpuCount: 1, poolId: 7 }),
    });
  });

  it("is idempotent — a credit already on the balance is not issued twice", async () => {
    mockListBalanceTransactions.mockResolvedValue({
      data: [
        {
          amount: -197,
          description: "GPU early termination credit: 20 mins unused",
          metadata: { instance_id: "i-abc" },
        },
      ],
    });

    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: { prepaidUntil: minutesFromNow(20), hourlyRateCents: 590, poolId: null, deployStatus: "running" },
      ref: { instanceId: "i-abc" },
    });

    expect(result.creditedCents).toBe(0);
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it("moves the ledger no further once the deploy monitor refunded the block", async () => {
    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: {
        prepaidUntil: minutesFromNow(24),
        hourlyRateCents: 375,
        poolId: null,
        deployStatus: "failed_refunded",
      },
      ref: { instanceId: "i-abc" },
    });

    expect(result).toEqual({ creditedCents: 0, chargedCents: 0 });
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
    expect(mockWalletTransactionCreate).not.toHaveBeenCalled();
  });

  it("charges nothing extra on a refunded block terminated after prepaidUntil", async () => {
    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: "team-1",
      podMetadata: {
        prepaidUntil: minutesFromNow(-40),
        hourlyRateCents: 375,
        poolId: null,
        deployStatus: "failed_refunded",
      },
      ref: { instanceId: "i-abc" },
    });

    expect(result).toEqual({ creditedCents: 0, chargedCents: 0 });
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it("no-ops for pods without prepaid billing metadata", async () => {
    const result = await reconcileTerminationBilling({
      stripeCustomerId: "cus_1",
      teamId: null,
      podMetadata: { prepaidUntil: null, hourlyRateCents: null, poolId: null, deployStatus: null },
      ref: { instanceId: "i-abc" },
    });

    expect(result).toEqual({ creditedCents: 0, chargedCents: 0 });
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });
});
