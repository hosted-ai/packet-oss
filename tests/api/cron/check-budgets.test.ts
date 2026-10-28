// Tests for src/app/api/cron/check-budgets/route.ts.
//
// This cron is load-bearing for spend-limit enforcement: if it breaks,
// customers can overrun their budget caps and racks get stopped that shouldn't
// be — or worse, runaway spend goes unnoticed.
//
// Pinned contracts:
//   * Auth gating
//   * Per-customer error isolation — one bad customer must not abort the loop
//   * Alert threshold logic (50 / 80 / 100) with monthly-vs-daily dedup rules
//   * Auto-shutdown fires only when enabled AND threshold crossed
//
// We mock at the Prisma + Stripe + hostedai + email boundary. The route's
// pure helpers (isSameDay, percent math) are exercised through the public
// POST handler rather than imported directly — the file doesn't export them.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockBudgetSettingsFindMany,
  mockBudgetSettingsUpdate,
  mockBudgetAlertCreate,
  mockWalletTxnAggregate,
  mockGetStripe,
  mockStripeCustomersRetrieve,
  mockGetPoolSubscriptions,
  mockPodAction,
  mockSendBudgetAlertEmail,
  mockSendAutoShutdownNotificationEmail,
} = vi.hoisted(() => ({
  mockBudgetSettingsFindMany: vi.fn(),
  mockBudgetSettingsUpdate: vi.fn(),
  mockBudgetAlertCreate: vi.fn(),
  mockWalletTxnAggregate: vi.fn(),
  mockGetStripe: vi.fn(),
  mockStripeCustomersRetrieve: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockPodAction: vi.fn(),
  mockSendBudgetAlertEmail: vi.fn(),
  mockSendAutoShutdownNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetSettings: {
      findMany: mockBudgetSettingsFindMany,
      update: mockBudgetSettingsUpdate,
    },
    budgetAlert: { create: mockBudgetAlertCreate },
    walletTransaction: { aggregate: mockWalletTxnAggregate },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({
  getPoolSubscriptions: mockGetPoolSubscriptions,
  podAction: mockPodAction,
}));
vi.mock("@/lib/email", () => ({
  sendBudgetAlertEmail: mockSendBudgetAlertEmail,
  sendAutoShutdownNotificationEmail: mockSendAutoShutdownNotificationEmail,
}));

import { POST } from "@/app/api/cron/check-budgets/route";

const SECRET = "cron-budget-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeAuthorized() {
  const headers = new Headers();
  headers.set("x-cron-secret", SECRET);
  return new NextRequest("http://localhost/api/cron/check-budgets", {
    method: "POST",
    headers,
  });
}

function settingsFixture(overrides: Record<string, unknown> = {}) {
  return {
    stripeCustomerId: "cus_1",
    monthlyLimitCents: 10000,
    dailyLimitCents: null,
    alertAt50Percent: true,
    alertAt80Percent: true,
    alertAt100Percent: true,
    autoShutdownEnabled: false,
    autoShutdownThreshold: 100,
    lastAlertSentAt: null,
    lastAlertPercent: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  mockGetStripe.mockResolvedValue({
    customers: { retrieve: mockStripeCustomersRetrieve },
  });
  mockWalletTxnAggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
  mockBudgetSettingsUpdate.mockResolvedValue({});
  mockBudgetAlertCreate.mockResolvedValue({});
  mockSendBudgetAlertEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL;
});

describe("POST /api/cron/check-budgets", () => {
  it("returns 401 on unauthorized request", async () => {
    const req = new NextRequest(
      "http://localhost/api/cron/check-budgets",
      { method: "POST" },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockBudgetSettingsFindMany).not.toHaveBeenCalled();
  });

  it("succeeds with zero customers when no budget settings exist", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([]);

    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customersChecked).toBe(0);
    expect(body.alertsSent).toBe(0);
    expect(body.instancesStopped).toBe(0);
  });

  it("isolates per-customer errors — one failure does not abort the loop", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({ stripeCustomerId: "cus_breaks" }),
      settingsFixture({ stripeCustomerId: "cus_ok" }),
    ]);
    mockStripeCustomersRetrieve
      .mockRejectedValueOnce(new Error("stripe down"))
      .mockResolvedValueOnce({
        id: "cus_ok",
        email: "ok@x.com",
        metadata: {}, // no team_id → early return without throw
      });

    const res = await POST(makeAuthorized());
    const body = await res.json();

    // Both processed: one as an error placeholder, one as a real result.
    expect(res.status).toBe(200);
    expect(body.customersChecked).toBe(2);
  });

  it("sends a 50% alert when spend crosses the threshold and the customer opted in", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_50",
        monthlyLimitCents: 10000,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_50",
      email: "user@x.com",
      name: "User",
      metadata: { hostedai_team_id: "team_50" },
    });
    // Spend = 5500c → 55% of monthly 10000c limit → crosses 50%
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 5500 } }) // monthly
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });   // daily

    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(mockSendBudgetAlertEmail).toHaveBeenCalledTimes(1);
    expect(mockSendBudgetAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@x.com",
        percentUsed: 55,
        limitType: "monthly",
      }),
    );
    expect(body.alertsSent).toBe(1);
  });

  it("does NOT re-send the same monthly alert level on subsequent runs", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_dedup",
        monthlyLimitCents: 10000,
        lastAlertSentAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
        lastAlertPercent: 50,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_dedup",
      email: "u@x.com",
      metadata: { hostedai_team_id: "t1" },
    });
    // Same spend as last run — still 55%, 50% threshold already alerted.
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 5500 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });

    await POST(makeAuthorized());

    expect(mockSendBudgetAlertEmail).not.toHaveBeenCalled();
  });

  it("escalates from 50% to 80% when spend grows past a higher threshold", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_esc",
        monthlyLimitCents: 10000,
        lastAlertSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        lastAlertPercent: 50,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_esc",
      email: "u@x.com",
      metadata: { hostedai_team_id: "t1" },
    });
    // 85% — should send 80% alert despite prior 50% alert.
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 8500 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });

    await POST(makeAuthorized());

    expect(mockSendBudgetAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ percentUsed: 85 }),
    );
  });

  it("skips alert when threshold flag is disabled (alertAt100Percent=false)", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_off",
        monthlyLimitCents: 10000,
        alertAt100Percent: false,
        alertAt80Percent: false,
        alertAt50Percent: false,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_off",
      email: "u@x.com",
      metadata: { hostedai_team_id: "t1" },
    });
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 15000 } }) // 150%
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });

    await POST(makeAuthorized());

    expect(mockSendBudgetAlertEmail).not.toHaveBeenCalled();
  });

  it("does NOT auto-shutdown when autoShutdownEnabled=false even at 200%", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_no_shutdown",
        monthlyLimitCents: 1000,
        autoShutdownEnabled: false,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_no_shutdown",
      email: "u@x.com",
      metadata: { hostedai_team_id: "t1" },
    });
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 2000 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });

    await POST(makeAuthorized());

    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
    expect(mockPodAction).not.toHaveBeenCalled();
  });

  it("auto-shuts running pods when enabled AND threshold crossed", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_shutdown",
        monthlyLimitCents: 1000,
        autoShutdownEnabled: true,
        autoShutdownThreshold: 100,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_shutdown",
      email: "u@x.com",
      metadata: { hostedai_team_id: "team_shutdown" },
    });
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 1500 } }) // 150%
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: "sub_1",
        status: "active",
        pods: [
          { pod_name: "pod-a", pod_status: "running" },
          { pod_name: "pod-b", pod_status: "stopped" }, // shouldn't be stopped
        ],
      },
    ]);
    mockPodAction.mockResolvedValue({});

    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(mockPodAction).toHaveBeenCalledTimes(1);
    expect(mockPodAction).toHaveBeenCalledWith("pod-a", "sub_1", "stop");
    expect(body.instancesStopped).toBe(1);
    expect(mockSendAutoShutdownNotificationEmail).toHaveBeenCalledTimes(1);
  });

  it("takes no action when spend is under every budget threshold", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({
        stripeCustomerId: "cus_under",
        monthlyLimitCents: 10000,
        autoShutdownEnabled: true,
        autoShutdownThreshold: 100,
      }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_under",
      email: "u@x.com",
      metadata: { hostedai_team_id: "team_under" },
    });
    // Spend = 3000c → 30% of the 10000c monthly limit — under every alert
    // threshold (50/80/100) and the auto-shutdown threshold.
    mockWalletTxnAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 3000 } }) // monthly
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });   // daily

    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alertsSent).toBe(0);
    expect(body.instancesStopped).toBe(0);
    expect(mockSendBudgetAlertEmail).not.toHaveBeenCalled();
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
    expect(mockPodAction).not.toHaveBeenCalled();
  });

  it("skips customers without a hostedai_team_id (orphan accounts)", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({ stripeCustomerId: "cus_orphan" }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_orphan",
      email: "u@x.com",
      metadata: {}, // no team_id
    });

    const res = await POST(makeAuthorized());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alertsSent).toBe(0);
    expect(mockWalletTxnAggregate).not.toHaveBeenCalled();
  });

  it("skips deleted Stripe customers", async () => {
    mockBudgetSettingsFindMany.mockResolvedValue([
      settingsFixture({ stripeCustomerId: "cus_deleted" }),
    ]);
    mockStripeCustomersRetrieve.mockResolvedValue({
      id: "cus_deleted",
      deleted: true,
    });

    const res = await POST(makeAuthorized());

    expect(res.status).toBe(200);
    expect(mockWalletTxnAggregate).not.toHaveBeenCalled();
  });
});
