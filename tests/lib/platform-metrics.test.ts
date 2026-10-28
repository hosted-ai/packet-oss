// Tests for src/lib/platform-metrics.ts — platform metrics #1–12 (PA-693).
//
// Boundary deps mocked (@/lib/prisma, pool-overview, stripe, stripe-metrics,
// internal-accounts); subscription-proration runs REAL (pure module, its own
// suite covers it). Each metric function is pinned with concrete values.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  lifecycleCount: vi.fn(),
  lifecycleFindMany: vi.fn(),
  walletGroupBy: vi.fn(),
  walletAggregate: vi.fn(),
  queryRaw: vi.fn(),
  subHistoryFindMany: vi.fn(),
  snapshotFindMany: vi.fn(),
  readPoolOverviewCache: vi.fn(),
  getStripe: vi.fn(),
  computeMrrCents: vi.fn(),
  getInternalExclusions: vi.fn(),
  getInternalCustomerIdsFromCache: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerLifecycle: { count: h.lifecycleCount, findMany: h.lifecycleFindMany },
    walletTransaction: { groupBy: h.walletGroupBy, aggregate: h.walletAggregate },
    subscriptionHistory: { findMany: h.subHistoryFindMany },
    fleetCapacitySnapshot: { findMany: h.snapshotFindMany },
    $queryRaw: h.queryRaw,
  },
}));
vi.mock("@/lib/pool-overview", () => ({ readPoolOverviewCache: h.readPoolOverviewCache }));
vi.mock("@/lib/stripe", () => ({ getStripe: h.getStripe }));
vi.mock("@/lib/stripe-metrics", () => ({ computeMrrCents: h.computeMrrCents }));
// Keep the real buildExcludeInternalWhere (pure); mock only the async resolvers.
vi.mock("@/lib/internal-accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/internal-accounts")>()),
  getInternalExclusions: h.getInternalExclusions,
  getInternalCustomerIdsFromCache: h.getInternalCustomerIdsFromCache,
}));

import {
  resolveWindow,
  previousUtcDay,
  listWindowDates,
  classifyPools,
  countSignups,
  timeToFirstJob,
  activePayingCustomers,
  mrrAsOf,
  consumptionRunRate,
  revenueTotal,
  countSuppliers,
  activeGpus,
  availableGpuHours,
  utilization,
  computePlatformMetrics,
  CONSUMPTION_LEDGER_TYPES,
  UNKNOWN_GPU_TYPE,
  type MetricsWindow,
} from "@/lib/platform-metrics";

// Fixed clock: 2026-08-07 10:00 UTC → "yesterday" = Aug 6.
const NOW = new Date("2026-08-07T10:00:00.000Z");
const round2 = (n: number) => Math.round(n * 100) / 100;
const W: MetricsWindow = {
  start: new Date("2026-08-06T00:00:00.000Z"),
  end: new Date("2026-08-06T23:59:59.999Z"),
};

// Pools: 1 = dedicated H100, 2 = dynamic (×4) L40S.
function overview() {
  return {
    pools: [
      {
        id: 1,
        totalGpus: 2,
        overcommitRatio: 1,
        gpus: [
          { gpuModel: "H100", nodeId: 10 },
          { gpuModel: "H100", nodeId: 10 },
        ],
        nodes: [
          { id: 10, gpuModel: "H100", gpuCount: 2, providerId: "prov-1", initStatus: 2 },
        ],
      },
      {
        id: 2,
        totalGpus: 3,
        overcommitRatio: 4,
        gpus: [
          { gpuModel: "L40S", nodeId: 20 },
          { gpuModel: "L40S", nodeId: 20 },
          { gpuModel: "L40S", nodeId: 21 },
        ],
        nodes: [
          { id: 20, gpuModel: "L40S", gpuCount: 2, providerId: "prov-2", initStatus: 2 },
          { id: 21, gpuModel: "L40S", gpuCount: 1, providerId: null, initStatus: 2 },
        ],
      },
    ],
  };
}

const pcOf = () => classifyPools(overview().pools);

beforeEach(() => {
  vi.clearAllMocks();
  h.getInternalExclusions.mockResolvedValue({ domains: ["hosted.ai"], emails: [] });
  h.getInternalCustomerIdsFromCache.mockResolvedValue(new Set<string>());
  h.readPoolOverviewCache.mockReturnValue(overview());
  h.lifecycleCount.mockResolvedValue(0);
  h.lifecycleFindMany.mockResolvedValue([]);
  h.walletGroupBy.mockResolvedValue([]);
  h.walletAggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
  h.queryRaw.mockResolvedValue([{ hours: "0" }]);
  h.subHistoryFindMany.mockResolvedValue([]);
  h.snapshotFindMany.mockResolvedValue([]);
  h.getStripe.mockRejectedValue(new Error("Stripe not configured"));
  h.computeMrrCents.mockResolvedValue(0);
});

// ── Windows ──────────────────────────────────────────────────────────────────

describe("resolveWindow", () => {
  it('"1d" = the previous full UTC day (Daily-Ops parity)', () => {
    const w = resolveWindow("1d", NOW);
    expect(w.start.toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-06T23:59:59.999Z");
    expect(w.label).toBe("1d");
    expect(w).toMatchObject(previousUtcDay(NOW));
  });

  it('"7d" / "1m" = trailing 7 / 30 whole UTC days ending yesterday', () => {
    const w7 = resolveWindow("7d", NOW);
    expect(w7.start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(w7.end.toISOString()).toBe("2026-08-06T23:59:59.999Z");
    const w30 = resolveWindow("1m", NOW);
    expect(w30.start.toISOString()).toBe("2026-07-08T00:00:00.000Z");
    expect(w30.end.toISOString()).toBe("2026-08-06T23:59:59.999Z");
  });

  it("custom range spans [from 00:00, to 23:59:59.999] UTC inclusive", () => {
    const w = resolveWindow({ from: "2026-07-01", to: "2026-07-31" }, NOW);
    expect(w.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-31T23:59:59.999Z");
    expect(w.label).toBe("2026-07-01 → 2026-07-31");
  });

  it("rejects malformed, impossible, and inverted custom dates", () => {
    expect(() => resolveWindow({ from: "garbage", to: "2026-07-31" }, NOW)).toThrow();
    expect(() => resolveWindow({ from: "2026-02-31", to: "2026-03-01" }, NOW)).toThrow();
    expect(() => resolveWindow({ from: "2026-07-31", to: "2026-07-01" }, NOW)).toThrow();
  });

  it("listWindowDates enumerates every UTC day the window touches", () => {
    expect(listWindowDates(resolveWindow("1d", NOW))).toEqual(["2026-08-06"]);
    expect(listWindowDates(resolveWindow({ from: "2026-07-30", to: "2026-08-01" }, NOW)))
      .toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });
});

// ── Pool classification ──────────────────────────────────────────────────────

describe("classifyPools", () => {
  it("dedicated = overcommit ≤ 1 (missing/0 ratio treated as 1), dynamic = > 1", () => {
    const pc = classifyPools([
      { id: 1, overcommitRatio: 1 },
      { id: 2, overcommitRatio: 4 },
      { id: 3, overcommitRatio: 0 }, // API glitch → 1
      { id: 4, overcommitRatio: undefined },
      { id: 5, overcommitRatio: 1.5 },
    ]);
    expect([...pc.dedicatedPoolIds].sort()).toEqual([1, 3, 4]);
    expect([...pc.dynamicPoolIds].sort()).toEqual([2, 5]);
  });

  it("maps each pool to its dominant GPU model, node fallback, absent when unknown", () => {
    const pc = classifyPools([
      { id: 1, overcommitRatio: 1, gpus: [{ gpuModel: "H100" }, { gpuModel: "H100" }, { gpuModel: "L40S" }] },
      { id: 2, overcommitRatio: 1, gpus: [], nodes: [{ gpuModel: "B200" }] },
      { id: 3, overcommitRatio: 1 },
    ]);
    expect(pc.gpuModelByPool.get(1)).toBe("H100");
    expect(pc.gpuModelByPool.get(2)).toBe("B200");
    expect(pc.gpuModelByPool.has(3)).toBe(false);
  });
});

// ── #1 Signups ───────────────────────────────────────────────────────────────

describe("countSignups (#1)", () => {
  it("counts signups in-window with the magic link clicked, internal excluded", async () => {
    h.lifecycleCount.mockResolvedValue(7);
    expect(await countSignups(W)).toBe(7);
    expect(h.lifecycleCount).toHaveBeenCalledWith({
      where: {
        signedUpAt: { gte: W.start, lte: W.end },
        firstLoginAt: { not: null },
        NOT: [{ email: { endsWith: "@hosted.ai" } }],
      },
    });
  });
});

// ── #2 Time-to-first-job ─────────────────────────────────────────────────────

describe("timeToFirstJob (#2)", () => {
  const signup = new Date("2026-08-06T00:00:00.000Z");
  const hrs = (n: number) => new Date(signup.getTime() + n * 3600e3);

  it("takes the median over activated users, preferring the workload timestamp", async () => {
    h.lifecycleFindMany.mockResolvedValue([
      { signedUpAt: signup, firstWorkloadAt: hrs(2), firstGpuDeployAt: hrs(1) }, // 2h (workload wins)
      { signedUpAt: signup, firstWorkloadAt: null, firstGpuDeployAt: hrs(10) }, // 10h (proxy)
      { signedUpAt: signup, firstWorkloadAt: hrs(4), firstGpuDeployAt: null }, // 4h
      { signedUpAt: signup, firstWorkloadAt: null, firstGpuDeployAt: null }, // never activated
    ]);
    const r = await timeToFirstJob(W);
    expect(r).toEqual({
      medianHours: 4, // median of [2, 4, 10]
      n: 3,
      cohortSize: 4,
      workloadBasisN: 2,
      deployProxyN: 1,
    });
  });

  it("averages the middle pair for even n and clamps negative gaps to 0", async () => {
    h.lifecycleFindMany.mockResolvedValue([
      { signedUpAt: signup, firstWorkloadAt: hrs(-5), firstGpuDeployAt: null }, // data oddity → 0
      { signedUpAt: signup, firstWorkloadAt: hrs(3), firstGpuDeployAt: null },
      { signedUpAt: signup, firstWorkloadAt: hrs(5), firstGpuDeployAt: null },
      { signedUpAt: signup, firstWorkloadAt: hrs(100), firstGpuDeployAt: null },
    ]);
    const r = await timeToFirstJob(W);
    expect(r.medianHours).toBe(4); // median of [0, 3, 5, 100] = (3+5)/2
    expect(r.n).toBe(4);
  });

  it("returns null median for a cohort with no activations", async () => {
    h.lifecycleFindMany.mockResolvedValue([
      { signedUpAt: signup, firstWorkloadAt: null, firstGpuDeployAt: null },
    ]);
    const r = await timeToFirstJob(W);
    expect(r.medianHours).toBeNull();
    expect(r.n).toBe(0);
    expect(r.cohortSize).toBe(1);
  });
});

// ── #3/#4/#5 Active paying customers ─────────────────────────────────────────

describe("activePayingCustomers (#3–#5)", () => {
  it("splits on-demand ∪ monthly by pool class × GPU type; total dedupes", async () => {
    // A: on-demand dedicated (pool 1) AND monthly dynamic (pool 2) — counts once in total.
    // B: on-demand dynamic (pool 2), no lifecycle row → kept (fail-open).
    // C: credit-only (lifecycle row, firstDepositAt null) → excluded.
    // D: monthly dedicated (pool 1).
    // E: internal → excluded everywhere.
    // F: on-demand, untagged poolId → unknownPool bucket, still in total.
    h.walletGroupBy.mockResolvedValue([
      { stripeCustomerId: "A", poolId: 1 },
      { stripeCustomerId: "B", poolId: 2 },
      { stripeCustomerId: "C", poolId: 1 },
      { stripeCustomerId: "E", poolId: 1 },
      { stripeCustomerId: "F", poolId: null },
    ]);
    h.subHistoryFindMany.mockResolvedValue([
      { stripeCustomerId: "A", poolId: 2 },
      { stripeCustomerId: "D", poolId: 1 },
      { stripeCustomerId: "E", poolId: 1 },
    ]);
    h.getInternalCustomerIdsFromCache.mockResolvedValue(new Set(["E"]));
    h.lifecycleFindMany.mockResolvedValue([
      { stripeCustomerId: "A", firstDepositAt: new Date("2026-01-01") },
      { stripeCustomerId: "C", firstDepositAt: null },
      { stripeCustomerId: "F", firstDepositAt: new Date("2026-01-01") },
    ]);

    const r = await activePayingCustomers(W, pcOf());
    expect(r.total).toBe(4); // A, B, D, F
    expect(r.onDemand).toBe(3); // A, B, F
    expect(r.monthly).toBe(2); // A, D
    expect(r.dedicated).toEqual({
      total: 2, // A (on-demand pool 1), D (monthly pool 1)
      onDemandByGpuType: { H100: 1 },
      monthlyByGpuType: { H100: 1 },
    });
    expect(r.dynamic).toEqual({
      total: 2, // B (on-demand pool 2), A (monthly pool 2)
      onDemandByGpuType: { L40S: 1 },
      monthlyByGpuType: { L40S: 1 },
    });
    expect(r.unknownPool).toBe(1); // F
  });

  it("queries only consumption debits in-window and paid overlapping subs", async () => {
    await activePayingCustomers(W, pcOf());
    expect(h.walletGroupBy).toHaveBeenCalledWith({
      by: ["stripeCustomerId", "poolId"],
      where: {
        type: { in: [...CONSUMPTION_LEDGER_TYPES] },
        createdAt: { gte: W.start, lte: W.end },
        amountCents: { gt: 0 },
      },
    });
    expect(h.subHistoryFindMany).toHaveBeenCalledWith({
      where: {
        priceCents: { gt: 0 },
        startedAt: { lte: W.end },
        OR: [{ endedAt: null }, { endedAt: { gte: W.start } }],
      },
      select: { stripeCustomerId: true, poolId: true },
    });
  });

  it("classified pool missing from the overview buckets as unknownPool", async () => {
    h.walletGroupBy.mockResolvedValue([{ stripeCustomerId: "A", poolId: 999 }]);
    const r = await activePayingCustomers(W, pcOf());
    expect(r.total).toBe(1);
    expect(r.unknownPool).toBe(1);
    expect(r.dedicated.total).toBe(0);
    expect(r.dynamic.total).toBe(0);
  });
});

// ── #6 MRR ───────────────────────────────────────────────────────────────────

describe("mrrAsOf (#6)", () => {
  const asOf = W.end;

  it("sums active-as-of subscription prices with class × GPU-type breakdown and ÷30", async () => {
    h.subHistoryFindMany.mockResolvedValue([
      { poolId: 1, priceCents: 100_000 },
      { poolId: 1, priceCents: 50_000 },
      { poolId: 2, priceCents: 200_000 },
      { poolId: null, priceCents: 10_000 },
    ]);
    const r = await mrrAsOf(asOf, pcOf(), null);
    expect(r.totalCents).toBe(360_000);
    expect(r.dailyProratedCents).toBe(12_000);
    expect(r.dedicatedMonthlyByGpuType).toEqual({ H100: 150_000 });
    expect(r.dynamicMonthlyByGpuType).toEqual({ L40S: 200_000 });
    expect(r.unknownPoolCents).toBe(10_000);
    expect(r.stripeLiveCents).toBeNull();
    expect(r.stripeDeltaCents).toBeNull();
    // As-of boundary: startedAt ≤ T, endedAt NULL or > T (strict).
    expect(h.subHistoryFindMany).toHaveBeenCalledWith({
      where: {
        priceCents: { gt: 0 },
        startedAt: { lte: asOf },
        OR: [{ endedAt: null }, { endedAt: { gt: asOf } }],
      },
      select: { poolId: true, priceCents: true },
    });
  });

  it("reports the live-Stripe delta when a Stripe client is supplied", async () => {
    h.subHistoryFindMany.mockResolvedValue([{ poolId: 1, priceCents: 90_000 }]);
    h.computeMrrCents.mockResolvedValue(100_000);
    const r = await mrrAsOf(asOf, pcOf(), {} as never);
    expect(r.stripeLiveCents).toBe(100_000);
    expect(r.stripeDeltaCents).toBe(-10_000); // DB under-reports → visible, not silent
  });

  it("a Stripe failure nulls the reconciliation, never the MRR", async () => {
    h.subHistoryFindMany.mockResolvedValue([{ poolId: 1, priceCents: 90_000 }]);
    h.computeMrrCents.mockRejectedValue(new Error("Stripe down"));
    const r = await mrrAsOf(asOf, pcOf(), {} as never);
    expect(r.totalCents).toBe(90_000);
    expect(r.stripeLiveCents).toBeNull();
  });
});

// ── #7 Consumption run-rate ──────────────────────────────────────────────────

describe("consumptionRunRate (#7)", () => {
  it("annualizes trailing-30d consumption ×12 with class × GPU-type split", async () => {
    h.walletGroupBy.mockResolvedValue([
      { poolId: 1, _sum: { amountCents: 60_000 } },
      { poolId: 2, _sum: { amountCents: 30_000 } },
      { poolId: null, _sum: { amountCents: 10_000 } },
    ]);
    h.walletAggregate.mockResolvedValue({ _sum: { amountCents: 4_000 } });

    const r = await consumptionRunRate(NOW, pcOf());
    expect(r.trailing30dCents).toBe(100_000);
    expect(r.runRateCents).toBe(1_200_000);
    expect(r.byGrain).toEqual({ "1d": 4_000, "7d": 4_000, "1m": 100_000 });
    expect(r.dedicatedByGpuType).toEqual({ H100: 60_000 });
    expect(r.dynamicByGpuType).toEqual({ L40S: 30_000 });
    expect(r.unknownPoolCents).toBe(10_000);
    // The grouped sweep covers the trailing 30 whole days with consumption types only.
    expect(h.walletGroupBy).toHaveBeenCalledWith({
      by: ["poolId"],
      _sum: { amountCents: true },
      where: {
        type: { in: [...CONSUMPTION_LEDGER_TYPES] },
        createdAt: {
          gte: new Date("2026-07-08T00:00:00.000Z"),
          lte: new Date("2026-08-06T23:59:59.999Z"),
        },
        amountCents: { gt: 0 },
      },
    });
  });
});

// ── #8 Revenue (total) ───────────────────────────────────────────────────────

describe("revenueTotal (#8)", () => {
  it("prorated subs + consumption − refunds (real proration math)", async () => {
    // July window; a $300 sub active all of July prorates to its full price.
    const july: MetricsWindow = {
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-07-31T23:59:59.999Z"),
    };
    h.subHistoryFindMany.mockResolvedValue([
      { startedAt: new Date("2026-06-01T00:00:00Z"), endedAt: null, priceCents: 30_000 },
      // Active July 1–15 (15 days of 31): 30000/31×15 per-month-slice rounding.
      { startedAt: new Date("2026-05-20T00:00:00Z"), endedAt: new Date("2026-07-15T12:00:00Z"), priceCents: 30_000 },
    ]);
    h.walletAggregate.mockImplementation(async (args: { where: { type: unknown } }) =>
      args.where.type === "refund"
        ? { _sum: { amountCents: -700 } } // credit rows are negative
        : { _sum: { amountCents: 5_000 } },
    );

    const r = await revenueTotal(july);
    const secondSub = Math.round((30_000 / 31) * 15); // day-granular, inclusive
    expect(r.subscriptionCents).toBe(30_000 + secondSub);
    expect(r.consumptionCents).toBe(5_000);
    expect(r.refundCents).toBe(700);
    expect(r.totalCents).toBe(30_000 + secondSub + 5_000 - 700);
  });
});

// ── #9/#10 Supply side ───────────────────────────────────────────────────────

describe("countSuppliers (#9)", () => {
  it("counts distinct providers with ≥1 GPU on an online node", () => {
    // prov-1 (pool 1, online, 2 GPUs) + prov-2 (pool 2, online, 2 GPUs); the
    // null-provider node is hosted.ai internal, not a registered supplier.
    expect(countSuppliers()).toBe(2);
  });

  it("ignores offline nodes and zero-GPU nodes; null when cache is cold", () => {
    h.readPoolOverviewCache.mockReturnValue({
      pools: [
        {
          id: 1,
          totalGpus: 2,
          overcommitRatio: 1,
          gpus: [],
          nodes: [
            { id: 1, gpuModel: "H100", gpuCount: 2, providerId: "p-off", initStatus: 1 }, // initializing
            { id: 2, gpuModel: "H100", gpuCount: 0, providerId: "p-empty", initStatus: 2 },
          ],
        },
      ],
    });
    expect(countSuppliers()).toBe(0);
    h.readPoolOverviewCache.mockReturnValue(null);
    expect(countSuppliers()).toBeNull();
  });
});

describe("activeGpus (#10)", () => {
  it("counts GPUs on online nodes, by model and class, with vGPU slots = physical × ratio", () => {
    const r = activeGpus(pcOf())!;
    expect(r.total).toEqual({ physical: 5, vgpuSlots: 14 }); // 2×1 + 3×4
    expect(r.dedicated).toEqual({ physical: 2, vgpuSlots: 2 });
    expect(r.dynamic).toEqual({ physical: 3, vgpuSlots: 12 });
    expect(r.byModel).toEqual({
      H100: { physical: 2, vgpuSlots: 2 },
      L40S: { physical: 3, vgpuSlots: 12 },
    });
  });

  it("excludes GPUs on offline nodes; falls back to totalGpus when the GPU list is empty", () => {
    h.readPoolOverviewCache.mockReturnValue({
      pools: [
        {
          id: 1,
          totalGpus: 3,
          overcommitRatio: 1,
          gpus: [
            { gpuModel: "H100", nodeId: 10 },
            { gpuModel: "H100", nodeId: 11 }, // node 11 offline → excluded
          ],
          nodes: [
            { id: 10, gpuModel: "H100", gpuCount: 1, providerId: null, initStatus: 2 },
            { id: 11, gpuModel: "H100", gpuCount: 1, providerId: null, initStatus: 0 },
          ],
        },
        { id: 2, totalGpus: 4, overcommitRatio: 2, gpus: [], nodes: [] }, // list failed → fallback
      ],
    });
    const pc = classifyPools([
      { id: 1, overcommitRatio: 1 },
      { id: 2, overcommitRatio: 2 },
    ]);
    const r = activeGpus(pc)!;
    expect(r.total.physical).toBe(5); // 1 online + 4 fallback
    expect(r.dynamic).toEqual({ physical: 4, vgpuSlots: 8 });
    expect(r.byModel[UNKNOWN_GPU_TYPE]).toEqual({ physical: 4, vgpuSlots: 8 });
    expect(activeGpus(pc)).not.toBeNull();
    h.readPoolOverviewCache.mockReturnValue(null);
    expect(activeGpus(pc)).toBeNull();
  });
});

// ── #11 Available GPU-hours ──────────────────────────────────────────────────

describe("availableGpuHours (#11)", () => {
  const twoDays: MetricsWindow = {
    start: new Date("2026-08-05T00:00:00.000Z"),
    end: new Date("2026-08-06T23:59:59.999Z"),
  };

  it("sums snapshot capacity per day (basis: snapshot)", async () => {
    h.snapshotFindMany.mockResolvedValue([
      { date: "2026-08-05", onlineGpus: 5, vgpuSlots: 14 },
      { date: "2026-08-05", onlineGpus: 1, vgpuSlots: 1 },
      { date: "2026-08-06", onlineGpus: 6, vgpuSlots: 15 },
    ]);
    const r = (await availableGpuHours(twoDays))!;
    expect(r.physicalGpuHours).toBe((5 + 1) * 24 + 6 * 24);
    expect(r.vgpuSlotHours).toBe((14 + 1) * 24 + 15 * 24);
    expect(r.basis).toBe("snapshot");
    expect(r.snapshotDays).toBe(2);
    expect(r.windowDays).toBe(2);
    expect(h.snapshotFindMany).toHaveBeenCalledWith({
      where: { date: { in: ["2026-08-05", "2026-08-06"] }, kind: "pool" },
      select: { date: true, onlineGpus: true, vgpuSlots: true },
    });
  });

  it("gap days use the current fleet held constant — never zero (basis: mixed)", async () => {
    h.snapshotFindMany.mockResolvedValue([
      { date: "2026-08-06", onlineGpus: 6, vgpuSlots: 15 },
    ]);
    const r = (await availableGpuHours(twoDays))!;
    // Live fleet: 5 physical / 14 slots (from the overview fixture) × 24h for Aug 5.
    expect(r.physicalGpuHours).toBe(5 * 24 + 6 * 24);
    expect(r.vgpuSlotHours).toBe(14 * 24 + 15 * 24);
    expect(r.basis).toBe("mixed");
    expect(r.snapshotDays).toBe(1);
  });

  it("no snapshots at all → pure current-fleet basis", async () => {
    const r = (await availableGpuHours(twoDays))!;
    expect(r.basis).toBe("current-fleet");
    expect(r.vgpuSlotHours).toBe(14 * 24 * 2);
    expect(r.snapshotDays).toBe(0);
  });

  it("returns null when gap days exist and the live fleet is unavailable too", async () => {
    h.readPoolOverviewCache.mockReturnValue(null);
    expect(await availableGpuHours(twoDays)).toBeNull();
  });
});

// ── #12 Utilization ──────────────────────────────────────────────────────────

describe("utilization (#12)", () => {
  it("(billed + committed monthly hours) ÷ available vGPU-slot-hours", async () => {
    h.queryRaw.mockResolvedValue([{ hours: "100" }]); // billed on-demand vGPU-hours
    h.subHistoryFindMany.mockResolvedValue([
      // Active the whole 1-day window → 24 committed hours (1 GPU per pod-row).
      { startedAt: new Date("2026-08-01T00:00:00Z"), endedAt: null },
      // Ended half-way through the window → 12h.
      { startedAt: new Date("2026-08-01T00:00:00Z"), endedAt: new Date("2026-08-06T12:00:00Z") },
      // Ended before the window → 0.
      { startedAt: new Date("2026-08-01T00:00:00Z"), endedAt: new Date("2026-08-05T00:00:00Z") },
    ]);
    h.snapshotFindMany.mockResolvedValue([
      { date: "2026-08-06", onlineGpus: 10, vgpuSlots: 20 },
    ]);
    const r = (await utilization(W))!;
    expect(r.billedGpuHours).toBe(100);
    expect(r.committedMonthlyGpuHours).toBe(36);
    expect(r.rentedGpuHours).toBe(136);
    expect(r.availableVgpuSlotHours).toBe(480); // 20 slots × 24h
    expect(r.pct).toBe(round2((136 / 480) * 100));
    expect(r.capacityBasis).toBe("snapshot");
  });

  it("null when the capacity denominator can't be computed honestly", async () => {
    h.readPoolOverviewCache.mockReturnValue(null); // no snapshots + no live fleet
    expect(await utilization(W)).toBeNull();
  });
});

// ── Orchestrator ─────────────────────────────────────────────────────────────

describe("computePlatformMetrics", () => {
  it("computes the full payload with degradation notes for live-only metrics", async () => {
    h.lifecycleCount.mockResolvedValue(3);
    const m = await computePlatformMetrics("1d", NOW);
    expect(m.window.start.toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(m.window.label).toBe("1d");
    expect(m.asOf.toISOString()).toBe("2026-08-06T23:59:59.999Z");
    expect(m.signups).toBe(3);
    expect(m.suppliers).toBe(2);
    expect(m.activeGpus?.total).toEqual({ physical: 5, vgpuSlots: 14 });
    expect(m.availableGpuHours?.basis).toBe("current-fleet");
    expect(m.utilization).not.toBeNull();
    expect(m.mrr?.stripeLiveCents).toBeNull(); // Stripe unconfigured in this run
    expect(m.notes.some((n) => n.includes("Stripe not configured"))).toBe(true);
    expect(m.notes.some((n) => n.includes("live snapshots"))).toBe(true);
  });

  it("one failed source nulls that metric and adds a note — never the payload", async () => {
    h.lifecycleCount.mockRejectedValue(new Error("db down"));
    const m = await computePlatformMetrics("1d", NOW);
    expect(m.signups).toBeNull();
    expect(m.notes.some((n) => n.includes("signups unavailable"))).toBe(true);
    expect(m.revenue).not.toBeNull();
    expect(m.activePaying).not.toBeNull();
  });

  it("cold pool cache → breakdown-degradation note, money metrics intact", async () => {
    h.readPoolOverviewCache.mockReturnValue(null);
    const m = await computePlatformMetrics("1d", NOW);
    expect(m.notes.some((n) => n.includes("pool overview unavailable"))).toBe(true);
    expect(m.suppliers).toBeNull();
    expect(m.activeGpus).toBeNull();
    expect(m.revenue).not.toBeNull();
    expect(m.mrr).not.toBeNull();
  });

  it("warns that the consumption run-rate does not follow a historical window", async () => {
    // #7 is trailing-30d-from-today by definition, so on a past period it must
    // say so rather than sit unlabeled beside period-scoped numbers.
    const past = await computePlatformMetrics({ from: "2026-06-01", to: "2026-06-30" }, NOW);
    expect(past.notes.some((n) => n.includes("does NOT follow the selected period"))).toBe(true);

    // Current window → no such warning (it IS the current trailing period).
    const current = await computePlatformMetrics("1d", NOW);
    expect(current.notes.some((n) => n.includes("does NOT follow the selected period"))).toBe(false);
  });

  it("passes Stripe through to the MRR reconciliation when configured", async () => {
    h.getStripe.mockResolvedValue({} as never);
    h.computeMrrCents.mockResolvedValue(123_456);
    h.subHistoryFindMany.mockResolvedValue([]);
    const m = await computePlatformMetrics("1d", NOW);
    expect(m.mrr?.stripeLiveCents).toBe(123_456);
    expect(m.mrr?.stripeDeltaCents).toBe(-123_456);
  });
});
