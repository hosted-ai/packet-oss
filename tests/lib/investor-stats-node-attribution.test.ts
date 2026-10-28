// PA-643 regression: pool→node revenue attribution. Every node in a pool
// claimed the pool's FULL revenue/capacity (a 4-node pool was counted 4x in
// gross — prod: james+cambium showed ~$114k vs a true ~$30k), unresolved
// pools collapsed into a single mislabeled bucket row, pod rows were repeated
// on every node of a shared pool, and a stale pool-overview cache silently
// degraded every investor to bucket rows. These tests drive
// computeInvestorStats and assert: pool totals are allocated across nodes by
// GPU share (Σ nodes = Σ pools exactly), unresolved pools render one row
// each, pod rows appear exactly once, and a missing cache falls back to a
// live computePoolOverview().

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  assignedNodes: vi.fn(),
  revShare: vi.fn(),
  poolCache: vi.fn(),
  computePool: vi.fn(),
  writePool: vi.fn(),
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
  computePoolOverview: m.computePool,
  writePoolOverviewCache: m.writePool,
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

const NOW = new Date("2026-07-15T12:00:00.000Z");

// One pool spanning two nodes, GPUs split 3:1 (the prod pool-158 shape).
const SHARED_POOL_CACHE = {
  pools: [
    {
      id: 70,
      clusterId: 2,
      name: "b200-shared",
      totalGpus: 4,
      overcommitRatio: 2,
      gpus: [
        { nodeId: 1, gpuModel: "B200" },
        { nodeId: 1, gpuModel: "B200" },
        { nodeId: 1, gpuModel: "B200" },
        { nodeId: 2, gpuModel: "B200" },
      ],
      nodes: [
        { id: 1, name: "node-1", ip: "10.0.0.1", gpuModel: "B200", gpuCount: 3, initStatus: 2 },
        { id: 2, name: "node-2", ip: "10.0.0.2", gpuModel: "B200", gpuCount: 1, initStatus: 2 },
      ],
      pods: [
        { subscriptionId: "i-aaa", teamId: "team-a", vgpuCount: 1, status: "active", podName: "pod-a", customerEmail: "a@ext.com" },
        { subscriptionId: "i-bbb", teamId: "team-b", vgpuCount: 1, status: "active", podName: "pod-b", customerEmail: "b@ext.com" },
      ],
    },
  ],
};

// Two overlapping pools (prod pools 158/159): pool 80 on nodes 1+2, pool 81 on node 1 only.
const OVERLAP_POOL_CACHE = {
  pools: [
    {
      id: 80,
      clusterId: 3,
      name: "b200-dedicated",
      totalGpus: 2,
      overcommitRatio: 1,
      gpus: [{ nodeId: 1, gpuModel: "B200" }, { nodeId: 2, gpuModel: "B200" }],
      nodes: [
        { id: 1, name: "node-1", ip: "10.0.0.1", gpuModel: "B200", gpuCount: 1, initStatus: 2 },
        { id: 2, name: "node-2", ip: "10.0.0.2", gpuModel: "B200", gpuCount: 1, initStatus: 2 },
      ],
      pods: [],
    },
    {
      id: 81,
      clusterId: 3,
      name: "b200-dynamic",
      totalGpus: 1,
      overcommitRatio: 1,
      gpus: [{ nodeId: 1, gpuModel: "B200" }],
      nodes: [{ id: 1, name: "node-1", ip: "10.0.0.1", gpuModel: "B200", gpuCount: 1, initStatus: 2 }],
      pods: [],
    },
  ],
};

// Pools with pods but NO GPU/node inventory (the DeepGreen shape).
const NODELESS_POOL_CACHE = {
  pools: [
    {
      id: 90,
      clusterId: 33,
      name: "l40s-premium",
      totalGpus: 0,
      overcommitRatio: 1,
      gpus: [],
      nodes: [],
      pods: [
        { subscriptionId: "i-ccc", teamId: "team-a", vgpuCount: 1, status: "active", podName: "pod-c", customerEmail: "a@ext.com" },
      ],
    },
    {
      id: 91,
      clusterId: 38,
      name: "a100-premium-uk3",
      totalGpus: 0,
      overcommitRatio: 1,
      gpus: [],
      nodes: [],
      pods: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  m.assignedNodes.mockResolvedValue(["pools:70"]);
  m.revShare.mockResolvedValue(80);
  m.poolCache.mockReturnValue(SHARED_POOL_CACHE);
  m.computePool.mockResolvedValue(null);
  m.gpuProductFindMany.mockResolvedValue([]);
  m.providerNodeFindMany.mockResolvedValue([]);
  m.walletGroupBy.mockResolvedValue([]);
  m.podFindMany.mockResolvedValue([]);
  m.shFindMany.mockResolvedValue([]);
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

describe("computeInvestorStats — pool→node attribution (PA-643)", () => {
  it("a pool spanning two nodes is counted once, allocated by GPU share", async () => {
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 40000 } }]) // this month
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 20000 } }]); // last month
    const stats = await computeInvestorStats("investor@example.com");

    expect(stats.nodes.length).toBe(2);
    // Gross = the pool total, NOT nodes × pool total (was 80000 before the fix)
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(40000);
    expect(stats.revenue.grossRevenueLastMonthCents).toBe(20000);
    // Split 3:1 by each node's GPUs in the pool
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-1");
    const n2 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-2");
    expect(n1.revenueThisMonthCents).toBe(30000);
    expect(n2.revenueThisMonthCents).toBe(10000);
    expect(n1.revenueLastMonthCents).toBe(15000);
    expect(n2.revenueLastMonthCents).toBe(5000);
  });

  it("capacity is allocated too: summary slots equal the pool's slots, not a multiple", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    // Pool: 4 GPUs × ratio 2 = 8 slots total (was 16 before the fix)
    expect(stats.summary.totalVgpuSlots).toBe(8);
    const slots = stats.nodes.map((n: { totalVgpuSlots: number }) => n.totalVgpuSlots).sort((a: number, b: number) => a - b);
    expect(slots).toEqual([2, 6]);
  });

  it("pod rows appear exactly once across the nodes of a shared pool", async () => {
    const stats = await computeInvestorStats("investor@example.com");
    const allSubs = stats.nodes.flatMap((n: { subscriptions: unknown[] }) => n.subscriptions);
    // 2 pods in the pool → 2 rows total (was 4: repeated per node)
    expect(allSubs.length).toBe(2);
    // Occupancy sums once as well: 2 occupied of 8
    expect(stats.summary.totalOccupiedSlots).toBe(2);
  });

  it("overlapping pools each count once (pool A on nodes 1+2, pool B on node 1)", async () => {
    m.poolCache.mockReturnValue(OVERLAP_POOL_CACHE);
    m.assignedNodes.mockResolvedValue(["pools:80,81"]);
    m.walletGroupBy
      .mockResolvedValueOnce([
        { poolId: 80, _sum: { amountCents: 10000 } },
        { poolId: 81, _sum: { amountCents: 5000 } },
      ])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");

    // Was 25000 before the fix (node1 claimed A+B, node2 claimed A again)
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(15000);
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-3-1");
    const n2 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-3-2");
    expect(n1.revenueThisMonthCents).toBe(10000); // A/2 + B
    expect(n2.revenueThisMonthCents).toBe(5000); // A/2
  });

  it("unresolved pools render one row per pool, named after the pool", async () => {
    m.poolCache.mockReturnValue(NODELESS_POOL_CACHE);
    m.assignedNodes.mockResolvedValue(["pools:90,91"]);
    m.gpuProductFindMany.mockResolvedValue([
      { name: "NVIDIA L40S - Dedicated", poolIds: "[90]", pricePerHourCents: 92, pricePerMonthCents: null, billingType: "hourly" },
      { name: "NVIDIA A100 PCIe - Dedicated", poolIds: "[91]", pricePerHourCents: 120, pricePerMonthCents: null, billingType: "hourly" },
    ]);
    m.walletGroupBy
      .mockResolvedValueOnce([
        { poolId: 90, _sum: { amountCents: 7000 } },
        { poolId: 91, _sum: { amountCents: 3000 } },
      ])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");

    // Was 1 bucket row "pools:90,91" named after pool 90's product only
    expect(stats.nodes.length).toBe(2);
    const p90 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "pools:90");
    const p91 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "pools:91");
    expect(p90.hostname).toBe("l40s-premium");
    expect(p91.hostname).toBe("a100-premium-uk3");
    expect(p90.revenueThisMonthCents).toBe(7000);
    expect(p91.revenueThisMonthCents).toBe(3000);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(10000);
    // The pool's pod lands on its own pool row
    expect(p90.subscriptions.length).toBe(1);
    expect(p91.subscriptions.length).toBe(0);
  });

  it("assigned pools missing from the cache entirely still get their own row", async () => {
    m.poolCache.mockReturnValue(NODELESS_POOL_CACHE);
    m.assignedNodes.mockResolvedValue(["pools:90,117"]); // 117 not in cache
    m.walletGroupBy
      .mockResolvedValueOnce([
        { poolId: 90, _sum: { amountCents: 7000 } },
        { poolId: 117, _sum: { amountCents: 2000 } },
      ])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.nodes.length).toBe(2);
    const p117 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "pools:117");
    expect(p117.revenueThisMonthCents).toBe(2000);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(9000);
  });

  it("falls back to a live computePoolOverview() when the cache is stale", async () => {
    m.poolCache.mockReturnValue(null);
    m.computePool.mockResolvedValue({ ...SHARED_POOL_CACHE, hadApiFailures: false });
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 40000 } }])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");

    expect(m.computePool).toHaveBeenCalledTimes(1);
    // Real nodes resolved from the live compute — no bucket-row degradation
    expect(stats.nodes.map((n: { nodeId: string }) => n.nodeId).sort()).toEqual(["gpuaas-2-1", "gpuaas-2-2"]);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(40000);
    // Clean result is persisted for the other consumers
    expect(m.writePool).toHaveBeenCalledTimes(1);
  });

  it("does not persist a live fallback result that had API failures", async () => {
    m.poolCache.mockReturnValue(null);
    m.computePool.mockResolvedValue({ ...SHARED_POOL_CACHE, hadApiFailures: true });
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.nodes.length).toBe(2); // still used in-memory
    expect(m.writePool).not.toHaveBeenCalled();
  });

  it("a member with zero GPUs in the pool gets a zero share — no phantom capacity", async () => {
    // node 2 is listed in pool.nodes but owns none of the pool's GPU rows
    m.poolCache.mockReturnValue({
      pools: [
        {
          ...SHARED_POOL_CACHE.pools[0],
          gpus: [
            { nodeId: 1, gpuModel: "B200" },
            { nodeId: 1, gpuModel: "B200" },
            { nodeId: 1, gpuModel: "B200" },
          ],
        },
      ],
    });
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 40000 } }])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-1");
    const n2 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-2");
    expect(n1.revenueThisMonthCents).toBe(40000);
    expect(n2.revenueThisMonthCents).toBe(0);
    // zero share stays zero — must NOT fall back to the node's own GPUs
    expect(n2.totalVgpuSlots).toBe(0);
    expect(stats.summary.totalVgpuSlots).toBe(8);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(40000);
  });

  it("a node referenced directly AND via pools: appears once and the sum holds", async () => {
    m.assignedNodes.mockResolvedValue(["gpuaas-2-1", "pools:70"]);
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 40000 } }])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");
    const ids = stats.nodes.map((n: { nodeId: string }) => n.nodeId);
    expect(ids.sort()).toEqual(["gpuaas-2-1", "gpuaas-2-2"]); // no duplicate row
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(40000);
  });

  it("mixed pool: on-demand wallet AND monthly subscriptions both count (defect 2)", async () => {
    // 15 days into a 31-day July, cus_a's $299/mo sub prorates to:
    const A_JUL = Math.round((29900 / 31) * 15);
    m.shFindMany.mockResolvedValue([
      { poolId: 70, stripeCustomerId: "cus_a", startedAt: new Date("2026-05-01T00:00:00Z"), endedAt: null, priceCents: 29900 },
    ]);
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 50000 } }])
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 30000 } }]); // last month wallet
    // $queryRaw call order: metrics, daily chart, churn ×2, concentration —
    // give the concentration query a wallet customer so the fold is visible
    m.queryRaw
      .mockResolvedValueOnce([]) // metrics
      .mockResolvedValueOnce([]) // daily chart
      .mockResolvedValueOnce([]) // churn last month
      .mockResolvedValueOnce([]) // churn this month
      .mockResolvedValueOnce([{ cid: "cus_b", total: 50000 }]); // concentration
    const stats = await computeInvestorStats("investor@example.com");
    // Sum, not MAX — the two streams are disjoint
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(50000 + A_JUL);
    // Last month sums too: wallet 30000 + full June of the $299 sub
    expect(stats.revenue.grossRevenueLastMonthCents).toBe(30000 + 29900);
    // The monthly subscriber's estimate reaches customer concentration even
    // though the wallet stream is larger (previously skipped unless the
    // estimate "won" the pool): top = cus_b's wallet share of the true total
    const expectedTop = Math.round((50000 / (50000 + A_JUL)) * 1000) / 10;
    expect(stats.businessHealth.topCustomerPercent).toBe(expectedTop);
    // Defect 3: a node earning both streams is labeled "mixed" (not flipped
    // wholesale to "monthly" by a single subscription window)…
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-1");
    expect(n1.billingType).toBe("mixed");
    // …and sell-through stays occupancy-based: 2 occupied of 8 slots
    expect(stats.businessHealth.sellThroughPercent).toBe(25);
  });

  it("monthly node shows the monthly product's rate even when the pool resolves to the hourly product (defect 3)", async () => {
    m.gpuProductFindMany.mockResolvedValue([
      { name: "B200 On-demand", poolIds: "[70]", pricePerHourCents: 92, pricePerMonthCents: null, billingType: "hourly" },
      { name: "B200 Monthly", poolIds: "[70]", pricePerHourCents: 0, pricePerMonthCents: 29900, billingType: "monthly" },
    ]);
    m.shFindMany.mockResolvedValue([
      { poolId: 70, stripeCustomerId: "cus_a", startedAt: new Date("2026-05-01T00:00:00Z"), endedAt: null, priceCents: 29900 },
    ]);
    const stats = await computeInvestorStats("investor@example.com");
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-2-1");
    // No wallet revenue → monthly-only, not mixed
    expect(n1.billingType).toBe("monthly");
    // The pool→product map prefers the hourly product (PA-354), which has no
    // monthly rate — the monthly product's rate must still surface
    expect(n1.monthlyRateCents).toBe(29900);
    // The display rate must NOT leak into the revenue compute: the pool's
    // no-history pod (team-b) is hourly, not a phantom monthly subscriber —
    // gross stays the one prorated subscription, nothing more
    const A_JUL = Math.round((29900 / 31) * 15);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(A_JUL);
  });

  it("single-node pools keep their exact revenue (weight-1 path unchanged)", async () => {
    m.poolCache.mockReturnValue({
      pools: [
        {
          ...SHARED_POOL_CACHE.pools[0],
          gpus: [{ nodeId: 1, gpuModel: "B200" }],
          nodes: [{ id: 1, name: "node-1", ip: "10.0.0.1", gpuModel: "B200", gpuCount: 1, initStatus: 2 }],
        },
      ],
    });
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 12345 } }])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.nodes.length).toBe(1);
    expect(stats.nodes[0].revenueThisMonthCents).toBe(12345);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(12345);
  });
});

// PoolNode.gpuCount is POOL-scoped (pool-overview.ts counts only that pool's
// GPUs on the node) and the resolution loops keep the first pool that mentions a
// node — so a node split across pools reported one pool's slice as its whole GPU
// count. That undercounts the node row and summary.totalPhysicalGpus, and
// therefore OVERSTATES revenue-per-GPU-per-day, which divides by that total.
describe("computeInvestorStats — GPUs of a node split across pools", () => {
  beforeEach(() => {
    m.poolCache.mockReturnValue(OVERLAP_POOL_CACHE);
    m.walletGroupBy.mockResolvedValue([]);
  });

  it("counts every pool's GPUs on the node, not just the first pool's", async () => {
    m.assignedNodes.mockResolvedValue(["pools:80,81"]);
    const stats = await computeInvestorStats("investor@example.com");

    // node 1 carries one GPU in pool 80 and one in pool 81. Was 1 before the fix.
    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-3-1");
    expect(n1?.gpuCount).toBe(2);
    // node 2 is in pool 80 only — unchanged, proving this isn't a blanket bump.
    const n2 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-3-2");
    expect(n2?.gpuCount).toBe(1);
    expect(stats.summary.totalPhysicalGpus).toBe(3);
  });

  it("counts only the pools the investor actually owns", async () => {
    // Same physical node, but pool 81 belongs to someone else.
    m.assignedNodes.mockResolvedValue(["pools:80"]);
    const stats = await computeInvestorStats("investor@example.com");

    const n1 = stats.nodes.find((n: { nodeId: string }) => n.nodeId === "gpuaas-3-1");
    expect(n1?.gpuCount).toBe(1);
    expect(stats.summary.totalPhysicalGpus).toBe(2);
  });

  it("keeps revenue-per-GPU honest once the denominator is right", async () => {
    m.assignedNodes.mockResolvedValue(["pools:80,81"]);
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 80, _sum: { amountCents: 30000 } }])
      .mockResolvedValueOnce([]);
    const stats = await computeInvestorStats("investor@example.com");

    // 80% of $300 over 3 GPUs and 15 days into July — not over 2 GPUs.
    const expected = Math.round(Math.round(30000 * 0.8) / 3 / 15);
    expect(stats.businessHealth.revenuePerGpuPerDayCents).toBe(expected);
  });
});
