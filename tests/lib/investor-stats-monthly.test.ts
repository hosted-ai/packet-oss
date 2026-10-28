// PA-354 regression: monthly-subscription revenue was structurally invisible
// to the investor portal (wallet_transaction-only queries). These tests drive
// computeInvestorStats with an empty wallet ledger + SubscriptionHistory
// records and assert every metric the fix touches: gross this/last month
// (Issues 1/9), per-sub createdAt (3), contracted-price proration (5/6),
// daily chart (8), churn + concentration (10), and sell-through (11).
// Before the fix all of these were $0 / null / wrong.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  assignedNodes: vi.fn(),
  revShare: vi.fn(),
  poolCache: vi.fn(),
  gpuProductFindMany: vi.fn(),
  providerNodeFindMany: vi.fn(),
  walletGroupBy: vi.fn(),
  podFindMany: vi.fn(),
  shFindMany: vi.fn(),
  queryRaw: vi.fn(),
  customersList: vi.fn(),
  cacheFindMany: vi.fn(),
}));

// Spread the real module so pure helpers (parseAssignedRegionIds) stay real and
// adding another one later doesn't break this suite — only the DB-backed
// accessors are faked.
vi.mock("@/lib/auth/investor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/investor")>()),
  getInvestorAssignedNodes: m.assignedNodes,
  getInvestorRevenueShare: m.revShare,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    customers: { list: m.customersList, listBalanceTransactions: vi.fn() },
  }),
}));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: m.poolCache,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findMany: m.gpuProductFindMany },
    providerNode: { findMany: m.providerNodeFindMany },
    walletTransaction: { groupBy: m.walletGroupBy },
    podMetadata: { findMany: m.podFindMany },
    subscriptionHistory: { findMany: m.shFindMany },
    $queryRaw: m.queryRaw,
    customerCache: { findMany: m.cacheFindMany },
  },
}));

import { computeInvestorStats } from "@/lib/investor-stats";

// Frozen clock: 2026-07-15 → July has 31 days, 15 days elapsed; June has 30.
const NOW = new Date("2026-07-15T12:00:00.000Z");

const POOL_CACHE = {
  pools: [
    {
      id: 60,
      clusterId: 1,
      name: "b200-monthly-60",
      totalGpus: 8,
      overcommitRatio: 1,
      gpus: [{ nodeId: 5, gpuModel: "B200" }],
      nodes: [{ id: 5, name: "node-5", ip: "10.0.0.5", gpuModel: "B200", gpuCount: 8, initStatus: 2 }],
      pods: [
        { subscriptionId: "i-aaa", teamId: "team-a", vgpuCount: 1, status: "active", podName: "pod-a", customerEmail: "a@ext.com" },
        { subscriptionId: "i-bbb", teamId: "team-b", vgpuCount: 1, status: "active", podName: "pod-b", customerEmail: "b@ext.com" },
      ],
    },
  ],
};

// Two live subscribers at DIFFERENT price points (Issue 6) + one churned in June.
const HISTORY = [
  { poolId: 60, stripeCustomerId: "cus_a", startedAt: new Date("2026-05-20T00:00:00Z"), endedAt: null, priceCents: 29900 },
  { poolId: 60, stripeCustomerId: "cus_b", startedAt: new Date("2026-06-05T00:00:00Z"), endedAt: null, priceCents: 19900 },
  { poolId: 60, stripeCustomerId: "cus_c", startedAt: new Date("2026-04-01T00:00:00Z"), endedAt: new Date("2026-06-20T00:00:00Z"), priceCents: 29900 },
];

// Expected proration (whole UTC calendar days, per month's own day count):
const A_JUL = Math.round((29900 / 31) * 15); // Jul 1–15
const B_JUL = Math.round((19900 / 31) * 15);
const THIS_MONTH = A_JUL + B_JUL;
const A_JUN = 29900; // full June
const B_JUN = Math.round((19900 / 30) * 26); // Jun 5–30
const C_JUN = Math.round((29900 / 30) * 20); // Jun 1–20 (churned)
const LAST_MONTH = A_JUN + B_JUN + C_JUN;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  m.assignedNodes.mockResolvedValue(["pools:60"]);
  m.revShare.mockResolvedValue(70);
  m.poolCache.mockReturnValue(POOL_CACHE);
  m.gpuProductFindMany.mockResolvedValue([]);
  m.providerNodeFindMany.mockResolvedValue([]);
  m.walletGroupBy.mockResolvedValue([]);
  m.podFindMany.mockResolvedValue([]);
  m.shFindMany.mockResolvedValue(HISTORY);
  m.queryRaw.mockResolvedValue([]);
  m.cacheFindMany.mockResolvedValue([]);
  m.customersList.mockResolvedValue({
    data: [
      { id: "cus_a", email: "a@ext.com", name: "A", metadata: { hostedai_team_id: "team-a" } },
      { id: "cus_b", email: "b@ext.com", name: "B", metadata: { hostedai_team_id: "team-b" } },
    ],
    has_more: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeInvestorStats — monthly pools (PA-354)", () => {
  it("Issue 1: gross revenue this month comes from prorated subscription history", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(THIS_MONTH);
    expect(stats.revenue.investorRevenueThisMonthCents).toBe(Math.round(THIS_MONTH * 0.7));
  });

  it("Issue 9: last month includes the churned subscriber and MoM is real", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.revenue.grossRevenueLastMonthCents).toBe(LAST_MONTH);
    const expectedMoM = Math.round(((THIS_MONTH - LAST_MONTH) / LAST_MONTH) * 1000) / 10;
    expect(stats.revenue.monthOverMonthChangePercent).toBe(expectedMoM);
  });

  it("Issues 3/5/6: per-sub createdAt and revenue come from the history record", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    const node = stats.nodes[0];
    expect(node.billingType).toBe("monthly");
    const subs = node.subscriptions;
    expect(subs.map((s: { createdAt: string }) => s.createdAt).sort()).toEqual([
      "2026-05-20T00:00:00.000Z",
      "2026-06-05T00:00:00.000Z",
    ]);
    // Each live sub billed at ITS contracted price, not a shared product price
    expect(subs.map((s: { revenueThisMonthCents: number }) => s.revenueThisMonthCents).sort((a: number, b: number) => a - b))
      .toEqual([B_JUL, A_JUL].sort((a, b) => a - b));
  });

  it("Issue 8: the daily chart carries prorated monthly revenue every day", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    // 30-day window: Jun 15 .. Jul 15 inclusive
    expect(stats.dailyRevenue.length).toBe(31);
    expect(stats.dailyRevenue[0].date).toBe("2026-06-15");
    for (const day of stats.dailyRevenue) {
      expect(day.grossCents).toBeGreaterThan(0);
    }
    // Jun 15: A (29900/30) + B (19900/30) + C (29900/30, churned Jun 20 so still active)
    expect(stats.dailyRevenue[0].grossCents).toBe(
      Math.round(29900 / 30) + Math.round(19900 / 30) + Math.round(29900 / 30),
    );
  });

  it("Issue 10: churn counts the monthly subscriber who cancelled in June", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    // June customers: cus_a, cus_b, cus_c — only cus_c gone in July → 1/3
    expect(stats.businessHealth.churnPercent).toBe(33.3);
  });

  it("Issue 10: top-customer concentration sees monthly revenue", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    const expected = Math.round((A_JUL / THIS_MONTH) * 1000) / 10;
    expect(stats.businessHealth.topCustomerPercent).toBe(expected);
  });

  it("Issue 11: sell-through for monthly nodes is slot occupancy, not billed hours", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    // 2 occupied of 8 vGPU slots → 25%
    expect(stats.businessHealth.sellThroughPercent).toBe(25);
  });

  it("shows per-pod rows from history even when the pool cache has no pods", async () => {
    // Stale/empty cache (no pods) + a record terminated mid-July: every record
    // that billed this month must still appear in the per-pod breakdown.
    m.poolCache.mockReturnValue({
      pools: [{ ...POOL_CACHE.pools[0], pods: [] }],
    });
    m.shFindMany.mockResolvedValue([
      HISTORY[0], // cus_a, active
      HISTORY[1], // cus_b, active
      { poolId: 60, stripeCustomerId: "cus_d", startedAt: new Date("2026-06-01T00:00:00Z"), endedAt: new Date("2026-07-05T00:00:00Z"), priceCents: 29900 },
    ]);
    const stats = await computeInvestorStats("investor@example.com");
    const subs = stats.nodes[0].subscriptions;
    expect(subs.length).toBe(3);
    expect(subs.map((s: { status: string }) => s.status).sort()).toEqual(["subscribed", "subscribed", "terminated"]);
    const expected = [A_JUL, B_JUL, Math.round((29900 / 31) * 5)].sort((a, b) => a - b);
    expect(subs.map((s: { revenueThisMonthCents: number }) => s.revenueThisMonthCents).sort((a: number, b: number) => a - b)).toEqual(expected);
    // Node revenue still matches the pool estimate (no double counting)
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(A_JUL + B_JUL + Math.round((29900 / 31) * 5));
    // Terminated rows billed this month but are NOT current customers
    expect(stats.summary.totalCustomers).toBe(2);
  });

  it("excludes internal accounts' subscriptions from revenue", async () => {
    m.cacheFindMany.mockResolvedValue([{ id: "cus_internal" }]);
    m.shFindMany.mockResolvedValue([
      ...HISTORY,
      { poolId: 60, stripeCustomerId: "cus_internal", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null, priceCents: 99900 },
    ]);
    const stats = await computeInvestorStats("investor@example.com");
    // Internal $999/mo sub contributes nothing — gross unchanged
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(THIS_MONTH);
  });

  it("sums wallet + monthly estimate per pool — disjoint streams (PA-643)", async () => {
    // Monthly pods never write gpu_usage/gpu_deploy/refund wallet rows, so a
    // mixed pool genuinely earns BOTH. The old MAX(wallet, estimate) merge
    // dropped the smaller stream.
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 60, _sum: { amountCents: 50000 } }]) // this month
      .mockResolvedValueOnce([]); // last month
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(50000 + THIS_MONTH);
  });

  it("reverts to hourly labeling when the pool's only monthly subscriber churned last month", async () => {
    m.shFindMany.mockResolvedValue([HISTORY[2]]); // cus_c only: ended Jun 20
    const stats = await computeInvestorStats("investor@example.com");
    // Not monthly-billed THIS month → hourly labeling + hours-based sell-through
    expect(stats.nodes[0].billingType).toBe("hourly");
    // …but the churned subscriber's June revenue still counts
    expect(stats.revenue.grossRevenueLastMonthCents).toBe(C_JUN);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(0);
  });

  it("leaves pure hourly investors untouched (no history records)", async () => {
    m.shFindMany.mockResolvedValue([]);
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 60, _sum: { amountCents: 12345 } }])
      .mockResolvedValueOnce([{ poolId: 60, _sum: { amountCents: 11111 } }]);
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(12345);
    expect(stats.revenue.grossRevenueLastMonthCents).toBe(11111);
    expect(stats.nodes[0].billingType).toBe("hourly");
  });
});
