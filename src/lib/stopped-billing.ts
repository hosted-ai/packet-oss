/**
 * Stopped-instance ("reserved") billing math.
 *
 * Stopped / paused / reserved GPU pods are billed at a configurable percentage
 * of their running rate (see getStoppedInstanceRatePercent / data/pricing.json).
 *
 * IMPORTANT: each stopped pod is priced at ITS OWN whole-instance rate, exactly
 * like the running-charge path (sync/route.ts). Two rules:
 *   1. Never average rates across the customer's fleet — a single expensive (or
 *      stale/terminated) pod in PodMetadata would otherwise inflate the charge
 *      applied to a cheap stopped pod (the "$751.90 for a stopped $100/hr GPU"
 *      overcharge).
 *   2. Never multiply by GPU count. PodMetadata.hourlyRateCents is the WHOLE-
 *      instance price (a "2 x A100" product is priced for both GPUs — see the
 *      GpuProduct catalog), so the count is already baked in. Multiplying would
 *      double-bill any pod HAI reports with vgpu_count > 1.
 */

export interface StoppedPodInput {
  /** GPUs in this stopped pod (HAI vgpu_count) — informational, for the charge description only. */
  gpuCount: number;
  /** This pod's OWN whole-instance hourly rate in cents (PodMetadata.hourlyRateCents). 0 = unknown. */
  podHourlyRateCents: number;
}

export interface StoppedChargeResult {
  /** Total GPUs actually billed (priced pods only). Used for the charge description. */
  stoppedGpuCount: number;
  /** Amount to charge for this billing interval, in cents (rounded). */
  stoppedCostCents: number;
}

/**
 * Compute the stopped-instance reservation charge for one billing interval.
 *
 * For each stopped pod with a known rate: contributes its OWN whole-instance
 * hourly rate to the full-rate total (NOT × gpuCount — the rate already covers
 * every GPU in the pod). The total is then scaled by the stopped-rate percentage
 * and the interval length, and rounded once at the end.
 *
 * Pods with no known rate (podHourlyRateCents <= 0) are skipped entirely — never
 * billed and never counted — so a missing PodMetadata row can't be "guessed" at
 * a fleet average.
 */
export function computeStoppedCharge(
  pods: StoppedPodInput[],
  stoppedRatePercent: number,
  intervalMinutes: number,
): StoppedChargeResult {
  const hoursInInterval = intervalMinutes / 60;

  let stoppedGpuCount = 0;
  let fullHourlyRateCents = 0;

  for (const pod of pods) {
    if (!pod.podHourlyRateCents || pod.podHourlyRateCents <= 0) continue; // unpriced → skip
    const gpus = Math.max(1, Math.ceil(pod.gpuCount || 1));
    stoppedGpuCount += gpus; // display only — the rate already covers all GPUs
    fullHourlyRateCents += pod.podHourlyRateCents; // whole-instance rate, NOT × gpus
  }

  const stoppedCostCents = Math.round(
    fullHourlyRateCents * (stoppedRatePercent / 100) * hoursInInterval,
  );

  return { stoppedGpuCount, stoppedCostCents };
}

/** One pool's own stopped-reservation charge (a pool-tagged ledger row). */
export interface StoppedPoolCharge {
  poolId: number | null;
  amountCents: number;
  /** GPUs billed in this pool (display, same counting as computeStoppedCharge). */
  gpuCount: number;
}

/**
 * Per-pool stopped charges for the pool-tagged LEDGER rows only: group the
 * stopped pods by pool and price each pool with computeStoppedCharge. This is
 * pure attribution — the Stripe charge itself is still computed over the whole
 * fleet in sync/route.ts, completely unchanged. Each row is the pool's own
 * true price, so in the common single-pool case the row equals the Stripe
 * charge exactly; multi-pool rows round independently and can drift from the
 * single charge by under a cent per pool per cycle (fine for reporting —
 * billing is untouched).
 */
export function stoppedPoolCharges(
  pods: Array<StoppedPodInput & { poolId: number | null }>,
  stoppedRatePercent: number,
  intervalMinutes: number,
): StoppedPoolCharge[] {
  const byPool = new Map<number | null, StoppedPodInput[]>();
  for (const pod of pods) {
    if (!pod.podHourlyRateCents || pod.podHourlyRateCents <= 0) continue; // unpriced → skip
    const group = byPool.get(pod.poolId);
    if (group) group.push(pod);
    else byPool.set(pod.poolId, [pod]);
  }

  const out: StoppedPoolCharge[] = [];
  for (const [poolId, group] of byPool) {
    const c = computeStoppedCharge(group, stoppedRatePercent, intervalMinutes);
    if (c.stoppedCostCents > 0) {
      out.push({ poolId, amountCents: c.stoppedCostCents, gpuCount: c.stoppedGpuCount });
    }
  }
  return out;
}

/** Minimal shape of a Stripe customer balance transaction for the dedup check. */
export interface RecentBalanceTxn {
  created: number; // unix seconds
  metadata?: { billing_type?: string | null } | null;
}

export const STOPPED_RESERVATION_BILLING_TYPE = "stopped_reservation";

/**
 * Dedup guard: true if a stopped-reservation charge was already posted within
 * `withinSeconds` of `nowSec`.
 *
 * The running-charge path is idempotent per interval via each pod's prepaidUntil
 * (plus a recent-chargeId check). The stopped-charge path has no prepaidUntil, so
 * without this a double cron run could bill stopped pods twice — e.g. a brand-new
 * customer with no storage-sync timestamp yet, or two overlapping invocations
 * racing the 25-min storage-sync gate. A short window (well under the ~25-min
 * legitimate spacing) catches those races without blocking real consecutive bills.
 */
export function wasStoppedBilledRecently(
  txns: RecentBalanceTxn[],
  nowSec: number,
  withinSeconds: number,
): boolean {
  const cutoff = nowSec - withinSeconds;
  return txns.some(
    (t) => t.metadata?.billing_type === STOPPED_RESERVATION_BILLING_TYPE && t.created > cutoff,
  );
}
