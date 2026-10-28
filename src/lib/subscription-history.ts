/**
 * SubscriptionHistory writers (PA-354).
 *
 * Monthly pods bill through Stripe subscriptions and never write
 * wallet_transaction rows; their pod_metadata row is hard-deleted at
 * termination. SubscriptionHistory is the durable record the investor portal
 * derives monthly revenue from: one row per POD window (a quantity-N Stripe
 * subscription has N pods → N rows at the per-unit price), keyed by
 * podSubscriptionId (= pod_metadata.subscriptionId), opened at deploy and
 * closed at termination. A redeploy that closes and reopens on the same UTC
 * day REOPENS the closed record instead of creating a new one, so the
 * day-inclusive proration never counts the boundary day twice.
 *
 * All writers are deliberately non-fatal — history bookkeeping must never
 * break a deploy or a termination. A missed write is recoverable from Stripe
 * (subscription start/cancel dates and prices are retained there), and
 * reconcileOpenSubscriptionHistory() closes any open record whose pod has
 * vanished, so a swallowed close failure can't accrue revenue forever.
 */

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

interface PodForHistory {
  /** pod_metadata.subscriptionId — unique per pod, the record key */
  subscriptionId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  poolId: string | null;
  billingType: string | null;
  deployTime: Date | null;
  createdAt: Date;
}

function parsePoolId(poolId: string | null): number | null {
  if (!poolId) return null;
  const n = parseInt(poolId, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The customer's actual contracted per-unit price from Stripe, or null. */
async function fetchStripePriceCents(stripeSubscriptionId: string): Promise<number | null> {
  try {
    const stripe = await getStripe();
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const amount = sub.items?.data?.[0]?.price?.unit_amount;
    return typeof amount === "number" && amount > 0 ? amount : null;
  } catch (e) {
    console.warn(`[SubscriptionHistory] Stripe price lookup failed for ${stripeSubscriptionId}:`, e);
    return null;
  }
}

/**
 * Open a history record for a freshly deployed monthly pod. Idempotent per
 * pod. If a record for the same Stripe subscription was closed earlier the
 * same UTC day (stale-slot cleanup during a redeploy), that record is
 * reopened and re-pointed at the new pod instead of creating an overlapping
 * window.
 */
export async function openSubscriptionHistory(
  pod: PodForHistory,
  fallbackPriceCents?: number | null,
): Promise<void> {
  try {
    if (pod.billingType !== "monthly") return;
    const poolId = parsePoolId(pod.poolId);
    if (poolId == null) {
      console.warn(`[SubscriptionHistory] Opening record with null poolId for pod ${pod.subscriptionId} — attribution needs a backfill`);
    }

    const alreadyOpen = await prisma.subscriptionHistory.findFirst({
      where: { podSubscriptionId: pod.subscriptionId, endedAt: null },
      select: { id: true },
    });
    if (alreadyOpen) return;

    if (pod.stripeSubscriptionId) {
      const closedToday = await prisma.subscriptionHistory.findFirst({
        where: {
          stripeSubscriptionId: pod.stripeSubscriptionId,
          endedAt: { gte: startOfUtcDay(new Date()) },
        },
        orderBy: { endedAt: "desc" },
      });
      // Only reopen when the pod landed on the SAME pool (or a pool is
      // unresolved on either side). Re-pointing poolId on a cross-pool
      // redeploy would re-attribute the record's entire historical window to
      // the new pool's investor — there a fresh record is correct: one real
      // boundary day on each pool.
      if (closedToday && (poolId == null || closedToday.poolId == null || closedToday.poolId === poolId)) {
        await prisma.subscriptionHistory.update({
          where: { id: closedToday.id },
          data: {
            endedAt: null,
            podSubscriptionId: pod.subscriptionId,
            ...(closedToday.poolId == null && poolId != null ? { poolId } : {}),
          },
        });
        return;
      }
    }

    const priceCents =
      (pod.stripeSubscriptionId ? await fetchStripePriceCents(pod.stripeSubscriptionId) : null) ??
      fallbackPriceCents ??
      0;
    if (priceCents <= 0) {
      console.warn(`[SubscriptionHistory] Opening record with priceCents=0 for pod ${pod.subscriptionId} — price unresolved`);
    }

    await prisma.subscriptionHistory.create({
      data: {
        stripeCustomerId: pod.stripeCustomerId,
        stripeSubscriptionId: pod.stripeSubscriptionId,
        podSubscriptionId: pod.subscriptionId,
        poolId,
        startedAt: pod.deployTime ?? new Date(),
        endedAt: null,
        billingType: "monthly",
        priceCents,
      },
    });
  } catch (e) {
    console.error("[SubscriptionHistory] Failed to open record:", e);
  }
}

/**
 * Close the open history record for a pod that is being terminated (or whose
 * metadata row is being freed for redeploy). Call BEFORE deleting the
 * pod_metadata row. Matches by pod key first; the Stripe-subscription and
 * customer+pool fallbacks only consider legacy records without a pod key, so
 * a quantity-N subscription's other pods are never closed by mistake.
 * Creates a retroactive record if none is open (pods deployed before this
 * feature shipped). No-op for non-monthly pods.
 */
export async function closeSubscriptionHistory(
  ref: { id?: string; subscriptionId?: string },
): Promise<void> {
  try {
    const pod = await prisma.podMetadata.findUnique({
      where: ref.id ? { id: ref.id } : { subscriptionId: ref.subscriptionId! },
    });
    if (!pod || pod.billingType !== "monthly") return;

    const now = new Date();
    const poolId = parsePoolId(pod.poolId);

    let open = await prisma.subscriptionHistory.findFirst({
      where: { podSubscriptionId: pod.subscriptionId, endedAt: null },
    });
    if (!open && pod.stripeSubscriptionId) {
      open = await prisma.subscriptionHistory.findFirst({
        where: { stripeSubscriptionId: pod.stripeSubscriptionId, podSubscriptionId: null, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
    }
    if (!open) {
      open = await prisma.subscriptionHistory.findFirst({
        where: {
          stripeCustomerId: pod.stripeCustomerId,
          poolId: poolId ?? -1,
          podSubscriptionId: null,
          stripeSubscriptionId: null,
          endedAt: null,
        },
      });
    }

    if (open) {
      // Re-snapshot the price at close (catches mid-term price changes) and
      // backfill pool/pod keys the record was missing.
      const priceCents = pod.stripeSubscriptionId
        ? await fetchStripePriceCents(pod.stripeSubscriptionId)
        : null;
      await prisma.subscriptionHistory.update({
        where: { id: open.id },
        data: {
          endedAt: now,
          ...(priceCents ? { priceCents } : {}),
          ...(open.poolId == null && poolId != null ? { poolId } : {}),
          ...(open.podSubscriptionId == null ? { podSubscriptionId: pod.subscriptionId } : {}),
        },
      });
      return;
    }

    // No open record — pod predates this feature. Write the whole window now.
    const priceCents = pod.stripeSubscriptionId
      ? (await fetchStripePriceCents(pod.stripeSubscriptionId)) ?? 0
      : 0;
    await prisma.subscriptionHistory.create({
      data: {
        stripeCustomerId: pod.stripeCustomerId,
        stripeSubscriptionId: pod.stripeSubscriptionId,
        podSubscriptionId: pod.subscriptionId,
        poolId,
        startedAt: pod.deployTime ?? pod.createdAt,
        endedAt: now,
        billingType: "monthly",
        priceCents,
      },
    });
  } catch (e) {
    console.error("[SubscriptionHistory] Failed to close record:", e);
  }
}

/**
 * Safety net for swallowed close failures: closes any open record whose pod
 * no longer exists, so an orphaned window can't accrue revenue forever.
 * Called from the hourly investor-stats cron. Returns the number closed.
 * (A record closed here during a same-day redeploy race is simply reopened
 * by openSubscriptionHistory's closed-today check.)
 */
export async function reconcileOpenSubscriptionHistory(): Promise<number> {
  try {
    const open = await prisma.subscriptionHistory.findMany({ where: { endedAt: null } });
    if (open.length === 0) return 0;

    const pods = await prisma.podMetadata.findMany({
      where: { billingType: "monthly" },
      select: { subscriptionId: true, stripeSubscriptionId: true, stripeCustomerId: true, poolId: true },
    });
    const podKeys = new Set(pods.map((p) => p.subscriptionId));
    const stripeSubIds = new Set(pods.map((p) => p.stripeSubscriptionId).filter(Boolean));
    const customerPools = new Set(pods.map((p) => `${p.stripeCustomerId}:${parsePoolId(p.poolId) ?? ""}`));

    let closed = 0;
    for (const rec of open) {
      const alive = rec.podSubscriptionId
        ? podKeys.has(rec.podSubscriptionId)
        : rec.stripeSubscriptionId
          ? stripeSubIds.has(rec.stripeSubscriptionId)
          : customerPools.has(`${rec.stripeCustomerId}:${rec.poolId ?? ""}`);
      if (alive) continue;
      await prisma.subscriptionHistory.update({
        where: { id: rec.id },
        data: { endedAt: new Date() },
      });
      closed++;
      console.warn(`[SubscriptionHistory] Reconcile: closed orphaned open record ${rec.id} (pod gone)`);
    }
    return closed;
  } catch (e) {
    console.error("[SubscriptionHistory] Reconcile failed:", e);
    return 0;
  }
}
