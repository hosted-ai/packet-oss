// Marketplace KPIs from the metrics gap-analysis sheet (Kumar):
//   #14 GMV          — billed pod volume from the wallet ledger (gpu_usage +
//                      stopped_reservation rows), i.e. what billing actually charged.
//   #15 Net Revenue  — GMV × flat take-rate (modeled).
//   #12 Utilization  — decomposed per SKU: headline, 12a bare metal, 12b dedicated
//                      (overcommit ≤ 1), 12c dynamic (overcommit > 1), 12d VRAM.
//
// Everything is windowed over [start, end). Per the sheet's GMV definition
// ("Sum(billed GPU-hrs × hourly price) across jobs"), monthly subscriptions
// (Stripe-billed) and bare-metal term prepay (invoice-billed) are NOT in GMV.
//
// Capacity denominators use the CURRENT fleet (pool-overview cache / live HAI
// node list) held constant across the window — no historical online-hours
// series exists yet (sheet #11). Treat utilization as an approximation until
// that series is built.

import { prisma } from "@/lib/prisma";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";
import { classifyPools } from "@/lib/platform-metrics";
import { ACTIVATED_ORDER_STATUSES } from "@/lib/baremetal/order-status";

// ponytail: flat modeled take-rate (sheet #15 v1). provider_node_usage
// .packet_margin_cents is never written and ProviderCommercialTerms is sparse —
// swap to real per-provider margin once either carries production data.
export const PACKET_TAKE_RATE = 0.2;

/** Utilization window is capped: ledger×capacity math over "all time" against
 *  today's fleet is meaningless. GMV/Net Revenue are NOT capped. */
const MAX_UTILIZATION_WINDOW_DAYS = 90;

export interface UtilizationBlock {
  billedGpuHours: number;
  capacityGpuHours: number;
  pct: number;
}

export interface MarketplaceMetrics {
  gmv: {
    totalCents: number;
    usageCents: number;
    stoppedCents: number;
    billedGpuHours: number;
  };
  netRevenue: { cents: number; takeRate: number };
  utilization: {
    /** Days the utilization blocks actually cover (may be shorter than the GMV window). */
    windowDays: number;
    /** #12 headline: billed GPU-hours ÷ capacity GPU-hours across all pools. */
    headline: UtilizationBlock | null;
    /** 12b: pools with overcommit ≤ 1 (single-tenant). */
    dedicated: UtilizationBlock | null;
    /** 12c: pools with overcommit > 1. Null until such pools exist. */
    dynamicLogical: UtilizationBlock | null;
    /** 12d: avg VRAM % across sampled (rented) GPUs. Samples are retained 7
     *  days, so this effectively covers min(window, 7d). */
    vramAvgPct: number | null;
    /** 12a: rented server-hours ÷ (currently-online servers × window hours). */
    bareMetal: {
      rentedServerHours: number;
      onlineServers: number;
      capacityServerHours: number;
      pct: number;
    } | null;
    capacityBasis: "current-fleet";
  };
}

interface LedgerGroup {
  type: string;
  poolId: number | null;
  cents: number;
  gpuHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Billed cents + GPU-hours from the wallet ledger, grouped by type and pool.
 *  gpu_count/billing_minutes are nullable on old rows → COALESCE to 0 so those
 *  rows still contribute cents (they just add no hours). */
async function ledgerGroups(start: Date, end: Date): Promise<LedgerGroup[]> {
  const rows = await prisma.$queryRaw<
    { type: string; poolId: number | null; cents: unknown; gpuHours: unknown }[]
  >`
    SELECT type,
           pool_id AS poolId,
           COALESCE(SUM(amount_cents), 0) AS cents,
           COALESCE(SUM(COALESCE(billing_minutes, 0) * COALESCE(gpu_count, 0)), 0) / 60 AS gpuHours
    FROM wallet_transaction
    WHERE type IN ('gpu_usage', 'stopped_reservation')
      AND created_at >= ${start} AND created_at < ${end}
    GROUP BY type, pool_id
  `;
  // MariaDB SUM() comes back as Decimal/string through $queryRaw — normalize.
  return rows.map((r) => ({
    type: r.type,
    poolId: r.poolId === null ? null : Number(r.poolId),
    cents: Number(r.cents),
    gpuHours: Number(r.gpuHours),
  }));
}

export async function computeMarketplaceMetrics(
  start: Date,
  end: Date,
): Promise<MarketplaceMetrics> {
  // ── GMV / Net Revenue (#14, #15) — full window ─────────────────────────────
  const gmvGroups = await ledgerGroups(start, end);
  let usageCents = 0;
  let stoppedCents = 0;
  let gmvGpuHours = 0;
  for (const g of gmvGroups) {
    if (g.type === "gpu_usage") usageCents += g.cents;
    else stoppedCents += g.cents;
    gmvGpuHours += g.gpuHours;
  }
  const totalCents = usageCents + stoppedCents;

  // ── Utilization (#12) — window capped at 90 days ───────────────────────────
  const maxUtilMs = MAX_UTILIZATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const clamped = end.getTime() - start.getTime() > maxUtilMs;
  const utilStart = clamped ? new Date(end.getTime() - maxUtilMs) : start;
  const utilGroups = clamped ? await ledgerGroups(utilStart, end) : gmvGroups;
  const windowHours = (end.getTime() - utilStart.getTime()) / (60 * 60 * 1000);
  const windowDays = round2(windowHours / 24);

  // Pool classification (sheet B1): dedicated = overcommit ≤ 1, dynamic = > 1 —
  // the shared classifier (PA-693), same rule this file used to inline.
  const overview = readPoolOverviewCache();
  let headline: UtilizationBlock | null = null;
  let dedicated: UtilizationBlock | null = null;
  let dynamicLogical: UtilizationBlock | null = null;
  if (overview) {
    const { dedicatedPoolIds, dynamicPoolIds } = classifyPools(overview.pools);
    let dedicatedCapacity = 0;
    let dynamicCapacity = 0;
    for (const p of overview.pools) {
      const cap = p.totalGpus * (p.overcommitRatio || 1) * windowHours;
      if (dynamicPoolIds.has(p.id)) dynamicCapacity += cap;
      else dedicatedCapacity += cap;
    }

    // Headline numerator counts every billed hour (incl. rows with no pool tag
    // — pre-0.8.26 ledger rows — and pools since deleted from the fleet).
    // Per-SKU numerators only see rows whose pool is in the current overview.
    let allHours = 0;
    let dedicatedHours = 0;
    let dynamicHours = 0;
    for (const g of utilGroups) {
      allHours += g.gpuHours;
      if (g.poolId === null) continue;
      if (dynamicPoolIds.has(g.poolId)) dynamicHours += g.gpuHours;
      else if (dedicatedPoolIds.has(g.poolId)) dedicatedHours += g.gpuHours;
    }

    const block = (hours: number, capacity: number): UtilizationBlock => ({
      billedGpuHours: round2(hours),
      capacityGpuHours: round2(capacity),
      pct: capacity > 0 ? round2((hours / capacity) * 100) : 0,
    });
    headline = block(allHours, dedicatedCapacity + dynamicCapacity);
    dedicated = block(dedicatedHours, dedicatedCapacity);
    // No overcommit pools exist yet (v1.0) — stays null until one does.
    dynamicLogical = dynamicPoolIds.size > 0 ? block(dynamicHours, dynamicCapacity) : null;
  }

  // 12d — VRAM. Samples only exist for rented pods (7-day retention), so this
  // is "how loaded are the GPUs customers hold", not fleet-wide.
  let vramAvgPct: number | null = null;
  try {
    const vram = await prisma.gpuHardwareMetrics.aggregate({
      _avg: { memoryPercent: true },
      where: { timestamp: { gte: utilStart, lt: end } },
    });
    vramAvgPct = vram._avg.memoryPercent === null ? null : round2(vram._avg.memoryPercent);
  } catch (err) {
    console.error("[Marketplace KPIs] VRAM aggregate failed:", err);
  }

  // 12a — bare metal. Rented hours from order lifecycle (provisioned → expiry/
  // termination), × serverCount for multi-server orders. Denominator is the
  // live online-node count — server online-hours are not persisted (sheet gap).
  let bareMetal: MarketplaceMetrics["utilization"]["bareMetal"] = null;
  try {
    const orders = await prisma.bareMetalOrder.findMany({
      where: {
        provisionedDate: { not: null, lt: end },
        status: { in: [...ACTIVATED_ORDER_STATUSES] },
      },
      select: {
        provisionedDate: true,
        expiresAt: true,
        terminatedAt: true,
        serverCount: true,
      },
    });
    let rentedServerHours = 0;
    for (const o of orders) {
      const rentedFrom = Math.max(o.provisionedDate!.getTime(), utilStart.getTime());
      const rentedTo = Math.min(
        end.getTime(),
        o.terminatedAt?.getTime() ?? Infinity,
        o.expiresAt?.getTime() ?? Infinity,
      );
      if (rentedTo <= rentedFrom) continue;
      rentedServerHours += ((rentedTo - rentedFrom) / (60 * 60 * 1000)) * o.serverCount;
    }

    const nodes = await gpuaasAdmin.listAllBaremetalNodes();
    const onlineServers = nodes.filter(
      (n) => (n.status || "").toLowerCase() === "online",
    ).length;
    const capacityServerHours = onlineServers * windowHours;
    bareMetal = {
      rentedServerHours: round2(rentedServerHours),
      onlineServers,
      capacityServerHours: round2(capacityServerHours),
      pct: capacityServerHours > 0 ? round2((rentedServerHours / capacityServerHours) * 100) : 0,
    };
  } catch (err) {
    console.error("[Marketplace KPIs] bare-metal utilization failed:", err);
  }

  return {
    gmv: {
      totalCents,
      usageCents,
      stoppedCents,
      billedGpuHours: round2(gmvGpuHours),
    },
    netRevenue: { cents: Math.round(totalCents * PACKET_TAKE_RATE), takeRate: PACKET_TAKE_RATE },
    utilization: {
      windowDays,
      headline,
      dedicated,
      dynamicLogical,
      vramAvgPct,
      bareMetal,
      capacityBasis: "current-fleet",
    },
  };
}
