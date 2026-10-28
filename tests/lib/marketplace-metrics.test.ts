// Tests for src/lib/marketplace-metrics.ts — GMV (#14), Net Revenue (#15) and
// per-SKU utilization (#12) from the metrics gap-analysis sheet.
//
// GMV = wallet-ledger gpu_usage + stopped_reservation sums; Net Revenue =
// GMV × 0.20 (modeled); utilization = billed GPU-hours ÷ current-fleet
// capacity, split dedicated (overcommit ≤ 1) vs dynamic (> 1), plus bare-metal
// server-hours and avg VRAM. Boundary deps mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  gpuMetricsAggregate: vi.fn(),
  bmOrderFindMany: vi.fn(),
  readPoolOverviewCache: vi.fn(),
  listAllBaremetalNodes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: h.queryRaw,
    gpuHardwareMetrics: { aggregate: h.gpuMetricsAggregate },
    bareMetalOrder: { findMany: h.bmOrderFindMany },
  },
}));
vi.mock("@/lib/pool-overview", () => ({ readPoolOverviewCache: h.readPoolOverviewCache }));
vi.mock("@/lib/gpuaas-admin", () => ({ gpuaasAdmin: { listAllBaremetalNodes: h.listAllBaremetalNodes } }));

import { computeMarketplaceMetrics, PACKET_TAKE_RATE } from "@/lib/marketplace-metrics";

const END = new Date("2026-07-30T00:00:00.000Z");
const START_24H = new Date(END.getTime() - 24 * 60 * 60 * 1000);

// Ledger groups: MariaDB SUM() arrives as Decimal/string through $queryRaw —
// return strings deliberately to pin the Number() normalization.
function ledgerRows() {
  return [
    { type: "gpu_usage", poolId: 143, cents: "10000", gpuHours: "12" },
    { type: "gpu_usage", poolId: null, cents: "2000", gpuHours: "3" }, // pre-0.8.26 untagged
    { type: "stopped_reservation", poolId: 145, cents: "3000", gpuHours: "6" },
  ];
}

// Pool 143: 4 GPUs, no overcommit (dedicated). Pool 145: 2 GPUs × 3 (dynamic).
function overview() {
  return {
    pools: [
      { id: 143, totalGpus: 4, overcommitRatio: 1 },
      { id: 145, totalGpus: 2, overcommitRatio: 3 },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.queryRaw.mockResolvedValue(ledgerRows());
  h.readPoolOverviewCache.mockReturnValue(overview());
  h.gpuMetricsAggregate.mockResolvedValue({ _avg: { memoryPercent: 42.126 } });
  h.bmOrderFindMany.mockResolvedValue([]);
  h.listAllBaremetalNodes.mockResolvedValue([]);
});

describe("GMV + Net Revenue", () => {
  it("sums usage + stopped cents and applies the flat take-rate", async () => {
    const m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.gmv).toEqual({
      totalCents: 15000,
      usageCents: 12000,
      stoppedCents: 3000,
      billedGpuHours: 21,
    });
    expect(m.netRevenue).toEqual({ cents: 3000, takeRate: PACKET_TAKE_RATE });
    expect(m.netRevenue.cents).toBe(Math.round(15000 * 0.2));
  });

  it("computes GMV even when the pool overview is unavailable", async () => {
    h.readPoolOverviewCache.mockReturnValue(null);
    const m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.gmv.totalCents).toBe(15000);
    expect(m.utilization.headline).toBeNull();
    expect(m.utilization.dedicated).toBeNull();
    expect(m.utilization.dynamicLogical).toBeNull();
  });
});

describe("utilization", () => {
  it("splits billed hours dedicated vs dynamic; untagged rows count in headline only", async () => {
    const m = await computeMarketplaceMetrics(START_24H, END);
    // Capacity over 24h: dedicated 4×1×24 = 96, dynamic 2×3×24 = 144.
    expect(m.utilization.windowDays).toBe(1);
    expect(m.utilization.headline).toEqual({
      billedGpuHours: 21, // 12 (dedicated) + 6 (dynamic) + 3 (untagged)
      capacityGpuHours: 240,
      pct: 8.75,
    });
    expect(m.utilization.dedicated).toEqual({
      billedGpuHours: 12,
      capacityGpuHours: 96,
      pct: 12.5,
    });
    expect(m.utilization.dynamicLogical).toEqual({
      billedGpuHours: 6,
      capacityGpuHours: 144,
      pct: 4.17,
    });
    expect(m.utilization.capacityBasis).toBe("current-fleet");
  });

  it("returns dynamicLogical null while no overcommit pools exist", async () => {
    h.readPoolOverviewCache.mockReturnValue({
      pools: [{ id: 143, totalGpus: 4, overcommitRatio: 1 }],
    });
    const m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.utilization.dynamicLogical).toBeNull();
    expect(m.utilization.dedicated?.capacityGpuHours).toBe(96);
    // Dynamic pool 145's billed hours reclassify as dedicated? No — 145 is
    // simply absent from the overview, so its rows land in headline only.
    expect(m.utilization.dedicated?.billedGpuHours).toBe(12);
    expect(m.utilization.headline?.billedGpuHours).toBe(21);
  });

  it("caps the utilization window at 90 days but keeps GMV on the full window", async () => {
    const start = new Date(END.getTime() - 100 * 24 * 60 * 60 * 1000);
    const m = await computeMarketplaceMetrics(start, END);
    // Two ledger sweeps: full window for GMV, clamped window for utilization.
    expect(h.queryRaw).toHaveBeenCalledTimes(2);
    expect(m.utilization.windowDays).toBe(90);
    expect(m.gmv.totalCents).toBe(15000);
    // Dedicated capacity now 4 × 1 × (90×24) = 8640.
    expect(m.utilization.dedicated?.capacityGpuHours).toBe(8640);
  });

  it("reports avg VRAM % rounded, null when no samples", async () => {
    let m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.utilization.vramAvgPct).toBe(42.13);

    h.gpuMetricsAggregate.mockResolvedValue({ _avg: { memoryPercent: null } });
    m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.utilization.vramAvgPct).toBeNull();
  });
});

describe("bare-metal utilization (12a)", () => {
  it("computes rented server-hours × serverCount against currently-online nodes", async () => {
    h.bmOrderFindMany.mockResolvedValue([
      // Provisioned before the window, still running: full 24h × 2 servers.
      {
        provisionedDate: new Date(END.getTime() - 48 * 3600e3),
        expiresAt: null,
        terminatedAt: null,
        serverCount: 2,
      },
      // Terminated mid-window: 12h × 1 server.
      {
        provisionedDate: new Date(END.getTime() - 72 * 3600e3),
        expiresAt: new Date(END.getTime() + 720 * 3600e3),
        terminatedAt: new Date(END.getTime() - 12 * 3600e3),
        serverCount: 1,
      },
      // Expired before the window: contributes nothing.
      {
        provisionedDate: new Date(END.getTime() - 500 * 3600e3),
        expiresAt: new Date(END.getTime() - 100 * 3600e3),
        terminatedAt: null,
        serverCount: 4,
      },
    ]);
    h.listAllBaremetalNodes.mockResolvedValue([
      { id: 1, status: "Online" },
      { id: 2, status: "ONLINE" }, // HAI casing drifts — match case-insensitively
      { id: 3, status: "online" },
      { id: 4, status: "Offline" },
    ]);

    const m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.utilization.bareMetal).toEqual({
      rentedServerHours: 60, // 24×2 + 12×1
      onlineServers: 3,
      capacityServerHours: 72, // 3 × 24h
      pct: 83.33,
    });
  });

  it("degrades to null when the HAI node list fails, leaving the rest intact", async () => {
    h.listAllBaremetalNodes.mockRejectedValue(new Error("HAI down"));
    const m = await computeMarketplaceMetrics(START_24H, END);
    expect(m.utilization.bareMetal).toBeNull();
    expect(m.gmv.totalCents).toBe(15000);
    expect(m.utilization.headline?.pct).toBe(8.75);
  });
});
