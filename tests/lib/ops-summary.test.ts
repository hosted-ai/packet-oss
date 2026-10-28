// Tests for src/lib/ops-summary.ts — scoped earned-revenue compute + render.
//
// Daily Revenue = GPU usage (ledger by pool) + stopped (yesterday's
// stopped_reservation ledger rows, pool-tagged by the sync engine so products
// scope filters by poolId) + monthly subs (Stripe, ÷30).
// Scope = everything | products. Boundary deps mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  walletTxnAggregate: vi.fn(),
  queryRaw: vi.fn(),
  gpuProductFindMany: vi.fn(),
  bmProductFindMany: vi.fn(),
  bmOrderAggregate: vi.fn(),
  podMetadataFindMany: vi.fn(),
  subscriptionsList: vi.fn(),
  getStripe: vi.fn(),
  readPoolOverviewCache: vi.fn(),
  getAllUnifiedInstances: vi.fn(),
  getVgpuCounts: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  listAllBaremetalNodes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    walletTransaction: { aggregate: h.walletTxnAggregate },
    $queryRaw: h.queryRaw,
    gpuProduct: { findMany: h.gpuProductFindMany },
    bareMetalProduct: { findMany: h.bmProductFindMany },
    bareMetalOrder: { aggregate: h.bmOrderAggregate },
    podMetadata: { findMany: h.podMetadataFindMany },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: h.getStripe }));
vi.mock("@/lib/pool-overview", () => ({ readPoolOverviewCache: h.readPoolOverviewCache }));
vi.mock("@/lib/hostedai/instances", () => ({ getAllUnifiedInstances: h.getAllUnifiedInstances }));
vi.mock("@/lib/ops-vgpu-cache", () => ({ getVgpuCounts: h.getVgpuCounts }));
vi.mock("@/lib/settings", () => ({ getSetting: h.getSetting, setSetting: h.setSetting }));
vi.mock("@/lib/gpuaas-admin", () => ({ gpuaasAdmin: { listAllBaremetalNodes: h.listAllBaremetalNodes } }));

// PA-693: stub only the platform-health metric functions; the moved ledger
// helpers (sumUsageRevenue etc.), previousUtcDay, resolveWindow and
// classifyPools stay REAL via importOriginal — they back the existing rows.
const ph = vi.hoisted(() => ({
  countSignups: vi.fn(),
  timeToFirstJob: vi.fn(),
  activePayingCustomers: vi.fn(),
  mrrAsOf: vi.fn(),
  consumptionRunRate: vi.fn(),
  countSuppliers: vi.fn(),
  availableGpuHours: vi.fn(),
  utilization: vi.fn(),
}));
vi.mock("@/lib/platform-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform-metrics")>()),
  ...ph,
}));

import {
  computeOpsSummary,
  getOpsSummaryConfig,
  renderTable,
  stampOpsGpuSnapshot,
  DEFAULT_OPS_SUMMARY_CONFIG,
  type OpsSummaryConfig,
  type OpsScope,
  type MetricRow,
} from "@/lib/ops-summary";

const NOW = new Date("2026-06-20T13:00:00.000Z"); // → report date 2026-06-19

// Pools: 143 & 145 belong to product gp-b200; 999 is an H100 pool (out of scope).
// totalGpus = physical GPUs; overcommitRatio = share ratio. vGPU capacity = product.
function poolOk() {
  return {
    summary: { utilizationPercent: 64, totalGpus: 500, allocatedGpus: 320, activePods: 58 },
    pools: [
      { id: 143, totalGpus: 4, overcommitRatio: 1, allocatedGpus: 4 },
      { id: 145, totalGpus: 2, overcommitRatio: 1, allocatedGpus: 2 },
      { id: 999, totalGpus: 4, overcommitRatio: 1, allocatedGpus: 4 },
    ],
  };
}

function instances() {
  return [
    { id: "i1", nature: "pod", status: "running", team: { id: "t1" }, pod_info: { pool_id: 143 } },
    { id: "i2", nature: "pod", status: "active", team: { id: "t2" }, pod_info: { pool_id: 145 } },
    { id: "i3", nature: "pod", status: "running", team: { id: "t1" }, pod_info: { pool_id: 143 } },
    { id: "i6", nature: "pod", status: "running", team: { id: "t4" }, pod_info: { pool_id: 999 } },
    { id: "i7", nature: "pod", status: "STOPPED", team: { id: "t3" }, pod_info: { pool_id: 143 } }, // real HAI value (uppercase), in scope
    { id: "i8", nature: "baremetal", status: "Online", team: { id: "t5" }, pod_info: { pool_id: 143 } }, // real HAI BM value (node-style "Online"); excluded from pod metrics
  ];
}

function cfg(scope?: OpsScope): OpsSummaryConfig {
  return {
    enabled: true,
    scope: scope ?? { mode: "everything", productIds: [] },
    gpuRows: [
      { label: "B200 Bare Metal", source: "baremetal", productIds: [], nodeIds: [1, 3], goal: 16 },
      { label: "B200 Dynamic", source: "pool", productIds: ["gp-b200"], goal: 16 },
    ],
    goals: DEFAULT_OPS_SUMMARY_CONFIG.goals,
  };
}

const val = (rows: MetricRow[], label: string) => rows.find((r) => r.label === label)?.value;
const rev = (rows: MetricRow[], label: string) => rows.find((r) => r.label === label)?.revenue;
const cap = (rows: MetricRow[], label: string) => rows.find((r) => r.label === label)?.capacity;
const util = (rows: MetricRow[], label: string) => rows.find((r) => r.label === label)?.utilization;

beforeEach(() => {
  vi.clearAllMocks();
  // Usage: scoped query (where.poolId present) → $40; platform → $100.
  // Stopped ledger (type=stopped_reservation): platform → $90; scoped → $40.
  h.walletTxnAggregate.mockImplementation(
    async (args: { where?: { poolId?: unknown; type?: string } }) => {
      if (args?.where?.type === "stopped_reservation")
        return { _sum: { amountCents: args?.where?.poolId ? 4000 : 9000 } };
      return { _sum: { amountCents: args?.where?.poolId ? 4000 : 10000 } };
    },
  );
  h.gpuProductFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
    const ids = args?.where?.id?.in ?? [];
    const map: Record<string, { poolIds: string; billingType: string }> = {
      "gp-b200": { poolIds: "[143,145]", billingType: "hourly" },
    };
    return ids.filter((id) => map[id]).map((id) => ({ id, ...map[id] }));
  });
  // PA-409: default no per-pod billing metadata → every running pod is treated
  // hourly (isMonthlyPod=false), so hourly rows count the full pooled set.
  h.podMetadataFindMany.mockResolvedValue([]);
  h.bmProductFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) =>
    (args?.where?.id?.in ?? []).includes("bm-b200") ? [{ gpuType: "NVIDIA B200 192GB" }] : [],
  );
  // Baremetal node assignment: node 1 in-service (8 GPUs), node 3 NOT in service
  // (excluded), node 9 in-service but not selected. Row selects [1, 3] → 8.
  h.listAllBaremetalNodes.mockResolvedValue([
    { id: 1, name: "srv-1", gpu_count: 8, status: "Online", service_status: "In service" },
    { id: 3, name: "srv-3", gpu_count: 8, status: "Online", service_status: "Not in service" },
    { id: 9, name: "srv-9", gpu_count: 4, status: "Online", service_status: "In service" },
  ]);
  h.bmOrderAggregate.mockImplementation(async (args: { _sum?: Record<string, unknown> }) => {
    if (args?._sum?.serverCount !== undefined) return { _sum: { serverCount: 3 } };
    if (args?._sum?.totalInvoiceCents !== undefined) return { _sum: { totalInvoiceCents: 500_000 } };
    if (args?._sum?.termPriceCents !== undefined) return { _sum: { termPriceCents: 800_000 } };
    return { _sum: {} };
  });
  const monthlyItem = (cents: number) => ({ price: { recurring: { interval: "month" }, unit_amount: cents }, quantity: 1 });
  h.subscriptionsList.mockResolvedValue({
    has_more: false,
    data: [
      { id: "sub1", status: "active", metadata: { gpu_product_id: "gp-b200" }, items: { data: [monthlyItem(300_000)] } },
      { id: "sub2", status: "active", metadata: { gpu_product_id: "other" }, items: { data: [monthlyItem(300_000)] } },
    ],
  });
  h.getStripe.mockResolvedValue({ subscriptions: { list: h.subscriptionsList } });
  // Billed GPU-hours ledger sweep (sumBilledGpuHours raw query): 48 GPU-hours.
  h.queryRaw.mockResolvedValue([{ hours: 48 }]);
  h.readPoolOverviewCache.mockReturnValue(poolOk());
  h.getAllUnifiedInstances.mockResolvedValue(instances());
  h.getVgpuCounts.mockImplementation(async (ids: string[]) => {
    const all: Record<string, number> = { i1: 1, i2: 2, i3: 1, i6: 1 };
    const out: Record<string, number> = {};
    for (const id of ids) if (all[id] != null) out[id] = all[id];
    return out;
  });
  h.getSetting.mockResolvedValue(null);

  // PA-693 platform-health stubs (pinned by the platform-health rows test).
  ph.countSignups.mockResolvedValue(4);
  ph.timeToFirstJob.mockResolvedValue({
    medianHours: 6.5, n: 3, cohortSize: 5, workloadBasisN: 2, deployProxyN: 1,
  });
  ph.activePayingCustomers.mockResolvedValue({
    total: 12, onDemand: 9, monthly: 5,
    dedicated: { total: 6, onDemandByGpuType: { H100: 4 }, monthlyByGpuType: { H100: 2 } },
    dynamic: { total: 5, onDemandByGpuType: { L40S: 5 }, monthlyByGpuType: {} },
    unknownPool: 1,
  });
  ph.mrrAsOf.mockResolvedValue({
    totalCents: 360_000, dailyProratedCents: 12_000,
    dedicatedMonthlyByGpuType: { H100: 150_000 },
    dynamicMonthlyByGpuType: { L40S: 210_000 },
    unknownPoolCents: 0, stripeLiveCents: null, stripeDeltaCents: null,
  });
  ph.consumptionRunRate.mockResolvedValue({
    trailing30dCents: 100_000, runRateCents: 1_200_000,
    byGrain: { "1d": 4_000, "7d": 28_000, "1m": 100_000 },
    dedicatedByGpuType: {}, dynamicByGpuType: {}, unknownPoolCents: 0,
  });
  ph.countSuppliers.mockReturnValue(2); // sync — reads the pool cache
  ph.availableGpuHours.mockResolvedValue({
    physicalGpuHours: 120, vgpuSlotHours: 336, basis: "snapshot",
    snapshotDays: 1, windowDays: 1,
  });
  ph.utilization.mockResolvedValue({
    billedGpuHours: 100, committedMonthlyGpuHours: 36, rentedGpuHours: 136,
    availableVgpuSlotHours: 336, pct: 40.48, capacityBasis: "snapshot",
    snapshotDays: 1, windowDays: 1,
  });
});

describe("computeOpsSummary — everything (platform) scope", () => {
  it("earned Daily Revenue = usage + stopped + monthly; platform KPIs", async () => {
    const s = await computeOpsSummary(cfg(), NOW);
    expect(s.scopeLabel).toBe("Platform");
    expect(s.missing).toEqual([]);
    expect(val(s.rows, "B200 Bare Metal")).toBe("1"); // node COUNT: in-service node 1; node 3 not-in-service excluded
    expect(val(s.rows, "B200 Dynamic")).toBe("4"); // gp-b200 pools 143,145 → i1(1)+i2(2)+i3(1)
    // PA-409: per-product revenue alongside the count. B200 Dynamic is hourly →
    // usage + stopped for its pools (scoped ledger mock: 4000 + 4000). Baremetal
    // has no daily earned line → "—".
    expect(rev(s.rows, "B200 Dynamic")).toBe("$80");
    expect(rev(s.rows, "B200 Bare Metal")).toBeNull();
    // Basis column in the row; formulas live in the pinned reference, not the post.
    // PA-691: Capacity = Σ row-pool GPUs × share ratio (143: 4×1 + 145: 2×1 = 6),
    // Util % = Today ÷ Capacity (4/6 → 67%).
    expect(s.text).toContain("| B200 Dynamic | 4 | 6 | 67% | $80 | 16 | LIVE |");
    // BM row: capacity = assigned nodes Online (1 and 3, service status ignored
    // for the denominator) = 2; Today = in-service only = 1 → 50%.
    expect(s.text).toContain("| B200 Bare Metal | 1 | 2 | 50% |");
    expect(s.raw["B200 Dynamic (capacity)"]).toBe("6");
    expect(s.raw["B200 Dynamic (util%)"]).toBe("67%");
    expect(s.raw["B200 Bare Metal (capacity)"]).toBe("2");
    expect(s.raw["B200 Bare Metal (util%)"]).toBe("50%");
    // vGPUs in use (i1+i2+i3+i6 = 5) ÷ capacity (4+2+4 = 10) = 50%
    expect(val(s.rows, "vGPU Utilization %")).toBe("50%");
    // Billed (windowed): 48 ledger GPU-hours ÷ (capacity 10 × 24h) = 20%
    expect(val(s.rows, "GPU Utilization % (billed)")).toBe("20%");
    // BM utilization: in-service (nodes 1,9) ÷ online (1,3,9) = 67%
    expect(val(s.rows, "Bare Metal Utilization %")).toBe("67%");
    expect(val(s.rows, "Active Customers (Pods)")).toBe("3"); // running teams t1,t2,t4 (stopped/baremetal excluded)
    expect(val(s.rows, "Active Customers (Bare Metal)")).toBe("1"); // baremetal i8 → team t5
    // usage 10000 + stopped (ledger, billed yesterday = 9000) + monthly ((300000+300000)/30=20000) = 39000
    expect(s.raw.usageCents).toBe(10000);
    expect(s.raw.stoppedCents).toBe(9000);
    expect(s.raw.monthlyCents).toBe(20000);
    expect(val(s.rows, "Daily Revenue")).toBe("$390");
    // Breakdown sub-rows show each stream; time basis moved to the Basis column
    expect(val(s.rows, "↳ GPU Usage")).toBe("$100");
    expect(val(s.rows, "↳ Stopped Pods")).toBe("$90"); // platform = ledger, not snapshot
    expect(val(s.rows, "↳ Monthly Subs")).toBe("$200");
    // Net Revenue = 20% of the ledger GMV: (10000 usage + 9000 stopped) × 0.2 = $38
    expect(val(s.rows, "Net Revenue (20% take)")).toBe("$38");
    expect(s.raw.netRevenueCents).toBe(3800);
    expect(val(s.rows, "Revenue / GPU / Day (live GPUs)")).toBe("$78"); // 39000 / 5 vGPUs in use
    expect(val(s.rows, "Bare Metal Deposits")).toBe("$8,000"); // termPriceCents 800000
    expect(val(s.rows, "Revenue Run Rate (×365 + BM deposits)")).toBe("$150,350"); // 39000 × 365 + 800000
    expect(s.bmContractCents).toBe(500_000);
    expect(s.raw.bmDepositsToDateCents).toBe(800_000);
  });

  it("BM deposits only count orders that reached Active — never-activated orders excluded (PA-357)", async () => {
    await computeOpsSummary(cfg(), NOW);
    const call = h.bmOrderAggregate.mock.calls.find((c) => c[0]?._sum?.termPriceCents !== undefined);
    expect(call?.[0]?.where?.status).toEqual({ in: ["active", "expired", "terminated"] });
  });

  it("an explicit window overrides the previous-UTC-day default (PA-693)", async () => {
    const window = {
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-06-01T23:59:59.999Z"),
    };
    const s = await computeOpsSummary(cfg(), NOW, window);
    expect(s.date).toBe("2026-06-01"); // not NOW-1 (2026-06-19)
    // The ledger sweeps ran over the explicit window, not previousUtcDay(NOW).
    expect(h.walletTxnAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: window.start, lte: window.end },
        }),
      }),
    );
  });

  // ── PA-693 platform-health rows — same lib functions as /api/admin/packet-health ──
  it("renders the platform-health rows from the shared metrics lib", async () => {
    const s = await computeOpsSummary(cfg(), NOW);

    expect(val(s.rows, "Signups (completed)")).toBe("4");
    expect(val(s.rows, "Time to First Job (median)")).toBe("6.5h");
    expect(val(s.rows, "Active Paying Customers")).toBe("12");
    expect(val(s.rows, "↳ Dedicated")).toBe("6");
    expect(val(s.rows, "↳ Dynamic")).toBe("5");
    expect(val(s.rows, "MRR")).toBe("$3,600");
    expect(val(s.rows, "↳ Dedicated Monthly")).toBe("$1,500");
    expect(val(s.rows, "↳ Dynamic Monthly")).toBe("$2,100");
    // Label states the basis: #7 is trailing-30d-from-today, NOT the report day.
    expect(val(s.rows, "Consumption Run Rate (30d×12, as of today)")).toBe("$12,000");
    expect(val(s.rows, "Suppliers (live GPUs)")).toBe("2");
    expect(val(s.rows, "Available GPU-hours")).toBe("336");
    expect(val(s.rows, "Utilization % (rented ÷ available)")).toBe("40%");

    // The metric fns received the report-day window / as-of anchor.
    expect(ph.countSignups).toHaveBeenCalledWith({
      start: new Date("2026-06-19T00:00:00.000Z"),
      end: new Date("2026-06-19T23:59:59.999Z"),
    });
    expect(ph.mrrAsOf).toHaveBeenCalledWith(
      new Date("2026-06-19T23:59:59.999Z"),
      expect.anything(),
    );

    // Every number mirrors into raw for the API payload.
    expect(s.raw.signupsCompleted).toBe(4);
    expect(s.raw.ttfjMedianHours).toBe(6.5);
    expect(s.raw.activePayingTotal).toBe(12);
    expect(s.raw.mrrCents).toBe(360_000);
    expect(s.raw.consumptionRunRateCents).toBe(1_200_000);
    expect(s.raw.suppliersLiveGpus).toBe(2);
    expect(s.raw.availableVgpuSlotHours).toBe(336);
    expect(s.raw.platformUtilizationPct).toBe(40.48);
  });

  it("a failed platform-health source renders — for its row only", async () => {
    ph.mrrAsOf.mockRejectedValue(new Error("db down"));
    const s = await computeOpsSummary(cfg(), NOW);

    expect(val(s.rows, "MRR")).toBeNull();
    expect(s.missing).toContain("MRR");
    expect(val(s.rows, "Signups (completed)")).toBe("4"); // others intact
    expect(val(s.rows, "Daily Revenue")).toBe("$390"); // existing rows untouched
  });

  it("counts monthly subscriptions regardless of any deployed pod, across pages", async () => {
    const monthlyItem = (c: number) => ({ price: { recurring: { interval: "month" }, unit_amount: c }, quantity: 1 });
    h.subscriptionsList
      .mockResolvedValueOnce({ has_more: true, data: [{ id: "a", status: "active", metadata: {}, items: { data: [monthlyItem(300_000)] } }] })
      .mockResolvedValueOnce({ has_more: false, data: [{ id: "b", status: "active", metadata: {}, items: { data: [monthlyItem(300_000)] } }] });
    const s = await computeOpsSummary(cfg(), NOW);
    expect(s.raw.monthlyCents).toBe(20000); // both pages summed (600000/30), no pod required
  });

  it("monthly subs window = the report day: churned-overnight counts, ended-before-day and never-active don't", async () => {
    // Report day = 2026-06-19 UTC. dayStart = 06-19T00:00Z.
    const dayStartSec = Date.UTC(2026, 5, 19) / 1000;
    const monthlyItem = (c: number) => ({ price: { recurring: { interval: "month" }, unit_amount: c }, quantity: 1 });
    h.subscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        // Canceled TODAY (after dayStart) → was still earning yesterday → counts.
        { id: "churned", status: "canceled", ended_at: dayStartSec + 30 * 3600, metadata: {}, items: { data: [monthlyItem(300_000)] } },
        // Ended BEFORE the report day → doesn't count.
        { id: "old", status: "canceled", ended_at: dayStartSec - 3600, metadata: {}, items: { data: [monthlyItem(300_000)] } },
        // Never became active → doesn't count.
        { id: "incomplete", status: "incomplete", metadata: {}, items: { data: [monthlyItem(300_000)] } },
        // Expired UNPAID during the day: Stripe stamps ended_at on expiry, but
        // the sub never earned a cent → must NOT add a phantom MRR day.
        { id: "ghost", status: "incomplete_expired", ended_at: dayStartSec + 3600, metadata: {}, items: { data: [monthlyItem(300_000)] } },
      ],
    });
    const s = await computeOpsSummary(cfg(), NOW);
    expect(s.raw.monthlyCents).toBe(10000); // only "churned" (300000/30)
    // Sweep must ask Stripe for ALL statuses, capped at subs created by day end.
    const call = h.subscriptionsList.mock.calls[0]?.[0];
    expect(call?.status).toBe("all");
    expect(call?.created?.lte).toBe(Math.floor(Date.UTC(2026, 5, 19, 23, 59, 59, 999) / 1000));
  });
});

describe("computeOpsSummary — products scope", () => {
  it("scopes every KPI to the selected products' pools", async () => {
    const s = await computeOpsSummary(cfg({ mode: "products", productIds: ["gp-b200"] }), NOW);
    expect(s.scopeLabel).toBe("1 product");
    // vGPUs in use (i1+i2+i3 = 4) ÷ capacity (pools 143,145 = 4+2 = 6) = 67%
    expect(val(s.rows, "vGPU Utilization %")).toBe("67%");
    // Billed: 48 GPU-hours ÷ (scoped capacity 6 × 24h = 144) = 33%
    expect(val(s.rows, "GPU Utilization % (billed)")).toBe("33%");
    expect(val(s.rows, "Active Customers (Pods)")).toBe("2"); // t1,t2 (t4 on pool 999 is out of scope)
    // BM metrics are platform-only — a scoped report omits them entirely.
    expect(val(s.rows, "Bare Metal Utilization %")).toBeUndefined();
    expect(val(s.rows, "Active Customers (Bare Metal)")).toBeUndefined();
    // usage scoped 4000 + stopped (scoped ledger 4000) + monthly (gp-b200 only, 300000/30=10000) = 18000
    expect(s.raw.usageCents).toBe(4000);
    expect(s.raw.monthlyCents).toBe(10000);
    expect(val(s.rows, "Daily Revenue")).toBe("$180");
    expect(val(s.rows, "↳ GPU Usage")).toBe("$40");
    expect(val(s.rows, "↳ Stopped Pods")).toBe("$40");
    expect(val(s.rows, "↳ Monthly Subs")).toBe("$100");
    // Scoped net revenue: (4000 usage + 4000 stopped) × 0.2 = $16
    expect(val(s.rows, "Net Revenue (20% take)")).toBe("$16");
    // Scoped stopped must hit the ledger WITH the pool filter (143, 145).
    const stoppedCall = h.walletTxnAggregate.mock.calls.find(
      (c) => c[0]?.where?.type === "stopped_reservation",
    );
    expect(stoppedCall?.[0]?.where?.poolId).toEqual({ in: [143, 145] });
    expect(val(s.rows, "Revenue / GPU / Day (live GPUs)")).toBe("$45"); // 18000 / (i1+i2+i3 = 4 vGPU)
    // Products scope: baremetal deposits are platform-only, so the run rate is pure recurring.
    expect(val(s.rows, "Bare Metal Deposits")).toBeUndefined(); // not shown in products scope
    expect(val(s.rows, "Revenue Run Rate (×365)")).toBe("$65,700"); // 18000 × 365, no BM deposits
  });

  it("omits the PA-693 platform-health rows and never calls the metric fns", async () => {
    const s = await computeOpsSummary(cfg({ mode: "products", productIds: ["gp-b200"] }), NOW);
    expect(val(s.rows, "Signups (completed)")).toBeUndefined();
    expect(val(s.rows, "MRR")).toBeUndefined();
    expect(val(s.rows, "Utilization % (rented ÷ available)")).toBeUndefined();
    expect(ph.countSignups).not.toHaveBeenCalled();
    expect(ph.mrrAsOf).not.toHaveBeenCalled();
    expect(ph.countSuppliers).not.toHaveBeenCalled();
    expect(s.raw.signupsCompleted).toBeNull();
  });
});

describe("per-product-type split — Dedicated Monthly vs On-demand share a pool (PA-409)", () => {
  // Both products point to the SAME pool 143. Before the fix, both rows counted
  // every running pod in the pool → identical numbers (the reported bug). The
  // fix splits by each pod's billing type (PodMetadata).
  const splitCfg: OpsSummaryConfig = {
    enabled: true,
    scope: { mode: "everything", productIds: [] },
    gpuRows: [
      { label: "B200 Dedicated On-demand", source: "pool", productIds: ["gp-dh"], goal: 16 },
      { label: "B200 Dedicated Monthly", source: "pool", productIds: ["gp-dm"], goal: 16 },
    ],
    goals: DEFAULT_OPS_SUMMARY_CONFIG.goals,
  };

  beforeEach(() => {
    h.gpuProductFindMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
      const ids = args?.where?.id?.in ?? [];
      const map: Record<string, { poolIds: string; billingType: string }> = {
        "gp-dh": { poolIds: "[143]", billingType: "hourly" },
        "gp-dm": { poolIds: "[143]", billingType: "monthly" },
      };
      return ids.filter((id) => map[id]).map((id) => ({ id, ...map[id] }));
    });
    // Pool 143: two hourly pods + one monthly pod, all running.
    h.getAllUnifiedInstances.mockResolvedValue([
      { id: "h1", nature: "pod", status: "running", team: { id: "t1" }, pod_info: { pool_id: 143 } },
      { id: "h2", nature: "pod", status: "running", team: { id: "t2" }, pod_info: { pool_id: 143 } },
      { id: "m1", nature: "pod", status: "running", team: { id: "t3" }, pod_info: { pool_id: 143 } },
    ]);
    h.podMetadataFindMany.mockResolvedValue([
      { instanceId: "h1", billingType: "hourly", stripeSubscriptionId: null },
      { instanceId: "h2", billingType: null, stripeSubscriptionId: null }, // legacy → hourly
      { instanceId: "m1", billingType: "monthly", stripeSubscriptionId: "sub_x" },
    ]);
    h.getVgpuCounts.mockImplementation(async (ids: string[]) => {
      const all: Record<string, number> = { h1: 1, h2: 1, m1: 1 };
      const out: Record<string, number> = {};
      for (const id of ids) if (all[id] != null) out[id] = all[id];
      return out;
    });
    // One monthly sub for gp-dm at $3000/mo → ÷30 = $100.
    h.subscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        { id: "s-dm", status: "active", metadata: { gpu_product_id: "gp-dm" }, items: { data: [{ price: { recurring: { interval: "month" }, unit_amount: 300_000 }, quantity: 1 }] } },
      ],
    });
  });

  it("counts each billing type separately, not the identical pooled total", async () => {
    const s = await computeOpsSummary(splitCfg, NOW);
    expect(val(s.rows, "B200 Dedicated On-demand")).toBe("2"); // h1 + h2 (hourly)
    expect(val(s.rows, "B200 Dedicated Monthly")).toBe("1"); // m1 only — was 3 before the fix
  });

  it("attributes revenue by billing type: on-demand = ledger, monthly = subs", async () => {
    const s = await computeOpsSummary(splitCfg, NOW);
    expect(rev(s.rows, "B200 Dedicated On-demand")).toBe("$80"); // usage 4000 + stopped 4000
    expect(rev(s.rows, "B200 Dedicated Monthly")).toBe("$100"); // gp-dm subs 300000/30
  });
});

describe("Rev/GPU self-snapshot (denominator measured during the revenue day)", () => {
  const SNAP_KEY = "OPS_SUMMARY_GPU_SNAPSHOT";

  it("uses the stamp when its date matches the report day → basis 'yesterday'", async () => {
    h.getSetting.mockImplementation(async (key: string) =>
      key === SNAP_KEY
        ? JSON.stringify({ measuredOn: "2026-06-19", gpus: { everything: 39 } })
        : null,
    );
    const s = await computeOpsSummary(cfg(), NOW);
    // daily 39000 ÷ stamped 39 (not live 5) = 1000 → $10
    expect(val(s.rows, "Revenue / GPU / Day")).toBe("$10");
    expect(s.raw.revPerGpuBasis).toBe("yesterday");
  });

  it("stale stamp (different day) or wrong scope key → live fallback, labeled", async () => {
    h.getSetting.mockImplementation(async (key: string) =>
      key === SNAP_KEY
        ? JSON.stringify({ measuredOn: "2026-06-18", gpus: { everything: 39 } })
        : null,
    );
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "Revenue / GPU / Day (live GPUs)")).toBe("$78"); // 39000 / live 5
    expect(s.raw.revPerGpuBasis).toBe("live");
  });

  it("products scope reads its own scope key", async () => {
    h.getSetting.mockImplementation(async (key: string) =>
      key === SNAP_KEY
        ? JSON.stringify({ measuredOn: "2026-06-19", gpus: { "products:gp-b200": 9 } })
        : null,
    );
    const s = await computeOpsSummary(cfg({ mode: "products", productIds: ["gp-b200"] }), NOW);
    // scoped daily 18000 ÷ stamped 9 = 2000 → $20
    expect(val(s.rows, "Revenue / GPU / Day")).toBe("$20");
  });

  it("stampOpsGpuSnapshot merges same-day scopes and skips null/zero counts", async () => {
    h.getSetting.mockResolvedValue(
      JSON.stringify({ measuredOn: "2026-06-20", gpus: { everything: 70 } }),
    );
    await stampOpsGpuSnapshot({ mode: "products", productIds: ["gp-b200"] }, 5, NOW);
    expect(h.setSetting).toHaveBeenCalledWith(
      "OPS_SUMMARY_GPU_SNAPSHOT",
      JSON.stringify({ measuredOn: "2026-06-20", gpus: { everything: 70, "products:gp-b200": 5 } }),
    );
    h.setSetting.mockClear();
    await stampOpsGpuSnapshot({ mode: "everything", productIds: [] }, null, NOW); // HAI down
    await stampOpsGpuSnapshot({ mode: "everything", productIds: [] }, 0, NOW); // empty fleet
    expect(h.setSetting).not.toHaveBeenCalled();
  });
});

describe("computeOpsSummary — failure paths render '—'", () => {
  it("HAI down → active customers —; platform stopped still computes from the ledger", async () => {
    h.getAllUnifiedInstances.mockRejectedValue(new Error("HAI 500"));
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "Active Customers (Pods)")).toBeNull();
    expect(val(s.rows, "Active Customers (Bare Metal)")).toBeNull();
    expect(s.missing).toContain("HAI instances");
    expect(s.raw.stoppedCents).toBe(9000); // ledger-based — no HAI dependency in platform scope
    expect(val(s.rows, "↳ Stopped Pods")).toBe("$90");
    expect(s.raw.usageCents).toBe(10000); // usage unaffected
  });

  it("HAI down in products scope → stopped still computes from the pool-tagged ledger", async () => {
    h.getAllUnifiedInstances.mockRejectedValue(new Error("HAI 500"));
    const s = await computeOpsSummary(cfg({ mode: "products", productIds: ["gp-b200"] }), NOW);
    expect(s.raw.stoppedCents).toBe(4000); // ledger-based — no HAI dependency in either scope
    expect(val(s.rows, "↳ Stopped Pods")).toBe("$40");
  });

  it("pool cache cold → utilization —, but Rev/GPU still computes (vGPUs from instances)", async () => {
    h.readPoolOverviewCache.mockReturnValue(null);
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "vGPU Utilization %")).toBeNull(); // capacity needs the pool cache
    expect(val(s.rows, "GPU Utilization % (billed)")).toBeNull(); // same capacity dependency
    expect(val(s.rows, "Revenue / GPU / Day (live GPUs)")).toBe("$78"); // 39000 / 5 vGPUs (no cache needed)
    expect(s.missing).toContain("pool overview");
  });

  it("billed-hours ledger sweep fails → billed utilization —, live utilization unaffected", async () => {
    h.queryRaw.mockRejectedValue(new Error("db"));
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "GPU Utilization % (billed)")).toBeNull();
    expect(s.missing).toContain("billed utilization");
    expect(val(s.rows, "vGPU Utilization %")).toBe("50%"); // live path doesn't touch the ledger
  });

  it("utilization divides by physical GPUs × share ratio, not physical alone", async () => {
    // 1 physical GPU, share ratio 4 → 4 vGPU slots. 2 running vGPUs on it → 50%
    // (physical-only would read 200%).
    h.readPoolOverviewCache.mockReturnValue({
      summary: { utilizationPercent: 0, totalGpus: 1, allocatedGpus: 1, activePods: 2 },
      pools: [{ id: 143, totalGpus: 1, overcommitRatio: 4, allocatedGpus: 1 }],
    });
    h.gpuProductFindMany.mockResolvedValue([{ id: "gp-b200", poolIds: "[143]", billingType: "hourly" }]); // scope + row both resolve to pool 143
    const s = await computeOpsSummary(cfg({ mode: "products", productIds: ["gp-b200"] }), NOW);
    expect(val(s.rows, "vGPU Utilization %")).toBe("50%"); // i1(1)+i3(1)=2 vGPU ÷ (1×4)
  });

  it("real 0% utilization renders '0%', not '—'", async () => {
    h.readPoolOverviewCache.mockReturnValue({
      summary: { utilizationPercent: 0, totalGpus: 0, allocatedGpus: 0, activePods: 0 },
      pools: [],
    });
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "vGPU Utilization %")).toBe("0%");
  });

  // ── PA-691: per-row Capacity / Util % degrade to "—", never 0% or an error ──
  it("pool cache cold → product-row capacity and util render — (never the Goal)", async () => {
    h.readPoolOverviewCache.mockReturnValue(null);
    const s = await computeOpsSummary(cfg(), NOW);
    expect(cap(s.rows, "B200 Dynamic")).toBeNull();
    expect(util(s.rows, "B200 Dynamic")).toBeNull();
    expect(val(s.rows, "B200 Dynamic")).toBe("4"); // Today still counts (HAI sweep)
    // BM capacity comes from the node list, not the pool cache — unaffected.
    expect(cap(s.rows, "B200 Bare Metal")).toBe("2");
  });

  it("BM node fetch failed → BM row capacity and util render —", async () => {
    h.listAllBaremetalNodes.mockRejectedValue(new Error("HAI down"));
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "B200 Bare Metal")).toBeNull();
    expect(cap(s.rows, "B200 Bare Metal")).toBeNull();
    expect(util(s.rows, "B200 Bare Metal")).toBeNull();
  });

  it("zero capacity → util — (not 0%), capacity still shows 0", async () => {
    const config = cfg();
    config.gpuRows = [
      { label: "Unlinked Row", source: "pool", productIds: [], goal: 16 },
      { label: "No Nodes", source: "baremetal", productIds: [], nodeIds: [], goal: 4 },
    ];
    const s = await computeOpsSummary(config, NOW);
    expect(val(s.rows, "Unlinked Row")).toBe("0");
    expect(cap(s.rows, "Unlinked Row")).toBe("0");
    expect(util(s.rows, "Unlinked Row")).toBeNull();
    expect(cap(s.rows, "No Nodes")).toBe("0");
    expect(util(s.rows, "No Nodes")).toBeNull();
    expect(s.text).toContain("| Unlinked Row | 0 | 0 | — |");
  });

  it("capacity excludes GPUs on OFFLINE nodes — dead hardware isn't sellable", async () => {
    // Pool 143: 4 GPUs across two nodes; node 11 is still initializing, so its
    // 2 GPUs are not sellable. Capacity must read 2×1, not 4×1.
    h.readPoolOverviewCache.mockReturnValue({
      summary: { utilizationPercent: 0, totalGpus: 4, allocatedGpus: 2, activePods: 2 },
      pools: [
        {
          id: 143,
          totalGpus: 4,
          overcommitRatio: 1,
          allocatedGpus: 2,
          gpus: [
            { nodeId: 10, gpuModel: "B200" },
            { nodeId: 10, gpuModel: "B200" },
            { nodeId: 11, gpuModel: "B200" },
            { nodeId: 11, gpuModel: "B200" },
          ],
          nodes: [
            { id: 10, initStatus: 2, gpuModel: "B200" }, // online
            { id: 11, initStatus: 1, gpuModel: "B200" }, // initializing
          ],
        },
      ],
    });
    h.gpuProductFindMany.mockResolvedValue([
      { id: "gp-b200", poolIds: "[143]", billingType: "hourly" },
    ]);
    const s = await computeOpsSummary(cfg(), NOW);
    expect(cap(s.rows, "B200 Dynamic")).toBe("2");
    expect(val(s.rows, "B200 Dynamic")).toBe("2"); // i1 + i3 on pool 143
    expect(util(s.rows, "B200 Dynamic")).toBe("100%"); // 2 of 2 sellable slots
  });

  it("capacity counts vGPU slots (GPUs × share ratio) to match the vGPU Today count", async () => {
    h.readPoolOverviewCache.mockReturnValue({
      summary: { utilizationPercent: 0, totalGpus: 1, allocatedGpus: 1, activePods: 2 },
      pools: [{ id: 143, totalGpus: 1, overcommitRatio: 4, allocatedGpus: 1 }],
    });
    h.gpuProductFindMany.mockResolvedValue([
      { id: "gp-b200", poolIds: "[143]", billingType: "hourly" },
    ]);
    const s = await computeOpsSummary(cfg(), NOW);
    // Pool 143 only: i1(1) + i3(1) = 2 running vGPUs of 1×4 = 4 slots → 50%.
    expect(cap(s.rows, "B200 Dynamic")).toBe("4");
    expect(val(s.rows, "B200 Dynamic")).toBe("2");
    expect(util(s.rows, "B200 Dynamic")).toBe("50%");
  });

  it("usage-revenue query fails → Daily Revenue and Net Revenue — (no partial)", async () => {
    h.walletTxnAggregate.mockRejectedValue(new Error("db"));
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "Daily Revenue")).toBeNull();
    expect(val(s.rows, "Net Revenue (20% take)")).toBeNull(); // GMV base unknown
    expect(s.missing).toContain("usage revenue");
  });

  it("monthly-subs sweep fails → Daily Revenue — (no partial)", async () => {
    h.getStripe.mockRejectedValue(new Error("Stripe down"));
    const s = await computeOpsSummary(cfg(), NOW);
    expect(val(s.rows, "Daily Revenue")).toBeNull();
    expect(s.missing).toContain("monthly subs");
  });
});

describe("getOpsSummaryConfig — scope", () => {
  it("defaults to everything when unset", async () => {
    h.getSetting.mockResolvedValue(null);
    expect((await getOpsSummaryConfig()).scope).toEqual({ mode: "everything", productIds: [] });
  });

  it("keeps a stored products scope", async () => {
    h.getSetting.mockResolvedValue(
      JSON.stringify({ scope: { mode: "products", productIds: ["gp-b200", "gp-h100"] }, gpuRows: [], goals: {} }),
    );
    expect((await getOpsSummaryConfig()).scope).toEqual({ mode: "products", productIds: ["gp-b200", "gp-h100"] });
  });

  it("a legacy config with no scope key normalizes to everything", async () => {
    h.getSetting.mockResolvedValue(JSON.stringify({ gpuRows: [], goals: {} }));
    expect((await getOpsSummaryConfig()).scope.mode).toBe("everything");
  });
});

describe("renderTable", () => {
  it("shows the scope line, the rows, and a — for null values/basis", () => {
    const rows: MetricRow[] = [
      { label: "Daily Revenue", value: null, goal: "$30,000" },
      { label: "Utilization %", value: "50%", goal: "100%" },
    ];
    const text = renderTable("2026-06-19", "1 product", rows, ["usage revenue"], 500_000, 58, 500);
    expect(text).toContain("_Scope: 1 product_");
    expect(text).toContain("| Metric | Today | Capacity | Util % | Rev (prev day) | Goal | Basis |");
    // No basis/note set → Basis renders — and the label gets no footnote marker.
    // PA-691: rows without capacity/utilization (the KPI rows) render — too.
    expect(text).toContain("| Daily Revenue | — | — | — | — | $30,000 | — |");
    expect(text).toContain("| Utilization % | 50% | — | — | — | 100% | — |");
    expect(text).toContain("Unavailable this run: usage revenue");
    expect(text).toContain("New bare-metal contracts (2026-06-19): **$5,000**");
    expect(text).toContain("_Basis (Today column): LIVE = snapshot at post time");
    // PA-691 column legend: Capacity is fleet, not Goal.
    expect(text).toContain("_Capacity = sellable fleet for the row");
  });

  it("renders the basis per row (YDAY dated); formulas stay out of the post", () => {
    const rows: MetricRow[] = [
      { label: "B200 Dynamic", value: "4", goal: "16", basis: "LIVE", note: "HAI sweep — pods", capacity: "6", utilization: "67%" },
      { label: "Daily Revenue", value: "$390", goal: "$30,000", basis: "YDAY", note: "ledger + Stripe" },
      { label: "BM Deposits", value: "$8,000", goal: "—", basis: "TO-DATE", note: "BareMetalOrder" },
    ];
    const text = renderTable("2026-06-19", "Platform", rows, [], 0, null, null);
    expect(text).toContain("| B200 Dynamic | 4 | 6 | 67% | — | 16 | LIVE |");
    expect(text).toContain("| Daily Revenue | $390 | — | — | — | $30,000 | YDAY (2026-06-19) |");
    expect(text).toContain("| BM Deposits | $8,000 | — | — | — | — | TO-DATE |");
    // Notes are NOT rendered — they live in the manually pinned reference message.
    expect(text).not.toContain("HAI sweep — pods");
    expect(text).not.toContain("¹");
    expect(text).toContain(`pinned "Formula Reference"`);
  });
});
