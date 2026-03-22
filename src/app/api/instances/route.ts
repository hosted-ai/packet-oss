import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { resolveAllTeamsForEmail } from "@/lib/customer-resolver";
import {
  getTeamInstances,
  createInstance,
  getInstanceCredentials,
  subscribeToPool,
  getPoolSubscriptions,
  getAllPools,
  createSharedVolume,
  getSharedVolumes,
  getPoolPersistentStorageBlocks,
  selectOptimalPool,
  subscribeWithFallback,
  getStorageBlocks,
  getCompatibleImages,
  getInstanceTypes,
  getApiUrl,
  getApiKey,
  Instance,
  PoolSubscription,
} from "@/lib/hostedai";
import { logGPULaunched, getFirstGpuLaunch } from "@/lib/activity";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";
import { prisma } from "@/lib/prisma";
import { sendGpuLaunchedEmail } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { cacheCustomer } from "@/lib/customer-cache";
// Pricing now comes from GpuProduct model, not static config
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { installMetricsCollector } from "@/lib/metrics-collector";

// Billing constants
const MINIMUM_BILLING_MINUTES = 30; // Minimum billing period in minutes

// GET - List team instances
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Resolve ALL teams for this email — customers may have multiple Stripe
    // accounts (hourly + monthly) that link to different hosted.ai teams.
    // We consolidate all pods into a single dashboard view.
    const resolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
    if (!resolved || resolved.allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const customer = resolved.primaryCustomer;
    cacheCustomer(customer).catch(() => {});
    console.log(`[Instances GET] Resolved ${payload.email}: primary=${customer.id}, teams=[${resolved.allTeamIds.join(",")}]`);

    // Fetch instances and pool subscriptions from ALL teams in parallel
    let instances: Instance[] = [];
    let poolSubscriptions: PoolSubscription[] = [];

    const teamFetchResults = await Promise.all(
      resolved.allTeamIds.map(async (teamId) => {
        let teamInstances: Instance[] = [];
        let teamPools: PoolSubscription[] = [];

        try {
          teamInstances = await getTeamInstances(teamId) || [];
        } catch (error) {
          console.error(`Failed to fetch instances for team ${teamId}:`, error);
        }

        try {
          // 90s timeout for teams with many GPUs; 30s cache TTL
          teamPools = await getPoolSubscriptions(teamId, undefined, 90000) || [];
        } catch (error) {
          console.error(`Failed to fetch pool subscriptions for team ${teamId}:`, error);
        }

        return { teamInstances, teamPools };
      })
    );

    // Merge results from all teams
    for (const result of teamFetchResults) {
      if (result.teamInstances?.length) {
        instances = [...instances, ...result.teamInstances];
      }
      if (result.teamPools?.length) {
        poolSubscriptions = [...poolSubscriptions, ...result.teamPools];
      }
    }

    console.log(`[Instances GET] Consolidated: ${instances.length} instances, ${poolSubscriptions.length} pool subscriptions across ${resolved.allTeamIds.length} team(s)`);

    // Fetch pod metadata for all subscriptions AND unified instances
    const subscriptionIds = poolSubscriptions.map(s => String(s.id));
    const instanceIds = instances.map(i => i.id);
    let podMetadata: Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string }> = {};
    let hfDeployments: Record<string, {
      id: string;
      hfItemId: string;
      hfItemName: string;
      status: string;
      errorMessage: string | null;
      createdAt: string;
      netdata?: boolean;
      netdataPort?: number | null;
      openWebUI?: boolean;
      webUiPort?: number | null;
    }> = {};

    if (subscriptionIds.length > 0 || instanceIds.length > 0) {
      try {
        // Fetch metadata by subscriptionId (legacy) AND instanceId (HAI 2.2)
        const metadata = await prisma.podMetadata.findMany({
          where: {
            OR: [
              ...(subscriptionIds.length > 0 ? [{ subscriptionId: { in: subscriptionIds } }] : []),
              ...(instanceIds.length > 0 ? [{ instanceId: { in: instanceIds } }] : []),
            ],
          },
        });
        podMetadata = metadata.reduce((acc, m) => {
          const metaValue = {
            displayName: m.displayName,
            notes: m.notes,
            hourlyRate: m.hourlyRateCents ? m.hourlyRateCents / 100 : undefined,
            startupScriptStatus: m.startupScriptStatus,
            stripeSubscriptionId: m.stripeSubscriptionId || undefined,
            billingType: m.billingType || undefined,
          };
          // Index by subscriptionId for legacy pool subscriptions
          acc[m.subscriptionId] = metaValue;
          // Also index by instanceId for unified instances (HAI 2.2)
          if (m.instanceId) {
            acc[m.instanceId] = metaValue;
          }
          return acc;
        }, {} as Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string }>);

        // Also fetch pending metadata and try to resolve to real subscriptions
        // This handles cases where the API returned a pending ID initially
        const pendingMetadata = await prisma.podMetadata.findMany({
          where: { subscriptionId: { startsWith: "pending-" } },
        });

        // Try to match pending metadata to real subscriptions by pool_id
        for (const pending of pendingMetadata) {
          // Extract pool_id from pending ID (format: pending-{poolId}-{timestamp})
          const parts = pending.subscriptionId.split("-");
          if (parts.length >= 3) {
            const pendingPoolId = parts[1];

            // Find a real subscription with matching pool_id that doesn't have metadata yet
            const matchingSub = poolSubscriptions.find(s => {
              if (String(s.pool_id) !== pendingPoolId) return false;
              // Already have metadata for this subscription
              if (podMetadata[String(s.id)]) return false;
              return true;
            });

            if (matchingSub) {
              // Update the pending metadata with the real subscription ID
              try {
                await prisma.podMetadata.update({
                  where: { subscriptionId: pending.subscriptionId },
                  data: { subscriptionId: String(matchingSub.id) },
                });
                console.log(`[Dashboard] Resolved pending metadata ${pending.subscriptionId} -> ${matchingSub.id}`);
                podMetadata[String(matchingSub.id)] = {
                  displayName: pending.displayName,
                  notes: pending.notes,
                  hourlyRate: pending.hourlyRateCents ? pending.hourlyRateCents / 100 : undefined,
                  startupScriptStatus: pending.startupScriptStatus,
                  stripeSubscriptionId: pending.stripeSubscriptionId || undefined,
                  billingType: pending.billingType || undefined,
                };
              } catch {
                // Might fail if another request already updated it - that's fine
              }
            }
          }
        }

        // === BILLING RECONCILIATION ===
        // Detect pool subscriptions that are missing PodMetadata billing records.
        // This catches pods deployed outside the dashboard (directly on hosted.ai)
        // or pods where metadata creation failed. Without a PodMetadata record,
        // the billing cron won't charge for the pod.
        const unbilledSubscriptionIds = subscriptionIds.filter(id => !podMetadata[id]);
        if (unbilledSubscriptionIds.length > 0) {
          console.log(`[Billing Reconciliation] Found ${unbilledSubscriptionIds.length} subscriptions without billing records: ${unbilledSubscriptionIds.join(", ")}`);

          try {
            // Load all active GpuProducts to match pool_id → pricing
            const gpuProducts = await prisma.gpuProduct.findMany({
              where: { active: true },
            });

            for (const subId of unbilledSubscriptionIds) {
              const sub = poolSubscriptions.find(s => String(s.id) === subId);
              if (!sub) continue;

              // Find the GpuProduct whose poolIds array includes this subscription's pool_id
              let matchedProduct: typeof gpuProducts[0] | undefined;
              for (const product of gpuProducts) {
                try {
                  const poolIdList: number[] = JSON.parse(product.poolIds || "[]");
                  if (poolIdList.includes(Number(sub.pool_id))) {
                    matchedProduct = product;
                    break;
                  }
                } catch {
                  // Invalid JSON in poolIds, skip
                }
              }

              if (!matchedProduct) {
                console.warn(`[Billing Reconciliation] No GpuProduct found for pool_id=${sub.pool_id} (subscription ${subId}). Cannot auto-bill.`);
                continue;
              }

              const hourlyRate = matchedProduct.pricePerHourCents;
              const billingType = matchedProduct.billingType || "hourly";

              console.log(`[Billing Reconciliation] Auto-creating PodMetadata for subscription ${subId} (pool ${sub.pool_id}): ${matchedProduct.name} @ $${(hourlyRate / 100).toFixed(2)}/hr, billingType=${billingType}`);

              try {
                const newMeta = await prisma.podMetadata.create({
                  data: {
                    subscriptionId: subId,
                    stripeCustomerId: customer.id,
                    displayName: sub.pool_name || `GPU Pod #${subId}`,
                    deployTime: new Date(),
                    poolId: String(sub.pool_id),
                    productId: matchedProduct.id,
                    hourlyRateCents: hourlyRate,
                    billingType,
                  },
                });

                // Add to podMetadata map so the response includes the new record
                podMetadata[subId] = {
                  displayName: newMeta.displayName,
                  notes: newMeta.notes,
                  hourlyRate: hourlyRate > 0 ? hourlyRate / 100 : undefined,
                  startupScriptStatus: null,
                  stripeSubscriptionId: undefined,
                  billingType,
                };

                console.log(`[Billing Reconciliation] Created PodMetadata ${newMeta.id} for subscription ${subId}`);
              } catch (createErr: unknown) {
                // Could be a unique constraint if another request already created it
                const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
                if (errMsg.includes("Unique constraint")) {
                  console.log(`[Billing Reconciliation] PodMetadata already exists for subscription ${subId} (race condition - OK)`);
                } else {
                  console.error(`[Billing Reconciliation] Failed to create PodMetadata for subscription ${subId}:`, createErr);
                }
              }
            }
          } catch (reconcileErr) {
            console.error("[Billing Reconciliation] Error during reconciliation:", reconcileErr);
          }
        }

        // Fetch HuggingFace deployments for subscriptions
        // Also fetch pending deployments (pending-{poolId}-{timestamp}) and resolve them
        const deployments = await prisma.huggingFaceDeployment.findMany({
          where: {
            OR: [
              { subscriptionId: { in: subscriptionIds } },
              { subscriptionId: { startsWith: "pending-" }, stripeCustomerId: payload.customerId },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });

        // Resolve any pending subscription IDs to real ones
        for (const d of deployments) {
          if (d.subscriptionId.startsWith("pending-")) {
            const pendingPoolId = d.subscriptionId.split("-")[1];
            const match = poolSubscriptions.find(
              (s: { pool_id?: number | string; status?: string }) =>
                String(s.pool_id) === pendingPoolId &&
                ["subscribing", "subscribed", "active", "running"].includes(s.status || "")
            );
            if (match) {
              const realId = String(match.id);
              console.log(`[Instances] Resolved pending HF deployment ${d.subscriptionId} -> ${realId}`);
              await prisma.huggingFaceDeployment.update({
                where: { id: d.id },
                data: { subscriptionId: realId },
              });
              d.subscriptionId = realId;
            }
          }
        }

        hfDeployments = deployments.reduce((acc, d) => {
          // Only keep the most recent deployment per subscription
          if (!acc[d.subscriptionId]) {
            acc[d.subscriptionId] = {
              id: d.id,
              hfItemId: d.hfItemId,
              hfItemName: d.hfItemName,
              status: d.status,
              errorMessage: d.errorMessage,
              createdAt: d.createdAt.toISOString(),
              netdata: d.netdata,
              netdataPort: d.netdataPort,
              openWebUI: d.openWebUI,
              webUiPort: d.webUiPort,
            };
          }
          return acc;
        }, {} as Record<string, { id: string; hfItemId: string; hfItemName: string; status: string; errorMessage: string | null; createdAt: string; netdata?: boolean; netdataPort?: number | null; openWebUI?: boolean; webUiPort?: number | null }>);
      } catch (error) {
        console.error("Failed to fetch pod metadata:", error);
      }
    }

    return NextResponse.json({ instances, poolSubscriptions, podMetadata, hfDeployments });
  } catch (error) {
    console.error("List instances error:", error);
    return NextResponse.json(
      { error: "Failed to list instances" },
      { status: 500 }
    );
  }
}

// POST - Create new instance (supports both traditional and GPUaaS pool-based creation)
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Resolve to primary customer for deployment (wallet, team)
    const stripe = getStripe();
    const resolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
    if (!resolved || resolved.allTeamIds.length === 0) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const customer = resolved.primaryCustomer;
    cacheCustomer(customer).catch(() => {});
    const teamId = customer.metadata?.hostedai_team_id;
    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      name,
      pool_id,
      product_id, // GPU product ID for per-product pricing
      instance_type_id,
      // GPUaaS fields
      ephemeral_storage_block_id,
      persistent_storage_block_id, // Create new volume with this storage block
      existing_shared_volume_id, // Attach existing shared volume by ID
      skip_auto_storage, // User explicitly chose "no persistent storage"
      image_uuid,
      vgpus,
      startup_script, // Custom startup script to run after pod starts
      startup_script_preset_id, // Preset ID for automatic port exposure
      // Monthly subscription fields
      billingType, // "monthly" for subscription-based deploy
      stripeSubscriptionId, // Stripe subscription ID for monthly deploys
      // Legacy fields for traditional instance creation
      service_id,
      image_hash_id,
      storage_block_id
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Instance name is required" },
        { status: 400 }
      );
    }

    // ============================================================
    // HAI 2.2 UNIFIED INSTANCE CREATION
    // When the GpuProduct has a serviceId, use the unified create-instance API
    // instead of the legacy pool subscription flow.
    // ============================================================
    if (product_id) {
      const gpuProduct = await prisma.gpuProduct.findUnique({
        where: { id: product_id },
      });

      if (gpuProduct?.serviceId) {
        return await handleUnifiedInstanceCreate({
          request,
          body,
          gpuProduct,
          teamId,
          customer,
          payload,
          stripe: getStripe(),
        });
      }
    }

    // GPUaaS pool-based creation (legacy — products without serviceId)
    if (pool_id) {
      const gpuCount = vgpus || 1;

      // DEPLOYMENT LOCK: Use Stripe customer metadata as atomic lock to prevent race conditions
      // This ensures only one deployment can proceed at a time per customer (any pool)
      // Using a single customer-level lock prevents concurrent deployments that could bypass wallet checks
      const lockKey = `deploy_lock`;
      const lockTimestamp = customer.metadata?.[lockKey];
      const now = Math.floor(Date.now() / 1000);

      if (lockTimestamp) {
        const lockTime = parseInt(lockTimestamp, 10);
        // If lock is less than 60 seconds old, another deployment is in progress
        if (now - lockTime < 60) {
          console.log(`[Billing] Blocking concurrent deployment for customer ${payload.customerId} - lock held since ${new Date(lockTime * 1000).toISOString()}`);
          return NextResponse.json(
            { error: "Another GPU deployment is in progress. Please wait a moment." },
            { status: 429 }
          );
        }
      }

      // Acquire lock before proceeding
      try {
        const lockedCustomer = await stripe.customers.update(payload.customerId, {
          metadata: {
            ...customer.metadata,
            [lockKey]: now.toString(),
          },
        });
        cacheCustomer(lockedCustomer as Stripe.Customer).catch(() => {});
        console.log(`[Billing] Acquired deployment lock for customer ${payload.customerId}`);
      } catch (lockErr) {
        console.error(`[Billing] Failed to acquire lock:`, lockErr);
        // Continue anyway - better to risk duplicate than fail deployment
      }

      // Get ephemeral storage and instance types for this team's region from the API
      const { getAllPools, getPoolEphemeralStorageBlocks } = await import("@/lib/hostedai");

      let selectedInstanceType = instance_type_id;
      let selectedEphemeralStorage = ephemeral_storage_block_id;

      // Get pool info to find region_id
      // Use let since we may switch to an alternative pool if this one is blocked
      const pools = await getAllPools();
      let selectedPoolId = pool_id;
      let selectedPool = pools.find(p => String(p.id) === String(pool_id));
      const regionId = selectedPool?.region_id || 2; // Default to region 2 if not found

      // If no instance type provided, fetch compatible instance types for this region
      // Uses the per-region compatible-instance-types endpoint which returns only types
      // that the hosted.ai cluster actually accepts for subscription
      if (!selectedInstanceType) {
        try {
          const { getPoolInstanceTypes } = await import("@/lib/hostedai");
          console.log(`Fetching compatible instance types for region ${regionId}, team ${teamId}`);
          const compatibleTypes = await getPoolInstanceTypes(String(regionId), teamId);

          console.log("Compatible instance types:", compatibleTypes.map(t =>
            `${t.name} (${t.id})`
          ));

          if (compatibleTypes.length > 0) {
            selectedInstanceType = compatibleTypes[0].id;
            console.log(`Selected instance type: ${compatibleTypes[0].name} (${compatibleTypes[0].id})`);
          } else {
            throw new Error("No compatible instance types available for this region");
          }
        } catch (err) {
          console.error("Failed to get compatible instance types:", err);
          throw new Error("Could not determine compatible instance type for this GPU pool");
        }
      }

      // If no ephemeral storage provided, fetch from API
      if (!selectedEphemeralStorage) {
        try {
          console.log(`Getting compatible ephemeral storage for region ${regionId}, team ${teamId}`);
          const storageBlocks = await getPoolEphemeralStorageBlocks(String(regionId), teamId);
          console.log("Compatible ephemeral storage blocks:", JSON.stringify(storageBlocks, null, 2));

          if (storageBlocks.length > 0) {
            // Use the first available compatible storage block
            selectedEphemeralStorage = storageBlocks[0].id;
            console.log(`Using compatible ephemeral storage: ${selectedEphemeralStorage} (${storageBlocks[0].name})`);
          } else {
            // Fallback: use global storage blocks filtered for ephemeral usage
            console.log("No region-specific ephemeral storage, trying global storage blocks...");
            const { getStorageBlocks } = await import("@/lib/hostedai");
            const allBlocks = await getStorageBlocks();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ephemeralBlocks = allBlocks.filter((b: any) => b.ephemeral_usage === true);
            if (ephemeralBlocks.length > 0) {
              selectedEphemeralStorage = ephemeralBlocks[0].id;
              console.log(`Using global ephemeral storage fallback: ${selectedEphemeralStorage} (${ephemeralBlocks[0].name})`);
            } else {
              throw new Error("No ephemeral storage blocks available");
            }
          }
        } catch (err) {
          console.error("Failed to get compatible ephemeral storage:", err);
          throw new Error("Could not determine compatible ephemeral storage for this pool");
        }
      }

      // Only use image_uuid if it's in valid UUID format (not hash format from image policy)
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const isValidUUID = image_uuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(image_uuid);
      const validImageUuid = isValidUUID ? image_uuid : "";

      // CRITICAL: Select the optimal pool using centralized logic
      // Rules: 1) maintenance (hard filter), 2) one pod per pool, 3) empty pools first, 4) least VRAM
      // Look up product pool IDs so we search across ALL clusters, not just one gpuaas_id
      let productPoolIds: number[] | undefined;
      if (product_id) {
        try {
          const gpuProduct = await prisma.gpuProduct.findUnique({ where: { id: product_id }, select: { poolIds: true } });
          if (gpuProduct?.poolIds) {
            productPoolIds = JSON.parse(gpuProduct.poolIds) as number[];
          }
        } catch {}
      }

      let fallbackPools: import("@/lib/hostedai").GPUPoolExtended[] = [];
      let blockedPoolIds = new Set<string>();
      try {
        const optimalResult = await selectOptimalPool({
          requestedPoolId: selectedPoolId,
          teamId,
          gpuCount,
          allPools: pools,
          productPoolIds,
        });
        selectedPoolId = optimalResult.pool.id;
        selectedPool = optimalResult.pool;
        fallbackPools = optimalResult.fallbackPools;
        blockedPoolIds = optimalResult.blockedPoolIds;
      } catch (poolErr: any) {
        const status = poolErr.status || 500;
        const message = poolErr.message || "Failed to select GPU pool";
        return NextResponse.json({ error: message }, { status });
      }

      // Handle persistent storage: either use existing shared volume or create new one
      let sharedVolumeIds: number[] = [];

      // Option 1: Attach an existing shared volume (user's previously created volume)
      if (existing_shared_volume_id) {
        console.log("Attaching existing shared volume:", existing_shared_volume_id);
        sharedVolumeIds = [existing_shared_volume_id];
      }
      // Option 2: Create a new shared volume with the specified storage block
      else if (persistent_storage_block_id) {
        try {
          console.log("Creating shared volume for persistent storage:", {
            team_id: teamId,
            region_id: selectedPool?.region_id || 1,
            storage_block_id: persistent_storage_block_id,
          });

          const volumeName = `${name || 'gpu'}-storage-${Date.now()}`;
          const sharedVolume = await createSharedVolume({
            team_id: teamId,
            region_id: selectedPool?.region_id || 1,
            name: volumeName,
            storage_block_id: persistent_storage_block_id,
          });

          console.log("Created shared volume:", sharedVolume);
          sharedVolumeIds = [sharedVolume.id];

          // Wait briefly for volume to be ready
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (storageError) {
          console.error("Failed to create shared volume:", storageError);
        }
      }

      // Fallback: If no storage was selected and user didn't explicitly opt out, auto-create 100GB workspace storage
      if (sharedVolumeIds.length === 0 && !skip_auto_storage) {
        try {
          // First check for existing volumes the team already has
          const existingVolumes = await getSharedVolumes(teamId);
          if (existingVolumes.length > 0) {
            console.log(`[Storage] Auto-attaching existing volume ${existingVolumes[0].id} (${existingVolumes[0].name})`);
            sharedVolumeIds = [existingVolumes[0].id];
          } else {
            // Create a new 100GB volume — find the closest storage block
            const regionId = String(selectedPool?.region_id || 1);
            const storageBlocks = await getPoolPersistentStorageBlocks(regionId, teamId);
            const persistentBlocks = storageBlocks.filter(b => b.shared_storage_usage !== false && b.is_available !== false);

            // Pick closest to 100GB (prefer >= 100GB)
            const sorted = [...persistentBlocks].sort((a, b) => {
              const aSize = a.size_gb || a.size_in_gb || 0;
              const bSize = b.size_gb || b.size_in_gb || 0;
              const aOk = aSize >= 100 ? 0 : 1;
              const bOk = bSize >= 100 ? 0 : 1;
              if (aOk !== bOk) return aOk - bOk;
              return aSize - bSize;
            });

            if (sorted.length > 0) {
              const volumeName = `${name || 'gpu'}-workspace-${Date.now()}`;
              const vol = await createSharedVolume({
                team_id: teamId,
                region_id: selectedPool?.region_id || 1,
                name: volumeName,
                storage_block_id: sorted[0].id,
              });
              console.log(`[Storage] Auto-created 100GB workspace volume ${vol.id}`);
              sharedVolumeIds = [vol.id];
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              console.warn("[Storage] No persistent storage blocks available — launching without workspace storage");
            }
          }
        } catch (autoStorageErr) {
          console.error("[Storage] Auto-create workspace storage failed:", autoStorageErr);
          // Continue without storage rather than failing the launch
        }
      }

      // Helper to clear the deployment lock (defined early so it can be used for early returns)
      const clearDeployLock = async () => {
        try {
          const freshCustomer = await stripe.customers.retrieve(payload.customerId) as Stripe.Customer;
          cacheCustomer(freshCustomer).catch(() => {});
          const updatedMetadata = { ...freshCustomer.metadata };
          delete updatedMetadata[lockKey];
          const unlockedCustomer = await stripe.customers.update(payload.customerId, { metadata: updatedMetadata });
          cacheCustomer(unlockedCustomer as Stripe.Customer).catch(() => {});
          console.log(`[Billing] Released deployment lock for customer ${payload.customerId}`);
        } catch (e) {
          console.error(`[Billing] Failed to release lock:`, e);
        }
      };

      // === AUTO-DETECT MONTHLY PRODUCT: If product_id is provided and product is monthly,
      // find the user's active Stripe subscription automatically (so frontend doesn't need to send it) ===
      let resolvedBillingType = billingType;
      let resolvedStripeSubscriptionId = stripeSubscriptionId;

      if (product_id && !stripeSubscriptionId) {
        try {
          const productForBilling = await prisma.gpuProduct.findUnique({
            where: { id: product_id },
          });
          if (productForBilling && productForBilling.billingType === "monthly" && productForBilling.stripePriceId) {
            console.log(`[Monthly Auto-Detect] Product "${productForBilling.name}" is monthly with stripePriceId=${productForBilling.stripePriceId}`);
            resolvedBillingType = "monthly";

            // Find the user's active subscription for this price by searching Stripe customers by email
            // Monthly subscriptions may be on a separate Stripe customer (created via customer_email checkout)
            const customerEmail = customer.email;
            if (customerEmail) {
              const allCustomers = await stripe.customers.list({ email: customerEmail, limit: 10 });
              for (const stripeCustomer of allCustomers.data) {
                const subs = await stripe.subscriptions.list({
                  customer: stripeCustomer.id,
                  status: "active",
                  limit: 20,
                });
                for (const sub of subs.data) {
                  const hasMatchingPrice = sub.items.data.some(
                    (item) => item.price.id === productForBilling.stripePriceId
                  );
                  if (hasMatchingPrice) {
                    resolvedStripeSubscriptionId = sub.id;
                    console.log(`[Monthly Auto-Detect] Found active subscription ${sub.id} on customer ${stripeCustomer.id}`);
                    break;
                  }
                }
                if (resolvedStripeSubscriptionId) break;
              }
            }

            if (!resolvedStripeSubscriptionId) {
              await clearDeployLock();
              return NextResponse.json(
                { error: "No active subscription found for this monthly product. Please subscribe first at /blackwell." },
                { status: 400 }
              );
            }
          }
        } catch (autoDetectErr) {
          console.error("[Monthly Auto-Detect] Error:", autoDetectErr);
          // Fall through to hourly path if auto-detection fails
        }
      }

      // === MONTHLY SUBSCRIPTION DEPLOY: Skip wallet entirely ===
      const isMonthlyDeploy = resolvedBillingType === "monthly" && resolvedStripeSubscriptionId;

      if (isMonthlyDeploy) {
        // Validate the Stripe subscription is active and belongs to this customer
        try {
          const stripeSub = await stripe.subscriptions.retrieve(resolvedStripeSubscriptionId!);
          if (stripeSub.status !== "active") {
            await clearDeployLock();
            return NextResponse.json(
              { error: "Your subscription is not active. Please check your billing status." },
              { status: 400 }
            );
          }
          // When auto-detected, subscription may be on a different Stripe customer (created via customer_email checkout)
          // so we skip the strict customer ID check and rely on the email-based lookup above
        } catch (subErr) {
          console.error("[Monthly] Failed to verify subscription:", subErr);
          await clearDeployLock();
          return NextResponse.json(
            { error: "Failed to verify subscription. Please try again." },
            { status: 400 }
          );
        }

        // Check entitlement: only 1 GPU per subscription
        const existingMonthlyPod = await prisma.podMetadata.findFirst({
          where: { stripeSubscriptionId: resolvedStripeSubscriptionId },
        });
        if (existingMonthlyPod) {
          // Verify the pod is actually running on hosted.ai before blocking
          // Stale PodMetadata records can be left behind if termination cleanup fails
          let podStillRunning = false;
          try {
            const subs = await getPoolSubscriptions(teamId);
            podStillRunning = subs.some(s => String(s.id) === String(existingMonthlyPod.subscriptionId));
          } catch (e) {
            console.error("[Monthly] Failed to verify existing pod status, assuming still running:", e);
            podStillRunning = true; // Err on the safe side
          }

          if (podStillRunning) {
            await clearDeployLock();
            return NextResponse.json(
              { error: "You already have a GPU deployed for this subscription. Terminate it first to redeploy." },
              { status: 409 }
            );
          }

          // Orphaned record - clean it up and allow deployment
          console.log(`[Monthly] Cleaning up orphaned PodMetadata ${existingMonthlyPod.id} for subscription ${resolvedStripeSubscriptionId}`);
          await prisma.podMetadata.delete({ where: { id: existingMonthlyPod.id } });
        }

        console.log(`[Monthly] Deploying GPU for subscription ${resolvedStripeSubscriptionId} - skipping wallet`);

        // Deploy directly - no wallet check, no pre-charge
        console.log("Subscribing to GPU pool (monthly):", {
          pool_id: selectedPoolId,
          instance_type_id: selectedInstanceType,
          ephemeral_storage_block_id: selectedEphemeralStorage,
          shared_volumes: sharedVolumeIds,
          image_uuid: validImageUuid,
          teamId,
          name,
          vgpus: gpuCount
        });

        let result;
        try {
          const deployResult = await subscribeWithFallback({
            primaryPool: selectedPool!,
            fallbackPools,
            subscribeParams: {
              team_id: teamId,
              vgpus: gpuCount,
              instance_type_id: selectedInstanceType,
              ephemeral_storage_block_id: selectedEphemeralStorage,
              shared_volumes: sharedVolumeIds,
              image_uuid: validImageUuid,
            },
          });
          result = { subscription_id: deployResult.subscription_id };
          selectedPoolId = deployResult.pool.id;
          selectedPool = deployResult.pool;
        } catch (deployError) {
          await clearDeployLock();
          throw deployError;
        }

        await clearDeployLock();

        const subscriptionId = result!.subscription_id;
        const deployTime = new Date();
        const metricsToken = randomBytes(32).toString("hex");

        // Save pod metadata with monthly billing info
        try {
          await prisma.podMetadata.create({
            data: {
              subscriptionId: String(subscriptionId),
              stripeCustomerId: payload.customerId,
              displayName: name,
              deployTime,
              prepaidUntil: null,
              prepaidAmountCents: 0,
              poolId: String(selectedPoolId),
              productId: product_id || null,
              hourlyRateCents: 0, // Monthly = no hourly rate
              metricsToken,
              startupScript: startup_script || null,
              startupScriptStatus: "pending", // Always pending — workspace setup always runs
              billingType: "monthly",
              stripeSubscriptionId: resolvedStripeSubscriptionId,
              sharedVolumeId: sharedVolumeIds[0] || null,
            },
          });
          console.log(`[Monthly] Saved billing metadata for subscription ${subscriptionId}`);

          // Increment activePods in CustomerCache
          prisma.customerCache.update({
            where: { id: payload.customerId },
            data: { activePods: { increment: 1 } },
          }).catch(() => {});

          installMetricsCollector(String(subscriptionId), teamId, metricsToken).catch((err) => {
            console.error(`[Metrics] Failed to install metrics collector for ${subscriptionId}:`, err);
          });

          // Always run workspace setup + user startup script (MOTD banner is also prepended)
          const fullStartupScript = WORKSPACE_SETUP_SCRIPT + "\n" + (startup_script || "");
          runStartupScript(String(subscriptionId), teamId, fullStartupScript, startup_script_preset_id).catch((err) => {
            console.error(`[Startup] Failed to run startup script for ${subscriptionId}:`, err);
          });
        } catch (metadataError) {
          console.error("Failed to save monthly pod metadata:", metadataError);
        }

        // Get pool name for logging
        let poolName = name || "GPU Pool";
        if (selectedPool?.name) {
          poolName = selectedPool.name;
        }

        // Check if this is the customer's first GPU launch
        const priorMonthlyGpuLaunch = await getFirstGpuLaunch(payload.customerId);

        await logGPULaunched(payload.customerId, poolName, gpuCount, name, String(subscriptionId));

        // Send onboarding event for GPU launch
        const monthlyGpuProduct = product_id ? await prisma.gpuProduct.findUnique({ where: { id: product_id } }).catch(() => null) : null;
        sendOnboardingEvent({
          type: "gpu.launched",
          email: payload.email,
          name: customer.name || customer.email?.split("@")[0] || "Unknown",
          metadata: {
            "Stripe Customer ID": payload.customerId,
            "GPU Type": monthlyGpuProduct?.name || product_id || "Unknown",
            "Pool Name": poolName,
            "Pod Name": name,
            "GPU Count": gpuCount,
            "Billing Type": "monthly",
            "Stripe Subscription": resolvedStripeSubscriptionId || null,
            "Subscription ID": String(subscriptionId),
            "First GPU": !priorMonthlyGpuLaunch ? "Yes" : "No",
          },
        });

        // Send email notification
        try {
          const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
          const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
          await sendGpuLaunchedEmail({
            to: customer.email!,
            customerName: customer.name || customer.email!.split("@")[0],
            poolName,
            gpuCount,
            dashboardUrl,
          });
        } catch (emailError) {
          console.error("Failed to send GPU launched email:", emailError);
        }

        return NextResponse.json({
          success: true,
          subscription_id: subscriptionId,
          message: "Monthly GPU deployed successfully"
        });
      }

      // === HOURLY BILLING: Get pricing info first, then deploy, then charge on success ===
      // Pricing MUST come from GpuProduct - no static fallback
      let hourlyRateCents = 0;

      if (product_id) {
        try {
          const product = await prisma.gpuProduct.findUnique({
            where: { id: product_id },
          });
          if (product && product.pricePerHourCents > 0) {
            hourlyRateCents = product.pricePerHourCents;
            console.log(`[Billing] Using product "${product.name}" pricing: $${(hourlyRateCents / 100).toFixed(2)}/hr`);
          }
        } catch (productErr) {
          console.error("Failed to look up product pricing:", productErr);
        }
      }

      // Require valid product pricing
      if (hourlyRateCents === 0) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No valid pricing found. Please select a GPU product with configured pricing." },
          { status: 400 }
        );
      }

      const prepaidMinutes = MINIMUM_BILLING_MINUTES;
      const prepaidAmountCents = Math.round((prepaidMinutes / 60) * hourlyRateCents * gpuCount);

      // CRITICAL: Check wallet balance AND charge BEFORE deploying
      // This is atomic: charge first, deploy second, refund if deploy fails
      const walletBalance = await getWalletBalance(payload.customerId);
      if (walletBalance.availableBalance < prepaidAmountCents) {
        await clearDeployLock();
        return NextResponse.json(
          {
            error: `Whoa there, GPU adventurer! 🚀 Your wallet's looking a bit light for this journey. You'll need at least $${(prepaidAmountCents / 100).toFixed(2)} to get started (you've got $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet and let's get those GPUs spinning!`,
          },
          { status: 402 }
        );
      }

      // CHARGE BEFORE DEPLOYMENT - deduct from wallet upfront
      const deployTime = new Date();
      const prepaidUntil = new Date(deployTime.getTime() + prepaidMinutes * 60 * 1000);
      const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;

      console.log(`[Billing] Pre-charging ${prepaidMinutes} minutes: $${(prepaidAmountCents / 100).toFixed(2)} for ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr BEFORE deployment`);

      const deductResult = await deductUsage(
        payload.customerId,
        (prepaidMinutes / 60) * gpuCount,
        `GPU deploy: pool ${String(selectedPoolId).slice(0, 8)} - ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
        hourlyRateCents,
        preDeployId
      );

      if (!deductResult.success) {
        await clearDeployLock();
        console.error(`[Billing] Failed to pre-charge wallet:`, deductResult.error);
        return NextResponse.json(
          { error: "Failed to process payment. Please try again." },
          { status: 402 }
        );
      }

      console.log(`[Billing] Pre-charged $${(prepaidAmountCents / 100).toFixed(2)} successfully. Now deploying...`);

      console.log("Subscribing to GPU pool:", {
        pool_id: selectedPoolId,
        instance_type_id: selectedInstanceType,
        ephemeral_storage_block_id: selectedEphemeralStorage,
        shared_volumes: sharedVolumeIds,
        image_uuid: validImageUuid,
        teamId,
        name,
        vgpus: gpuCount
      });

      // DEPLOY AFTER PAYMENT - refund if deployment fails
      // Uses subscribeWithFallback to automatically retry on "Insufficient resources"
      let result;
      try {
        const deployResult = await subscribeWithFallback({
          primaryPool: selectedPool!,
          fallbackPools,
          subscribeParams: {
            team_id: teamId,
            vgpus: gpuCount,
            instance_type_id: selectedInstanceType,
            ephemeral_storage_block_id: selectedEphemeralStorage,
            shared_volumes: sharedVolumeIds,
            image_uuid: validImageUuid,
          },
        });
        result = { subscription_id: deployResult.subscription_id };
        selectedPoolId = deployResult.pool.id;
        selectedPool = deployResult.pool;
      } catch (deployError) {
        const errMsg = deployError instanceof Error ? deployError.message : "";
        console.log(`[Billing] Deployment failed, refunding pre-charge of $${(prepaidAmountCents / 100).toFixed(2)}`);
        await refundDeployment(
          payload.customerId,
          prepaidAmountCents,
          `Refund: deployment failed - ${errMsg.slice(0, 100)}`
        );
        await clearDeployLock();
        throw deployError;
      }

      // Deployment succeeded - clear lock (allow future deployments to same pool if needed)
      await clearDeployLock();

      // Deployment succeeded - payment was already taken, log the transaction
      const subscriptionId = result!.subscription_id;
      const deployId = `deploy_${subscriptionId}`;

      console.log(`[Billing] Deployment succeeded. Pre-charge of $${(prepaidAmountCents / 100).toFixed(2)} confirmed. Prepaid until: ${prepaidUntil.toISOString()}`);

      // Log deploy charge to local WalletTransaction table
      await prisma.walletTransaction.create({
        data: {
          stripeCustomerId: payload.customerId,
          teamId,
          type: "gpu_deploy",
          amountCents: prepaidAmountCents,
          description: `GPU deploy: pool ${String(selectedPoolId).slice(0, 8)} - ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
          subscriptionId: String(subscriptionId),
          poolId: typeof selectedPoolId === "number" ? selectedPoolId : parseInt(String(selectedPoolId), 10) || null,
          gpuCount,
          hourlyRateCents,
          billingMinutes: prepaidMinutes,
          syncCycleId: deployId,
        },
      }).catch((e) => console.error(`[Billing] Failed to log WalletTransaction for deploy:`, e));

      // Get pool name for logging
      let poolName = name || "GPU Pool";
      if (selectedPool?.name) {
        poolName = selectedPool.name;
      }

      // Check if this is the customer's first GPU launch
      const priorHourlyGpuLaunch = await getFirstGpuLaunch(payload.customerId);

      // Log the activity (include pod name for tracking)
      await logGPULaunched(payload.customerId, poolName, gpuCount, name, String(subscriptionId));

      // Send onboarding event for GPU launch
      const hourlyGpuProduct = product_id ? await prisma.gpuProduct.findUnique({ where: { id: product_id } }).catch(() => null) : null;
      sendOnboardingEvent({
        type: "gpu.launched",
        email: payload.email,
        name: customer.name || customer.email?.split("@")[0] || "Unknown",
        metadata: {
          "Stripe Customer ID": payload.customerId,
          "GPU Type": hourlyGpuProduct?.name || product_id || "Unknown",
          "Pool Name": poolName,
          "Pod Name": name,
          "GPU Count": gpuCount,
          "Billing Type": "hourly",
          "Hourly Rate": `$${(hourlyRateCents / 100).toFixed(2)}/hr`,
          "Prepaid Amount": `$${(prepaidAmountCents / 100).toFixed(2)}`,
          "Subscription ID": String(subscriptionId),
          "First GPU": !priorHourlyGpuLaunch ? "Yes" : "No",
        },
      });

      // Generate a metrics token for push-based metrics collection
      const metricsToken = randomBytes(32).toString("hex");

      // Check if subscription is pending (need to poll for actual ID)
      const isPending = subscriptionId.startsWith("pending-");

      if (isPending) {
        // Poll for actual subscription ID in background - don't block the response
        console.log(`[Billing] Subscription pending, will poll for actual ID in background`);

        // Start background polling for the real subscription ID
        (async () => {
          const { clearCache, getPoolSubscriptions } = await import("@/lib/hostedai");
          for (let i = 0; i < 15; i++) { // Try for up to 30 seconds
            await new Promise(resolve => setTimeout(resolve, 2000));
            clearCache(`pool-subscriptions:${teamId}`);
            const subs = await getPoolSubscriptions(teamId);
            const newSub = subs.find(s =>
              String(s.pool_id) === String(selectedPoolId) &&
              (s.status === "subscribing" || s.status === "subscribed" || s.status === "active")
            );
            if (newSub) {
              console.log(`[Billing] Found actual subscription ID: ${newSub.id}`);
              // Save metadata now that we have the real ID
              try {
                await prisma.podMetadata.create({
                  data: {
                    subscriptionId: String(newSub.id),
                    stripeCustomerId: payload.customerId,
                    displayName: name,
                    deployTime,
                    prepaidUntil,
                    prepaidAmountCents,
                    poolId: String(selectedPoolId),
                    productId: product_id || null,
                    hourlyRateCents,
                    metricsToken,
                    startupScript: startup_script || null,
                    startupScriptStatus: "pending", // Always pending — workspace setup always runs
                    sharedVolumeId: sharedVolumeIds[0] || null,
                  },
                });
                console.log(`[Billing] Saved billing metadata for subscription ${newSub.id}`);
                installMetricsCollector(String(newSub.id), teamId, metricsToken).catch((err) => {
                  console.error(`[Metrics] Failed to install metrics collector for ${newSub.id}:`, err);
                });
                // Always run workspace setup + user startup script (MOTD banner is also prepended)
                const fullStartupScript2 = WORKSPACE_SETUP_SCRIPT + "\n" + (startup_script || "");
                runStartupScript(String(newSub.id), teamId, fullStartupScript2, startup_script_preset_id).catch((err) => {
                  console.error(`[Startup] Failed to run startup script for ${newSub.id}:`, err);
                });
              } catch (e) {
                console.error(`[Billing] Failed to save metadata for ${newSub.id}:`, e);
              }
              return;
            }
          }
          console.error(`[Billing] Could not find subscription for pool ${selectedPoolId} after 30 seconds`);
        })();

        // Return immediately - don't wait for the background poll
        return NextResponse.json({
          success: true,
          subscription_id: "pending",
          message: "GPU deployment started - check dashboard for status"
        });
      }

      // Save the user's display name and billing info to PodMetadata
      try {
        await prisma.podMetadata.create({
          data: {
            subscriptionId: String(subscriptionId),
            stripeCustomerId: payload.customerId,
            displayName: name,
            // Billing fields for upfront charging
            deployTime,
            prepaidUntil,
            prepaidAmountCents,
            poolId: String(selectedPoolId),
            productId: product_id || null, // Store product ID for ongoing billing
            hourlyRateCents,
            metricsToken, // Token for pod to push metrics
            // Startup script fields
            startupScript: startup_script || null,
            startupScriptStatus: "pending", // Always pending — workspace setup always runs
            sharedVolumeId: sharedVolumeIds[0] || null,
          },
        });
        console.log(`[Billing] Saved billing metadata for subscription ${subscriptionId}`);

        // Increment activePods in CustomerCache
        prisma.customerCache.update({
          where: { id: payload.customerId },
          data: { activePods: { increment: 1 } },
        }).catch(() => {});

        // Schedule metrics collector and startup script installation (runs in background)
        installMetricsCollector(String(subscriptionId), teamId, metricsToken).catch((err) => {
          console.error(`[Metrics] Failed to install metrics collector for ${subscriptionId}:`, err);
        });

        // Always run workspace setup + user startup script (MOTD banner is also prepended)
        const fullStartupScript3 = WORKSPACE_SETUP_SCRIPT + "\n" + (startup_script || "");
        runStartupScript(String(subscriptionId), teamId, fullStartupScript3, startup_script_preset_id).catch((err) => {
          console.error(`[Startup] Failed to run startup script for ${subscriptionId}:`, err);
        });
      } catch (metadataError) {
        // Log but don't fail the request if metadata save fails
        console.error("Failed to save pod metadata:", metadataError);
      }

      // Send email notification
      try {
        const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
        await sendGpuLaunchedEmail({
          to: customer.email!,
          customerName: customer.name || customer.email!.split("@")[0],
          poolName,
          gpuCount,
          dashboardUrl,
        });
      } catch (emailError) {
        console.error("Failed to send GPU launched email:", emailError);
      }

      return NextResponse.json({
        success: true,
        subscription_id: subscriptionId,
        message: "GPU pool subscription created successfully"
      });
    }

    // Traditional instance creation (requires all fields)
    if (!service_id || !instance_type_id || !image_hash_id || !storage_block_id) {
      return NextResponse.json(
        { error: "Missing required fields for instance creation" },
        { status: 400 }
      );
    }

    const instance = await createInstance({
      name,
      service_id,
      instance_type_id,
      image_hash_id,
      storage_block_id,
      team_id: teamId,
    });

    return NextResponse.json({ instance });
  } catch (error) {
    console.error("Create instance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create instance";

    // Provide user-friendly messages for known error codes
    if (errorMessage.includes("Insufficient resources") || errorMessage.includes("10189007")) {
      return NextResponse.json(
        { error: "No GPUs currently available in this pool. Please try again later or select a different GPU pool." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// Metrics collector and startup script runner are imported from shared modules
import { runStartupScript } from "@/lib/startup-script-runner";
import { WORKSPACE_SETUP_SCRIPT } from "@/lib/startup-scripts";

// ============================================================
// HAI 2.2 Unified Instance Creation Handler
// Uses create-instance API instead of pool subscription
// ============================================================

interface UnifiedCreateParams {
  request: NextRequest;
  body: Record<string, unknown>;
  gpuProduct: {
    id: string;
    name: string;
    serviceId: string | null;
    pricePerHourCents: number;
    billingType: string;
    stripePriceId: string | null;
  };
  teamId: string;
  customer: Stripe.Customer;
  payload: { email: string; customerId: string };
  stripe: Stripe;
}

async function handleUnifiedInstanceCreate({
  body,
  gpuProduct,
  teamId,
  customer,
  payload,
  stripe,
}: UnifiedCreateParams): Promise<NextResponse> {
  const {
    name,
    instance_type_id,
    image_uuid,
    image_hash_id,
    storage_block_id,
    persistent_storage_block_id,
    existing_shared_volume_id,
    skip_auto_storage,
    startup_script,
    startup_script_preset_id,
    billingType: requestedBillingType,
    stripeSubscriptionId,
  } = body as Record<string, string | number | boolean | undefined>;

  const serviceId = gpuProduct.serviceId!;
  const gpuCount = 1; // Unified instances are single-GPU

  // DEPLOYMENT LOCK
  const lockKey = "deploy_lock";
  const lockTimestamp = customer.metadata?.[lockKey];
  const now = Math.floor(Date.now() / 1000);

  if (lockTimestamp) {
    const lockTime = parseInt(lockTimestamp, 10);
    if (now - lockTime < 60) {
      return NextResponse.json(
        { error: "Another GPU deployment is in progress. Please wait a moment." },
        { status: 429 }
      );
    }
  }

  try {
    await stripe.customers.update(payload.customerId, {
      metadata: { ...customer.metadata, [lockKey]: now.toString() },
    });
  } catch (lockErr) {
    console.error("[Billing] Failed to acquire lock:", lockErr);
  }

  const clearDeployLock = async () => {
    try {
      const fresh = await stripe.customers.retrieve(payload.customerId) as Stripe.Customer;
      cacheCustomer(fresh).catch(() => {});
      const meta = { ...fresh.metadata };
      delete meta[lockKey];
      const unlocked = await stripe.customers.update(payload.customerId, { metadata: meta });
      cacheCustomer(unlocked as Stripe.Customer).catch(() => {});
    } catch (e) {
      console.error("[Billing] Failed to release lock:", e);
    }
  };

  try {
    // Resolve instance_type_id if not provided (auto-select from service)
    let selectedInstanceType = instance_type_id as string | undefined;
    if (!selectedInstanceType) {
      const types = await getInstanceTypes(serviceId, teamId);
      if (types.length > 0) {
        // Pick the first available — service should have instance_type_locked
        selectedInstanceType = types[0].id;
        console.log(`[HAI 2.2] Auto-selected instance type: ${types[0].name} (${selectedInstanceType})`);
      } else {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No compatible instance types available for this GPU" },
          { status: 400 }
        );
      }
    }

    // Resolve image — use image_hash_id, image_uuid, or auto-select from service
    let selectedImage = (image_hash_id || image_uuid) as string | undefined;
    if (!selectedImage) {
      const images = await getCompatibleImages(serviceId, teamId);
      if (images.length > 0) {
        selectedImage = images[0].id;
        console.log(`[HAI 2.2] Auto-selected image: ${images[0].name} (${selectedImage})`);
      } else {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No compatible images available for this GPU" },
          { status: 400 }
        );
      }
    }

    // Resolve storage_block_id if not provided
    let selectedStorage = storage_block_id as string | undefined;
    if (!selectedStorage) {
      const blocks = await getStorageBlocks();
      // Filter for ephemeral-capable blocks
      const ephemeral = blocks.filter(b => b.is_available !== false);
      if (ephemeral.length > 0) {
        selectedStorage = ephemeral[0].id;
        console.log(`[HAI 2.2] Auto-selected storage: ${ephemeral[0].name} (${selectedStorage})`);
      } else {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No storage blocks available" },
          { status: 400 }
        );
      }
    }

    // Handle persistent storage (additional disks)
    const additionalDisks: Array<{ storage_block_id: string; disk_position: number }> = [];

    if (existing_shared_volume_id) {
      // Existing shared volumes are attached via workspace_id in 2.2
      console.log("[HAI 2.2] Attaching existing shared volume:", existing_shared_volume_id);
    } else if (persistent_storage_block_id) {
      additionalDisks.push({
        storage_block_id: persistent_storage_block_id as string,
        disk_position: 1,
      });
    } else if (!skip_auto_storage) {
      // Auto-create workspace storage — find persistent storage blocks
      try {
        const existingVolumes = await getSharedVolumes(teamId);
        if (existingVolumes.length === 0) {
          const storageBlocks = await getStorageBlocks();
          const persistent = storageBlocks.filter(b => b.shared_storage_usage !== false && b.is_available !== false);
          const sorted = [...persistent].sort((a, b) => {
            const aSize = a.size_gb || a.size_in_gb || 0;
            const bSize = b.size_gb || b.size_in_gb || 0;
            const aOk = aSize >= 100 ? 0 : 1;
            const bOk = bSize >= 100 ? 0 : 1;
            if (aOk !== bOk) return aOk - bOk;
            return aSize - bSize;
          });
          if (sorted.length > 0) {
            additionalDisks.push({
              storage_block_id: sorted[0].id,
              disk_position: 1,
            });
          }
        }
      } catch (autoStorageErr) {
        console.error("[HAI 2.2] Auto-create workspace storage failed:", autoStorageErr);
      }
    }

    // === MONTHLY BILLING FLOW ===
    let resolvedBillingType = requestedBillingType as string | undefined;
    let resolvedStripeSubId = stripeSubscriptionId as string | undefined;

    if (!resolvedStripeSubId && gpuProduct.billingType === "monthly" && gpuProduct.stripePriceId) {
      resolvedBillingType = "monthly";
      const customerEmail = customer.email;
      if (customerEmail) {
        const allCustomers = await stripe.customers.list({ email: customerEmail, limit: 10 });
        for (const sc of allCustomers.data) {
          const subs = await stripe.subscriptions.list({ customer: sc.id, status: "active", limit: 20 });
          for (const sub of subs.data) {
            if (sub.items.data.some(item => item.price.id === gpuProduct.stripePriceId)) {
              resolvedStripeSubId = sub.id;
              break;
            }
          }
          if (resolvedStripeSubId) break;
        }
      }
      if (!resolvedStripeSubId) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No active subscription found for this monthly product." },
          { status: 400 }
        );
      }
    }

    const isMonthlyDeploy = resolvedBillingType === "monthly" && resolvedStripeSubId;

    // === WALLET CHECK (hourly only) ===
    const hourlyRateCents = gpuProduct.pricePerHourCents;
    const prepaidMinutes = MINIMUM_BILLING_MINUTES;
    const prepaidAmountCents = Math.round((prepaidMinutes / 60) * hourlyRateCents * gpuCount);
    let deployTime = new Date();
    let prepaidUntil: Date | null = null;

    if (isMonthlyDeploy) {
      // Validate Stripe subscription
      const stripeSub = await stripe.subscriptions.retrieve(resolvedStripeSubId!);
      if (stripeSub.status !== "active") {
        await clearDeployLock();
        return NextResponse.json(
          { error: "Your subscription is not active." },
          { status: 400 }
        );
      }
      // Check entitlement: 1 GPU per subscription
      const existing = await prisma.podMetadata.findFirst({
        where: { stripeSubscriptionId: resolvedStripeSubId },
      });
      if (existing) {
        // Check if pod actually running
        let stillRunning = false;
        try {
          const instances = await getTeamInstances(teamId);
          stillRunning = instances.some(i => i.id === existing.instanceId);
        } catch {
          stillRunning = true;
        }
        if (stillRunning) {
          await clearDeployLock();
          return NextResponse.json(
            { error: "You already have a GPU deployed for this subscription. Terminate it first to redeploy." },
            { status: 409 }
          );
        }
        await prisma.podMetadata.delete({ where: { id: existing.id } });
      }
    } else {
      // Hourly billing — check wallet and pre-charge
      if (hourlyRateCents === 0) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "No valid pricing found." },
          { status: 400 }
        );
      }

      const walletBalance = await getWalletBalance(payload.customerId);
      if (walletBalance.availableBalance < prepaidAmountCents) {
        await clearDeployLock();
        return NextResponse.json(
          { error: `Insufficient wallet balance. Need $${(prepaidAmountCents / 100).toFixed(2)}, have $${(walletBalance.availableBalance / 100).toFixed(2)}.` },
          { status: 402 }
        );
      }

      deployTime = new Date();
      prepaidUntil = new Date(deployTime.getTime() + prepaidMinutes * 60 * 1000);
      const preDeployId = `predeploy_${payload.customerId}_${Date.now()}`;

      const deductResult = await deductUsage(
        payload.customerId,
        (prepaidMinutes / 60) * gpuCount,
        `GPU deploy: ${gpuProduct.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
        hourlyRateCents,
        preDeployId
      );

      if (!deductResult.success) {
        await clearDeployLock();
        return NextResponse.json(
          { error: "Failed to process payment. Please try again." },
          { status: 402 }
        );
      }
    }

    // === DEPLOY via create-instance ===
    console.log("[HAI 2.2] Creating instance:", {
      name: name as string,
      service_id: serviceId,
      instance_type_id: selectedInstanceType,
      image_hash_id: selectedImage,
      storage_block_id: selectedStorage,
      team_id: teamId,
      additional_disks: additionalDisks.length > 0 ? additionalDisks : undefined,
    });

    let instance: Instance;
    try {
      instance = await createInstance({
        name: name as string,
        service_id: serviceId,
        instance_type_id: selectedInstanceType,
        image_hash_id: selectedImage,
        storage_block_id: selectedStorage,
        team_id: teamId,
        additional_disks: additionalDisks.length > 0 ? additionalDisks : undefined,
      });
    } catch (deployError) {
      if (!isMonthlyDeploy && prepaidAmountCents > 0) {
        const errMsg = deployError instanceof Error ? deployError.message : "";
        console.log(`[Billing] Deployment failed, refunding $${(prepaidAmountCents / 100).toFixed(2)}`);
        await refundDeployment(
          payload.customerId,
          prepaidAmountCents,
          `Refund: deployment failed - ${errMsg.slice(0, 100)}`
        );
      }
      await clearDeployLock();
      throw deployError;
    }

    await clearDeployLock();

    const instanceId = instance.id;
    const metricsToken = randomBytes(32).toString("hex");

    // Save PodMetadata with instanceId
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: `instance-${instanceId}`, // Unique placeholder for legacy compat
          instanceId,
          stripeCustomerId: payload.customerId,
          displayName: name as string,
          deployTime,
          prepaidUntil: isMonthlyDeploy ? null : prepaidUntil,
          prepaidAmountCents: isMonthlyDeploy ? 0 : prepaidAmountCents,
          poolId: null,
          productId: gpuProduct.id,
          hourlyRateCents: isMonthlyDeploy ? 0 : hourlyRateCents,
          metricsToken,
          startupScript: (startup_script as string) || null,
          startupScriptStatus: "pending",
          billingType: isMonthlyDeploy ? "monthly" : "hourly",
          stripeSubscriptionId: resolvedStripeSubId || null,
        },
      });
      console.log(`[HAI 2.2] Saved PodMetadata for instance ${instanceId}`);

      // Install metrics collector and run startup script
      installMetricsCollector(instanceId, teamId, metricsToken).catch((err) => {
        console.error(`[Metrics] Failed to install for ${instanceId}:`, err);
      });

      const fullStartup = WORKSPACE_SETUP_SCRIPT + "\n" + ((startup_script as string) || "");
      runStartupScript(instanceId, teamId, fullStartup, startup_script_preset_id as string | undefined).catch((err) => {
        console.error(`[Startup] Failed for ${instanceId}:`, err);
      });
    } catch (metaErr) {
      console.error("[HAI 2.2] Failed to save PodMetadata:", metaErr);
    }

    // Log wallet transaction (hourly only)
    if (!isMonthlyDeploy && prepaidAmountCents > 0) {
      await prisma.walletTransaction.create({
        data: {
          stripeCustomerId: payload.customerId,
          teamId,
          type: "gpu_deploy",
          amountCents: prepaidAmountCents,
          description: `GPU deploy: ${gpuProduct.name} @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
          subscriptionId: instanceId,
          gpuCount,
          hourlyRateCents,
          billingMinutes: prepaidMinutes,
          syncCycleId: `deploy_${instanceId}`,
        },
      }).catch((e) => console.error("[Billing] Failed to log WalletTransaction:", e));
    }

    // Activity logging and email
    const priorLaunch = await getFirstGpuLaunch(payload.customerId);
    await logGPULaunched(payload.customerId, gpuProduct.name, gpuCount, name as string, instanceId);

    sendOnboardingEvent({
      type: "gpu.launched",
      email: payload.email,
      name: customer.name || customer.email?.split("@")[0] || "Unknown",
      metadata: {
        "Stripe Customer ID": payload.customerId,
        "GPU Type": gpuProduct.name,
        "Pod Name": name as string,
        "GPU Count": gpuCount,
        "Billing Type": isMonthlyDeploy ? "monthly" : "hourly",
        "Instance ID": instanceId,
        "First GPU": !priorLaunch ? "Yes" : "No",
      },
    });

    try {
      const dashboardToken = generateCustomerToken(payload.email.toLowerCase(), payload.customerId);
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;
      await sendGpuLaunchedEmail({
        to: customer.email!,
        customerName: customer.name || customer.email!.split("@")[0],
        poolName: gpuProduct.name,
        gpuCount,
        dashboardUrl,
      });
    } catch (emailErr) {
      console.error("Failed to send GPU launched email:", emailErr);
    }

    return NextResponse.json({
      success: true,
      instance_id: instanceId,
      message: isMonthlyDeploy ? "Monthly GPU deployed successfully" : "GPU deployed successfully",
    });
  } catch (error) {
    await clearDeployLock();
    console.error("[HAI 2.2] Create instance error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create instance";

    if (errorMessage.includes("Insufficient resources") || errorMessage.includes("10189007")) {
      return NextResponse.json(
        { error: "No GPUs currently available. Please try again later." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
