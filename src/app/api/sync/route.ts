import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSharedVolumes, getPoolSubscriptions } from "@/lib/hostedai";
import { checkAndRefillWallet, WALLET_CONFIG } from "@/lib/wallet";
import { getStoragePricePerGBHourCents, getStoppedInstanceRatePercent, getHardStopDebtToleranceCents } from "@/lib/pricing";
import { computeStorageCharge, storageIntervalHours } from "@/lib/storage-billing";
import { computeStoppedCharge, stoppedPoolCharges, wasStoppedBilledRecently, type StoppedPodInput } from "@/lib/stopped-billing";
import { getInternalExclusions, makeIsInternalOrExcluded } from "@/lib/internal-accounts";
import { getProductByPoolId, type ProductPricing } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { sendNegativeBalanceShutdownEmail } from "@/lib/email";
import { cacheCustomer } from "@/lib/customer-cache";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import { classifyPodBilling, isHourlyWorkload, logUnclassifiedSkip, VOLUME_DELETION_GRACE_DAYS, type PodBilling } from "@/lib/negative-balance";
import { trackGA4Event } from "@/lib/analytics/ga4";
import { posthogTrackEvent } from "@/lib/analytics/posthog";
import type Stripe from "stripe";

// Secret key to protect the sync endpoint (set in env)
const SYNC_SECRET = process.env.SYNC_SECRET;

// Track when reconciliation last ran (Step 0) — only needs to run once per hour
let lastReconciliationRun = 0;
const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Billing interval in minutes (each pod is billed every 30 mins from its deploy time)
const BILLING_INTERVAL_MINUTES = 30;

// The customer fields the sweep reads, served either from customer_cache or Stripe.
interface SweepCustomer {
  id: string;
  email: string | null;
  name: string | null;
  balanceCents: number;
  metadata: Record<string, string>;
}

function fromCachedCustomer(row: {
  id: string;
  email: string | null;
  name: string | null;
  balanceCents: number;
  billingType: string | null;
  teamId: string | null;
  metadataJson: string | null;
}): SweepCustomer {
  let metadata: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.metadataJson || "{}");
    if (parsed && typeof parsed === "object") metadata = { ...(parsed as Record<string, string>) };
  } catch { /* unparseable metadata reads as empty */ }
  // The mirrored columns are authoritative for the two keys the sweep gates on,
  // so a row written before metadata_json existed still resolves.
  if (row.billingType) metadata.billing_type = row.billingType;
  if (row.teamId) metadata.hostedai_team_id = row.teamId;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    balanceCents: row.balanceCents ?? 0,
    metadata,
  };
}

function fromStripeCustomer(customer: Stripe.Customer): SweepCustomer {
  return {
    id: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
    balanceCents: customer.balance ?? 0,
    metadata: (customer.metadata ?? {}) as Record<string, string>,
  };
}

// Storage is metered on fixed intervals with a 25-minute buffer.
function storageSyncedRecently(lastStorageSync: string | undefined, nowSec: number): boolean {
  if (!lastStorageSync) return false;
  const lastSyncTime = parseInt(lastStorageSync, 10);
  return Number.isFinite(lastSyncTime) && nowSec - lastSyncTime < 25 * 60;
}

interface PodBillingResult {
  subscriptionId: string;
  customerId: string;
  email?: string;
  status: "billed" | "not_due" | "error" | "skipped_stopped" | "hard_stopped_arrears" | "skipped_balance_hold";
  amountCents?: number;
  nextBillingAt?: Date;
  error?: string;
}

/**
 * PA-468: Atomically claim a due pod's current billing period.
 *
 * The double-charge bug was a time-of-check-to-time-of-use race: `/api/sync` read which
 * pods were due, did seconds of Stripe/HAI I/O, charged, and only THEN advanced
 * `prepaidUntil`. Two overlapping runs both saw the pod as due and both charged.
 *
 * This advances `prepaidUntil` up front with a compare-and-swap on the value we read
 * (`prepaidUntil` is the concurrency token). Whichever overlapping run flips it first
 * wins and must perform the period's side-effect (charge / stop) exactly once; the
 * loser's `updateMany` matches 0 rows and skips. `subscriptionId` is `@unique`, so the
 * write touches at most one row. `pod.prepaidUntil` may be null (never billed) — Prisma
 * turns that into `IS NULL`, so the null-init case is claimed too. Advances by exactly
 * one interval from the read value, preserving the existing per-pod catch-up cadence.
 *
 * @returns the new `prepaidUntil` if THIS run won the claim, or `null` if a concurrent
 * run already advanced it (caller must skip).
 */
async function claimBillingPeriod(
  pod: { subscriptionId: string; prepaidUntil: Date | null; hourlyRateCents: number | null },
  now: Date,
): Promise<Date | null> {
  const nextBillingAt = new Date((pod.prepaidUntil ?? now).getTime() + BILLING_INTERVAL_MINUTES * 60 * 1000);
  // The rate is part of the token: a row repriced after this run read it is not charged at the stale rate.
  const claim = await prisma.podMetadata.updateMany({
    where: { subscriptionId: pod.subscriptionId, prepaidUntil: pod.prepaidUntil, hourlyRateCents: pod.hourlyRateCents },
    data: { prepaidUntil: nextBillingAt },
  });
  return claim.count > 0 ? nextBillingAt : null;
}

export async function POST(request: NextRequest) {
  // Verify sync secret to prevent unauthorized calls
  const authHeader = request.headers.get("authorization");
  if (!SYNC_SECRET || authHeader !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = await getStripe();
  const now = new Date();
  const podResults: PodBillingResult[] = [];
  const customerRefills: Map<string, { refilled: boolean; amount?: number }> = new Map();

  // Get stopped instance rate configuration
  const stoppedInstanceRatePercent = getStoppedInstanceRatePercent();
  const storagePriceCentsPerGBHour = getStoragePricePerGBHourCents();

  // PA-644: accounts on the PA-410 internal exclusion lists bill at $0.00 —
  // usage still writes $0 WalletTransaction rows (auditable), but no Stripe
  // balance transaction is posted, and no enforcement (arrears hard-stop,
  // negative-balance termination, auto-refill) runs against them. Resolved
  // once per run; an unreadable email bills normally (prior behavior).
  const isInternalAccount = makeIsInternalOrExcluded(await getInternalExclusions());

  // === PER-RUN CACHES ===
  // Avoid calling hosted.ai multiple times for the same team within a single sync run.
  // Each getPoolSubscriptions call takes ~1-2s and hits the hosted.ai API.
  const subsCache = new Map<string, Awaited<ReturnType<typeof getPoolSubscriptions>>>();
  const volumeCache = new Map<string, Awaited<ReturnType<typeof getSharedVolumes>>>();

  async function getCachedSubs(teamId: string) {
    const cached = subsCache.get(teamId);
    if (cached) return cached;
    const result = await getPoolSubscriptions(teamId);
    subsCache.set(teamId, result);
    return result;
  }

  async function getCachedVolumes(teamId: string) {
    const cached = volumeCache.get(teamId);
    if (cached) return cached;
    const result = await getSharedVolumes(teamId);
    volumeCache.set(teamId, result);
    return result;
  }

  // Customers are read from customer_cache and resolved once per run; Stripe is
  // called only to confirm a customer this sweep is about to write to.
  const sweepCustomers = new Map<string, SweepCustomer | null>();

  async function primeCustomers(ids: Iterable<string>) {
    const missing = [...new Set(ids)].filter((id) => !sweepCustomers.has(id));
    if (missing.length === 0) return;
    const rows = await prisma.customerCache.findMany({
      where: { id: { in: missing }, isDeleted: false },
      select: { id: true, email: true, name: true, balanceCents: true, billingType: true, teamId: true, metadataJson: true },
    });
    for (const row of rows) sweepCustomers.set(row.id, fromCachedCustomer(row));
  }

  // The Stripe read of record. Every path that moves money or writes metadata goes
  // through this, never through the cached view.
  async function confirmCustomer(customerId: string): Promise<SweepCustomer | null> {
    try {
      const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
      if ("deleted" in customer && customer.deleted) {
        sweepCustomers.set(customerId, null);
        return null;
      }
      cacheCustomer(customer).catch(() => {});
      const resolved = fromStripeCustomer(customer);
      sweepCustomers.set(customerId, resolved);
      return resolved;
    } catch {
      sweepCustomers.set(customerId, null);
      return null;
    }
  }

  // Cached view, good enough to decide whether a customer is worth looking at.
  async function resolveCustomer(customerId: string): Promise<SweepCustomer | null> {
    const known = sweepCustomers.get(customerId);
    if (known !== undefined) return known;
    return confirmCustomer(customerId);
  }

  // Stopping a pod is an act, so the cached balance only decides whether to look —
  // Stripe decides whether the customer is really in arrears.
  async function confirmsArrears(customerId: string, debtToleranceCents: number): Promise<boolean> {
    const confirmed = await confirmCustomer(customerId);
    if (!confirmed) return false;
    if (confirmed.balanceCents > debtToleranceCents) return true;
    console.warn(`[Sync] Skipping arrears hard-stop for ${customerId}: balance no longer beyond tolerance on re-read (${confirmed.balanceCents}c)`);
    return false;
  }

  // A balance transaction returns the resulting balance, so later steps in this run
  // see the debit without another Stripe read.
  function noteBalance(customerId: string, balanceCents: number) {
    const known = sweepCustomers.get(customerId);
    if (known) sweepCustomers.set(customerId, { ...known, balanceCents });
    prisma.customerCache
      .update({ where: { id: customerId }, data: { balanceCents } })
      .catch(() => {});
  }

  try {
    // === STEP 0: BILLING RECONCILIATION ===
    // Only runs once per hour (not every sync cycle) to reduce hosted.ai API load.
    // Uses pool overview cache (local file) to detect orphaned subs without API calls.
    const reconciliationResults: Array<{
      customerId: string;
      subscriptionId: string;
      poolId: string;
      hourlyRateCents: number;
      action: string;
      productId?: string | null;
      reason?: "no_product" | "zero_rate";
    }> = [];

    // An active sub reconciliation cannot price is reported, never silently exempt.
    const reportUnmetered = (
      customerId: string,
      teamId: string,
      subscriptionId: string,
      poolId: string,
      product: ProductPricing | null,
      action: "skipped_unpriced" | "rate_not_backfilled",
    ) => {
      const reason = product ? "zero_rate" : "no_product";
      console.warn(`[Sync Reconcile] Not metering sub ${subscriptionId}: action=${action} reason=${reason} team=${teamId} pool=${poolId} product=${product?.id ?? "none"} customer=${customerId}`);
      reconciliationResults.push({
        customerId,
        subscriptionId,
        poolId,
        hourlyRateCents: 0,
        action,
        productId: product?.id ?? null,
        reason,
      });
    };

    const shouldReconcile = Date.now() - lastReconciliationRun >= RECONCILIATION_INTERVAL_MS;

    if (shouldReconcile) {
      lastReconciliationRun = Date.now();

      try {
        // Use pool overview cache to find all active pods (no hosted.ai API calls)
        const poolCache = readPoolOverviewCache();
        if (poolCache?.pools) {
          // Build map: teamId → list of active sub-like objects from the cache
          const activeTeamPods = new Map<string, Array<{ poolId: number; poolName: string; status: string }>>();
          for (const pool of poolCache.pools) {
            for (const pod of pool.pods || []) {
              if (pod.teamId && ["subscribed", "active", "running"].includes(pod.status)) {
                const arr = activeTeamPods.get(pod.teamId) || [];
                arr.push({ poolId: pool.id, poolName: pool.name, status: pod.status });
                activeTeamPods.set(pod.teamId, arr);
              }
            }
          }

          // Cross-check: for each team with active pods, check if all their subs have PodMetadata
          // Only call hosted.ai for teams that actually have gaps
          for (const [teamId, pods] of activeTeamPods) {
            // Find the customer for this team from our local DB
            // Include "free" customers — they may have active pods via voucher credit
            const customerCache = await prisma.customerCache.findFirst({
              where: { teamId, isDeleted: false },
            });
            if (!customerCache) continue;

            // Pull the HAI subs FIRST so we know which sub IDs to look up locally.
            // (Reordered from the previous flow so the global existence check below
            // has the canonical list of HAI sub IDs to query against.)
            let activeSubs: Awaited<ReturnType<typeof getPoolSubscriptions>>;
            try {
              activeSubs = await getCachedSubs(teamId);
            } catch (subErr) {
              console.error(`[Sync Reconcile] Error fetching subs for team ${teamId}:`, subErr);
              continue;
            }

            const activeSubIds = activeSubs
              .filter(s => s.status === "subscribed" || s.status === "active")
              .map(s => String(s.id));

            if (activeSubIds.length === 0) continue;

            // Existence check is GLOBAL across all customers. instance_id and
            // subscription_id are unique, so a HAI sub can only be claimed by one
            // row — but the claiming row may be owned by a different Stripe
            // customer (third-party payer for someone else's team). Scoping this
            // query to customerCache.id (the team owner) hid those rows and made
            // reconciliation create rogue hourly duplicates that silently flipped
            // monthly pods to hourly billing. See PA-209 / sync-reconciliation-
            // duplicate-rows memory.
            const existingMeta = await prisma.podMetadata.findMany({
              where: {
                OR: [
                  { subscriptionId: { in: activeSubIds } },
                  { subscriptionId: { in: activeSubIds.map(id => `instance-${id}`) } },
                  { instanceId: { in: activeSubIds } },
                ],
              },
              select: {
                subscriptionId: true,
                instanceId: true,
                stripeCustomerId: true,
                hourlyRateCents: true,
                billingType: true,
                managedBy: true,
              },
            });

            // Map every variant of a sub's storage shape back to the canonical
            // bare HAI sub id, so we can answer "does any row claim this sub?".
            const claimedSubIds = new Set<string>();
            for (const m of existingMeta) {
              if (m.instanceId) claimedSubIds.add(m.instanceId);
              if (m.subscriptionId.startsWith("instance-")) {
                claimedSubIds.add(m.subscriptionId.slice("instance-".length));
              } else {
                claimedSubIds.add(m.subscriptionId);
              }
            }

            // A team any monthly customer shares cannot say which subscription an unclaimed
            // pod belongs to, so those pods stay unbilled and are flagged here for ops.
            const teamCustomers = await prisma.customerCache.findMany({
              where: { teamId, isDeleted: false },
              select: { id: true, billingType: true },
            });
            const monthlyCustomer = teamCustomers.find(c => c.billingType === "monthly");
            if (monthlyCustomer) {
              const unclaimed = activeSubIds.filter(id => !claimedSubIds.has(id));
              if (unclaimed.length > 0) {
                console.warn(`[Sync Reconcile] Not adopting ${unclaimed.length} unclaimed pod(s) in team ${teamId}: monthly customer ${monthlyCustomer.id} shares it (${unclaimed.join(", ")})`);
              }
              continue;
            }

            // Force-flip the team owner's billing_type to "hourly" only if no row
            // for this team is explicitly monthly. Third-party-payer setups want
            // the team owner to stay on whatever they were (free/monthly) while
            // the actual billing happens via the payer's Stripe subscription.
            const hasMonthlyMetaForTeam = existingMeta.some(m => m.billingType === "monthly");
            if (customerCache.billingType !== "hourly" && !hasMonthlyMetaForTeam) {
              try {
                await stripe.customers.update(customerCache.id, {
                  metadata: { billing_type: "hourly" },
                });
                await prisma.customerCache.update({
                  where: { id: customerCache.id },
                  data: { billingType: "hourly" },
                });
                console.log(`[Sync Reconcile] Upgraded ${customerCache.id} (${customerCache.email}) billing_type from "${customerCache.billingType}" to "hourly" — has ${pods.length} active pod(s)`);
              } catch (upgradeErr) {
                console.error(`[Sync Reconcile] Failed to upgrade billing_type for ${customerCache.id}:`, upgradeErr);
              }
            }

            for (const sub of activeSubs) {
              if (sub.status !== "subscribed" && sub.status !== "active") continue;
              const subId = String(sub.id);

              if (claimedSubIds.has(subId)) {
                // Some row already claims this HAI sub. Only backfill a missing
                // rate if the row belongs to the team owner AND is explicitly
                // hourly (or unset, which we treat as hourly). Never touch a
                // monthly row or a row owned by a different customer.
                const own = existingMeta.find(m =>
                  (m.instanceId === subId
                    || m.subscriptionId === subId
                    || m.subscriptionId === `instance-${subId}`)
                  && m.stripeCustomerId === customerCache.id
                  && m.billingType !== "monthly"
                  && m.managedBy !== "engine"
                  && !m.hourlyRateCents
                );
                if (own) {
                  const product = await getProductByPoolId(sub.pool_id);
                  const rateCents = product?.hourly_rate_cents || 0;
                  if (rateCents > 0) {
                    const fullExisting = await prisma.podMetadata.findUnique({ where: { subscriptionId: own.subscriptionId } });
                    await prisma.podMetadata.update({
                      where: { subscriptionId: own.subscriptionId },
                      data: {
                        hourlyRateCents: rateCents,
                        poolId: fullExisting?.poolId || String(sub.pool_id),
                        productId: fullExisting?.productId || product?.id || null,
                        ...(fullExisting?.prepaidUntil ? {} : { prepaidUntil: now }),
                      },
                    });
                    console.log(`[Sync Reconcile] Updated PodMetadata for sub ${subId} - set rate to $${(rateCents / 100).toFixed(2)}/hr`);
                    reconciliationResults.push({
                      customerId: customerCache.id,
                      subscriptionId: own.subscriptionId,
                      poolId: String(sub.pool_id),
                      hourlyRateCents: rateCents,
                      action: "updated",
                    });
                  } else {
                    reportUnmetered(customerCache.id, teamId, own.subscriptionId, String(sub.pool_id), product, "rate_not_backfilled");
                  }
                }
                continue;
              }

              // Truly orphaned — no pod_metadata row exists anywhere for this HAI
              // sub. Create one under the team owner with the hourly product rate.
              const product = await getProductByPoolId(sub.pool_id);
              const rateCents = product?.hourly_rate_cents || 0;
              if (rateCents === 0) {
                reportUnmetered(customerCache.id, teamId, subId, String(sub.pool_id), product, "skipped_unpriced");
                continue;
              }

              await prisma.podMetadata.create({
                data: {
                  subscriptionId: subId,
                  stripeCustomerId: customerCache.id,
                  displayName: sub.pool_name || null,
                  hourlyRateCents: rateCents,
                  poolId: String(sub.pool_id),
                  productId: product?.id || null,
                  prepaidUntil: now,
                },
              });
              console.log(`[Sync Reconcile] Created PodMetadata for orphaned sub ${subId} @ $${(rateCents / 100).toFixed(2)}/hr`);
              reconciliationResults.push({
                customerId: customerCache.id,
                subscriptionId: subId,
                poolId: String(sub.pool_id),
                hourlyRateCents: rateCents,
                action: "created",
              });
            }
          }
        }

        const fixedCount = reconciliationResults.filter(r => !r.reason).length;
        if (fixedCount > 0) {
          console.log(`[Sync Reconcile] Fixed ${fixedCount} orphaned subscription(s)`);
        }
      } catch (reconcileErr) {
        console.error("[Sync Reconcile] Error during reconciliation:", reconcileErr);
      }
    } else {
      console.log(`[Sync] Skipping reconciliation (last ran ${Math.round((Date.now() - lastReconciliationRun) / 60000)}m ago, interval=${RECONCILIATION_INTERVAL_MS / 60000}m)`);
    }

    // === STEP 1: PER-POD BILLING ===
    // Find all pods where prepaidUntil <= now (their billing is due)
    // Also include pods where prepaidUntil is null (never billed after initial deployment)
    const podsDue = await prisma.podMetadata.findMany({
      where: {
        OR: [
          { prepaidUntil: { lte: now } },
          { prepaidUntil: null }, // Pods that were never properly initialized for billing
        ],
        hourlyRateCents: { gt: 0 }, // Must have a rate configured
        managedBy: { not: "engine" }, // engine-launched pods are billed by packet-api alone
      },
    });

    console.log(`[Sync] Found ${podsDue.length} pods due for billing`);

    // An instance a monthly subscription pays for is never also metered, whichever
    // row shape the metered duplicate was written in.
    const instanceKey = (p: { instanceId: string | null; subscriptionId: string }) =>
      p.instanceId ?? p.subscriptionId.replace(/^instance-/, "");
    const dueKeys = [...new Set(podsDue.map(instanceKey))];
    const monthlyClaims = dueKeys.length === 0 ? [] : await prisma.podMetadata.findMany({
      where: {
        billingType: "monthly",
        OR: [
          { instanceId: { in: dueKeys } },
          { subscriptionId: { in: dueKeys.map(k => `instance-${k}`) } },
        ],
      },
      select: { instanceId: true, subscriptionId: true },
    });
    const monthlyInstances = new Set(monthlyClaims.map(instanceKey));

    // One cache read covers every customer in this step, however many pods each holds.
    await primeCustomers(podsDue.map(p => p.stripeCustomerId));

    // Build product -> poolId lookup for HAI 2.2 pods that have no poolId
    const productPoolMap = new Map<string, number>();
    const podsNeedPoolId = podsDue.some(p => !p.poolId && p.productId);
    if (podsNeedPoolId) {
      // Keyed by product id, for pods that already exist — sale state is not the
      // question, and filtering on it drops a withdrawn plan's pods from billing.
      const products = await prisma.gpuProduct.findMany({
        select: { id: true, poolIds: true },
      });
      for (const p of products) {
        try {
          const pids: number[] = JSON.parse(p.poolIds);
          if (pids.length > 0) productPoolMap.set(p.id, pids[0]);
        } catch { /* skip malformed */ }
      }
    }

    for (const pod of podsDue) {
      try {
        // A refunded failed deploy is terminal — never charge it again, even
        // when the instance survived the delete and HAI reports it running.
        if (pod.deployStatus === "failed_refunded") {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: deploy failed and was refunded`);
          continue;
        }

        if (pod.billingType === "monthly" || monthlyInstances.has(instanceKey(pod))) {
          console.warn(`[Sync] Skipping pod ${pod.subscriptionId}: instance ${instanceKey(pod)} is paid for by a monthly subscription`);
          continue;
        }

        // Stripe balance is positive when the customer OWES (in arrears). null =
        // unreadable customer → the hard stop below fails open.
        const podCustomer = await resolveCustomer(pod.stripeCustomerId);
        const customerEmail = podCustomer?.email || "unknown";
        const customerBalanceCents: number | null = podCustomer ? podCustomer.balanceCents : null;

        // Verify the subscription is still active
        const teamId = podCustomer?.metadata?.hostedai_team_id || null;
        if (!teamId) {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: no team ID for customer`);
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "error",
            error: "No team ID for customer",
          });
          continue;
        }

        // PA-644: internal accounts bill this pod at $0.00.
        const internalZeroBill = customerEmail !== "unknown" && isInternalAccount(customerEmail);

        // Check if subscription still exists and is active (uses per-run cache)
        const subscriptions = await getCachedSubs(teamId);
        // Match by instanceId first (HAI 2.2), fall back to subscriptionId (legacy)
        const subscription = pod.instanceId
          ? subscriptions.find(s => s.id === pod.instanceId)
          : subscriptions.find(s => String(s.id) === pod.subscriptionId);

        if (!subscription || (subscription.status !== "subscribed" && subscription.status !== "active")) {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: subscription not active (status: ${subscription?.status || "not found"})`);
          // SAFETY: Never delete pod_metadata — just skip billing
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "error",
            error: `Subscription not active: ${subscription?.status || "not found"}`,
          });
          continue;
        }

        // Check if pod is actually running — stopped/paused pods are billed separately at reduced rate
        // Ref: Confluence HP/600178689 — billable-at-full-rate statuses
        const FULL_RATE_STATUSES = ["running", "active", "restarting", "stopping", "resizing", "succeeded"];
        const podStatuses = (subscription.pods || []).map((p: { pod_status?: string }) => (p.pod_status || "").toLowerCase());
        const hasRunningPod = podStatuses.some((s: string) => FULL_RATE_STATUSES.includes(s));
        if (!hasRunningPod && podStatuses.length > 0) {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: no running pods (statuses: ${podStatuses.join(", ")}). Will be billed at stopped rate.`);
          // Still advance prepaidUntil so we don't re-check every cycle.
          // PA-468: CAS claim so two overlapping runs can't both advance this pod
          // (race parity with the charge path below).
          if (!(await claimBillingPeriod(pod, now))) {
            console.log(`[Sync] Skipping stopped pod ${pod.subscriptionId}: slot already claimed by a concurrent run`);
            continue;
          }
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "skipped_stopped",
            amountCents: 0,
          });
          continue;
        }

        // PA-339: HARD STOP — if this running pod's customer arrives at a billing
        // cycle already in arrears beyond tolerance, stop the pod instead of
        // billing it deeper into the negative (the reported bug: a $1000/hr pod ran
        // overnight to -$245 with no stop). Checked BEFORE the charge, so a customer
        // still in credit is never stopped — they get billed, then STEP 2's
        // auto-refill tops them up; only a customer already owing money with no
        // refill safety net trips this. Fails open when the balance is unknown, and
        // uses stopInstance (a reversible stop), not STEP 3's destructive delete.
        // PA-644: internal accounts are exempt — any arrears are historical
        // (they bill $0 from here on), so never stop their pods over it.
        const debtToleranceCents = getHardStopDebtToleranceCents();
        if (!internalZeroBill && customerBalanceCents !== null && customerBalanceCents > debtToleranceCents
            && await confirmsArrears(pod.stripeCustomerId, debtToleranceCents)) {
          // An invoice generator neutralizes the balance while it finalizes, and
          // overlapping holds read POSITIVE — a funded customer looking in arrears.
          const { hasInFlightBalanceHold } = await import("@/lib/invoice");
          if (await hasInFlightBalanceHold(stripe, pod.stripeCustomerId)) {
            console.warn(`[Sync] Skipping arrears hard-stop for pod ${pod.subscriptionId}: an invoice balance hold is in flight, balance is not authoritative`);
            podResults.push({
              subscriptionId: pod.subscriptionId,
              customerId: pod.stripeCustomerId,
              email: customerEmail,
              status: "skipped_balance_hold",
              amountCents: 0,
            });
            continue;
          }
          // PA-468: claim the slot BEFORE stopping, so two overlapping runs don't both
          // stop and advance. The loser skips — the winner has already handled arrears
          // for this cycle. Advancing here also prevents reprocessing (or re-stopping)
          // every cycle; STEP 2 then bills it at the stopped rate until the customer
          // tops up and restarts it.
          if (!(await claimBillingPeriod(pod, now))) continue;
          console.warn(`[Sync] Hard-stopping pod ${pod.subscriptionId}: customer in arrears (${customerBalanceCents}c owed > ${debtToleranceCents}c tolerance)`);
          try {
            const { stopInstance } = await import("@/lib/hostedai");
            await stopInstance(String(subscription.id));
          } catch (e) {
            console.error(`[Sync] Failed to stop pod ${pod.subscriptionId} for arrears:`, e);
          }
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "hard_stopped_arrears",
            amountCents: 0,
          });
          continue;
        }

        // Calculate GPU count from subscription (round up, minimum 1 — no fractional GPU billing)
        const gpuCount = Math.max(1, Math.ceil(subscription.per_pod_info?.vgpu_count || 1));

        // Calculate cost for 30 minutes.
        // hourlyRateCents is the WHOLE-INSTANCE rate — a "2 x A100" product is priced
        // for both GPUs (see GpuProduct catalog), so the GPU count is already baked in.
        // Bill rate × hours, NOT × gpuCount; gpuCount (live vgpu_count) is kept for the
        // description/metadata only. Multiplying would double-bill any pod HAI reports
        // with vgpu_count > 1.
        const hoursToCharge = BILLING_INTERVAL_MINUTES / 60; // 0.5 hours
        // PA-644: internal accounts accrue $0.00 — the ledger row below still
        // records the real rate so the waived usage stays auditable.
        const amountCents = internalZeroBill ? 0 : Math.round(hoursToCharge * pod.hourlyRateCents!);

        // PA-468: atomically claim this billing period BEFORE charging. Whichever
        // overlapping sync run advances prepaidUntil first owns the charge; the loser's
        // CAS matches 0 rows and skips here. This is the fix for the double-charge race —
        // the idempotency marker is advanced up front, not after the charge. If the Stripe
        // charge below throws after the claim, the safe failure is a MISSED charge for this
        // period (customer under-billed), never a double charge.
        const nextBillingAt = await claimBillingPeriod(pod, now);
        if (!nextBillingAt) {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: billing slot already claimed by a concurrent run`);
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "billed",
            amountCents: 0,
            error: "slot already claimed by concurrent run",
          });
          continue;
        }

        // Deduplication id, keyed on the billing PERIOD (not the per-run clock) so the
        // Stripe dedup guard below also catches cross-run duplicates as a second layer (PA-468).
        const chargeId = `pod_${pod.subscriptionId}_${(pod.prepaidUntil ?? now).getTime()}`;

        const chargeDescription = `GPU usage: ${gpuCount} GPU(s) x ${BILLING_INTERVAL_MINUTES} mins @ $${(pod.hourlyRateCents! / 100).toFixed(2)}/hr`;

        if (internalZeroBill) {
          console.log(`[Sync] Internal account ${customerEmail}: $0.00 billing for pod ${pod.subscriptionId} (PA-644)`);
        } else {
          // Check for duplicate charges in last 5 minutes
          const recentTxns = await stripe.customers.listBalanceTransactions(pod.stripeCustomerId, {
            limit: 10,
          });
          const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
          const duplicate = recentTxns.data.find(
            txn => txn.metadata?.pod_billing_id === chargeId && txn.created > fiveMinutesAgo
          );

          if (duplicate) {
            console.log(`[Sync] Skipping duplicate charge for pod ${pod.subscriptionId}`);
            podResults.push({
              subscriptionId: pod.subscriptionId,
              customerId: pod.stripeCustomerId,
              email: customerEmail,
              status: "billed",
              amountCents: 0,
              error: "Already billed in this cycle",
            });
            continue;
          }

          // Create the charge
          const posted = await stripe.customers.createBalanceTransaction(pod.stripeCustomerId, {
            amount: amountCents,
            currency: "usd",
            description: chargeDescription,
            metadata: {
              subscription_id: pod.subscriptionId,
              gpu_count: gpuCount.toString(),
              hourly_rate_cents: pod.hourlyRateCents!.toString(),
              billing_minutes: BILLING_INTERVAL_MINUTES.toString(),
              pod_billing_id: chargeId,
            },
          });
          if (typeof posted?.ending_balance === "number") {
            noteBalance(pod.stripeCustomerId, posted.ending_balance);
          }
        }

        // Resolve poolId: prefer pod.poolId, fall back to product's poolIds[0]
        let resolvedPoolId: number | null = pod.poolId ? parseInt(pod.poolId, 10) || null : null;
        if (resolvedPoolId === null && pod.productId) {
          resolvedPoolId = productPoolMap.get(pod.productId) ?? null;
          // Backfill PodMetadata so future cycles don't need the lookup
          if (resolvedPoolId !== null) {
            prisma.podMetadata.update({
              where: { subscriptionId: pod.subscriptionId },
              data: { poolId: String(resolvedPoolId) },
            }).catch(e => console.error(`[Sync] Failed to backfill poolId for ${pod.subscriptionId}:`, e));
          }
        }

        // Log to local WalletTransaction table
        await prisma.walletTransaction.create({
          data: {
            stripeCustomerId: pod.stripeCustomerId,
            teamId,
            type: "gpu_usage",
            amountCents,
            description: chargeDescription,
            subscriptionId: pod.subscriptionId,
            poolId: resolvedPoolId,
            gpuCount,
            hourlyRateCents: pod.hourlyRateCents!,
            billingMinutes: BILLING_INTERVAL_MINUTES,
            syncCycleId: chargeId,
          },
        }).catch((e) => console.error(`[Sync] Failed to log WalletTransaction for pod ${pod.subscriptionId}:`, e));

        // prepaidUntil was already advanced by claimBillingPeriod() above (PA-468) —
        // do NOT advance it again here, or a re-advance would reopen the race.
        console.log(`[Sync] Billed pod ${pod.subscriptionId}: $${(amountCents / 100).toFixed(2)} for ${gpuCount} GPU(s). Prepaid until ${nextBillingAt.toISOString()} (period claimed before charge — PA-468).`);

        podResults.push({
          subscriptionId: pod.subscriptionId,
          customerId: pod.stripeCustomerId,
          email: customerEmail,
          status: "billed",
          amountCents,
          nextBillingAt,
        });

        // GA4 + PostHog: gpu_session_hours — GPU usage billed (hours consumed).
        // Internal accounts are excluded from metrics (PA-410), so skip.
        if (internalZeroBill) continue;
        const sessionHours = BILLING_INTERVAL_MINUTES / 60;
        trackGA4Event(pod.stripeCustomerId, "gpu_session_hours", {
          value: amountCents / 100,
          hours: sessionHours,
          gpu_count: gpuCount,
        }).catch(() => {});
        posthogTrackEvent(pod.stripeCustomerId, "gpu_session_hours", {
          value: amountCents / 100,
          hours: sessionHours,
          gpu_count: gpuCount,
        }).catch(() => {});
      } catch (error) {
        console.error(`[Sync] Error billing pod ${pod.subscriptionId}:`, error);
        podResults.push({
          subscriptionId: pod.subscriptionId,
          customerId: pod.stripeCustomerId,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // === STEP 2: STORAGE BILLING ===
    // Storage is still billed per-customer at fixed intervals (every 30 mins)
    // Get unique customers from pods we processed
    const customersToProcess = new Set(podResults.map(r => r.customerId));

    // Also add customers with active pods that weren't due
    const allActivePods = await prisma.podMetadata.findMany({
      where: { hourlyRateCents: { gt: 0 } },
      select: { stripeCustomerId: true },
    });
    allActivePods.forEach(p => customersToProcess.add(p.stripeCustomerId));

    // A shared volume outlives the pods that created it, and terminating an instance
    // deletes its pod_metadata row — so storage candidates come from the customer table.
    const storageCandidates = await prisma.customerCache.findMany({
      where: { billingType: "hourly", isDeleted: false, teamId: { not: null } },
      select: { id: true, teamId: true },
    });
    storageCandidates
      .filter(c => !!c.teamId)
      .forEach(c => customersToProcess.add(c.id));

    const storageResults: Array<{
      customerId: string;
      storageGb: number;
      storageCostCents: number;
    }> = [];

    const stoppedResults: Array<{
      customerId: string;
      stoppedGpuCount: number;
      stoppedCostCents: number;
    }> = [];

    // One cache read covers the whole storage/stopped sweep.
    await primeCustomers(customersToProcess);

    for (const customerId of customersToProcess) {
      try {
        const nowSec = Math.floor(Date.now() / 1000);

        // The cached view only decides whether this customer is worth a Stripe call:
        // one metered recently, or not on hourly billing, costs none at all.
        const cached = await resolveCustomer(customerId);
        if (!cached) continue;
        if (cached.metadata?.billing_type !== "hourly") continue;
        if (!cached.metadata?.hostedai_team_id) continue;
        if (storageSyncedRecently(cached.metadata?.last_storage_sync_timestamp, nowSec)) continue;

        // Metering reads and writes the sub-cent accumulator, so past this point the
        // sweep works from Stripe's own record, never the cached copy.
        const customer = await confirmCustomer(customerId);
        if (!customer) continue;
        if (customer.metadata?.billing_type !== "hourly") continue;

        const teamId = customer.metadata?.hostedai_team_id;
        if (!teamId) continue;

        const lastStorageSync = customer.metadata?.last_storage_sync_timestamp;
        if (storageSyncedRecently(lastStorageSync, nowSec)) continue;

        // Internal accounts get $0 ledger rows, no Stripe charges and no refill.
        const internalZeroBill = !!customer.email && isInternalAccount(customer.email);

        // The sync timestamp and the accumulator land in one write per customer per
        // window, carrying only the keys this sweep owns.
        const metadataWrite: Record<string, string> = { last_storage_sync_timestamp: nowSec.toString() };
        let metadataFlushed = false;
        const flushCustomerMetadata = async () => {
          if (metadataFlushed) return;
          metadataFlushed = true;
          const updated = await stripe.customers.update(customerId, { metadata: metadataWrite });
          cacheCustomer(updated as Stripe.Customer).catch(() => {});
        };

        // === Storage billing ===
        let totalStorageGb = 0;
        try {
          const allVolumes = await getCachedVolumes(teamId);
          const filteredVolumes = allVolumes.filter(vol => vol.team_id === teamId);
          const volumeMap = new Map<number, typeof filteredVolumes[0]>();
          for (const vol of filteredVolumes) {
            if (!volumeMap.has(vol.id)) {
              volumeMap.set(vol.id, vol);
            }
          }
          for (const vol of volumeMap.values()) {
            totalStorageGb += vol.size_in_gb || 0;
          }

          if (totalStorageGb > 0) {
            // Sub-cent accumulator: carry fractional cents forward across intervals,
            // only post a Stripe charge when the running balance crosses 1¢. This
            // removes the $14.60/mo minimum-charge floor caused by Math.round on
            // each 30-min interval. See PA-159 and src/lib/storage-billing.ts.
            // Accrue on real elapsed wall-clock since the last metering, not a
            // fixed 30-min nominal. Storage syncs fire every ~25-30 min (25-min
            // gate above), so a fixed interval over-bills and inflates the
            // "avg GB" label vs the real-clock window. See PA-168.
            const lastSyncSec = lastStorageSync ? parseInt(lastStorageSync, 10) : null;
            const hoursInInterval = storageIntervalHours(
              nowSec,
              lastSyncSec,
              BILLING_INTERVAL_MINUTES,
              BILLING_INTERVAL_MINUTES * 2,
            );
            const meta = customer.metadata ?? {};
            const prevPendingCents = parseFloat(meta.storage_pending_cents ?? "") || 0;
            const prevPendingGbHours = parseFloat(meta.storage_pending_gb_hours ?? "") || 0;
            const prevWindowStart = parseInt(meta.storage_window_started_at ?? "", 10);
            // Reject a window start in the future (clock skew / corrupted metadata):
            // it would collapse windowHours toward zero and render an absurd avg GB.
            const windowStartedAt = Number.isFinite(prevWindowStart) && prevWindowStart > 0 && prevWindowStart <= nowSec
              ? prevWindowStart
              : nowSec - BILLING_INTERVAL_MINUTES * 60;

            const result = computeStorageCharge(
              { pendingCents: prevPendingCents, pendingGbHours: prevPendingGbHours, windowStartedAt },
              totalStorageGb,
              storagePriceCentsPerGBHour,
              hoursInInterval,
              nowSec,
            );

            // Persist accumulator state (always, charge or not), before the charge.
            metadataWrite.storage_pending_cents = result.newState.pendingCents.toFixed(8);
            metadataWrite.storage_pending_gb_hours = result.newState.pendingGbHours.toFixed(4);
            metadataWrite.storage_window_started_at = result.newState.windowStartedAt.toString();
            await flushCustomerMetadata();

            if (result.charge) {
              // Internal accounts skip the Stripe charge; the ledger row below is
              // written at $0 so storage usage stays visible.
              if (!internalZeroBill) {
                const posted = await stripe.customers.createBalanceTransaction(customerId, {
                  amount: result.charge.cents,
                  currency: "usd",
                  description: result.charge.description,
                  metadata: {
                    storage_gb: totalStorageGb.toString(),
                    billing_type: "storage",
                    window_started_at: result.charge.windowStartedAt.toString(),
                    window_ended_at: result.charge.windowEndedAt.toString(),
                    avg_gb: result.charge.avgGb.toString(),
                  },
                });
                if (typeof posted?.ending_balance === "number") {
                  noteBalance(customerId, posted.ending_balance);
                }
              }

              const storageCents = internalZeroBill ? 0 : result.charge.cents;
              const windowMinutes = Math.max(1, Math.round((result.charge.windowEndedAt - result.charge.windowStartedAt) / 60));
              await prisma.walletTransaction.create({
                data: {
                  stripeCustomerId: customerId,
                  teamId,
                  type: "storage",
                  amountCents: storageCents,
                  description: result.charge.description,
                  billingMinutes: windowMinutes,
                },
              }).catch((e) => console.error(`[Sync] Failed to log storage WalletTransaction for ${customerId}:`, e));

              storageResults.push({ customerId, storageGb: totalStorageGb, storageCostCents: storageCents });
            }
          }
        } catch (storageErr) {
          console.error(`Error billing storage for ${customerId}:`, storageErr);
        }

        // A customer with no storage, or whose volumes were unreadable, still advances
        // the sync timestamp so the next cycle skips them without a Stripe call.
        await flushCustomerMetadata().catch((e) =>
          console.error(`[Sync] Failed to persist storage sync metadata for ${customerId}:`, e));

        // === Stopped instance billing ===
        // Bill each stopped/paused/reserved pod at ITS OWN per-GPU rate × the
        // configured stopped percentage — mirroring the running-charge path.
        // (Previously this averaged hourlyRateCents across the whole fleet, so a
        // single expensive or stale terminated pod overcharged cheap stopped
        // ones — e.g. a stopped $100/hr GPU billed $751.90. See stopped-billing.ts.)
        let stoppedGpuCount = 0;
        try {
          // Per-GPU rate lookup, keyed by every id shape a HAI sub takes in
          // PodMetadata (bare id, "instance-<id>", and instanceId).
          const podMetaRows = await prisma.podMetadata.findMany({
            where: { stripeCustomerId: customerId, hourlyRateCents: { gt: 0 }, managedBy: { not: "engine" } },
            select: { subscriptionId: true, instanceId: true, hourlyRateCents: true },
          });
          const rateBySubId = new Map<string, number>();
          for (const m of podMetaRows) {
            const rate = m.hourlyRateCents || 0;
            if (rate <= 0) continue;
            const bare = m.subscriptionId.startsWith("instance-")
              ? m.subscriptionId.slice("instance-".length)
              : m.subscriptionId;
            rateBySubId.set(m.subscriptionId, rate);
            rateBySubId.set(bare, rate);
            if (m.instanceId) rateBySubId.set(String(m.instanceId), rate);
          }

          const allSubscriptions = await getCachedSubs(teamId);
          const subMap = new Map<string | number, typeof allSubscriptions[0]>();
          for (const sub of allSubscriptions) {
            if (!subMap.has(sub.id)) subMap.set(sub.id, sub);
          }
          const processedPods = new Set<string>();
          const stoppedPods: Array<StoppedPodInput & { poolId: number | null }> = [];

          for (const sub of subMap.values()) {
            if (sub.status !== "subscribed" && sub.status !== "active") continue;
            if (!sub.pods || sub.pods.length === 0) continue;

            const subId = String(sub.id);
            const podRateCents =
              rateBySubId.get(subId) ?? rateBySubId.get(`instance-${subId}`) ?? 0;
            const subPoolId = Number.parseInt(String(sub.pool_id), 10);

            for (const pod of sub.pods) {
              const podKey = pod.pod_name || `${sub.id}-${pod.pod_status}`;
              if (processedPods.has(podKey)) continue;
              processedPods.add(podKey);

              const podStatus = (pod.pod_status || "").toLowerCase();
              if (podStatus === "stopped" || podStatus === "paused" || podStatus === "reserved") {
                // Surface revenue gaps: a stopped pod with no PodMetadata rate is
                // not billed (computeStoppedCharge skips it) — log so it's visible.
                if (podRateCents <= 0) {
                  console.warn(`[Sync] Stopped pod ${podKey} (sub ${subId}) has no rate in PodMetadata — not billed`);
                }
                stoppedPods.push({
                  gpuCount: pod.gpu_count || sub.per_pod_info?.vgpu_count || 1,
                  podHourlyRateCents: podRateCents,
                  poolId: Number.isFinite(subPoolId) ? subPoolId : null,
                });
              }
            }
          }

          const charge = computeStoppedCharge(
            stoppedPods,
            stoppedInstanceRatePercent,
            BILLING_INTERVAL_MINUTES,
          );
          stoppedGpuCount = charge.stoppedGpuCount;
          const stoppedCostCents = charge.stoppedCostCents;

          if (stoppedCostCents > 0) {
            // Dedup guard: unlike the running path (idempotent per interval via
            // prepaidUntil), the stopped path bills every run. If two cron runs
            // race the 25-min storage-sync gate (or a brand-new customer has no
            // timestamp yet), a stopped pod could be billed twice. Skip if we
            // already posted a stopped-reservation charge in the last 5 minutes.
            // PA-644: internal accounts skip the Stripe charge and its dedup
            // read ($0 rows are written below; a duplicate $0 row on a rare
            // racing run is harmless).
            const recentStoppedTxns = internalZeroBill
              ? []
              : (await stripe.customers.listBalanceTransactions(customerId, { limit: 20 })).data;
            if (wasStoppedBilledRecently(recentStoppedTxns, nowSec, 5 * 60)) {
              console.log(`[Sync] Skipping duplicate stopped-reservation charge for ${customerId} (already billed in last 5m)`);
            } else {
              const stoppedDesc = `Reserved: ${stoppedGpuCount} GPU(s) stopped @ ${stoppedInstanceRatePercent}%`;
              if (!internalZeroBill) {
                const posted = await stripe.customers.createBalanceTransaction(customerId, {
                  amount: stoppedCostCents,
                  currency: "usd",
                  description: stoppedDesc,
                  metadata: {
                    stopped_gpu_count: stoppedGpuCount.toString(),
                    billing_type: "stopped_reservation",
                  },
                });
                if (typeof posted?.ending_balance === "number") {
                  noteBalance(customerId, posted.ending_balance);
                }
              }

              // Log stopped reservation charge locally — one row PER POOL
              // (tagged with poolId so scoped reports can attribute it), each
              // priced as the pool's own charge with the same math as the
              // Stripe charge above (which stays whole-fleet, untouched).
              // Usually one pool → one row equal to the Stripe charge.
              await Promise.all(
                stoppedPoolCharges(stoppedPods, stoppedInstanceRatePercent, BILLING_INTERVAL_MINUTES).map((s) =>
                  prisma.walletTransaction.create({
                    data: {
                      stripeCustomerId: customerId,
                      teamId,
                      type: "stopped_reservation",
                      amountCents: internalZeroBill ? 0 : s.amountCents,
                      description: stoppedDesc,
                      poolId: s.poolId,
                      gpuCount: s.gpuCount,
                      billingMinutes: BILLING_INTERVAL_MINUTES,
                    },
                  }).catch((e) => console.error(`[Sync] Failed to log stopped WalletTransaction for ${customerId}:`, e)),
                ),
              );

              stoppedResults.push({ customerId, stoppedGpuCount, stoppedCostCents: internalZeroBill ? 0 : stoppedCostCents });
            }
          }
        } catch (stoppedErr) {
          console.error(`Error billing stopped instances for ${customerId}:`, stoppedErr);
        }

        // === Wallet refill check ===
        // PA-644: never touch an internal account's card — they bill $0.
        if (!internalZeroBill && !customerRefills.has(customerId)) {
          const refillResult = await checkAndRefillWallet(customerId);
          customerRefills.set(customerId, refillResult);
        }
      } catch (customerErr) {
        console.error(`Error processing customer ${customerId}:`, customerErr);
      }
    }

    // === STEP 3: NEGATIVE BALANCE ENFORCEMENT ===
    // Check all customers for negative balance and terminate resources
    const negativeBalanceResults: Array<{
      customerId: string;
      email: string;
      balanceCents: number;
      podsTerminated: string[];
      volumesScheduledForDeletion: number[];
    }> = [];

    // Enforcement is pod-backed, not storage-backed: only a customer holding an
    // hourly-rated instance has anything to suspend.
    const allCustomersToCheck = new Set<string>();
    podResults.forEach(r => allCustomersToCheck.add(r.customerId));
    allActivePods.forEach(p => allCustomersToCheck.add(p.stripeCustomerId));

    // PA-325: used to reject a transiently-wrong balance before the irreversible
    // termination below (a customer's live balance can briefly read positive
    // while an invoice generation holds it — see hasInFlightBalanceHold).
    const { hasInFlightBalanceHold } = await import("@/lib/invoice");

    await primeCustomers(allCustomersToCheck);

    for (const customerId of allCustomersToCheck) {
      try {
        // The cached balance only decides who to look at; the Stripe re-read below
        // is what any termination is actually taken on.
        const cached = await resolveCustomer(customerId);
        if (!cached) continue;
        if (cached.metadata?.billing_type !== "hourly") continue;

        // Internal accounts are exempt from enforcement — they bill $0 going
        // forward, so any arrears are historical; never terminate.
        if (cached.email && isInternalAccount(cached.email)) continue;

        // Check balance: positive = owes money (negative wallet), negative = has credit
        // If balance > 0, customer owes us money (negative wallet balance)
        const balanceCents = cached.balanceCents;

        if (balanceCents > 0) {
          // One read of the customer's pods decides both who is enforced and
          // what may be terminated, so the two can never disagree.
          const metas = await prisma.podMetadata.findMany({
            where: { stripeCustomerId: customerId },
            select: { subscriptionId: true, instanceId: true, billingType: true, stripeSubscriptionId: true, hourlyRateCents: true, managedBy: true },
          });
          // Enforcement needs a wallet-funded hourly workload to apply to; a
          // monthly-only customer can carry stale hourly metadata in Stripe.
          const hourlyPods = metas.filter(isHourlyWorkload).length;
          if (hourlyPods === 0) continue;

          // PA-325: terminating pods + emailing "balance gone negative" is
          // irreversible, so never act on a balance that is still mutating. A
          // customer's live Stripe balance can read transiently positive while
          // an invoice generation holds it at 0 (concurrent holds can briefly
          // overshoot positive). Skip this customer for this cycle if a balance
          // hold is in flight, or if a fresh re-read no longer shows a positive
          // balance — the next sync run enforces once the balance is stable.
          if (await hasInFlightBalanceHold(stripe, customerId)) {
            console.warn(`[Sync] Skipping negative-balance enforcement for ${customerId}: an invoice balance hold is in flight, balance is not authoritative`);
            continue;
          }
          const customer = await confirmCustomer(customerId);
          const confirmedBalanceCents = customer ? customer.balanceCents : 0;
          if (!customer || confirmedBalanceCents <= 0) {
            console.warn(`[Sync] Skipping negative-balance enforcement for ${customerId}: balance no longer positive on re-read (was ${balanceCents}c, now ${confirmedBalanceCents}c) — transient`);
            continue;
          }

          console.log(`[Sync] Customer ${customerId} has negative balance: owes $${(confirmedBalanceCents / 100).toFixed(2)} (${hourlyPods} hourly pod(s))`);

          const teamId = customer.metadata?.hostedai_team_id;
          if (!teamId) continue;

          const terminatedPods: string[] = [];
          const scheduledVolumes: number[] = [];
          // Monthly-subscription pods are paid via Stripe, not the wallet, so a
          // depleted wallet must not kill them; survivors also hold the storage.
          let keptPods = 0;

          try {
            const subscriptions = await getCachedSubs(teamId);

            // Key each sub's billing type by both the unified instance id and the
            // subscription id, since either can be sub.id.
            const metaByKey = new Map<string, PodBilling>();
            const engineKeys = new Set<string>();
            for (const m of metas) {
              const b: PodBilling = { billingType: m.billingType, stripeSubscriptionId: m.stripeSubscriptionId };
              if (m.subscriptionId) metaByKey.set(m.subscriptionId, b);
              if (m.instanceId) metaByKey.set(m.instanceId, b);
              if (m.managedBy === "engine") {
                if (m.subscriptionId) engineKeys.add(m.subscriptionId);
                if (m.instanceId) engineKeys.add(m.instanceId);
              }
            }

            // HAI 2.2: use deleteInstance instead of dead unsubscribeFromPool
            const { deleteInstance } = await import("@/lib/hostedai");
            for (const sub of subscriptions) {
              if (sub.status === "subscribed" || sub.status === "active" || sub.status === "subscribing") {
                // Engine-launched pods live and die by packet-api's own arrears
                // handling — terminating them here would race it.
                if (engineKeys.has(String(sub.id))) {
                  keptPods++;
                  console.log(`[Sync] Keeping engine-managed instance ${sub.id} for negative-balance customer ${customerId} (packet-api owns its billing)`);
                  continue;
                }
                const billingClass = classifyPodBilling(metaByKey.get(String(sub.id)));
                if (billingClass === "monthly") {
                  keptPods++;
                  console.log(`[Sync] Keeping monthly-subscription instance ${sub.id} for negative-balance customer ${customerId} (covered by Stripe subscription, not wallet)`);
                  continue;
                }
                if (billingClass === "unknown") {
                  keptPods++;
                  logUnclassifiedSkip("Sync", String(sub.id), `no billing metadata for negative-balance customer ${customerId}`);
                  continue;
                }
                try {
                  console.log(`[Sync] Terminating hourly instance ${sub.id} for negative balance customer ${customerId}`);
                  await deleteInstance(String(sub.id));
                  terminatedPods.push(String(sub.id));

                  // SAFETY: Never delete pod_metadata — mark it as terminated instead
                } catch (termErr) {
                  console.error(`[Sync] Failed to terminate instance ${sub.id}:`, termErr);
                }
              }
            }
          } catch (subErr) {
            console.error(`[Sync] Failed to get subscriptions for ${customerId}:`, subErr);
          }

          // Schedule the storage rather than deleting it here, so a top-up
          // recovers the data; any survivor may still depend on it.
          if (terminatedPods.length > 0 && keptPods === 0) {
            const scheduledFor = new Date(
              now.getTime() + VOLUME_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
            );
            try {
              const volumes = await getCachedVolumes(teamId);
              const teamVolumes = volumes.filter(v => v.team_id === teamId);
              for (const vol of teamVolumes) {
                try {
                  console.log(`[Sync] Scheduling storage volume ${vol.id} (${vol.name}) for deletion in ${VOLUME_DELETION_GRACE_DAYS}d — negative balance customer ${customerId}`);
                  // Keyed by volume id; if it's already scheduled, leave the
                  // original window in place (don't keep pushing it back on
                  // every sync run while the balance stays negative).
                  await prisma.pendingVolumeDeletion.upsert({
                    where: { volumeId: vol.id },
                    create: {
                      volumeId: vol.id,
                      volumeName: vol.name,
                      teamId,
                      stripeCustomerId: customerId,
                      reason: "negative_balance",
                      scheduledFor,
                    },
                    update: {},
                  });
                  scheduledVolumes.push(vol.id);
                } catch (volErr) {
                  console.error(`[Sync] Failed to schedule volume ${vol.id} for deletion:`, volErr);
                }
              }
            } catch (volErr) {
              console.error(`[Sync] Failed to get volumes for ${customerId}:`, volErr);
            }
          }

          // Send notification email
          if ((terminatedPods.length > 0 || scheduledVolumes.length > 0) && customer.email) {
            try {
              await sendNegativeBalanceShutdownEmail({
                to: customer.email,
                customerName: customer.name || customer.email.split("@")[0],
                balanceOwedCents: confirmedBalanceCents,
                podsTerminated: terminatedPods.length,
                volumesRetained: scheduledVolumes.length,
                retentionDays: VOLUME_DELETION_GRACE_DAYS,
                dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
              });
            } catch (emailErr) {
              console.error(`[Sync] Failed to send negative balance email to ${customer.email}:`, emailErr);
            }
          }

          if (terminatedPods.length > 0 || scheduledVolumes.length > 0) {
            negativeBalanceResults.push({
              customerId,
              email: customer.email || "unknown",
              balanceCents: confirmedBalanceCents,
              podsTerminated: terminatedPods,
              volumesScheduledForDeletion: scheduledVolumes,
            });
          }
        }
      } catch (err) {
        console.error(`[Sync] Error checking negative balance for ${customerId}:`, err);
      }
    }

    if (negativeBalanceResults.length > 0) {
      console.log(`[Sync] Terminated resources for ${negativeBalanceResults.length} customers with negative balance`);
    }

    // === SUMMARY ===
    const summary = {
      orphanedSubsFixed: reconciliationResults.filter(r => !r.reason).length,
      orphanedSubsUnmetered: reconciliationResults.filter(r => r.reason).length,
      podsBilled: podResults.filter(r => r.status === "billed" && (r.amountCents ?? 0) > 0).length,
      podsNotDue: podResults.filter(r => r.status === "not_due").length,
      podsErrors: podResults.filter(r => r.status === "error").length,
      totalPodBilledCents: podResults.reduce((sum, r) => sum + (r.amountCents || 0), 0),
      storageCharges: storageResults.length,
      totalStorageCents: storageResults.reduce((sum, r) => sum + r.storageCostCents, 0),
      stoppedCharges: stoppedResults.length,
      totalStoppedCents: stoppedResults.reduce((sum, r) => sum + r.stoppedCostCents, 0),
      refillsTriggered: Array.from(customerRefills.values()).filter(r => r.refilled).length,
      negativeBalanceShutdowns: negativeBalanceResults.length,
    };

    console.log("[Sync] Completed:", summary);

    return NextResponse.json({
      success: true,
      summary,
      reconciliationResults,
      podResults,
      storageResults,
      stoppedResults,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET endpoint to check sync status (protected)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!SYNC_SECRET || authHeader !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Count pods due for billing (including null prepaidUntil)
  const now = new Date();
  const podsDue = await prisma.podMetadata.count({
    where: {
      OR: [
        { prepaidUntil: { lte: now } },
        { prepaidUntil: null },
      ],
      hourlyRateCents: { gt: 0 },
    },
  });

  const podsNotDue = await prisma.podMetadata.count({
    where: {
      prepaidUntil: { gt: now },
      hourlyRateCents: { gt: 0 },
    },
  });

  return NextResponse.json({
    status: "ready",
    billingIntervalMinutes: BILLING_INTERVAL_MINUTES,
    podsDueForBilling: podsDue,
    podsNotYetDue: podsNotDue,
    config: {
      storagePriceCentsPerGBHour: getStoragePricePerGBHourCents(),
      stoppedInstanceRatePercent: getStoppedInstanceRatePercent(),
      autoRefillThresholdCents: WALLET_CONFIG.autoRefillThresholdCents,
      autoRefillAmountCents: WALLET_CONFIG.autoRefillAmountCents,
    },
  });
}
