// Tests for the GET handler in src/app/api/admin/business-metrics/route.ts.
//
// PA-287: admin observability coverage — and the highest-value target in the
// batch. This route aggregates a full business dashboard from Stripe
// (revenue, refunds, customers, wallet balances, top spenders) and Prisma
// (providers, node usage, vouchers, referrals, pod-usage hours), overlaid
// with the pool-overview cache for GPU stats. The compute is the product
// surface, so these tests pin CONCRETE computed values with known inputs:
//   * auth gating (401 no cookie / 401 bad token),
//   * the Stripe-not-configured empty envelope (every aggregate 0, no NaN),
//   * revenue/refunds/period-change math with hand-picked charges,
//   * customer counts (total/new/previousNew/active), wallet totals/averages,
//   * provider + node-usage + voucher + referral roll-ups,
//   * top-customers-by-balance and top-spenders ordering,
//   * period→periodDays mapping and the Stripe `created` window forwarding,
//   * the empty-data envelope (zeroed, not NaN/undefined),
//   * the 500 path.
//
// NOTE: the route keeps a module-level 6h cache keyed by period. Every test
// here either passes refresh=true to bypass it or uses a unique period, so
// tests never see another test's cached payload.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetStripe,
  mockChargesList,
  mockCustomersList,
  mockReadPoolOverviewCache,
  mockPodMetadataFindMany,
  mockCustomerCacheFindMany,
  mockServiceProviderFindMany,
  mockProviderNodeUsageFindMany,
  mockVoucherFindMany,
  mockReferralCodeFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockChargesList: vi.fn(),
  mockCustomersList: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
  mockPodMetadataFindMany: vi.fn(),
  mockCustomerCacheFindMany: vi.fn(),
  mockServiceProviderFindMany: vi.fn(),
  mockProviderNodeUsageFindMany: vi.fn(),
  mockVoucherFindMany: vi.fn(),
  mockReferralCodeFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: mockReadPoolOverviewCache,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findMany: mockPodMetadataFindMany },
    customerCache: { findMany: mockCustomerCacheFindMany },
    serviceProvider: { findMany: mockServiceProviderFindMany },
    providerNodeUsage: { findMany: mockProviderNodeUsageFindMany },
    voucher: { findMany: mockVoucherFindMany },
    referralCode: { findMany: mockReferralCodeFindMany },
  },
}));

import { GET } from "@/app/api/admin/business-metrics/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

let periodCounter = 0;
/** Unique period each call so the module cache never serves a stale payload. */
function uniquePeriodQuery(extra = "") {
  periodCounter += 1;
  return `period=p${periodCounter}&refresh=true${extra ? `&${extra}` : ""}`;
}

function makeRequest(query: string, { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/business-metrics${query ? `?${query}` : ""}`;
  return new NextRequest(url, { method: "GET", headers });
}

const nowSec = Math.floor(Date.now() / 1000);

function charge(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `ch_${Math.random().toString(36).slice(2)}`,
    amount: 0,
    amount_refunded: 0,
    status: "succeeded",
    refunded: false,
    created: nowSec - 60 * 60, // 1h ago, inside any period
    customer: null,
    ...over,
  };
}

function customer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `cus_${Math.random().toString(36).slice(2)}`,
    email: "c@example.com",
    name: "Cust",
    balance: 0,
    created: nowSec - 60 * 60,
    deleted: false,
    metadata: {},
    ...over,
  };
}

/** Make charges.list/customers.list return a single non-paginated page. */
function singlePage(data: unknown[]) {
  return { data, has_more: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });

  mockChargesList.mockResolvedValue(singlePage([]));
  mockCustomersList.mockResolvedValue(singlePage([]));
  mockGetStripe.mockResolvedValue({
    charges: { list: mockChargesList },
    customers: { list: mockCustomersList },
  });

  mockReadPoolOverviewCache.mockReturnValue(null);
  mockPodMetadataFindMany.mockResolvedValue([]);
  mockCustomerCacheFindMany.mockResolvedValue([]);
  mockServiceProviderFindMany.mockResolvedValue([]);
  mockProviderNodeUsageFindMany.mockResolvedValue([]);
  mockVoucherFindMany.mockResolvedValue([]);
  mockReferralCodeFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/business-metrics — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest(uniquePeriodQuery(), { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest(uniquePeriodQuery()));
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/business-metrics — Stripe not configured", () => {
  it("returns a fully zeroed envelope with a notice (no NaN)", async () => {
    mockGetStripe.mockRejectedValue(new Error("STRIPE_SECRET_KEY is not set"));

    const res = await GET(makeRequest(uniquePeriodQuery()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.notice).toContain("Stripe is not configured");
    expect(body.revenue).toEqual({ total: 0, previous: 0, change: 0, refunds: 0, daily: [] });
    expect(body.customers.total).toBe(0);
    expect(body.gpu).toEqual({
      activeGPUs: 0,
      activePods: 0,
      totalHoursUsed: 0,
      totalUsageCost: 0,
      avgUtilization: 0,
    });
    // No prisma aggregation should run on the Stripe-missing short-circuit.
    expect(mockServiceProviderFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/business-metrics — period mapping & windows", () => {
  it("maps 7d/30d/90d/all to periodDays", async () => {
    for (const [period, days] of [
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
      ["all", 365 * 10],
    ] as const) {
      const body = await (
        await GET(makeRequest(`period=${period}&refresh=true`))
      ).json();
      expect(body.period).toBe(period);
      expect(body.periodDays).toBe(days);
    }
  });

  it("defaults to a 30d period when none is supplied", async () => {
    const body = await (await GET(makeRequest("refresh=true"))).json();
    expect(body.period).toBe("30d");
    expect(body.periodDays).toBe(30);
  });

  it("forwards a Stripe `created.gte` window to charges.list", async () => {
    await GET(makeRequest("period=7d&refresh=true"));
    const firstCall = mockChargesList.mock.calls[0][0];
    expect(firstCall.created).toHaveProperty("gte");
    expect(typeof firstCall.created.gte).toBe("number");
    expect(firstCall.limit).toBe(100);
  });
});

describe("GET /api/admin/business-metrics — revenue math", () => {
  it("sums succeeded non-refunded charges and converts cents→dollars", async () => {
    // current period (1h ago): 10000 + 2500 = 12500 cents → 125.00
    // a refunded charge contributes refunds, not revenue.
    mockChargesList
      .mockResolvedValueOnce(
        singlePage([
          charge({ amount: 10000 }),
          charge({ amount: 2500 }),
          charge({ amount: 9999, status: "failed" }), // excluded
          charge({ amount: 5000, refunded: true, amount_refunded: 5000 }), // refund only
        ])
      )
      // previous-period charges:
      .mockResolvedValueOnce(singlePage([]));

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.revenue.total).toBe(125);
    expect(body.revenue.refunds).toBe(50);
    // previous = 0 → change defended to 0 (no divide-by-zero NaN).
    expect(body.revenue.change).toBe(0);
  });

  it("computes the period-over-period change percentage", async () => {
    // current = 15000 cents (150), previous = 10000 cents (100) → +50%
    mockChargesList
      .mockResolvedValueOnce(singlePage([charge({ amount: 15000 })]))
      .mockResolvedValueOnce(
        singlePage([charge({ amount: 10000, created: nowSec - 40 * 24 * 60 * 60 })])
      );

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.revenue.total).toBe(150);
    expect(body.revenue.previous).toBe(100);
    expect(body.revenue.change).toBe(50);
  });

  it("paginates charges until has_more is false", async () => {
    mockChargesList
      // current period: page 1 then page 2
      .mockResolvedValueOnce({ data: [charge({ amount: 1000 })], has_more: true })
      .mockResolvedValueOnce({ data: [charge({ amount: 2000 })], has_more: false })
      // previous period: empty
      .mockResolvedValueOnce(singlePage([]));

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.revenue.total).toBe(30); // (1000 + 2000) / 100
  });
});

describe("GET /api/admin/business-metrics — customer & wallet math", () => {
  it("counts total/new customers and totals wallet balances", async () => {
    mockCustomersList.mockResolvedValue(
      singlePage([
        // negative balance = owed credit; abs summed for wallet
        customer({ id: "cus_1", balance: -5000, created: nowSec - 60 * 60 }),
        customer({ id: "cus_2", balance: -2500, created: nowSec - 60 * 60 }),
        // positive balance contributes 0 to wallet, not active
        customer({ id: "cus_3", balance: 1000, created: nowSec - 60 * 60 }),
      ])
    );

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.customers.total).toBe(3);
    expect(body.customers.new).toBe(3); // all created within period
    // active = customers with balance < 0 → cus_1, cus_2
    expect(body.customers.active).toBe(2);
    // wallet total = (5000 + 2500) / 100 = 75
    expect(body.wallet.totalBalance).toBe(75);
    // avg = 75 / 3 = 25
    expect(body.wallet.avgBalance).toBe(25);
  });

  it("classifies customers by billing_type metadata", async () => {
    mockCustomersList.mockResolvedValue(
      singlePage([
        customer({ metadata: { billing_type: "hourly" } }),
        customer({ metadata: { billing_type: "hourly" } }),
        customer({ metadata: { billing_type: "monthly" } }),
      ])
    );
    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.customers.hourly).toBe(2);
    expect(body.customers.monthly).toBe(1);
  });

  it("ranks top customers by balance descending", async () => {
    mockCustomersList.mockResolvedValue(
      singlePage([
        customer({ id: "cus_small", email: "small@x.io", balance: -1000 }),
        customer({ id: "cus_big", email: "big@x.io", balance: -9000 }),
      ])
    );
    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.topCustomers.byBalance[0].id).toBe("cus_big");
    expect(body.topCustomers.byBalance[0].balance).toBe(90);
    expect(body.topCustomers.byBalance[1].id).toBe("cus_small");
  });

  it("ranks top spenders by succeeded charge totals", async () => {
    mockCustomersList.mockResolvedValue(
      singlePage([
        customer({ id: "cus_a", email: "a@x.io" }),
        customer({ id: "cus_b", email: "b@x.io" }),
      ])
    );
    mockChargesList
      .mockResolvedValueOnce(
        singlePage([
          charge({ amount: 3000, customer: "cus_a" }),
          charge({ amount: 1000, customer: "cus_a" }),
          charge({ amount: 9000, customer: "cus_b" }),
        ])
      )
      .mockResolvedValueOnce(singlePage([]));

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.topCustomers.bySpending[0].id).toBe("cus_b");
    expect(body.topCustomers.bySpending[0].spent).toBe(90);
    expect(body.topCustomers.bySpending[1].id).toBe("cus_a");
    expect(body.topCustomers.bySpending[1].spent).toBe(40); // (3000+1000)/100
  });
});

describe("GET /api/admin/business-metrics — provider & marketing roll-ups", () => {
  it("aggregates providers, nodes and payouts", async () => {
    mockServiceProviderFindMany.mockResolvedValue([
      {
        status: "approved",
        nodes: [{ status: "active" }, { status: "approved" }, { status: "down" }],
        payouts: [{ netPayoutCents: 10000 }, { netPayoutCents: 5000 }],
      },
      {
        status: "pending",
        nodes: [{ status: "active" }],
        payouts: [],
      },
    ]);
    mockProviderNodeUsageFindMany.mockResolvedValue([
      { customerRevenueCents: 20000, providerEarningsCents: 12000, packetMarginCents: 8000 },
    ]);

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.providers.total).toBe(2);
    expect(body.providers.active).toBe(1); // only "approved" provider
    expect(body.providers.totalNodes).toBe(4);
    expect(body.providers.activeNodes).toBe(3); // active+approved across providers
    expect(body.providers.payouts).toBe(150); // (10000+5000)/100
    expect(body.providers.revenue).toBe(200);
    expect(body.providers.earnings).toBe(120);
    expect(body.providers.margin).toBe(80);
  });

  it("aggregates voucher and referral marketing metrics", async () => {
    mockVoucherFindMany.mockResolvedValue([
      {
        active: true,
        redemptions: [{ creditCents: 5000 }, { creditCents: 2500 }],
      },
      { active: false, redemptions: [{ creditCents: 1000 }] },
    ]);
    mockReferralCodeFindMany.mockResolvedValue([
      {
        claims: [{ status: "qualified" }, { status: "pending" }, { status: "qualified" }],
      },
    ]);

    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.marketing.voucherRedemptions).toBe(3);
    expect(body.marketing.voucherCreditsGiven).toBe(85); // (5000+2500+1000)/100
    expect(body.marketing.activeVouchers).toBe(1);
    expect(body.marketing.referralClaims).toBe(3);
    expect(body.marketing.referralConversions).toBe(2);
    expect(body.marketing.activeReferralCodes).toBe(1);
  });
});

describe("GET /api/admin/business-metrics — GPU stats from pool-overview", () => {
  it("surfaces active GPU/pod/utilization from the pool-overview cache", async () => {
    mockReadPoolOverviewCache.mockReturnValue({
      summary: { activePods: 4, allocatedGpus: 9, utilizationPercent: 73.456 },
      pools: [],
    });
    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.gpu.activePods).toBe(4);
    expect(body.gpu.activeGPUs).toBe(9);
    // rounded to 2dp
    expect(body.gpu.avgUtilization).toBe(73.46);
  });

  it("zeroes GPU stats (not NaN) when no pool-overview cache exists", async () => {
    mockReadPoolOverviewCache.mockReturnValue(null);
    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.gpu.activePods).toBe(0);
    expect(body.gpu.activeGPUs).toBe(0);
    expect(body.gpu.avgUtilization).toBe(0);
    expect(Number.isNaN(body.gpu.totalHoursUsed)).toBe(false);
  });
});

describe("GET /api/admin/business-metrics — empty & cache & error", () => {
  it("returns a sane zeroed envelope with no data anywhere (no NaN/undefined)", async () => {
    const body = await (await GET(makeRequest(uniquePeriodQuery()))).json();
    expect(body.revenue.total).toBe(0);
    expect(body.revenue.change).toBe(0);
    expect(body.customers.total).toBe(0);
    expect(body.customers.avgValue).toBe(0);
    expect(body.wallet.avgBalance).toBe(0);
    expect(body.providers.total).toBe(0);
    expect(body.marketing.voucherRedemptions).toBe(0);
    // Defensive: nothing came back NaN.
    const flat = JSON.stringify(body);
    expect(flat).not.toContain("null,\"change\":null");
    expect(Number.isNaN(body.wallet.avgBalance)).toBe(false);
    expect(Number.isNaN(body.customers.change)).toBe(false);
  });

  it("serves a cached payload on a second request without refresh", async () => {
    const period = `cache-test-${Date.now()}`;
    // First request populates the cache (refresh forces compute).
    mockChargesList
      .mockResolvedValueOnce(singlePage([charge({ amount: 4200 })]))
      .mockResolvedValueOnce(singlePage([]));
    const first = await (await GET(makeRequest(`period=${period}&refresh=true`))).json();
    expect(first.revenue.total).toBe(42);

    // Change the underlying data; without refresh the cache must win.
    mockChargesList.mockReset();
    mockChargesList.mockResolvedValue(singlePage([charge({ amount: 999999 })]));
    const second = await (await GET(makeRequest(`period=${period}`))).json();
    expect(second.revenue.total).toBe(42);
    expect(second.cachedAt).toBeDefined();
    // Stripe must not have been re-queried on the cache hit.
    expect(mockChargesList).not.toHaveBeenCalled();
  });

  it("returns 500 when a prisma aggregation throws", async () => {
    mockServiceProviderFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest(uniquePeriodQuery()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch business metrics");
  });
});
