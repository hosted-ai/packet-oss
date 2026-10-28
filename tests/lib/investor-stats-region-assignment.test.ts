// PA-688 phase 1: `regions:` in assignedNodeIds scopes BARE METAL ONLY.
//
// This is the inverse assertion to the usual kind: it pins that a region
// assignment does NOT grant the region's GPU pools. A region→pool expansion was
// built and reverted — prod investors typically own only PART of a region's
// pools, so expanding would credit them pools they don't own. GPU attribution
// stays on pools:/gpuaas- refs; migrating it to regions is tracked in PA-712.
//
// Pinned contracts:
//   - a regions:-only investor gets no GPU nodes and no GPU revenue
//   - regions: alongside pools: leaves the pools: result completely unchanged
//   - a regions: entry is never mistaken for a ProviderNode cuid (no DB lookup)

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
  computeBareMetal: vi.fn(),
}));

vi.mock("@/lib/investor-baremetal", () => ({
  computeInvestorBareMetal: m.computeBareMetal,
}));

// Real module spread in so pure helpers stay real; only DB accessors are faked.
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

// Region 75 holds pools 70 and 71. An investor assigned region 75 must NOT
// inherit either of them — this is the prod "partial region" shape (they own 70,
// someone else owns 71).
const REGION_CACHE = {
  pools: [
    {
      id: 70,
      clusterId: 2,
      regionId: 75,
      regionName: "ind-k8s-2",
      name: "b200-shared",
      totalGpus: 1,
      overcommitRatio: 1,
      gpus: [{ nodeId: 1, gpuModel: "B200" }],
      nodes: [{ id: 1, name: "node-1", ip: "10.0.0.1", gpuModel: "B200", gpuCount: 1, initStatus: 2 }],
      pods: [],
    },
    {
      id: 71,
      clusterId: 2,
      regionId: 75,
      regionName: "ind-k8s-2",
      name: "someone-elses-pool",
      totalGpus: 1,
      overcommitRatio: 1,
      gpus: [{ nodeId: 2, gpuModel: "B200" }],
      nodes: [{ id: 2, name: "node-2", ip: "10.0.0.2", gpuModel: "B200", gpuCount: 1, initStatus: 2 }],
      pods: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  m.assignedNodes.mockResolvedValue(["regions:75"]);
  m.revShare.mockResolvedValue(80);
  m.poolCache.mockReturnValue(REGION_CACHE);
  m.computePool.mockResolvedValue(null);
  m.gpuProductFindMany.mockResolvedValue([]);
  m.providerNodeFindMany.mockResolvedValue([]);
  m.walletGroupBy.mockResolvedValue([]);
  m.podFindMany.mockResolvedValue([]);
  m.shFindMany.mockResolvedValue([]);
  m.queryRaw.mockResolvedValue([]);
  m.cacheFindMany.mockResolvedValue([]);
  m.customersList.mockResolvedValue({ data: [], has_more: false });
  m.computeBareMetal.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeInvestorStats — regions: is bare-metal-only in phase 1 (PA-688)", () => {
  it("a regions:-only investor gets no GPU nodes and no GPU revenue", async () => {
    m.walletGroupBy
      .mockResolvedValueOnce([
        { poolId: 70, _sum: { amountCents: 30000 } },
        { poolId: 71, _sum: { amountCents: 10000 } },
      ])
      .mockResolvedValueOnce([]);

    const stats = await computeInvestorStats("investor@example.com");

    expect(stats.nodes).toEqual([]);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(0);
  });

  it("regions: alongside pools: does not widen the pools: result", async () => {
    m.assignedNodes.mockResolvedValue(["pools:70", "regions:75"]);
    m.walletGroupBy
      .mockResolvedValueOnce([
        { poolId: 70, _sum: { amountCents: 30000 } },
        { poolId: 71, _sum: { amountCents: 10000 } },
      ])
      .mockResolvedValueOnce([]);

    const stats = await computeInvestorStats("investor@example.com");

    // Pool 70's node only — pool 71 is in the same region but not theirs.
    expect(stats.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual(["gpuaas-2-1"]);
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(30000);
  });

  it("never treats a regions: entry as a ProviderNode id", async () => {
    m.assignedNodes.mockResolvedValue(["regions:75,99"]);
    await computeInvestorStats("investor@example.com");
    expect(m.providerNodeFindMany).not.toHaveBeenCalled();
  });
});

describe("computeInvestorStats — bare-metal section wiring (PA-688)", () => {
  const BM = {
    servers: [{ haiNodeId: 1, name: "bm-1" }],
    summary: { totalServers: 1, liveServers: 1, inServiceServers: 1, totalGpus: 8, regions: [] },
    revenue: {
      grossWindowCents: 100,
      investorWindowCents: 70,
      grossAllTimeCents: 100,
      investorAllTimeCents: 70,
      revenueSharePercent: 70,
    },
    inventoryUnavailable: false,
  };

  it("passes the parsed region ids through to the bare-metal computation", async () => {
    m.assignedNodes.mockResolvedValue(["regions:75,99", "pools:70"]);
    await computeInvestorStats("investor@example.com");
    expect(m.computeBareMetal).toHaveBeenCalledWith(
      [75, 99],
      expect.any(Number),
      expect.any(Date),
      expect.any(Date),
      expect.any(Date)
    );
  });

  it("a bare-metal-ONLY investor gets real BM data, not an empty dashboard", async () => {
    // The regression this guards: a region-only investor has zero GPU nodes and
    // used to hit the `providerNodes.length === 0` bail-out, so someone owning a
    // rack of B200s saw a blank page.
    m.assignedNodes.mockResolvedValue(["regions:1234"]); // no GPU pools in cache
    m.computeBareMetal.mockResolvedValue(BM);

    const stats = await computeInvestorStats("investor@example.com");

    expect(stats.nodes).toEqual([]);
    expect(stats.bareMetal).toEqual(BM);
  });

  it("bareMetal is null (not missing) when no regions are assigned", async () => {
    m.assignedNodes.mockResolvedValue(["pools:70"]);
    const stats = await computeInvestorStats("investor@example.com");
    expect(stats.bareMetal).toBeNull();
  });

  it("a failing bare-metal section never takes down the GPU dashboard", async () => {
    m.assignedNodes.mockResolvedValue(["pools:70", "regions:75"]);
    m.computeBareMetal.mockRejectedValue(new Error("HAI exploded"));
    m.walletGroupBy
      .mockResolvedValueOnce([{ poolId: 70, _sum: { amountCents: 30000 } }])
      .mockResolvedValueOnce([]);

    const stats = await computeInvestorStats("investor@example.com");

    expect(stats.bareMetal).toBeNull();
    expect(stats.revenue.grossRevenueThisMonthCents).toBe(30000);
    expect(stats.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual(["gpuaas-2-1"]);
  });
});
