// Tests for src/app/api/cron/midnight-status-email/route.ts.
//
// Daily KPI cron emailed to partners@hosted.ai. Bugs here = wrong numbers in
// the daily exec report. We pin the auth gate and the snapshot collection
// invocation. The interior MRR/snapshot math is light enough that the route
// is largely a Stripe+Prisma adapter; we exercise it via the public handler.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetStripe,
  mockSendMidnightStatusEmail,
  mockCustomerCacheFindMany,
  mockEmailLogDeleteMany,
  mockPodMetricsFindMany,
  mockServiceProviderCount,
  mockProviderNodeCount,
  mockInferenceUsageCount,
  mockInferenceUsageAggregate,
  mockVoucherRedemptionCount,
  mockReferralClaimCount,
  mockStripeChargesList,
  mockStripeSubscriptionsList,
  mockAdminStatsSnapshotFindUnique,
} = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockSendMidnightStatusEmail: vi.fn(),
  mockCustomerCacheFindMany: vi.fn(),
  mockEmailLogDeleteMany: vi.fn(),
  mockPodMetricsFindMany: vi.fn(),
  mockServiceProviderCount: vi.fn(),
  mockProviderNodeCount: vi.fn(),
  mockInferenceUsageCount: vi.fn(),
  mockInferenceUsageAggregate: vi.fn(),
  mockVoucherRedemptionCount: vi.fn(),
  mockReferralClaimCount: vi.fn(),
  mockStripeChargesList: vi.fn(),
  mockStripeSubscriptionsList: vi.fn(),
  mockAdminStatsSnapshotFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: { findMany: mockCustomerCacheFindMany },
    emailLog: { deleteMany: mockEmailLogDeleteMany },
    podMetricsHistory: { findMany: mockPodMetricsFindMany },
    serviceProvider: { count: mockServiceProviderCount },
    providerNode: { count: mockProviderNodeCount },
    inferenceUsage: {
      count: mockInferenceUsageCount,
      aggregate: mockInferenceUsageAggregate,
    },
    voucherRedemption: { count: mockVoucherRedemptionCount },
    referralClaim: { count: mockReferralClaimCount },
    // previousMrrCents now reads the same-day-last-week value from the daily
    // AdminStatsSnapshot (findUnique by date); null → route falls back to mrrCents.
    adminStatsSnapshot: { findUnique: mockAdminStatsSnapshotFindUnique },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/email/templates/midnight-status", () => ({
  sendMidnightStatusEmail: mockSendMidnightStatusEmail,
}));

import { POST } from "@/app/api/cron/midnight-status-email/route";

const SECRET = "cron-status-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeAuthorized() {
  const headers = new Headers();
  headers.set("x-cron-secret", SECRET);
  return new NextRequest(
    "http://localhost/api/cron/midnight-status-email",
    { method: "POST", headers },
  );
}

function setUpMinimalMocks() {
  mockEmailLogDeleteMany.mockResolvedValue({ count: 0 });
  mockCustomerCacheFindMany.mockResolvedValue([]);
  mockPodMetricsFindMany.mockResolvedValue([]);
  mockServiceProviderCount.mockResolvedValue(0);
  mockProviderNodeCount.mockResolvedValue(0);
  mockInferenceUsageCount.mockResolvedValue(0);
  mockInferenceUsageAggregate.mockResolvedValue({
    _sum: { inputTokens: 0, outputTokens: 0 },
  });
  mockVoucherRedemptionCount.mockResolvedValue(0);
  mockReferralClaimCount.mockResolvedValue(0);
  mockStripeChargesList.mockResolvedValue({ data: [] });
  mockStripeSubscriptionsList.mockResolvedValue({ data: [] });
  mockGetStripe.mockResolvedValue({
    charges: { list: mockStripeChargesList },
    subscriptions: { list: mockStripeSubscriptionsList },
  });
  mockSendMidnightStatusEmail.mockResolvedValue(undefined);
  // No prior snapshot by default → previousMrrCents falls back to current mrr.
  mockAdminStatsSnapshotFindUnique.mockResolvedValue(null);
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  setUpMinimalMocks();
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL;
});

describe("POST /api/cron/midnight-status-email", () => {
  it("returns 401 on unauthorized request", async () => {
    const req = new NextRequest(
      "http://localhost/api/cron/midnight-status-email",
      { method: "POST" },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockSendMidnightStatusEmail).not.toHaveBeenCalled();
  });

  it("sends the email to partners@hosted.ai on success", async () => {
    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sentTo).toBe("partners@hosted.ai");
    expect(mockSendMidnightStatusEmail).toHaveBeenCalledTimes(1);
    expect(mockSendMidnightStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "partners@hosted.ai" }),
    );
  });

  it("includes a 7-day history (8 snapshots: yesterday + 7 days back + last-week)", async () => {
    await POST(makeAuthorized());

    const call = mockSendMidnightStatusEmail.mock.calls[0][0];
    expect(call.weekHistory).toHaveLength(7);
    // Confirm chronological order (oldest first).
    const dates = call.weekHistory.map((s: { date: string }) => s.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("sums monthly recurring revenue from active subscriptions correctly", async () => {
    mockStripeSubscriptionsList.mockResolvedValue({
      data: [
        {
          items: {
            data: [
              {
                price: { unit_amount: 5000, recurring: { interval: "month" } },
                quantity: 2,
              },
            ],
          },
        },
        {
          items: {
            data: [
              {
                price: { unit_amount: 120000, recurring: { interval: "year" } },
                quantity: 1,
              },
            ],
          },
        },
      ],
    });

    await POST(makeAuthorized());

    const call = mockSendMidnightStatusEmail.mock.calls[0][0];
    // monthly: 5000 * 2 = 10000
    // yearly: 120000 / 12 = 10000
    // total = 20000
    expect(call.mrrCents).toBe(20000);
  });

  it("counts wallet deposits from succeeded, non-refunded Stripe charges only", async () => {
    mockCustomerCacheFindMany.mockResolvedValue([
      {
        id: "c1",
        stripeCreatedAt: new Date("2020-01-01"),
        balanceCents: 0,
        isDeleted: false,
      },
    ]);
    mockStripeChargesList.mockResolvedValue({
      data: [
        { status: "succeeded", amount: 5000, amount_refunded: 0 },
        // Fully refunded (amount_refunded == amount) → net 0, not a deposit that
        // stuck. The product nets via amount_refunded, not the `refunded` flag.
        { status: "succeeded", amount: 9999, amount_refunded: 9999 },
        { status: "failed", amount: 3000, amount_refunded: 0 }, // excluded (not succeeded)
        { status: "succeeded", amount: 7500, amount_refunded: 0 },
      ],
    });

    await POST(makeAuthorized());

    const call = mockSendMidnightStatusEmail.mock.calls[0][0];
    expect(call.today.walletDeposits).toBe(2);
    expect(call.today.walletRevenueCents).toBe(12500);
  });

  it("returns 500 (not 200) when sendMidnightStatusEmail throws", async () => {
    mockSendMidnightStatusEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(makeAuthorized());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("failed");
  });

  it("tolerates EmailLog purge errors (table may not exist yet)", async () => {
    mockEmailLogDeleteMany.mockRejectedValue(
      new Error("Table 'email_log' doesn't exist"),
    );

    const res = await POST(makeAuthorized());

    // The route swallows this specific error.
    expect(res.status).toBe(200);
    expect(mockSendMidnightStatusEmail).toHaveBeenCalled();
  });
});
