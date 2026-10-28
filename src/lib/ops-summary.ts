/**
 * Daily Operating Summary — compute + render.
 *
 * Pulls GPU-count rows + 5 business KPIs and renders a Mattermost markdown table.
 * Reused by BOTH the cron route and the admin "Send now / Preview" action, so
 * `computeOpsSummary` is CONTEXT-FREE: config in → data out. It reads its own
 * sources (Stripe, HAI, pool-overview cache, Prisma) directly.
 *
 * SCOPE: the whole summary is either platform-wide ("everything") or limited to
 * a set of GpuProducts (config.scope). The 5 business KPIs honor that scope; the
 * GPU-count rows are independent per-row product counts.
 *
 * Revenue is EARNED, not deposits (the old Stripe-charge sweep counted wallet
 * top-ups — money in, not money earned). Daily Revenue =
 *   GPU usage  → wallet_transaction type=gpu_usage, SUM(amountCents) for the day,
 *                scoped by poolId (the ledger is the authoritative earned log)
 *   Stopped    → yesterday's stopped_reservation ledger rows (exactly what the
 *                sync engine billed, same window as usage), scoped by poolId —
 *                the sync engine writes one pool-tagged row per pool per cycle
 *   Monthly    → Stripe subscriptions active DURING the report day ÷ 30 (scoped
 *                by subscription.metadata.gpu_product_id); paginated (fixes the
 *                old MRR truncation). Counts the sub whether or not a pod is
 *                deployed; one that churned overnight still counts (it earned
 *                yesterday), one created today doesn't.
 *   (Storage is team-level → excluded. Bare-metal is lumpy term-prepay → shown
 *    as its own line, not folded into Daily Revenue.)
 * vGPU Utilization = vGPUs in use ÷ vGPU capacity, where capacity = Σ (physical
 * GPUs × share ratio) over the scope's pools (NOT the pool-overview "allocated"
 * count, which is pool-membership, not usage). Bare Metal Utilization = in-service
 * nodes ÷ online nodes (platform scope only, like all BM metrics). Revenue/GPU/Day
 * = Daily Revenue ÷ GPUs-in-use (scoped). Run Rate = ×365 + BM deposits. Active
 * Customers is split: (Pods) = distinct teams with a running pod in scope;
 * (Bare Metal) = distinct teams with a running BM instance (platform scope only).
 *
 * Each source is wrapped in try/catch: a failure renders "—" + a footnote naming
 * what's missing, and the post still goes out with whatever computed.
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PACKET_TAKE_RATE } from "@/lib/marketplace-metrics";
import {
  previousUtcDay,
  resolveWindow,
  sumStoppedBilled,
  sumBilledGpuHours,
  sumUsageRevenue,
  classifyPools,
  poolVgpuSlots,
  countSignups,
  timeToFirstJob,
  activePayingCustomers,
  mrrAsOf,
  consumptionRunRate,
  countSuppliers,
  availableGpuHours,
  utilization as platformUtilization,
} from "@/lib/platform-metrics";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import {
  getAllUnifiedInstances,
  type UnifiedInstance,
} from "@/lib/hostedai/instances";
import { getVgpuCounts } from "@/lib/ops-vgpu-cache";
import { getSetting, setSetting } from "@/lib/settings";
import { gpuaasAdmin, type BaremetalNode } from "@/lib/gpuaas-admin";
import { isMonthlyPod, type PodBilling } from "@/lib/negative-balance";
import { ACTIVATED_ORDER_STATUSES } from "@/lib/baremetal/order-status";

export const OPS_SUMMARY_CONFIG_KEY = "OPS_SUMMARY_CONFIG";
export const OPS_SUMMARY_LAST_POSTED_KEY = "OPS_SUMMARY_LAST_POSTED";
// Self-snapshot for the Rev/GPU denominator: each real post stamps the live
// GPUs-in-use it measured; the NEXT day's report divides yesterday's revenue by
// yesterday's stamp — a count measured DURING the revenue day.
export const OPS_SUMMARY_GPU_SNAPSHOT_KEY = "OPS_SUMMARY_GPU_SNAPSHOT";

const MAX_PAGES = 100; // hard cap on any Stripe sweep (~10k records); bump if the account outgrows it
const RUN_RATE_MULTIPLIER = 365; // annualize daily earned revenue (sganni sign-off)
const RUNNING = new Set(["running", "active", "subscribed"]);
const BM_RUNNING = new Set([...RUNNING, "online"]);

// ── Config ───────────────────────────────────────────────────────────────────
export interface GpuRow {
  label: string;
  source: "pool" | "baremetal";
  /** Pool rows: hard-linked GpuProduct IDs (joined → poolIds → running pods). */
  productIds: string[];
  /** Baremetal rows: hard-linked admin baremetal node ids. The metric counts
   *  the selected NODES that are in service (node assignment, replacing the
   *  old product → gpuType → orders mapping). */
  nodeIds?: number[];
  goal: number;
}

/** Read a stored row defensively. Pre-product-ID configs (token `matches`) are
 *  dropped to empty productIds — the admin re-picks; the feature isn't in prod. */
function normalizeRow(r: Partial<GpuRow>): GpuRow {
  const productIds = Array.isArray(r.productIds)
    ? r.productIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];
  const nodeIds = Array.isArray(r.nodeIds)
    ? r.nodeIds.filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id),
      )
    : [];
  return {
    label: typeof r.label === "string" ? r.label : "",
    source: r.source === "baremetal" ? "baremetal" : "pool",
    productIds,
    nodeIds,
    goal: typeof r.goal === "number" ? r.goal : 0,
  };
}

/** Summary scope: platform-wide ("everything") or a set of GpuProducts (whose
 *  pools the 5 business KPIs are computed over). */
export interface OpsScope {
  mode: "everything" | "products";
  productIds: string[]; // GpuProduct IDs when mode=products
}

function normalizeScope(s: Partial<OpsScope> | undefined): OpsScope {
  if (s && s.mode === "products" && Array.isArray(s.productIds)) {
    return {
      mode: "products",
      productIds: s.productIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      ),
    };
  }
  return { mode: "everything", productIds: [] };
}

export interface OpsSummaryGoals {
  utilizationPct: number;
  activeCustomers: number;
  dailyRevenueCents: number;
  revPerGpuCents: number;
  runRateCents: number;
}

export interface OpsSummaryConfig {
  /** Master switch for the SCHEDULED daily post. false = paused (manual Send-now still works). */
  enabled: boolean;
  /** Platform-wide or scoped to specific products. */
  scope: OpsScope;
  gpuRows: GpuRow[];
  goals: OpsSummaryGoals;
}

/** First-run seed — pre-filled so the admin edits a working config, not a blank table. */
export const DEFAULT_OPS_SUMMARY_CONFIG: OpsSummaryConfig = {
  enabled: false, // auto-post OFF until an admin explicitly turns it on + saves
  scope: { mode: "everything", productIds: [] }, // platform-wide by default
  gpuRows: [
    // productIds empty by default — the admin links specific products in the UI.
    {
      label: "B200 Bare Metal",
      source: "baremetal",
      productIds: [],
      nodeIds: [],
      goal: 16,
    },
    { label: "B200 Dynamic", source: "pool", productIds: [], goal: 16 },
  ],
  goals: {
    utilizationPct: 100,
    activeCustomers: 100,
    dailyRevenueCents: 30_000_00,
    revPerGpuCents: 60_00,
    runRateCents: 10_950_000_00, // ~daily goal × 365 (annualized; was ×30)
  },
};

/** Read + validate the stored config; falls back to the default on missing/malformed JSON. */
export async function getOpsSummaryConfig(): Promise<OpsSummaryConfig> {
  const raw = await getSetting(OPS_SUMMARY_CONFIG_KEY);
  if (!raw) return DEFAULT_OPS_SUMMARY_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<OpsSummaryConfig>;
    return {
      enabled: parsed.enabled === true, // default OFF; only an explicit true enables auto-post
      scope: normalizeScope(parsed.scope),
      gpuRows: Array.isArray(parsed.gpuRows)
        ? (parsed.gpuRows as Array<Partial<GpuRow>>).map(normalizeRow)
        : DEFAULT_OPS_SUMMARY_CONFIG.gpuRows,
      goals: { ...DEFAULT_OPS_SUMMARY_CONFIG.goals, ...(parsed.goals ?? {}) },
    };
  } catch {
    console.error(
      "[Daily Ops] OPS_SUMMARY_CONFIG is not valid JSON — using defaults",
    );
    return DEFAULT_OPS_SUMMARY_CONFIG;
  }
}

// ── Result shape ─────────────────────────────────────────────────────────────
export interface MetricRow {
  label: string;
  /** Rendered value, or null when the source failed (→ "—"). */
  value: string | null;
  goal: string;
  /** PA-409: per-product-type revenue earned the previous day. Set on the
   *  GPU-count (product-type) rows only; undefined/null renders "—". */
  revenue?: string | null;
  /** PA-691: sellable fleet for the row, from inventory data — NOT the Goal.
   *  Pool rows: Σ vGPU slots on ONLINE nodes over the row's pools (the shared
   *  platform-metrics definition — an offline node isn't sellable, so it must
   *  not inflate the denominator). A pool shared by two product types counts
   *  fully in both rows: physical capacity can't be split by billing type.
   *  Baremetal rows: assigned nodes Online (available-but-unsold is capacity;
   *  Offline is broken, not sellable).
   *  GPU-count rows only; undefined/null renders "—". */
  capacity?: string | null;
  /** PA-691: Today ÷ Capacity, whole percent. Null (→ "—") when either side
   *  is unavailable or capacity is 0 — never an error or a fake 0%. */
  utilization?: string | null;
  /** Time basis of the Today column: LIVE = snapshot at post time, YDAY =
   *  previous full UTC day, TO-DATE = cumulative. (The Rev column is always
   *  the previous UTC day — the table header says so.) */
  basis?: "LIVE" | "YDAY" | "TO-DATE";
  /** "source — formula". Identical notes share one numbered footnote under
   *  the table (Mattermost has no small-font markup). */
  note?: string;
}

export interface OpsSummary {
  date: string; // report date (the previous full UTC day)
  scopeLabel: string; // "Platform" or "N product(s)"
  rows: MetricRow[];
  /** Names of sources that failed, for the footnote. */
  missing: string[];
  bmContractCents: number; // informational: bare-metal contract value that landed yesterday
  text: string; // rendered Mattermost markdown
  raw: Record<string, number | string | null>;
}

// ── Formatting ───────────────────────────────────────────────────────────────
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
function pct(n: number): string {
  return `${Math.round(n)}%`;
}
function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Deterministic key for a report scope, used by the GPU self-snapshot. */
function opsScopeKey(scope: OpsScope): string {
  return scope.mode === "everything"
    ? "everything"
    : `products:${[...scope.productIds].sort().join(",")}`;
}

/**
 * Stamp today's live GPUs-in-use after a REAL post (never from preview/dryRun —
 * computeOpsSummary itself stays side-effect-free). Tomorrow's report divides
 * yesterday's revenue by this stamp: a fleet count measured during the revenue
 * day. Same-day stamps merge per scope; a new day replaces the map. Best-effort
 * — a failed stamp just means tomorrow falls back to its live count.
 */
export async function stampOpsGpuSnapshot(
  scope: OpsScope,
  gpusInUse: number | null,
  now: Date = new Date(),
): Promise<void> {
  if (gpusInUse === null || gpusInUse <= 0) return; // HAI down / empty — don't stamp garbage
  try {
    const measuredOn = dateStr(now);
    let gpus: Record<string, number> = {};
    try {
      const prev = await getSetting(OPS_SUMMARY_GPU_SNAPSHOT_KEY);
      if (prev) {
        const parsed = JSON.parse(prev) as {
          measuredOn?: string;
          gpus?: Record<string, number>;
        };
        if (parsed.measuredOn === measuredOn && parsed.gpus) gpus = parsed.gpus;
      }
    } catch {
      /* corrupt previous stamp → start fresh */
    }
    gpus[opsScopeKey(scope)] = gpusInUse;
    await setSetting(
      OPS_SUMMARY_GPU_SNAPSHOT_KEY,
      JSON.stringify({ measuredOn, gpus }),
    );
  } catch (err) {
    console.error("[Daily Ops] GPU snapshot stamp failed:", err);
  }
}

const isBaremetal = (i: UnifiedInstance) =>
  (i.nature || "").toLowerCase() === "baremetal";
const inScope = (i: UnifiedInstance, poolIds: Set<number> | null) => {
  if (poolIds === null) return true; // everything
  const pid = i.pod_info?.pool_id;
  return typeof pid === "number" && poolIds.has(pid);
};

// ── Compute (context-free) ───────────────────────────────────────────────────
export async function computeOpsSummary(
  config: OpsSummaryConfig,
  now: Date = new Date(),
  window?: { start: Date; end: Date },
): Promise<OpsSummary> {
  const { start: dayStart, end: dayEnd } = window ?? previousUtcDay(now);
  const missing = new Set<string>();
  const scope = config.scope ?? { mode: "everything", productIds: [] };
  const scopeProductIds = scope.mode === "products" ? scope.productIds : null;
  // Baremetal has no pool/GpuProduct FK, so BM metrics (utilization, customers,
  // deposits) can't be product-scoped — they only appear in platform scope.
  const platformScope = scope.mode === "everything";

  // Resolve the scope → the pool IDs it covers (null = everything / no pool filter).
  let scopePoolIds: Set<number> | null = null;
  if (scope.mode === "products") {
    scopePoolIds = await resolveProductPoolIds(scope.productIds).catch(
      (err) => {
        console.error("[Daily Ops] scope pool resolution failed:", err);
        missing.add("scope pools");
        return new Set<number>();
      },
    );
  }

  // One HAI instance sweep — feeds GPU rows, stopped revenue, active customers, GPUs-in-use.
  let instances: UnifiedInstance[] | null = null;
  try {
    instances = await getAllUnifiedInstances();
  } catch (err) {
    console.error("[Daily Ops] HAI instance fetch failed:", err);
    missing.add("HAI instances");
  }

  // Baremetal node fleet (admin /baremetal/node) — feeds the node-count rows and,
  // in platform scope, BM utilization. Fetch once; null = the admin fetch failed
  // → those metrics render "—". (Per-region calls are cached.)
  let baremetalNodes: BaremetalNode[] | null = null;
  const needsBaremetalNodes =
    platformScope ||
    config.gpuRows.some(
      (r) => r.source === "baremetal" && (r.nodeIds?.length ?? 0) > 0,
    );
  if (needsBaremetalNodes) {
    try {
      baremetalNodes = await gpuaasAdmin.listAllBaremetalNodes();
    } catch (err) {
      console.error("[Daily Ops] baremetal node fetch failed:", err);
      missing.add("baremetal nodes");
    }
  }

  // ── Per-product-type attribution inputs (PA-409) ──
  // A pool alone can't tell a Dedicated Monthly pod from a Dedicated On-demand
  // pod — both product types share the same physical pool, and the monthly
  // GpuProduct is inactive so productId doesn't disambiguate either. The
  // authoritative signal is the pod's own billing type (PodMetadata), read via
  // isMonthlyPod(). Prefetch once: product → {poolIds, billingType}, and a
  // per-running-pod billing lookup.
  const rowProductIds = [
    ...new Set(
      config.gpuRows
        .filter((r) => r.source === "pool")
        .flatMap((r) => r.productIds),
    ),
  ];
  let productInfo: Map<string, ProductInfo> | null = null;
  try {
    productInfo = await getProductInfo(rowProductIds);
  } catch (err) {
    console.error("[Daily Ops] product info fetch failed:", err);
  }

  // Per-instance billing for the running pods (one query). null = the lookup
  // failed → per-type pool counts can't be trusted, so those rows render "—".
  let billingByInstance: Map<string, PodBilling> | null = new Map();
  if (instances) {
    try {
      const runningIds = [...runningPodIdsInScope(instances, null)];
      if (runningIds.length) {
        const metas = await prisma.podMetadata.findMany({
          where: { instanceId: { in: runningIds } },
          select: { instanceId: true, billingType: true, stripeSubscriptionId: true },
        });
        const map = new Map<string, PodBilling>();
        for (const m of metas)
          if (m.instanceId)
            map.set(m.instanceId, {
              billingType: m.billingType,
              stripeSubscriptionId: m.stripeSubscriptionId,
            });
        billingByInstance = map;
      }
    } catch (err) {
      console.error("[Daily Ops] pod billing lookup failed:", err);
      billingByInstance = null;
      missing.add("pod billing types");
    }
  }

  // Stripe client for per-row monthly revenue (best-effort; a monthly row shows
  // "—" if unavailable). Separate from the platform monthly sweep below.
  let rowStripe: Stripe | null = null;
  try {
    rowStripe = await getStripe();
  } catch (err) {
    console.error("[Daily Ops] Stripe unavailable for per-row revenue:", err);
  }

  // Pool-overview cache — read once, BEFORE the GPU rows: PA-691 capacity
  // denominators and the platform utilization block share the same snapshot,
  // so Today and Capacity stay internally coherent (PA-409 basis convention).
  const pool = readPoolOverviewCache();
  if (!pool) missing.add("pool overview");

  // ── GPU-count rows (independent per-row counts) + per-type revenue (PA-409) ──
  const gpuMetrics: MetricRow[] = [];
  for (const row of config.gpuRows) {
    let value: string | null = null;
    let revenue: string | null = null; // pool rows only; baremetal → "—"

    // Resolve this pool row's products → pools + billing type once.
    const poolInfo =
      row.source === "pool" && productInfo
        ? row.productIds
            .map((id) => productInfo!.get(id))
            .filter((p): p is ProductInfo => p != null)
        : [];
    const poolIds = new Set<number>();
    for (const p of poolInfo) for (const pid of p.poolIds) poolIds.add(pid);
    const rowMonthly = poolInfo.some((p) => p.billingType === "monthly");

    // Count.
    try {
      if (row.source === "baremetal") {
        // Node assignment: count the assigned NODES that are actually in
        // service (Online + In service), not their GPU cards. Available/offline
        // nodes are capacity, not consumption, so they don't count here.
        const nodeIds = row.nodeIds ?? [];
        if (nodeIds.length === 0) {
          value = "0"; // no nodes assigned → counts nothing
        } else if (baremetalNodes === null) {
          value = null; // admin fetch failed → "—"
        } else {
          const selected = new Set(nodeIds);
          // Case-insensitive: HAI status casing drifts (cf. pod status handling
          // elsewhere in this file), so don't hard-match the exact label casing.
          const nodes = baremetalNodes.filter(
            (n) =>
              selected.has(n.id) &&
              (n.status || "").toLowerCase() === "online" &&
              (n.service_status || "").toLowerCase() === "in service",
          ).length;
          value = String(nodes);
        }
      } else if (row.productIds.length === 0) {
        value = "0"; // no products linked → counts nothing
      } else if (instances === null || billingByInstance === null || productInfo === null) {
        value = null; // HAI / billing / product lookup failed → "—"
      } else {
        // Only the pods in this product's pools whose billing type matches the
        // row (monthly vs hourly) — fixes the shared-pool collision (PA-409).
        const ids = [...runningPodIdsInScope(instances, poolIds)].filter(
          (id) => isMonthlyPod(billingByInstance!.get(id)) === rowMonthly,
        );
        const vgpu = await getVgpuCounts(ids);
        let gpus = 0;
        for (const id of ids) gpus += vgpu[id] ?? 0;
        value = String(gpus);
      }
    } catch (err) {
      console.error(`[Daily Ops] GPU row "${row.label}" count failed:`, err);
      value = null;
      missing.add(row.label);
    }

    // PA-691: capacity + utilization from the same run's fleet data. Pool rows
    // measure vGPU slots (GPUs × share ratio) so the denominator matches the
    // vGPU-count numerator; BM rows measure assigned Online nodes so the
    // denominator matches the in-service node count.
    let capacityNum: number | null = null;
    if (row.source === "baremetal") {
      const nodeIds = row.nodeIds ?? [];
      if (nodeIds.length === 0) {
        capacityNum = 0; // nothing assigned → nothing sellable
      } else if (baremetalNodes !== null) {
        const selected = new Set(nodeIds);
        capacityNum = baremetalNodes.filter(
          (n) => selected.has(n.id) && (n.status || "").toLowerCase() === "online",
        ).length;
      } // fetch failed → null → "—"
    } else if (row.productIds.length === 0) {
      capacityNum = 0;
    } else if (pool) {
      // Sellable vGPU slots on ONLINE nodes — the shared platform-metrics
      // definition (#10/#11), so this row's Util % and the platform
      // "Utilization % (rented ÷ available)" row share one denominator basis.
      capacityNum = 0;
      for (const p of pool.pools) if (poolIds.has(p.id)) capacityNum += poolVgpuSlots(p);
    } // pool cache cold → null → "—"
    const todayNum = value === null ? null : Number(value);
    const utilization =
      capacityNum !== null && capacityNum > 0 && todayNum !== null && Number.isFinite(todayNum)
        ? pct((todayNum / capacityNum) * 100)
        : null;

    // Revenue earned yesterday for this product type (pool rows only). Monthly
    // pods bill via Stripe (no ledger rows) → sum subs by product; hourly →
    // usage + stopped from the pool-tagged ledger (monthly pods never write
    // these, so a pool shared with a monthly product is still exact). Baremetal
    // is lumpy term-prepay → no daily earned line (kept in the BM rows below).
    // A revenue failure leaves "—" and never blanks the already-computed count.
    if (row.source === "pool" && row.productIds.length > 0 && productInfo !== null) {
      try {
        if (rowMonthly) {
          revenue = rowStripe
            ? usd(await sumMonthlyRevenue(rowStripe, row.productIds, dayStart, dayEnd))
            : null;
        } else {
          const usage = await sumUsageRevenue(dayStart, dayEnd, poolIds);
          const stopped = await sumStoppedBilled(dayStart, dayEnd, poolIds);
          revenue = usd(usage + stopped);
        }
      } catch (err) {
        console.error(`[Daily Ops] GPU row "${row.label}" revenue failed:`, err);
        revenue = null;
      }
    }

    gpuMetrics.push({
      label: row.label,
      value,
      goal: String(row.goal),
      revenue,
      capacity: capacityNum === null ? null : String(capacityNum),
      utilization,
      basis: "LIVE",
      note:
        row.source === "baremetal"
          ? "HAI node API — assigned nodes Online + In service (nodes, not GPU cards); capacity = assigned nodes Online"
          : "HAI sweep — Σ vGPUs of running pods in this row's pools; capacity = Σ online-node GPUs × share ratio",
    });
  }

  // ── Utilization + GPUs-in-use (pool-overview cache read above; null = cold → "—") ──
  // GPUs in use = real vGPUs allocated to running pods (everything → all pools;
  // products → scope pools). Drives Rev/GPU and the utilization numerator.
  // (pod_info.pool_id + vgpu_count via the detail cache — the same source as the
  // GPU rows; pool-overview's pods[].vgpuCount is a hardcoded 1, so not usable.)
  let gpusInUse: number | null = null;
  if (instances) {
    const ids = runningPodIdsInScope(instances, scopePoolIds);
    const vgpu = await getVgpuCounts([...ids]);
    gpusInUse = [...ids].reduce((s, id) => s + (vgpu[id] ?? 0), 0);
  }

  // vGPU capacity = Σ (physical GPUs × share ratio) over the relevant pools.
  // overcommitRatio maps to the pool's sharing_ratio (gpuaas-admin/types.ts).
  // Shared by live utilization (below) and billed utilization (ledger-based).
  let vgpuCapacity: number | null = null;
  if (pool) {
    vgpuCapacity = 0;
    for (const p of pool.pools) {
      if (scopePoolIds === null || scopePoolIds.has(p.id)) {
        vgpuCapacity += p.totalGpus * (p.overcommitRatio || 1);
      }
    }
  }

  // Utilization = vGPUs in use ÷ vGPU capacity. Needs the pool cache for capacity.
  let utilizationPct: number | null = null;
  if (vgpuCapacity !== null && gpusInUse !== null) {
    utilizationPct = vgpuCapacity > 0 ? (gpusInUse / vgpuCapacity) * 100 : 0;
  }

  // Billed utilization (metrics-sheet #12 headline): GPU-hours the ledger
  // actually billed yesterday ÷ (capacity × 24h). The live row above is a
  // point-in-time pulse; this one is what the fleet earned over the whole day.
  // Capacity is today's fleet held constant — no historical capacity series yet.
  let billedGpuHours: number | null = null;
  let billedUtilizationPct: number | null = null;
  try {
    billedGpuHours = await sumBilledGpuHours(dayStart, dayEnd, scopePoolIds);
    if (vgpuCapacity !== null) {
      billedUtilizationPct =
        vgpuCapacity > 0 ? (billedGpuHours / (vgpuCapacity * 24)) * 100 : 0;
    }
  } catch (err) {
    console.error("[Daily Ops] billed utilization failed:", err);
    missing.add("billed utilization");
  }

  // Bare-metal utilization = in-service nodes ÷ online nodes, fleet-wide.
  // Online-but-available nodes are unsold capacity; offline nodes are excluded
  // from the denominator (broken ≠ sellable). Platform scope only.
  let bmUtilizationPct: number | null = null;
  if (platformScope && baremetalNodes !== null) {
    const online = baremetalNodes.filter(
      (n) => (n.status || "").toLowerCase() === "online",
    );
    const inService = online.filter(
      (n) => (n.service_status || "").toLowerCase() === "in service",
    );
    bmUtilizationPct =
      online.length > 0 ? (inService.length / online.length) * 100 : 0;
  }

  // Active customers (pods) = distinct teams with a running pod in scope.
  let activeCustomers: number | null = null;
  if (instances) {
    const teams = new Set<string>();
    for (const i of instances) {
      if (isBaremetal(i)) continue;
      if (!RUNNING.has((i.status || "").toLowerCase())) continue;
      if (!inScope(i, scopePoolIds)) continue;
      if (i.team?.id) teams.add(i.team.id);
    }
    activeCustomers = teams.size;
  }

  // Active customers (bare metal) = distinct teams with a running BM instance.
  // Same HAI sweep, platform scope only (BM can't be product-scoped).
  let bmActiveCustomers: number | null = null;
  if (platformScope && instances) {
    const teams = new Set<string>();
    for (const i of instances) {
      if (!isBaremetal(i)) continue;
      if (!BM_RUNNING.has((i.status || "").toLowerCase())) continue;
      if (i.team?.id) teams.add(i.team.id);
    }
    bmActiveCustomers = teams.size;
  }

  // ── Daily Revenue (EARNED) = usage + stopped + monthly ──
  let usageCents: number | null = null;
  try {
    usageCents = await sumUsageRevenue(dayStart, dayEnd, scopePoolIds);
  } catch (err) {
    console.error("[Daily Ops] usage revenue failed:", err);
    missing.add("usage revenue");
  }

  // stoppedCents degrades to 0 in the TOTAL on failure (best-effort estimate),
  // but its own breakdown row must show "—" when the number is unknown, not $0.
  //
  // Both scopes: sum yesterday's stopped_reservation LEDGER rows — exactly what
  // the sync engine billed, windowed to the report's day like usage. Rows are
  // pool-tagged by the sync engine, so products scope filters by poolId.
  let stoppedCents = 0;
  let stoppedKnown = false;
  try {
    stoppedCents = await sumStoppedBilled(dayStart, dayEnd, scopePoolIds);
    stoppedKnown = true;
  } catch (err) {
    console.error("[Daily Ops] stopped revenue failed:", err);
    missing.add("stopped revenue");
  }

  let monthlyCents: number | null = null;
  try {
    const stripe = await getStripe();
    monthlyCents = await sumMonthlyRevenue(stripe, scopeProductIds, dayStart, dayEnd);
  } catch (err) {
    console.error("[Daily Ops] monthly subscription revenue failed:", err);
    missing.add("monthly subs");
  }

  // Total only when the two material sources resolved (don't show a partial number
  // on a leadership feed). Stopped is a best-effort estimate → 0 on failure.
  const dailyRevenueCents =
    usageCents === null || monthlyCents === null
      ? null
      : usageCents + stoppedCents + monthlyCents;

  // Net Revenue (metrics-sheet #15): Packet's modeled take on yesterday's GMV.
  // GMV = the ledger streams only (usage + stopped) — monthly subs and BM term
  // prepay are excluded by the sheet's definition. Same degrade rule as the
  // total: stopped folds in as 0 on failure, usage failing blanks the row.
  const netRevenueCents =
    usageCents === null
      ? null
      : Math.round((usageCents + stoppedCents) * PACKET_TAKE_RATE);

  // Rev/GPU denominator: prefer the GPU count stamped by the report POSTED
  // DURING the revenue day (yesterday's post measured its fleet live at post
  // time — 00:30 UTC, i.e. a start-of-day snapshot of that day), so both sides
  // of the ratio come from the same day. Falls back to today's
  // live count — labeled "(live GPUs)" — when no matching stamp exists (first
  // day after deploy, missed post, or the scope changed).
  let gpusForRevPerGpu = gpusInUse;
  let revPerGpuBasis: "yesterday" | "live" = "live";
  try {
    const snapRaw = await getSetting(OPS_SUMMARY_GPU_SNAPSHOT_KEY);
    if (snapRaw) {
      const snap = JSON.parse(snapRaw) as {
        measuredOn?: string;
        gpus?: Record<string, number>;
      };
      const stamped = snap.gpus?.[opsScopeKey(scope)];
      if (
        snap.measuredOn === dateStr(dayStart) &&
        typeof stamped === "number" &&
        stamped > 0
      ) {
        gpusForRevPerGpu = stamped;
        revPerGpuBasis = "yesterday";
      }
    }
  } catch {
    /* unreadable stamp → live fallback */
  }

  const revPerGpuCents =
    dailyRevenueCents !== null && gpusForRevPerGpu && gpusForRevPerGpu > 0
      ? Math.round(dailyRevenueCents / gpusForRevPerGpu)
      : null;
  // Bare-metal contract value that landed yesterday (informational footnote).
  let bmContractCents = 0;
  try {
    const bm = await prisma.bareMetalOrder.aggregate({
      _sum: { totalInvoiceCents: true },
      where: { paymentReceivedDate: { gte: dayStart, lte: dayEnd } },
    });
    bmContractCents = bm._sum.totalInvoiceCents ?? 0;
  } catch {
    /* informational only — ignore */
  }

  // Bare-metal deposits to date (cumulative): term price of every contract that
  // reached Active — currently active, or past-active (expired/terminated, both
  // only reachable from a provisioned state). Orders that never activated
  // (pending payment, provisioning, cancelled, refunded) are excluded (PA-357).
  // Shown as its own line and folded into
  // the run rate per the leadership sign-off. Term-prepay is lumpy, so this is the
  // baremetal "book", not a daily flow — see the caveat in the run-rate note.
  //
  // Baremetal has no pool/GpuProduct FK, so it can't be scoped to a product set.
  // We therefore only count it in platform scope; a products-scoped report stays
  // a pure recurring run rate (otherwise a scoped daily flow would be mixed with
  // the whole-platform baremetal book — a misleading overstatement).
  let bmDepositsToDateCents = 0;
  if (platformScope) {
    try {
      const bm = await prisma.bareMetalOrder.aggregate({
        _sum: { termPriceCents: true },
        where: {
          paymentReceivedDate: { not: null },
          status: { in: [...ACTIVATED_ORDER_STATUSES] },
        },
      });
      bmDepositsToDateCents = bm._sum.termPriceCents ?? 0;
    } catch {
      /* informational only — ignore */
    }
  }

  // Run rate = recurring annualized (daily × 365), plus the baremetal deposit
  // book in platform scope.
  const runRateCents =
    dailyRevenueCents !== null
      ? dailyRevenueCents * RUN_RATE_MULTIPLIER + bmDepositsToDateCents
      : null;

  // ── PA-693 platform-health metrics (platform scope only) ──
  // Same lib functions the /api/admin/packet-health endpoint reads, at the
  // 1-day grain (metrics dictionary AC: identical logic everywhere). Each
  // degrades independently to "—" + a missing entry.
  const phWindow = { start: dayStart, end: dayEnd };
  const grab = async <T>(name: string, make: () => Promise<T>): Promise<T | null> => {
    try {
      return await make();
    } catch (err) {
      console.error(`[Daily Ops] ${name} failed:`, err);
      missing.add(name);
      return null;
    }
  };
  const phPools = classifyPools(pool?.pools ?? []);
  const [phSignups, phTtfj, phPaying, phMrr, phRunRate, phAvail, phUtil] = platformScope
    ? await Promise.all([
        grab("signups", () => countSignups(phWindow)),
        // Lifetime-per-user metric → a trailing-30d signup cohort, not the
        // report day (a 1-day cohort is empty noise).
        grab("time to first job", () => timeToFirstJob(resolveWindow("1m", now))),
        grab("active paying customers", () => activePayingCustomers(phWindow, phPools)),
        // As-of end of the report day; no Stripe client — the health endpoint
        // owns the live-Stripe reconciliation.
        grab("MRR", () => mrrAsOf(dayEnd, phPools)),
        grab("consumption run-rate", () => consumptionRunRate(now, phPools)),
        grab("available GPU-hours", () => availableGpuHours(phWindow)),
        grab("platform utilization", () => platformUtilization(phWindow)),
      ])
    : [null, null, null, null, null, null, null];
  let phSuppliers: number | null = null;
  if (platformScope) {
    try {
      phSuppliers = countSuppliers();
    } catch (err) {
      console.error("[Daily Ops] suppliers failed:", err);
      missing.add("suppliers");
    }
  }
  const sumByType = (byType: Record<string, number>) =>
    Object.values(byType).reduce((s, v) => s + v, 0);

  const totalGpus = pool?.summary.totalGpus ?? null;
  const activePods = pool?.summary.activePods ?? null;
  const scopeLabel =
    scope.mode === "everything"
      ? "Platform"
      : `${scope.productIds.length} product${scope.productIds.length === 1 ? "" : "s"}`;

  const g = config.goals;
  const rows: MetricRow[] = [
    ...gpuMetrics,
    {
      label: "vGPU Utilization %",
      value: utilizationPct === null ? null : pct(utilizationPct),
      goal: pct(g.utilizationPct),
      basis: "LIVE",
      // Legacy denominator: the WHOLE fleet (offline nodes included), unchanged
      // since this row shipped so its day-over-day history stays comparable.
      // The per-row Capacity and the PA-693 rows use online-only GPUs, so these
      // diverge whenever a node is offline.
      note: "HAI sweep + pool cache — vGPUs in use ÷ Σ(all fleet GPUs × share ratio, incl. offline nodes)",
    },
    {
      label: "GPU Utilization % (billed)",
      value: billedUtilizationPct === null ? null : pct(billedUtilizationPct),
      goal: "—",
      basis: "YDAY",
      note: "wallet ledger — billed GPU-hours ÷ (vGPU capacity × 24h); capacity = current fleet",
    },
    ...(platformScope
      ? [
          {
            label: "Bare Metal Utilization %",
            value: bmUtilizationPct === null ? null : pct(bmUtilizationPct),
            goal: "—",
            basis: "LIVE" as const,
            note: "HAI node API — in-service ÷ online nodes (offline excluded)",
          },
        ]
      : []),
    {
      label: "Active Customers (Pods)",
      value: activeCustomers === null ? null : String(activeCustomers),
      goal: String(g.activeCustomers),
      basis: "LIVE",
      note: "HAI sweep — distinct teams with ≥1 running pod",
    },
    ...(platformScope
      ? [
          {
            label: "Active Customers (Bare Metal)",
            value:
              bmActiveCustomers === null ? null : String(bmActiveCustomers),
            goal: "—",
            basis: "LIVE" as const,
            note: "HAI sweep — distinct teams with ≥1 running BM instance",
          },
        ]
      : []),
    {
      label: "Daily Revenue",
      value: dailyRevenueCents === null ? null : usd(dailyRevenueCents),
      goal: usd(g.dailyRevenueCents),
      basis: "YDAY",
      note: "wallet ledger + Stripe — GPU usage + stopped + monthly subs",
    },
    // Breakdown of the three streams (time basis in the Basis column).
    {
      label: "↳ GPU Usage",
      value: usageCents === null ? null : usd(usageCents),
      goal: "—",
      basis: "YDAY",
      note: "wallet ledger — Σ gpu_usage rows (what billing charged)",
    },
    {
      label: "↳ Stopped Pods",
      value: stoppedKnown ? usd(stoppedCents) : null,
      goal: "—",
      basis: "YDAY",
      note: "wallet ledger — Σ stopped_reservation rows",
    },
    {
      label: "↳ Monthly Subs",
      value: monthlyCents === null ? null : usd(monthlyCents),
      goal: "—",
      basis: "YDAY",
      note: "Stripe — MRR of subs active yesterday ÷ 30",
    },
    {
      label: "Net Revenue (20% take)",
      value: netRevenueCents === null ? null : usd(netRevenueCents),
      goal: "—",
      basis: "YDAY",
      note: "modeled — (GPU usage + stopped) × 20%; monthly subs & BM excluded",
    },
    ...(platformScope
      ? [
          {
            label: "Bare Metal Deposits",
            value: usd(bmDepositsToDateCents),
            goal: "—",
            basis: "TO-DATE" as const,
            note: "BareMetalOrder — Σ term price of paid, activated orders",
          },
        ]
      : []),
    {
      label:
        revPerGpuBasis === "yesterday"
          ? "Revenue / GPU / Day"
          : "Revenue / GPU / Day (live GPUs)",
      value: revPerGpuCents === null ? null : usd(revPerGpuCents),
      goal: usd(g.revPerGpuCents),
      basis: "YDAY",
      note: "Daily Revenue ÷ GPUs in use stamped during the revenue day",
    },
    {
      label: platformScope
        ? "Revenue Run Rate (×365 + BM deposits)"
        : "Revenue Run Rate (×365)",
      value: runRateCents === null ? null : usd(runRateCents),
      goal: usd(g.runRateCents),
      basis: "YDAY",
      note: platformScope
        ? "Daily Revenue × 365 + BM deposits to date"
        : "Daily Revenue × 365",
    },
    // ── PA-693 platform-health rows (metrics dictionary #1–#12, 1-day grain) ──
    ...(platformScope
      ? ([
          {
            label: "Signups (completed)",
            value: phSignups === null ? null : String(phSignups),
            goal: "—",
            basis: "YDAY",
            note: "CustomerLifecycle — signed up in the day AND magic link clicked; internal excluded",
          },
          {
            label: "Time to First Job (median)",
            value:
              phTtfj === null
                ? null
                : phTtfj.medianHours === null
                  ? "n/a"
                  : `${phTtfj.medianHours}h`,
            goal: "—",
            basis: "TO-DATE",
            note: phTtfj
              ? `trailing-30d signup cohort; ${phTtfj.workloadBasisN} workload-based / ${phTtfj.deployProxyN} deploy-proxy activations`
              : "trailing-30d signup cohort",
          },
          {
            label: "Active Paying Customers",
            value: phPaying === null ? null : String(phPaying.total),
            goal: "—",
            basis: "YDAY",
            note: "wallet consumption debits ∪ paid subs overlapping the day; vouchers/internal excluded",
          },
          {
            label: "↳ Dedicated",
            value: phPaying === null ? null : String(phPaying.dedicated.total),
            goal: "—",
            basis: "YDAY",
            note: "pools with overcommit ≤ 1",
          },
          {
            label: "↳ Dynamic",
            value: phPaying === null ? null : String(phPaying.dynamic.total),
            goal: "—",
            basis: "YDAY",
            note: "pools with overcommit > 1",
          },
          {
            label: "MRR",
            value: phMrr === null ? null : usd(phMrr.totalCents),
            goal: "—",
            basis: "LIVE",
            note: "SubscriptionHistory active as of end of report day; daily value = ÷30",
          },
          {
            label: "↳ Dedicated Monthly",
            value: phMrr === null ? null : usd(sumByType(phMrr.dedicatedMonthlyByGpuType)),
            goal: "—",
            basis: "LIVE",
            note: "pools with overcommit ≤ 1",
          },
          {
            label: "↳ Dynamic Monthly",
            value: phMrr === null ? null : usd(sumByType(phMrr.dynamicMonthlyByGpuType)),
            goal: "—",
            basis: "LIVE",
            note: "pools with overcommit > 1",
          },
          {
            label: "Consumption Run Rate (30d×12, as of today)",
            value: phRunRate === null ? null : usd(phRunRate.runRateCents),
            goal: "—",
            basis: "TO-DATE",
            note: "trailing-30d consumption ledger (usage + deploy + stopped) × 12",
          },
          {
            label: "Suppliers (live GPUs)",
            value: phSuppliers === null ? null : String(phSuppliers),
            goal: "—",
            basis: "LIVE",
            note: "registered suppliers with ≥1 GPU on an online node",
          },
          {
            label: "Available GPU-hours",
            value: phAvail === null ? null : String(Math.round(phAvail.vgpuSlotHours)),
            goal: "—",
            basis: "YDAY",
            note: phAvail
              ? `vGPU-slot-hours; capacity basis: ${phAvail.basis} (${phAvail.snapshotDays}/${phAvail.windowDays} snapshot days)`
              : "vGPU-slot-hours from the fleet-capacity snapshot",
          },
          {
            label: "Utilization % (rented ÷ available)",
            value: phUtil === null ? null : pct(phUtil.pct),
            goal: "—",
            basis: "YDAY",
            note: phUtil
              ? `billed + committed monthly GPU-hours ÷ available; capacity basis: ${phUtil.capacityBasis}`
              : "billed + committed monthly GPU-hours ÷ available",
          },
        ] satisfies MetricRow[])
      : []),
  ];

  const date = dateStr(dayStart);
  const text = renderTable(
    date,
    scopeLabel,
    rows,
    [...missing],
    bmContractCents,
    activePods,
    totalGpus,
  );

  return {
    date,
    scopeLabel,
    rows,
    missing: [...missing],
    bmContractCents,
    text,
    raw: {
      scope: scope.mode,
      utilizationPct,
      bmUtilizationPct,
      activeCustomers,
      bmActiveCustomers,
      activePods,
      totalGpus,
      gpusInUse,
      usageCents,
      stoppedCents,
      monthlyCents,
      dailyRevenueCents,
      netRevenueCents,
      billedGpuHours,
      billedUtilizationPct,
      revPerGpuCents,
      revPerGpuBasis,
      runRateCents,
      bmContractCents,
      bmDepositsToDateCents,
      // PA-693 platform-health values (null outside platform scope / on failure)
      signupsCompleted: phSignups,
      ttfjMedianHours: phTtfj?.medianHours ?? null,
      ttfjActivatedN: phTtfj?.n ?? null,
      activePayingTotal: phPaying?.total ?? null,
      activePayingDedicated: phPaying?.dedicated.total ?? null,
      activePayingDynamic: phPaying?.dynamic.total ?? null,
      mrrCents: phMrr?.totalCents ?? null,
      mrrDailyProratedCents: phMrr?.dailyProratedCents ?? null,
      consumptionRunRateCents: phRunRate?.runRateCents ?? null,
      suppliersLiveGpus: phSuppliers,
      availableVgpuSlotHours: phAvail?.vgpuSlotHours ?? null,
      platformUtilizationPct: phUtil?.pct ?? null,
      ...Object.fromEntries(
        gpuMetrics.flatMap((m) => [
          [m.label, m.value],
          [`${m.label} (rev)`, m.revenue ?? null],
          [`${m.label} (capacity)`, m.capacity ?? null],
          [`${m.label} (util%)`, m.utilization ?? null],
        ]),
      ),
    },
  };
}

// ── Scope / instance helpers ─────────────────────────────────────────────────

/** A GpuProduct's pools + billing type, for per-product-type attribution (PA-409). */
interface ProductInfo {
  poolIds: number[];
  billingType: string; // "hourly" | "monthly"
}

/** Batch-fetch {poolIds, billingType} for the given GpuProduct IDs (one query). */
async function getProductInfo(
  productIds: string[],
): Promise<Map<string, ProductInfo>> {
  const out = new Map<string, ProductInfo>();
  if (productIds.length === 0) return out;
  const products = await prisma.gpuProduct.findMany({
    where: { id: { in: productIds } },
    select: { id: true, poolIds: true, billingType: true },
  });
  for (const p of products) {
    let pools: number[] = [];
    try {
      pools = (JSON.parse(p.poolIds) as unknown[]).filter(
        (x): x is number => typeof x === "number",
      );
    } catch {
      /* malformed poolIds JSON — treat as no pools */
    }
    out.set(p.id, { poolIds: pools, billingType: p.billingType ?? "hourly" });
  }
  return out;
}

/** GpuProduct IDs → the deduped union of their pool IDs (numeric). */
async function resolveProductPoolIds(
  productIds: string[],
): Promise<Set<number>> {
  const out = new Set<number>();
  if (productIds.length === 0) return out;
  const products = await prisma.gpuProduct.findMany({
    where: { id: { in: productIds } },
    select: { poolIds: true },
  });
  for (const p of products) {
    try {
      for (const id of JSON.parse(p.poolIds) as unknown[])
        if (typeof id === "number") out.add(id);
    } catch {
      /* malformed poolIds JSON — skip this product */
    }
  }
  return out;
}

/** Distinct running (non-baremetal) pod instance IDs on the given pools (null = all). */
function runningPodIdsInScope(
  instances: UnifiedInstance[],
  poolIds: Set<number> | null,
): Set<string> {
  const ids = new Set<string>();
  for (const i of instances) {
    if (isBaremetal(i)) continue;
    if (!RUNNING.has((i.status || "").toLowerCase())) continue;
    if (!inScope(i, poolIds)) continue;
    ids.add(i.id);
  }
  return ids;
}

// ── Revenue sources ──────────────────────────────────────────────────────────
// (sumStoppedBilled / sumBilledGpuHours / sumUsageRevenue moved to
//  @/lib/platform-metrics — PA-693 single source of truth; imported above.)

/**
 * Monthly subscription revenue, amortized to a single day (MRR ÷ 30). Counts
 * subscriptions that were ACTIVE DURING THE REPORT DAY (yesterday), matching the
 * other revenue streams' window: created by the end of the day, and either still
 * active or ended after the day started (a sub that churned overnight still
 * earned yesterday; one created today didn't). Counts the subscription whether
 * or not a pod is currently deployed. Scoped by the sub's
 * metadata.gpu_product_id (set at checkout). Paginated — fixes the old MRR
 * truncation (the previous code stopped at 100 active subs).
 */
async function sumMonthlyRevenue(
  stripe: Stripe,
  scopeProductIds: string[] | null,
  dayStart: Date,
  dayEnd: Date,
): Promise<number> {
  const want = scopeProductIds ? new Set(scopeProductIds) : null;
  let cents = 0;
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await stripe.subscriptions.list({
      status: "all", // canceled subs too — one that ended today was still earning yesterday
      created: { lte: Math.floor(dayEnd.getTime() / 1000) },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of batch.data) {
      // Never-paid subs get ended_at stamped when they expire unpaid — without
      // this guard an incomplete_expired sub adds a phantom MRR day on its
      // expiry day even though it never earned a cent.
      if (sub.status === "incomplete" || sub.status === "incomplete_expired")
        continue;
      const activeDuringDay =
        sub.status === "active" ||
        (sub.ended_at != null && sub.ended_at * 1000 >= dayStart.getTime());
      if (!activeDuringDay) continue; // never-active (trialing) or ended before the day
      if (want) {
        const pid = sub.metadata?.gpu_product_id;
        if (!pid || !want.has(pid)) continue; // out of scope (or legacy sub w/o product metadata)
      }
      for (const item of sub.items.data) {
        const r = item.price.recurring;
        const amount = (item.price.unit_amount ?? 0) * (item.quantity ?? 1);
        if (r?.interval === "month") cents += amount;
        else if (r?.interval === "year") cents += Math.round(amount / 12);
      }
    }
    if (!batch.has_more || batch.data.length === 0)
      return Math.round(cents / 30);
    startingAfter = batch.data[batch.data.length - 1].id;
  }
  // Cap hit with pages remaining: fail loud → "—", never a silent under-count.
  throw new Error(
    `monthly-subs sweep exceeded ${MAX_PAGES * 100} subscriptions`,
  );
}

// ── Render ───────────────────────────────────────────────────────────────────

export function renderTable(
  date: string,
  scopeLabel: string,
  rows: MetricRow[],
  missing: string[],
  bmContractCents: number,
  activePods: number | null,
  totalGpus: number | null,
): string {
  let text = `### 📊 Packet Daily Operating Summary — ${date}\n`;
  text += `_Scope: ${scopeLabel}_\n\n`;
  text += `| Metric | Today | Capacity | Util % | Rev (prev day) | Goal | Basis |\n|---|---:|---:|---:|---:|---:|---|\n`;
  for (const r of rows) {
    // YDAY carries the concrete UTC day so a screenshot is self-dating.
    const basis = r.basis === "YDAY" ? `YDAY (${date})` : (r.basis ?? "—");
    text += `| ${r.label} | ${r.value ?? "—"} | ${r.capacity ?? "—"} | ${r.utilization ?? "—"} | ${r.revenue ?? "—"} | ${r.goal} | ${basis} |\n`;
  }
  text += `\n_New bare-metal contracts (${date}): **${usd(bmContractCents)}**_`;
  if (activePods !== null || totalGpus !== null) {
    text += `\n_Active pods: ${activePods ?? "—"} · Fleet GPUs: ${totalGpus ?? "—"}_`;
  }
  if (missing.length) {
    text += `\n_⚠️ Unavailable this run: ${missing.join(", ")} (shown as —)_`;
  }
  text += `\n_Formulas & sources: 📌 pinned "Formula Reference" in this channel._`;
  text += `\n_Basis (Today column): LIVE = snapshot at post time · YDAY = previous full UTC day · TO-DATE = cumulative. The Rev column is always the previous UTC day. Revenue = earned; storage excluded. Run rate = daily earned × 365 + bare-metal deposits to date (activated orders only, net of refunds)._`;
  text += `\n_Capacity = sellable fleet for the row (GPUs on ONLINE nodes × share ratio; bare metal: assigned nodes online) — NOT the commercial Goal. Util % = Today ÷ Capacity; a shared pool counts fully in every product row selling from it._`;
  return text;
}

// The per-row source/formula notes are NOT rendered in the daily post — they
// live in a manually pinned "Formula Reference" message in the ops channel
// (incoming webhooks can't pin). `MetricRow.note` stays populated so the admin
// preview/raw payload can still surface them.
