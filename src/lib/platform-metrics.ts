/**
 * Platform metrics #1–12 (PA-693) — the single source of truth.
 *
 * Every consumer (the /api/admin/packet-health endpoint, the Daily Ops summary,
 * leadership reporting) MUST read these functions so the numbers are identical
 * everywhere. The consumer-facing copy of these definitions lives in
 * docs/platform-metrics.md — keep the two in sync.
 *
 * Definitions (metrics dictionary rows 1–13; #13 is parked, not built):
 *   #1  Signups            — CustomerLifecycle rows with signedUpAt in window AND
 *                            firstLoginAt set (magic link clicked). Internal/test
 *                            accounts excluded. Period.
 *   #2  Time-to-first-job  — median over the window's signup cohort of
 *                            (firstWorkloadAt ?? firstGpuDeployAt) − signedUpAt.
 *                            firstWorkloadAt = first GPU-metrics sample with real
 *                            utilization (forward-only from ship date); older users
 *                            fall back to the deploy-time proxy. Never-activated
 *                            users are excluded from the median. Bare metal is
 *                            inherently excluded (no pod metrics). Median in JS.
 *   #3  Active paying      — distinct customers with ≥1 wallet consumption debit
 *                            (gpu_usage / gpu_deploy / stopped_reservation) in the
 *                            window — excluding voucher/credit-only customers (a
 *                            CustomerLifecycle row with firstDepositAt NULL means
 *                            the customer never paid real money) — plus customers
 *                            with a paid subscription overlapping the window.
 *                            Internal accounts excluded. The wallet debit IS the
 *                            on-demand "successful charge": Stripe only sees
 *                            top-ups, consumption is charged from the balance.
 *   #4/5 Dedicated/Dynamic  — subsets of #3 by pool class (dedicated = overcommit
 *                            ≤ 1, dynamic = > 1), broken down on-demand/monthly ×
 *                            GPU type. Untagged rows (pre-0.8.26) → "unknown".
 *   #6  MRR                — Σ priceCents of SubscriptionHistory rows active as-of
 *                            T. Point-in-time. Daily prorated value = ÷30. A live
 *                            Stripe MRR is reported alongside for reconciliation.
 *   #7  Consumption run-rate — trailing-30-day consumption (usage + deploy +
 *                            stopped ledger debits) × 12, plus per-grain figures.
 *   #8  Revenue (total)    — prorated subscription revenue (SubscriptionHistory ×
 *                            calendar-day proration) + consumption debits − refunds
 *                            (ledger type="refund"), for the window.
 *   #9  Suppliers          — distinct registered suppliers (ProviderNode-linked)
 *                            with ≥1 GPU on an online node. Point-in-time (live).
 *   #10 Active GPUs        — GPUs on online nodes across all pools, by model /
 *                            pool class / physical vs vGPU slots (physical ×
 *                            overcommit). Point-in-time (live).
 *   #11 Available GPU-hours — Σ over the window's UTC days of the fleet-capacity
 *                            snapshot (online GPUs × 24); days before the series
 *                            started fall back to the current fleet, and the
 *                            result is labeled snapshot / current-fleet / mixed.
 *   #12 Utilization        — (billed GPU-hours + committed monthly GPU-hours) ÷
 *                            available vGPU-slot-hours (#11). Per-SKU decomposition
 *                            stays in marketplace-metrics.ts.
 *
 * Conventions:
 *   - Money is integer cents everywhere.
 *   - Windows are inclusive [start, end] with end at 23:59:59.999 UTC, matching
 *     the ledger helpers' gte/lte queries. All windows are whole UTC days —
 *     presets end at the END OF YESTERDAY (UTC), never mid-today, so numbers
 *     reconcile against Stripe's dashboard and the Daily Ops summary.
 *   - Customer-count metrics (#1–#5) exclude internal/test accounts (PA-410).
 *     Money metrics (#6–#8) do NOT — every existing revenue figure (ops summary,
 *     business metrics, Stripe live MRR) includes them, and excluding would break
 *     reconciliation.
 */

import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import { computeMrrCents } from "@/lib/stripe-metrics";
import { prorateMonthlyCents } from "@/lib/subscription-proration";
import {
  getInternalExclusions,
  buildExcludeInternalWhere,
  getInternalCustomerIdsFromCache,
} from "@/lib/internal-accounts";

// ── Windows ──────────────────────────────────────────────────────────────────

export interface MetricsWindow {
  start: Date;
  end: Date;
}

export type PeriodPreset = "1d" | "7d" | "1m";
/** Presets are trailing whole UTC days ending yesterday; custom is an explicit
 *  inclusive [from, to] date range (YYYY-MM-DD, UTC). */
export type Period = PeriodPreset | { from: string; to: string };

export interface ResolvedWindow extends MetricsWindow {
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD (UTC) for a Date. */
export function utcDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Previous full UTC day [00:00, 23:59:59.999]. Explicit UTC boundaries — do NOT
 *  inherit local-server-time helpers, or the window silently drifts off Stripe's
 *  dashboard. (Moved from ops-summary.ts, PA-693.) */
export function previousUtcDay(now: Date): MetricsWindow {
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  const start = new Date(
    Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 23, 59, 59, 999),
  );
  return { start, end };
}

function parseUtcDate(s: string, endOfDay: boolean): Date {
  if (!ISO_DATE.test(s)) throw new Error(`invalid date "${s}" — expected YYYY-MM-DD`);
  const [y, m, d] = s.split("-").map(Number);
  const t = endOfDay ? Date.UTC(y, m - 1, d, 23, 59, 59, 999) : Date.UTC(y, m - 1, d);
  const date = new Date(t);
  // Reject rollovers like 2026-02-31 → Mar 2.
  if (utcDateStr(date) !== s) throw new Error(`invalid date "${s}"`);
  return date;
}

/** Resolve a period to an inclusive UTC window. "1d" = the previous full UTC day
 *  (Daily-Ops parity); "7d"/"1m" = the trailing 7/30 full UTC days ending
 *  yesterday; custom = [from 00:00, to 23:59:59.999]. Throws on malformed or
 *  inverted custom dates — validate at the route for a 400 instead of a 500. */
export function resolveWindow(period: Period, now: Date = new Date()): ResolvedWindow {
  if (typeof period === "object") {
    const start = parseUtcDate(period.from, false);
    const end = parseUtcDate(period.to, true);
    if (start.getTime() > end.getTime())
      throw new Error(`invalid range: from ${period.from} is after to ${period.to}`);
    return { start, end, label: `${period.from} → ${period.to}` };
  }
  const days = period === "1d" ? 1 : period === "7d" ? 7 : 30;
  const { start: yesterdayStart, end } = previousUtcDay(now);
  const start = new Date(yesterdayStart.getTime() - (days - 1) * DAY_MS);
  return { start, end, label: period };
}

/** Every UTC date (YYYY-MM-DD) the window touches, in order. */
export function listWindowDates(w: MetricsWindow): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(
    w.start.getUTCFullYear(), w.start.getUTCMonth(), w.start.getUTCDate(),
  ); t <= w.end.getTime(); t += DAY_MS) {
    out.push(utcDateStr(new Date(t)));
  }
  return out;
}

// ── Pool classification (dedicated vs dynamic) ───────────────────────────────

export const UNKNOWN_GPU_TYPE = "unknown";

export interface ClassifiablePool {
  id: number;
  overcommitRatio: number | null | undefined;
  gpus?: { gpuModel: string | null }[];
  nodes?: { gpuModel: string | null }[];
}

export interface PoolClassification {
  dedicatedPoolIds: Set<number>;
  dynamicPoolIds: Set<number>;
  /** Pool → dominant GPU model. Missing pools resolve to UNKNOWN_GPU_TYPE. */
  gpuModelByPool: Map<number, string>;
}

/** THE pool classifier (metrics sheet B1): dedicated = overcommit ≤ 1 (single-
 *  tenant), dynamic = > 1. Joined to charge data via wallet_transaction.pool_id /
 *  SubscriptionHistory.pool_id so #4/#5/#6/#7 can split. Missing ratio = 1. */
export function classifyPools(pools: ClassifiablePool[]): PoolClassification {
  const dedicatedPoolIds = new Set<number>();
  const dynamicPoolIds = new Set<number>();
  const gpuModelByPool = new Map<number, string>();
  for (const p of pools) {
    const ratio = p.overcommitRatio || 1;
    if (ratio > 1) dynamicPoolIds.add(p.id);
    else dedicatedPoolIds.add(p.id);

    // Dominant GPU model across the pool's GPU list; node list as fallback.
    const tally = new Map<string, number>();
    for (const g of p.gpus ?? [])
      if (g.gpuModel) tally.set(g.gpuModel, (tally.get(g.gpuModel) ?? 0) + 1);
    let model: string | null = null;
    let best = 0;
    for (const [m, n] of tally) if (n > best) { model = m; best = n; }
    if (!model) model = p.nodes?.find((n) => n.gpuModel)?.gpuModel ?? null;
    if (model) gpuModelByPool.set(p.id, model);
  }
  return { dedicatedPoolIds, dynamicPoolIds, gpuModelByPool };
}

// ── Ledger sums (moved verbatim from ops-summary.ts, PA-693) ─────────────────

/** Stopped-reservation revenue actually BILLED in the window, from the ledger,
 *  scoped by pool (the sync engine writes one pool-tagged row per pool per cycle).
 *  NOTE: rows written before the pool-tagging deploy have poolId=NULL, so a
 *  scoped report undercounts until a full tagged day exists (platform is exact). */
export async function sumStoppedBilled(
  start: Date,
  end: Date,
  poolIds: Set<number> | null,
): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    _sum: { amountCents: true },
    where: {
      type: "stopped_reservation",
      createdAt: { gte: start, lte: end },
      ...(poolIds ? { poolId: { in: [...poolIds] } } : {}),
    },
  });
  return agg._sum.amountCents ?? 0;
}

/** GPU-hours the ledger billed in the window (usage + stopped reservations),
 *  scoped by pool. Σ(billing_minutes × gpu_count) — the two columns are only
 *  populated together, and old rows without them contribute 0 hours. */
export async function sumBilledGpuHours(
  start: Date,
  end: Date,
  poolIds: Set<number> | null,
): Promise<number> {
  if (poolIds && poolIds.size === 0) return 0; // no pools in scope → nothing billed
  const poolFilter = poolIds
    ? Prisma.sql`AND pool_id IN (${Prisma.join([...poolIds])})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ hours: unknown }[]>`
    SELECT COALESCE(SUM(COALESCE(billing_minutes, 0) * COALESCE(gpu_count, 0)), 0) / 60 AS hours
    FROM wallet_transaction
    WHERE type IN ('gpu_usage', 'stopped_reservation')
      AND created_at >= ${start} AND created_at <= ${end}
      ${poolFilter}`;
  return Number(rows[0]?.hours ?? 0);
}

/** Earned GPU-usage revenue for the day, from the ledger, scoped by pool. */
export async function sumUsageRevenue(
  start: Date,
  end: Date,
  poolIds: Set<number> | null,
): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    _sum: { amountCents: true },
    where: {
      type: "gpu_usage",
      createdAt: { gte: start, lte: end },
      ...(poolIds ? { poolId: { in: [...poolIds] } } : {}),
    },
  });
  return agg._sum.amountCents ?? 0;
}

// ── #1 Signups ───────────────────────────────────────────────────────────────

/** Completed signups: account created in the window AND the magic link was
 *  clicked (firstLoginAt set — a late click retroactively completes the
 *  signup-day count). Internal/test accounts excluded. */
export async function countSignups(w: MetricsWindow): Promise<number> {
  const excl = await getInternalExclusions();
  return prisma.customerLifecycle.count({
    where: {
      signedUpAt: { gte: w.start, lte: w.end },
      firstLoginAt: { not: null },
      ...buildExcludeInternalWhere(excl),
    },
  });
}

// ── #2 Time-to-first-job ─────────────────────────────────────────────────────

export interface TimeToFirstJobResult {
  /** Median hours from signup to activation, over the window's signup cohort.
   *  Null when nobody in the cohort activated. */
  medianHours: number | null;
  /** Activated users in the cohort (the median's n). */
  n: number;
  /** Signups in the cohort (internal excluded). */
  cohortSize: number;
  /** How many activations used the real workload timestamp vs the deploy proxy. */
  workloadBasisN: number;
  deployProxyN: number;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function timeToFirstJob(w: MetricsWindow): Promise<TimeToFirstJobResult> {
  const excl = await getInternalExclusions();
  const rows = await prisma.customerLifecycle.findMany({
    where: {
      signedUpAt: { gte: w.start, lte: w.end },
      ...buildExcludeInternalWhere(excl),
    },
    select: { signedUpAt: true, firstWorkloadAt: true, firstGpuDeployAt: true },
  });
  const hours: number[] = [];
  let workloadBasisN = 0;
  let deployProxyN = 0;
  for (const r of rows) {
    const activatedAt = r.firstWorkloadAt ?? r.firstGpuDeployAt;
    if (!activatedAt) continue; // never activated → excluded from the median
    if (r.firstWorkloadAt) workloadBasisN++;
    else deployProxyN++;
    hours.push(Math.max(0, (activatedAt.getTime() - r.signedUpAt.getTime()) / (60 * 60 * 1000)));
  }
  hours.sort((a, b) => a - b);
  const m = median(hours);
  return {
    medianHours: m === null ? null : round2(m),
    n: hours.length,
    cohortSize: rows.length,
    workloadBasisN,
    deployProxyN,
  };
}

// ── #3/#4/#5 Active paying customers ─────────────────────────────────────────

/** The consumption side of "successful charge": these ledger types are the
 *  billing engine actually charging a customer's wallet for on-demand GPUs. */
export const CONSUMPTION_LEDGER_TYPES = [
  "gpu_usage",
  "gpu_deploy",
  "stopped_reservation",
] as const;

export interface ActivePayingSplit {
  /** Distinct paying customers with ≥1 charge in this pool class. */
  total: number;
  onDemandByGpuType: Record<string, number>;
  monthlyByGpuType: Record<string, number>;
}

export interface ActivePayingResult {
  /** Distinct paying customers (on-demand ∪ monthly). */
  total: number;
  onDemand: number;
  monthly: number;
  dedicated: ActivePayingSplit;
  dynamic: ActivePayingSplit;
  /** Customers whose charges couldn't be classified (untagged pre-0.8.26 rows,
   *  or pools no longer in the overview). Counted in `total`, not in a class. */
  unknownPool: number;
}

interface ClassBuckets {
  customers: Set<string>;
  onDemandByGpuType: Map<string, Set<string>>;
  monthlyByGpuType: Map<string, Set<string>>;
}

const newBuckets = (): ClassBuckets => ({
  customers: new Set(),
  onDemandByGpuType: new Map(),
  monthlyByGpuType: new Map(),
});

function addTo(map: Map<string, Set<string>>, key: string, customer: string): void {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(customer);
}

const toCounts = (map: Map<string, Set<string>>): Record<string, number> =>
  Object.fromEntries([...map].map(([k, v]) => [k, v.size]));

export async function activePayingCustomers(
  w: MetricsWindow,
  pc: PoolClassification,
): Promise<ActivePayingResult> {
  const [groups, subs, internalIds] = await Promise.all([
    prisma.walletTransaction.groupBy({
      by: ["stripeCustomerId", "poolId"],
      where: {
        type: { in: [...CONSUMPTION_LEDGER_TYPES] },
        createdAt: { gte: w.start, lte: w.end },
        amountCents: { gt: 0 },
      },
    }),
    prisma.subscriptionHistory.findMany({
      where: {
        priceCents: { gt: 0 },
        startedAt: { lte: w.end },
        OR: [{ endedAt: null }, { endedAt: { gte: w.start } }],
      },
      select: { stripeCustomerId: true, poolId: true },
    }),
    getInternalCustomerIdsFromCache(),
  ]);

  // Voucher/credit-only gate: a lifecycle row with firstDepositAt NULL means the
  // customer never paid real money (PA-218 organic-deposit definition) — their
  // consumption is spending comped credit, not a successful charge. Customers
  // with NO lifecycle row (pre-lifecycle era) are kept: fail-open on real debits.
  const ledgerIds = [...new Set(groups.map((g) => g.stripeCustomerId))].filter(
    (id) => !internalIds.has(id),
  );
  const gateRows = ledgerIds.length
    ? await prisma.customerLifecycle.findMany({
        where: { stripeCustomerId: { in: ledgerIds } },
        select: { stripeCustomerId: true, firstDepositAt: true },
      })
    : [];
  const creditOnly = new Set(
    gateRows.filter((r) => r.firstDepositAt === null).map((r) => r.stripeCustomerId),
  );

  const onDemandIds = new Set(ledgerIds.filter((id) => !creditOnly.has(id)));
  const monthlyIds = new Set(
    subs.map((s) => s.stripeCustomerId).filter((id) => !internalIds.has(id)),
  );

  const dedicated = newBuckets();
  const dynamic = newBuckets();
  const unknownPool = new Set<string>();

  const classify = (
    customer: string,
    poolId: number | null,
    kind: "onDemandByGpuType" | "monthlyByGpuType",
  ) => {
    if (poolId !== null && pc.dedicatedPoolIds.has(poolId)) {
      dedicated.customers.add(customer);
      addTo(dedicated[kind], pc.gpuModelByPool.get(poolId) ?? UNKNOWN_GPU_TYPE, customer);
    } else if (poolId !== null && pc.dynamicPoolIds.has(poolId)) {
      dynamic.customers.add(customer);
      addTo(dynamic[kind], pc.gpuModelByPool.get(poolId) ?? UNKNOWN_GPU_TYPE, customer);
    } else {
      unknownPool.add(customer);
    }
  };

  for (const g of groups)
    if (onDemandIds.has(g.stripeCustomerId))
      classify(g.stripeCustomerId, g.poolId, "onDemandByGpuType");
  for (const s of subs)
    if (monthlyIds.has(s.stripeCustomerId))
      classify(s.stripeCustomerId, s.poolId, "monthlyByGpuType");

  const split = (b: ClassBuckets): ActivePayingSplit => ({
    total: b.customers.size,
    onDemandByGpuType: toCounts(b.onDemandByGpuType),
    monthlyByGpuType: toCounts(b.monthlyByGpuType),
  });

  return {
    total: new Set([...onDemandIds, ...monthlyIds]).size,
    onDemand: onDemandIds.size,
    monthly: monthlyIds.size,
    dedicated: split(dedicated),
    dynamic: split(dynamic),
    unknownPool: unknownPool.size,
  };
}

// ── #6 MRR ───────────────────────────────────────────────────────────────────

export interface MrrResult {
  /** Σ monthly price of subscriptions active as-of T (SubscriptionHistory). */
  totalCents: number;
  /** The dictionary's daily value: MRR ÷ 30. */
  dailyProratedCents: number;
  dedicatedMonthlyByGpuType: Record<string, number>;
  dynamicMonthlyByGpuType: Record<string, number>;
  unknownPoolCents: number;
  /** Live Stripe MRR (active subs, point-in-time NOW) for reconciliation; only
   *  meaningful when asOf ≈ now. Null when Stripe is unavailable/not requested. */
  stripeLiveCents: number | null;
  /** totalCents − stripeLiveCents. A material delta = SubscriptionHistory gaps
   *  (legacy subs) — visible, never silent. */
  stripeDeltaCents: number | null;
}

export async function mrrAsOf(
  asOf: Date,
  pc: PoolClassification,
  stripe?: Stripe | null,
): Promise<MrrResult> {
  const rows = await prisma.subscriptionHistory.findMany({
    where: {
      priceCents: { gt: 0 },
      startedAt: { lte: asOf },
      OR: [{ endedAt: null }, { endedAt: { gt: asOf } }],
    },
    select: { poolId: true, priceCents: true },
  });

  let totalCents = 0;
  let unknownPoolCents = 0;
  const dedicatedByType = new Map<string, number>();
  const dynamicByType = new Map<string, number>();
  for (const r of rows) {
    totalCents += r.priceCents;
    const model =
      r.poolId !== null ? (pc.gpuModelByPool.get(r.poolId) ?? UNKNOWN_GPU_TYPE) : UNKNOWN_GPU_TYPE;
    if (r.poolId !== null && pc.dedicatedPoolIds.has(r.poolId))
      dedicatedByType.set(model, (dedicatedByType.get(model) ?? 0) + r.priceCents);
    else if (r.poolId !== null && pc.dynamicPoolIds.has(r.poolId))
      dynamicByType.set(model, (dynamicByType.get(model) ?? 0) + r.priceCents);
    else unknownPoolCents += r.priceCents;
  }

  let stripeLiveCents: number | null = null;
  if (stripe) {
    try {
      stripeLiveCents = await computeMrrCents(stripe);
    } catch (err) {
      console.error("[Platform Metrics] live Stripe MRR failed:", err);
    }
  }

  return {
    totalCents,
    dailyProratedCents: Math.round(totalCents / 30),
    dedicatedMonthlyByGpuType: Object.fromEntries(dedicatedByType),
    dynamicMonthlyByGpuType: Object.fromEntries(dynamicByType),
    unknownPoolCents,
    stripeLiveCents,
    stripeDeltaCents: stripeLiveCents === null ? null : totalCents - stripeLiveCents,
  };
}

// ── #7 Consumption run-rate ──────────────────────────────────────────────────

export interface ConsumptionResult {
  /** Consumption debits over the trailing 30 full UTC days. */
  trailing30dCents: number;
  /** Annualized: trailing 30d × 12. */
  runRateCents: number;
  /** Consumption at the standard grains (whole-UTC-day windows ending yesterday). */
  byGrain: { "1d": number; "7d": number; "1m": number };
  dedicatedByGpuType: Record<string, number>;
  dynamicByGpuType: Record<string, number>;
  unknownPoolCents: number;
}

async function sumConsumption(w: MetricsWindow): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    _sum: { amountCents: true },
    where: {
      type: { in: [...CONSUMPTION_LEDGER_TYPES] },
      createdAt: { gte: w.start, lte: w.end },
      amountCents: { gt: 0 },
    },
  });
  return agg._sum.amountCents ?? 0;
}

export async function consumptionRunRate(
  now: Date,
  pc: PoolClassification,
): Promise<ConsumptionResult> {
  const w30 = resolveWindow("1m", now);
  const [groups, d1, d7] = await Promise.all([
    prisma.walletTransaction.groupBy({
      by: ["poolId"],
      _sum: { amountCents: true },
      where: {
        type: { in: [...CONSUMPTION_LEDGER_TYPES] },
        createdAt: { gte: w30.start, lte: w30.end },
        amountCents: { gt: 0 },
      },
    }),
    sumConsumption(resolveWindow("1d", now)),
    sumConsumption(resolveWindow("7d", now)),
  ]);

  let trailing30dCents = 0;
  let unknownPoolCents = 0;
  const dedicatedByType = new Map<string, number>();
  const dynamicByType = new Map<string, number>();
  for (const g of groups) {
    const cents = g._sum.amountCents ?? 0;
    trailing30dCents += cents;
    const model =
      g.poolId !== null ? (pc.gpuModelByPool.get(g.poolId) ?? UNKNOWN_GPU_TYPE) : UNKNOWN_GPU_TYPE;
    if (g.poolId !== null && pc.dedicatedPoolIds.has(g.poolId))
      dedicatedByType.set(model, (dedicatedByType.get(model) ?? 0) + cents);
    else if (g.poolId !== null && pc.dynamicPoolIds.has(g.poolId))
      dynamicByType.set(model, (dynamicByType.get(model) ?? 0) + cents);
    else unknownPoolCents += cents;
  }

  return {
    trailing30dCents,
    runRateCents: trailing30dCents * 12,
    byGrain: { "1d": d1, "7d": d7, "1m": trailing30dCents },
    dedicatedByGpuType: Object.fromEntries(dedicatedByType),
    dynamicByGpuType: Object.fromEntries(dynamicByType),
    unknownPoolCents,
  };
}

// ── #8 Revenue (total) ───────────────────────────────────────────────────────

export interface RevenueTotalResult {
  totalCents: number;
  /** Subscription revenue attributed to the window by calendar-day proration. */
  subscriptionCents: number;
  /** On-demand consumption debits (usage + deploy + stopped). */
  consumptionCents: number;
  /** Refunds netted (ledger type="refund"; deployment refunds are ledger-tracked
   *  from PA-693 ship date — earlier windows over-report by that volume). */
  refundCents: number;
}

export async function revenueTotal(w: MetricsWindow): Promise<RevenueTotalResult> {
  const [subs, consumptionCents, refundAgg] = await Promise.all([
    prisma.subscriptionHistory.findMany({
      where: {
        priceCents: { gt: 0 },
        startedAt: { lte: w.end },
        OR: [{ endedAt: null }, { endedAt: { gte: w.start } }],
      },
      select: { startedAt: true, endedAt: true, priceCents: true },
    }),
    sumConsumption(w),
    prisma.walletTransaction.aggregate({
      _sum: { amountCents: true },
      where: { type: "refund", createdAt: { gte: w.start, lte: w.end } },
    }),
  ]);

  let subscriptionCents = 0;
  for (const s of subs) subscriptionCents += prorateMonthlyCents(s, w.start, w.end);
  // Refund rows are negative (credit) by convention — abs() the sum.
  const refundCents = Math.abs(refundAgg._sum.amountCents ?? 0);

  return {
    totalCents: subscriptionCents + consumptionCents - refundCents,
    subscriptionCents,
    consumptionCents,
    refundCents,
  };
}

// ── #9/#10 Supply side (point-in-time, live pool overview) ───────────────────

/** initialize_state_status_code === 2 → the node completed init and is online. */
export const NODE_INIT_COMPLETED = 2;

/** #9: distinct registered suppliers (nodes linked to a ProviderNode) with ≥1
 *  GPU on an online node. Live snapshot — health history isn't recorded, so
 *  as-of past dates is unsupported. Null when the pool cache is cold. */
export function countSuppliers(): number | null {
  const overview = readPoolOverviewCache();
  if (!overview) return null;
  const ids = new Set<string>();
  for (const p of overview.pools)
    for (const n of p.nodes)
      if (n.providerId && n.initStatus === NODE_INIT_COMPLETED && n.gpuCount > 0)
        ids.add(n.providerId);
  return ids.size;
}

export interface GpuCountBlock {
  physical: number;
  /** Logical capacity: physical × overcommit ratio, rounded per pool. */
  vgpuSlots: number;
}

/** THE "sellable GPUs in a pool" definition (PA-693 #10/#11, PA-691 row
 *  capacity): physical GPUs sitting on init-completed (online) nodes. An
 *  offline node is not sellable, so it must not inflate a denominator.
 *  Pools whose GPU list didn't load fall back to totalGpus (assumed online) —
 *  a live approximation, same as the pool-overview cache itself does. */
export function onlinePhysicalGpus(p: {
  totalGpus: number;
  gpus?: { nodeId: number }[];
  nodes?: { id: number; initStatus: number }[];
}): number {
  // Tolerate a cache written by an older build (missing gpus/nodes arrays) —
  // a malformed snapshot must degrade to totalGpus, never throw and take the
  // whole summary down.
  const gpus = p.gpus ?? [];
  if (gpus.length === 0) return p.totalGpus;
  const online = new Set(
    (p.nodes ?? [])
      .filter((n) => n.initStatus === NODE_INIT_COMPLETED)
      .map((n) => n.id),
  );
  return gpus.filter((g) => online.has(g.nodeId)).length;
}

/** Sellable vGPU slots for a pool = online physical GPUs × overcommit ratio. */
export function poolVgpuSlots(p: {
  totalGpus: number;
  overcommitRatio?: number | null;
  gpus?: { nodeId: number }[];
  nodes?: { id: number; initStatus: number }[];
}): number {
  return Math.round(onlinePhysicalGpus(p) * (p.overcommitRatio || 1));
}

export interface ActiveGpusResult {
  total: GpuCountBlock;
  dedicated: GpuCountBlock;
  dynamic: GpuCountBlock;
  byModel: Record<string, GpuCountBlock>;
}

/** #10: GPUs on online (init-completed) nodes across all pools, live snapshot.
 *  vGPU slots derive from the pool's overcommit ratio — pool-overview's per-pod
 *  vgpuCount is a hardcoded 1 and must never be used. Null when cache is cold. */
export function activeGpus(pc: PoolClassification): ActiveGpusResult | null {
  const overview = readPoolOverviewCache();
  if (!overview) return null;

  const zero = (): GpuCountBlock => ({ physical: 0, vgpuSlots: 0 });
  const total = zero();
  const dedicated = zero();
  const dynamic = zero();
  const byModel = new Map<string, GpuCountBlock>();

  for (const p of overview.pools) {
    const ratio = p.overcommitRatio || 1;
    const onlineNodeIds = new Set(
      p.nodes.filter((n) => n.initStatus === NODE_INIT_COMPLETED).map((n) => n.id),
    );

    // Per-model physical counts on online nodes; totalGpus fallback for pools
    // whose GPU list didn't load (assume online — labeled a live approximation).
    const modelCounts = new Map<string, number>();
    if (p.gpus.length > 0) {
      for (const g of p.gpus) {
        if (!onlineNodeIds.has(g.nodeId)) continue;
        const model = g.gpuModel || UNKNOWN_GPU_TYPE;
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
      }
    } else if (p.totalGpus > 0) {
      modelCounts.set(pc.gpuModelByPool.get(p.id) ?? UNKNOWN_GPU_TYPE, p.totalGpus);
    }

    for (const [model, count] of modelCounts) {
      const slots = Math.round(count * ratio);
      let block = byModel.get(model);
      if (!block) { block = zero(); byModel.set(model, block); }
      block.physical += count;
      block.vgpuSlots += slots;
    }
    // Pool totals come from the shared definition, not the per-model loop, so
    // #10 can never drift from #11 / the ops-summary row capacity.
    const poolPhysical = onlinePhysicalGpus(p);
    const poolSlots = poolVgpuSlots(p);

    total.physical += poolPhysical;
    total.vgpuSlots += poolSlots;
    const bucket = pc.dynamicPoolIds.has(p.id) ? dynamic : dedicated;
    bucket.physical += poolPhysical;
    bucket.vgpuSlots += poolSlots;
  }

  return { total, dedicated, dynamic, byModel: Object.fromEntries(byModel) };
}

// ── #11 Available GPU-hours ──────────────────────────────────────────────────

export type CapacityBasis = "snapshot" | "current-fleet" | "mixed";

export interface AvailableGpuHoursResult {
  physicalGpuHours: number;
  /** The #12 denominator: logical (vGPU-slot) capacity hours. */
  vgpuSlotHours: number;
  basis: CapacityBasis;
  /** How many of the window's days were covered by real snapshots. */
  snapshotDays: number;
  windowDays: number;
}

/** Live-fleet daily capacity (online GPUs × 24h), the fallback for days before
 *  the snapshot series started. Null when the pool cache is cold. */
function currentFleetDailyCapacity(): { physical: number; vgpu: number } | null {
  const overview = readPoolOverviewCache();
  if (!overview) return null;
  const pc = classifyPools(overview.pools);
  const live = activeGpus(pc);
  if (!live) return null;
  return { physical: live.total.physical * 24, vgpu: live.total.vgpuSlots * 24 };
}

/** #11: Σ over the window's UTC days of online GPUs × 24, from the daily
 *  fleet-capacity snapshot; gap days (pre-series or cron outage) fall back to
 *  the CURRENT fleet held constant — never silently zero. Null only when there
 *  are gap days AND the live fallback is unavailable too. */
export async function availableGpuHours(
  w: MetricsWindow,
): Promise<AvailableGpuHoursResult | null> {
  const dates = listWindowDates(w);
  const rows = await prisma.fleetCapacitySnapshot.findMany({
    where: { date: { in: dates }, kind: "pool" },
    select: { date: true, onlineGpus: true, vgpuSlots: true },
  });

  const byDate = new Map<string, { physical: number; vgpu: number }>();
  for (const r of rows) {
    let day = byDate.get(r.date);
    if (!day) { day = { physical: 0, vgpu: 0 }; byDate.set(r.date, day); }
    day.physical += r.onlineGpus * 24;
    day.vgpu += r.vgpuSlots * 24;
  }

  const gapDays = dates.filter((d) => !byDate.has(d)).length;
  let fallback: { physical: number; vgpu: number } | null = null;
  if (gapDays > 0) {
    fallback = currentFleetDailyCapacity();
    if (!fallback) return null; // no snapshots AND no live fleet → can't compute honestly
  }

  let physicalGpuHours = 0;
  let vgpuSlotHours = 0;
  for (const d of dates) {
    const day = byDate.get(d) ?? fallback!;
    physicalGpuHours += day.physical;
    vgpuSlotHours += day.vgpu;
  }

  const snapshotDays = dates.length - gapDays;
  return {
    physicalGpuHours: round2(physicalGpuHours),
    vgpuSlotHours: round2(vgpuSlotHours),
    basis: gapDays === 0 ? "snapshot" : snapshotDays === 0 ? "current-fleet" : "mixed",
    snapshotDays,
    windowDays: dates.length,
  };
}

// ── #12 Utilization ──────────────────────────────────────────────────────────

export interface UtilizationResult {
  /** On-demand vGPU-hours the ledger billed (usage + stopped). */
  billedGpuHours: number;
  /** Monthly contracts: full contracted time falling in the window, 1 GPU per
   *  pod-row assumed (pod GPU count is unrecoverable post-termination). */
  committedMonthlyGpuHours: number;
  rentedGpuHours: number;
  availableVgpuSlotHours: number;
  pct: number;
  capacityBasis: CapacityBasis;
  snapshotDays: number;
  windowDays: number;
}

export async function utilization(w: MetricsWindow): Promise<UtilizationResult | null> {
  const [billed, subs, avail] = await Promise.all([
    sumBilledGpuHours(w.start, w.end, null),
    prisma.subscriptionHistory.findMany({
      where: {
        priceCents: { gt: 0 },
        startedAt: { lte: w.end },
        OR: [{ endedAt: null }, { endedAt: { gte: w.start } }],
      },
      select: { startedAt: true, endedAt: true },
    }),
    availableGpuHours(w),
  ]);
  if (!avail) return null;

  let committed = 0;
  for (const s of subs) {
    const from = Math.max(s.startedAt.getTime(), w.start.getTime());
    const to = Math.min(s.endedAt?.getTime() ?? Infinity, w.end.getTime());
    if (to > from) committed += (to - from) / (60 * 60 * 1000);
  }

  const rented = billed + committed;
  return {
    billedGpuHours: round2(billed),
    committedMonthlyGpuHours: round2(committed),
    rentedGpuHours: round2(rented),
    availableVgpuSlotHours: avail.vgpuSlotHours,
    pct: avail.vgpuSlotHours > 0 ? round2((rented / avail.vgpuSlotHours) * 100) : 0,
    capacityBasis: avail.basis,
    snapshotDays: avail.snapshotDays,
    windowDays: avail.windowDays,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface PlatformMetrics {
  window: { start: Date; end: Date; label: string };
  /** Point-in-time anchor for #6/#9/#10 (= window end). */
  asOf: Date;
  signups: number | null;
  timeToFirstJob: TimeToFirstJobResult | null;
  activePaying: ActivePayingResult | null;
  mrr: MrrResult | null;
  consumption: ConsumptionResult | null;
  revenue: RevenueTotalResult | null;
  suppliers: number | null;
  activeGpus: ActiveGpusResult | null;
  availableGpuHours: AvailableGpuHoursResult | null;
  utilization: UtilizationResult | null;
  /** Proxy/basis/series-start labels — render these wherever the numbers go. */
  notes: string[];
}

/** Compute all metrics for a period. Each metric degrades independently: one
 *  failed source nulls that metric and adds a note — never the whole payload. */
export async function computePlatformMetrics(
  period: Period,
  now: Date = new Date(),
): Promise<PlatformMetrics> {
  const window = resolveWindow(period, now);
  const asOf = window.end;
  const notes: string[] = [];

  const overview = readPoolOverviewCache();
  const pc = classifyPools(overview?.pools ?? []);
  if (!overview) {
    notes.push(
      'pool overview unavailable — dedicated/dynamic and GPU-type breakdowns bucket as "unknown"; supply metrics may be missing',
    );
  }

  let stripe: Stripe | null = null;
  try {
    stripe = await getStripe();
  } catch {
    notes.push("Stripe not configured — live-MRR reconciliation unavailable");
  }
  // The live-Stripe MRR is only a valid comparison when asOf is (near) now.
  const stripeForMrr =
    stripe && Math.abs(now.getTime() - asOf.getTime()) <= 48 * 60 * 60 * 1000 ? stripe : null;

  const settle = async <T>(name: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (err) {
      console.error(`[Platform Metrics] ${name} failed:`, err);
      notes.push(`${name} unavailable this run`);
      return null;
    }
  };
  const settleSync = <T>(name: string, fn: () => T | null): T | null => {
    try {
      return fn();
    } catch (err) {
      console.error(`[Platform Metrics] ${name} failed:`, err);
      notes.push(`${name} unavailable this run`);
      return null;
    }
  };

  const [
    signups,
    ttfj,
    activePaying,
    mrr,
    consumption,
    revenue,
    availGpuHours,
    util,
  ] = await Promise.all([
    settle("signups", countSignups(window)),
    settle("time-to-first-job", timeToFirstJob(window)),
    settle("active paying customers", activePayingCustomers(window, pc)),
    settle("MRR", mrrAsOf(asOf, pc, stripeForMrr)),
    settle("consumption run-rate", consumptionRunRate(now, pc)),
    settle("revenue", revenueTotal(window)),
    settle("available GPU-hours", availableGpuHours(window)),
    settle("utilization", utilization(window)),
  ]);

  const suppliers = settleSync("suppliers", countSuppliers);
  const gpus = settleSync("active GPUs", () => activeGpus(pc));

  // #7 is defined as trailing-30-days-from-now, so it does NOT follow the
  // selected window. Say so whenever the window isn't the current one, or a
  // historical period silently shows today's run rate.
  if (consumption && Math.abs(now.getTime() - asOf.getTime()) > 48 * 60 * 60 * 1000) {
    notes.push(
      "consumption run-rate (#7) is always the trailing 30 days as of today — it does NOT follow the selected period",
    );
  }
  if (ttfj && ttfj.deployProxyN > 0) {
    notes.push(
      `time-to-first-job: ${ttfj.deployProxyN}/${ttfj.n} activations use the deploy-time proxy (workload tracking starts at PA-693 ship date)`,
    );
  }
  if (availGpuHours && availGpuHours.basis !== "snapshot") {
    notes.push(
      `available GPU-hours: ${availGpuHours.windowDays - availGpuHours.snapshotDays}/${availGpuHours.windowDays} window days predate the capacity snapshot series — current fleet held constant for those days`,
    );
  }
  if (suppliers !== null || gpus !== null) {
    notes.push("suppliers and active GPUs are live snapshots (no fleet history exists)");
  }

  return {
    window: { start: window.start, end: window.end, label: window.label },
    asOf,
    signups,
    timeToFirstJob: ttfj,
    activePaying,
    mrr,
    consumption,
    revenue,
    suppliers,
    activeGpus: gpus,
    availableGpuHours: availGpuHours,
    utilization: util,
    notes,
  };
}
