import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSharedVolumes, getPoolSubscriptions, unsubscribeFromPool, deleteSharedVolume } from "@/lib/hostedai";
import { checkAndRefillWallet, WALLET_CONFIG } from "@/lib/wallet";
import { getStoragePricePerGBHourCents, getStoppedInstanceRatePercent } from "@/lib/pricing";
import { getProductByPoolId } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { sendNegativeBalanceShutdownEmail } from "@/lib/email";
import { cacheCustomer } from "@/lib/customer-cache";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import type Stripe from "stripe";

// Secret key to protect the sync endpoint (set in env)
const SYNC_SECRET = process.env.SYNC_SECRET;

// Track when reconciliation last ran (Step 0) — only needs to run once per hour
let lastReconciliationRun = 0;
const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Billing interval in minutes (each pod is billed every 30 mins from its deploy time)
const BILLING_INTERVAL_MINUTES = 30;

interface PodBillingResult {
  subscriptionId: string;
  customerId: string;
  email?: string;
  status: "billed" | "not_due" | "error";
  amountCents?: number;
  nextBillingAt?: Date;
  error?: string;
}

export async function POST(request: NextRequest) {
  // Verify sync secret to prevent unauthorized calls
  const authHeader = request.headers.get("authorization");
  if (!SYNC_SECRET || authHeader !== `Bearer ${SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  const now = new Date();
  const podResults: PodBillingResult[] = [];
  const customerRefills: Map<string, { refilled: boolean; amount?: number }> = new Map();

  // Get stopped instance rate configuration
  const stoppedInstanceRatePercent = getStoppedInstanceRatePercent();
  const storagePriceCentsPerGBHour = getStoragePricePerGBHourCents();

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
    }> = [];

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

            // If customer has active pods but billing_type is not "hourly", upgrade them.
            // This catches voucher users who got credit without a credit card.
            // Safe: only changes metadata, does NOT terminate any pods.
            if (customerCache.billingType !== "hourly") {
              try {
                await stripe.customers.update(customerCache.id, {
                  metadata: { billing_type: "hourly" },
                });
                // Also update local cache
                await prisma.customerCache.update({
                  where: { id: customerCache.id },
                  data: { billingType: "hourly" },
                });
                console.log(`[Sync Reconcile] Upgraded ${customerCache.id} (${customerCache.email}) billing_type from "${customerCache.billingType}" to "hourly" — has ${pods.length} active pod(s)`);
              } catch (upgradeErr) {
                console.error(`[Sync Reconcile] Failed to upgrade billing_type for ${customerCache.id}:`, upgradeErr);
              }
            }

            // Check if all pods for this team have PodMetadata
            const existingMeta = await prisma.podMetadata.findMany({
              where: { stripeCustomerId: customerCache.id },
              select: { subscriptionId: true, hourlyRateCents: true },
            });
            const metaSubIds = new Set(existingMeta.map(m => m.subscriptionId));
            const hasGaps = existingMeta.some(m => !m.hourlyRateCents);

            // If all pods have metadata with rates, skip this team
            if (!hasGaps && existingMeta.length >= pods.length) continue;

            // Only now call hosted.ai for this specific team
            try {
              const activeSubs = await getCachedSubs(teamId);
              for (const sub of activeSubs) {
                if (sub.status !== "subscribed" && sub.status !== "active") continue;

                const subId = String(sub.id);
                const existing = existingMeta.find(m => m.subscriptionId === subId);

                if (!existing || !existing.hourlyRateCents) {
                  const product = await getProductByPoolId(sub.pool_id);
                  const rateCents = product?.hourly_rate_cents || 0;
                  if (rateCents === 0) continue;

                  if (!existing) {
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
                  } else {
                    // existing has no hourlyRateCents — update it
                    // We already queried existingMeta above, so check prepaidUntil from the full record
                    const fullExisting = await prisma.podMetadata.findUnique({ where: { subscriptionId: subId } });
                    await prisma.podMetadata.update({
                      where: { subscriptionId: subId },
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
                      subscriptionId: subId,
                      poolId: String(sub.pool_id),
                      hourlyRateCents: rateCents,
                      action: "updated",
                    });
                  }
                }
              }
            } catch (subErr) {
              console.error(`[Sync Reconcile] Error checking subs for team ${teamId}:`, subErr);
            }
          }
        }

        if (reconciliationResults.length > 0) {
          console.log(`[Sync Reconcile] Fixed ${reconciliationResults.length} orphaned subscription(s)`);
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
      },
    });

    console.log(`[Sync] Found ${podsDue.length} pods due for billing`);

    for (const pod of podsDue) {
      try {
        // Get customer email for logging
        let customerEmail = "unknown";
        try {
          const customer = await stripe.customers.retrieve(pod.stripeCustomerId) as Stripe.Customer;
          cacheCustomer(customer).catch(() => {});
          customerEmail = customer.email || "unknown";
        } catch {
          // Continue without email
        }

        // Verify the subscription is still active
        const teamId = await getTeamIdForCustomer(stripe, pod.stripeCustomerId);
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

        // Check if subscription still exists and is active (uses per-run cache)
        const subscriptions = await getCachedSubs(teamId);
        const subscription = subscriptions.find(s => String(s.id) === pod.subscriptionId);

        if (!subscription || (subscription.status !== "subscribed" && subscription.status !== "active")) {
          console.log(`[Sync] Skipping pod ${pod.subscriptionId}: subscription not active (status: ${subscription?.status || "not found"})`);
          // Clean up the pod metadata if subscription is gone
          if (!subscription) {
            await prisma.podMetadata.delete({ where: { subscriptionId: pod.subscriptionId } }).catch(() => {});
          }
          podResults.push({
            subscriptionId: pod.subscriptionId,
            customerId: pod.stripeCustomerId,
            email: customerEmail,
            status: "error",
            error: `Subscription not active: ${subscription?.status || "not found"}`,
          });
          continue;
        }

        // Calculate GPU count from subscription (round up, minimum 1 — no fractional GPU billing)
        const gpuCount = Math.max(1, Math.ceil(subscription.per_pod_info?.vgpu_count || 1));

        // Calculate cost for 30 minutes
        const hoursToCharge = BILLING_INTERVAL_MINUTES / 60; // 0.5 hours
        const amountCents = Math.round(hoursToCharge * pod.hourlyRateCents! * gpuCount);

        // Generate unique charge ID to prevent duplicates
        const chargeId = `pod_${pod.subscriptionId}_${Math.floor(now.getTime() / 1000)}`;

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
        const chargeDescription = `GPU usage: ${gpuCount} GPU(s) x ${BILLING_INTERVAL_MINUTES} mins @ $${(pod.hourlyRateCents! / 100).toFixed(2)}/hr`;
        await stripe.customers.createBalanceTransaction(pod.stripeCustomerId, {
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

        // Log to local WalletTransaction table
        await prisma.walletTransaction.create({
          data: {
            stripeCustomerId: pod.stripeCustomerId,
            teamId,
            type: "gpu_usage",
            amountCents,
            description: chargeDescription,
            subscriptionId: pod.subscriptionId,
            poolId: pod.poolId ? parseInt(pod.poolId, 10) || null : null,
            gpuCount,
            hourlyRateCents: pod.hourlyRateCents!,
            billingMinutes: BILLING_INTERVAL_MINUTES,
            syncCycleId: chargeId,
          },
        }).catch((e) => console.error(`[Sync] Failed to log WalletTransaction for pod ${pod.subscriptionId}:`, e));

        // Update prepaidUntil to next billing time
        // IMPORTANT: Use pod's current prepaidUntil as the base (not now) to preserve individual billing schedules
        // This ensures pods deployed at different times stay on their individual 30-min cycles
        const currentPrepaidUntil = pod.prepaidUntil || now;
        const nextBillingAt = new Date(currentPrepaidUntil.getTime() + BILLING_INTERVAL_MINUTES * 60 * 1000);
        await prisma.podMetadata.update({
          where: { subscriptionId: pod.subscriptionId },
          data: { prepaidUntil: nextBillingAt },
        });

        console.log(`[Sync] Billed pod ${pod.subscriptionId}: $${(amountCents / 100).toFixed(2)} for ${gpuCount} GPU(s). Was prepaid until ${currentPrepaidUntil.toISOString()}, now prepaid until ${nextBillingAt.toISOString()}`);

        podResults.push({
          subscriptionId: pod.subscriptionId,
          customerId: pod.stripeCustomerId,
          email: customerEmail,
          status: "billed",
          amountCents,
          nextBillingAt,
        });
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

    for (const customerId of customersToProcess) {
      try {
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        cacheCustomer(customer).catch(() => {});
        if (customer.metadata?.billing_type !== "hourly") continue;

        const teamId = customer.metadata?.hostedai_team_id;
        if (!teamId) continue;

        // Check last storage sync time (storage is still on fixed 30-min intervals)
        const lastStorageSync = customer.metadata?.last_storage_sync_timestamp;
        const nowSec = Math.floor(Date.now() / 1000);
        if (lastStorageSync) {
          const lastSyncTime = parseInt(lastStorageSync, 10);
          if (nowSec - lastSyncTime < 25 * 60) { // 25 min buffer
            continue; // Skip, synced recently
          }
        }

        // Update storage sync timestamp
        const updatedSyncCustomer = await stripe.customers.update(customerId, {
          metadata: {
            ...customer.metadata,
            last_storage_sync_timestamp: nowSec.toString(),
          },
        });
        cacheCustomer(updatedSyncCustomer as Stripe.Customer).catch(() => {});

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
            const hoursInInterval = BILLING_INTERVAL_MINUTES / 60;
            const storageCostCents = Math.round(totalStorageGb * storagePriceCentsPerGBHour * hoursInInterval);

            if (storageCostCents > 0) {
              const storageDesc = `Storage: ${totalStorageGb}GB @ $${(storagePriceCentsPerGBHour / 100).toFixed(4)}/GB/hr`;
              await stripe.customers.createBalanceTransaction(customerId, {
                amount: storageCostCents,
                currency: "usd",
                description: storageDesc,
                metadata: {
                  storage_gb: totalStorageGb.toString(),
                  billing_type: "storage",
                },
              });

              // Log storage charge locally
              await prisma.walletTransaction.create({
                data: {
                  stripeCustomerId: customerId,
                  teamId,
                  type: "storage",
                  amountCents: storageCostCents,
                  description: storageDesc,
                  billingMinutes: BILLING_INTERVAL_MINUTES,
                },
              }).catch((e) => console.error(`[Sync] Failed to log storage WalletTransaction for ${customerId}:`, e));

              storageResults.push({ customerId, storageGb: totalStorageGb, storageCostCents });
            }
          }
        } catch (storageErr) {
          console.error(`Error billing storage for ${customerId}:`, storageErr);
        }

        // === Stopped instance billing ===
        let stoppedGpuCount = 0;
        try {
          const allSubscriptions = await getCachedSubs(teamId);
          const subMap = new Map<string | number, typeof allSubscriptions[0]>();
          for (const sub of allSubscriptions) {
            if (!subMap.has(sub.id)) subMap.set(sub.id, sub);
          }
          const processedPods = new Set<string>();

          for (const sub of subMap.values()) {
            if (sub.status !== "subscribed" && sub.status !== "active") continue;
            if (!sub.pods || sub.pods.length === 0) continue;

            for (const pod of sub.pods) {
              const podKey = pod.pod_name || `${sub.id}-${pod.pod_status}`;
              if (processedPods.has(podKey)) continue;
              processedPods.add(podKey);

              const podStatus = (pod.pod_status || "").toLowerCase();
              if (podStatus === "stopped" || podStatus === "paused" || podStatus === "reserved") {
                stoppedGpuCount += Math.max(1, Math.ceil(pod.gpu_count || sub.per_pod_info?.vgpu_count || 1));
              }
            }
          }

          if (stoppedGpuCount > 0) {
            // Get average hourly rate from this customer's pods
            const customerPods = await prisma.podMetadata.findMany({
              where: { stripeCustomerId: customerId, hourlyRateCents: { gt: 0 } },
              select: { hourlyRateCents: true },
            });
            const avgRate = customerPods.length > 0
              ? customerPods.reduce((sum, p) => sum + (p.hourlyRateCents || 0), 0) / customerPods.length
              : 0;

            if (avgRate > 0) {
              const hoursInInterval = BILLING_INTERVAL_MINUTES / 60;
              const reducedRate = Math.round(avgRate * (stoppedInstanceRatePercent / 100));
              const stoppedCostCents = Math.round(stoppedGpuCount * reducedRate * hoursInInterval);

              if (stoppedCostCents > 0) {
                const stoppedDesc = `Reserved: ${stoppedGpuCount} GPU(s) stopped @ ${stoppedInstanceRatePercent}%`;
                await stripe.customers.createBalanceTransaction(customerId, {
                  amount: stoppedCostCents,
                  currency: "usd",
                  description: stoppedDesc,
                  metadata: {
                    stopped_gpu_count: stoppedGpuCount.toString(),
                    billing_type: "stopped_reservation",
                  },
                });

                // Log stopped reservation charge locally
                await prisma.walletTransaction.create({
                  data: {
                    stripeCustomerId: customerId,
                    teamId,
                    type: "stopped_reservation",
                    amountCents: stoppedCostCents,
                    description: stoppedDesc,
                    gpuCount: stoppedGpuCount,
                    billingMinutes: BILLING_INTERVAL_MINUTES,
                  },
                }).catch((e) => console.error(`[Sync] Failed to log stopped WalletTransaction for ${customerId}:`, e));

                stoppedResults.push({ customerId, stoppedGpuCount, stoppedCostCents });
              }
            }
          }
        } catch (stoppedErr) {
          console.error(`Error billing stopped instances for ${customerId}:`, stoppedErr);
        }

        // === Wallet refill check ===
        if (!customerRefills.has(customerId)) {
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
      volumesDeleted: number[];
    }> = [];

    // Get all unique customers we've processed or have active pods
    const allCustomersToCheck = new Set<string>();
    podResults.forEach(r => allCustomersToCheck.add(r.customerId));
    customersToProcess.forEach(c => allCustomersToCheck.add(c));

    for (const customerId of allCustomersToCheck) {
      try {
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        if ("deleted" in customer && customer.deleted) continue;
        cacheCustomer(customer).catch(() => {});
        if (customer.metadata?.billing_type !== "hourly") continue;

        // Check balance: positive = owes money (negative wallet), negative = has credit
        // If balance > 0, customer owes us money (negative wallet balance)
        const balanceCents = customer.balance || 0;

        if (balanceCents > 0) {
          // Customer has negative wallet balance - they owe us money
          console.log(`[Sync] Customer ${customerId} has negative balance: owes $${(balanceCents / 100).toFixed(2)}`);

          const teamId = customer.metadata?.hostedai_team_id;
          if (!teamId) continue;

          const terminatedPods: string[] = [];
          const deletedVolumes: number[] = [];
          const preservedVolumeIds = new Set<number>(); // Volumes kept for auto-preserved snapshots

          // === AUTO-PRESERVE: Create snapshots before termination ===
          // This saves pod configuration + links to persistent storage so the user
          // can re-deploy when they top up their wallet. Snapshots expire after 7 days.
          const PRESERVATION_DAYS = 7;
          const expiresAt = new Date(Date.now() + PRESERVATION_DAYS * 24 * 60 * 60 * 1000);

          try {
            const subscriptions = await getCachedSubs(teamId);

            // First pass: create auto-preserved snapshots for each active pod
            for (const sub of subscriptions) {
              if (sub.status === "subscribed" || sub.status === "active" || sub.status === "subscribing") {
                try {
                  // Get pod metadata for display name
                  const podMeta = await prisma.podMetadata.findUnique({
                    where: { subscriptionId: String(sub.id) },
                  });

                  // Get HuggingFace deployment if any
                  const hfDeploy = await prisma.huggingFaceDeployment.findFirst({
                    where: { subscriptionId: String(sub.id) },
                  }).catch(() => null);

                  // Determine storage info from subscription
                  const sharedVolumes = sub.storage_details?.shared_volumes || [];
                  const firstVol = sharedVolumes[0];
                  const volumeId = firstVol?.id ? Number(firstVol.id) : null;
                  const volumeName = firstVol?.name || null;
                  const volumeSize = firstVol?.size_in_gb || firstVol?.size_gb || null;
                  const hasStorage = sharedVolumes.length > 0 || (sub.storage_details?.persistent_storage_gb || 0) > 0;

                  // If there's a persistent volume, mark it for preservation
                  if (volumeId && !isNaN(volumeId)) {
                    preservedVolumeIds.add(volumeId);
                  }

                  // Also check for volumes via the API if subscription has persistent_storage_gb but no shared_volumes
                  if (!volumeId && (sub.storage_details?.persistent_storage_gb || 0) > 0) {
                    try {
                      const teamVols = await getCachedVolumes(teamId);
                      const inUseVols = teamVols.filter(v => v.status === "IN_USE");
                      for (const vol of inUseVols) {
                        preservedVolumeIds.add(vol.id);
                      }
                    } catch { /* continue without */ }
                  }

                  const displayName = podMeta?.displayName || sub.pool_name || `Pod ${sub.id}`;
                  const poolId = String(sub.pool_id);
                  const vgpus = Math.max(1, Math.ceil(sub.per_pod_info?.vgpu_count || 1));
                  const imageUuid = sub.per_pod_info?.image_uuid || null;

                  await prisma.podSnapshot.create({
                    data: {
                      stripeCustomerId: customerId,
                      displayName: `${displayName} (auto-saved)`,
                      notes: `Automatically preserved on ${new Date().toLocaleDateString()} due to insufficient balance. Top up your wallet to re-deploy. Expires in ${PRESERVATION_DAYS} days.`,
                      snapshotType: hasStorage ? "full" : "template",
                      originalSubscriptionId: String(sub.id),
                      poolId,
                      poolName: sub.pool_name || null,
                      vgpus,
                      imageUuid,
                      persistentVolumeId: volumeId,
                      persistentVolumeName: volumeName,
                      persistentVolumeSize: volumeSize,
                      autoPreserved: true,
                      expiresAt,
                      hfItemId: hfDeploy?.hfItemId || null,
                      hfItemType: hfDeploy?.hfItemType || null,
                      hfItemName: hfDeploy?.hfItemName || null,
                      deployScript: hfDeploy?.deployScript || null,
                    },
                  });

                  console.log(`[Sync] Auto-preserved snapshot for pod ${sub.id} (${displayName}), expires ${expiresAt.toISOString()}`);
                } catch (snapErr) {
                  // Snapshot creation failure must NOT prevent termination
                  console.error(`[Sync] Failed to auto-preserve pod ${sub.id} (non-blocking):`, snapErr);
                }
              }
            }

            // Second pass: terminate all pods (unchanged logic)
            for (const sub of subscriptions) {
              if (sub.status === "subscribed" || sub.status === "active" || sub.status === "subscribing") {
                const poolId = sub.pool_id;
                try {
                  console.log(`[Sync] Terminating pod subscription ${sub.id} for negative balance customer ${customerId}`);
                  await unsubscribeFromPool(String(sub.id), teamId, String(poolId));
                  terminatedPods.push(String(sub.id));

                  // Clean up PodMetadata
                  await prisma.podMetadata.delete({
                    where: { subscriptionId: String(sub.id) }
                  }).catch(() => {});
                } catch (termErr) {
                  console.error(`[Sync] Failed to terminate subscription ${sub.id}:`, termErr);
                }
              }
            }
          } catch (subErr) {
            console.error(`[Sync] Failed to get subscriptions for ${customerId}:`, subErr);
          }

          // Delete storage volumes — BUT preserve those referenced by auto-preserved snapshots
          try {
            const volumes = await getCachedVolumes(teamId);
            const teamVolumes = volumes.filter(v => v.team_id === teamId);
            for (const vol of teamVolumes) {
              if (preservedVolumeIds.has(vol.id)) {
                console.log(`[Sync] Preserving storage volume ${vol.id} (${vol.name}) — referenced by auto-preserved snapshot, expires ${expiresAt.toISOString()}`);
                continue; // Skip deletion — snapshot references this volume
              }
              try {
                console.log(`[Sync] Deleting storage volume ${vol.id} (${vol.name}) for negative balance customer ${customerId}`);
                await deleteSharedVolume(vol.id);
                deletedVolumes.push(vol.id);
              } catch (volErr) {
                console.error(`[Sync] Failed to delete volume ${vol.id}:`, volErr);
              }
            }
          } catch (volErr) {
            console.error(`[Sync] Failed to get volumes for ${customerId}:`, volErr);
          }

          // Send notification email
          if ((terminatedPods.length > 0 || deletedVolumes.length > 0) && customer.email) {
            try {
              await sendNegativeBalanceShutdownEmail({
                to: customer.email,
                customerName: customer.name || customer.email.split("@")[0],
                balanceOwedCents: balanceCents,
                podsTerminated: terminatedPods.length,
                volumesDeleted: deletedVolumes.length,
                dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
              });
            } catch (emailErr) {
              console.error(`[Sync] Failed to send negative balance email to ${customer.email}:`, emailErr);
            }
          }

          if (terminatedPods.length > 0 || deletedVolumes.length > 0) {
            negativeBalanceResults.push({
              customerId,
              email: customer.email || "unknown",
              balanceCents,
              podsTerminated: terminatedPods,
              volumesDeleted: deletedVolumes,
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
      orphanedSubsFixed: reconciliationResults.length,
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

// Helper to get team ID from customer
async function getTeamIdForCustomer(stripe: Stripe, customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    cacheCustomer(customer).catch(() => {});
    return customer.metadata?.hostedai_team_id || null;
  } catch {
    return null;
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
