import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateApiKey,
  success,
  created,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import {
  getTeamInstances,
  subscribeToPool,
  getPoolSubscriptions,
  getAllPools,
  getPoolEphemeralStorageBlocks,
  createSharedVolume,
  getSharedVolumes,
  selectOptimalPool,
  subscribeWithFallback,
} from "@/lib/hostedai";
import { getWalletBalance, deductUsage, refundDeployment } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { recordFirstGpuDeploy, addSpend } from "@/lib/lifecycle";

/**
 * @swagger
 * /api/v1/instances:
 *   get:
 *     summary: List all instances
 *     description: Returns all GPU instances and pool subscriptions for your team
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: List of instances and subscriptions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get instances for the team
    let instances: Awaited<ReturnType<typeof getTeamInstances>> = [];
    try {
      instances = await getTeamInstances(auth.teamId);
    } catch (e) {
      console.error("Failed to fetch instances:", e);
    }

    // Fetch pool subscriptions with metrics
    let poolSubscriptions: Awaited<ReturnType<typeof getPoolSubscriptions>> = [];
    try {
      poolSubscriptions = await getPoolSubscriptions(auth.teamId, "last_5m");
    } catch (e) {
      console.error("Failed to fetch pool subscriptions:", e);
    }

    // Fetch pod metadata
    const subscriptionIds = poolSubscriptions.map(s => String(s.id));
    let podMetadata: Record<string, { displayName: string | null; notes: string | null }> = {};

    if (subscriptionIds.length > 0) {
      try {
        // Fetch metadata for real subscription IDs
        const metadata = await prisma.podMetadata.findMany({
          where: { subscriptionId: { in: subscriptionIds } },
        });
        podMetadata = metadata.reduce((acc, m) => {
          acc[m.subscriptionId] = { displayName: m.displayName, notes: m.notes };
          return acc;
        }, {} as Record<string, { displayName: string | null; notes: string | null }>);

        // Also fetch pending metadata and try to resolve to real subscriptions
        // This handles cases where the API returned a pending ID initially
        const pendingMetadata = await prisma.podMetadata.findMany({
          where: { subscriptionId: { startsWith: "pending-" } },
        });

        // Try to match pending metadata to real subscriptions by pool_id and time
        for (const pending of pendingMetadata) {
          // Extract pool_id and timestamp from pending ID (format: pending-{poolId}-{timestamp})
          const parts = pending.subscriptionId.split("-");
          if (parts.length >= 3) {
            const pendingPoolId = parts[1];
            const pendingTimestamp = parseInt(parts[2], 10);

            // Find a real subscription with matching pool_id that was created around the same time
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
                console.log(`[API] Resolved pending metadata ${pending.subscriptionId} -> ${matchingSub.id}`);
                podMetadata[String(matchingSub.id)] = { displayName: pending.displayName, notes: pending.notes };
              } catch {
                // Might fail if another request already updated it - that's fine
              }
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch pod metadata:", e);
      }
    }

    return withRateLimitHeaders(
      success({ instances, poolSubscriptions, podMetadata }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/instances:
 *   post:
 *     summary: Create a new GPU instance
 *     description: Subscribe to a GPU pool to launch a new instance
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - pool_id
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name for the instance
 *               pool_id:
 *                 type: string
 *                 description: GPU pool ID to subscribe to
 *               vgpus:
 *                 type: integer
 *                 description: Number of vGPUs (default 1)
 *               instance_type_id:
 *                 type: string
 *                 description: Optional instance type ID
 *               image_uuid:
 *                 type: string
 *                 description: Optional image UUID
 *               ephemeral_storage_block_id:
 *                 type: string
 *                 description: Optional ephemeral storage block ID
 *               persistent_storage_block_id:
 *                 type: string
 *                 description: Optional persistent storage block ID - creates new volume (data persists across restarts)
 *               existing_shared_volume_id:
 *                 type: integer
 *                 description: Optional ID of existing shared volume to attach (survives pod termination)
 *     responses:
 *       201:
 *         description: Instance created successfully
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "launch");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const {
      name,
      pool_id,
      vgpus = 1,
      instance_type_id,
      image_uuid,
      ephemeral_storage_block_id,
      persistent_storage_block_id, // Create new volume with this storage block
      existing_shared_volume_id, // Attach existing shared volume by ID
      startup_script,
      startup_script_preset_id,
    } = body;

    if (!name) {
      throw ApiError.missingField("name");
    }

    if (!pool_id) {
      throw ApiError.missingField("pool_id");
    }

    // Enforce single GPU per pod - multi-GPU creates multiple pods which UI doesn't support
    if (vgpus > 1) {
      throw ApiError.badRequest("Multi-GPU is not supported. Each pod can only have 1 GPU.");
    }

    const gpuCount = 1; // Always 1 GPU per pod

    // Get pool info
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === String(pool_id));
    const regionId = pool?.region_id || 2;

    // Get instance type if not provided
    let selectedInstanceType = instance_type_id;
    if (!selectedInstanceType) {
      const apiUrl = process.env.HOSTEDAI_API_URL!;
      const apiKey = process.env.HOSTEDAI_API_KEY!;

      const response = await fetch(`${apiUrl}/api/instance-type`, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const allTypes = await response.json() as Array<{
          id: string;
          name: string;
          memory_mb: number;
          vcpus: number;
          gpu_workload: boolean;
          is_available: boolean;
        }>;

        const gpuTypes = allTypes
          .filter(t => t.gpu_workload === true && t.is_available !== false)
          .sort((a, b) => a.memory_mb - b.memory_mb);

        if (gpuTypes.length === 0) {
          throw ApiError.serviceUnavailable("No GPU-compatible instance types available");
        }

        const mediumType = gpuTypes.find(t => t.name === "Medium");
        selectedInstanceType = mediumType ? mediumType.id : gpuTypes[0].id;
      } else {
        throw ApiError.internal("Failed to fetch instance types");
      }
    }

    // Get ephemeral storage (use provided or fetch default)
    let selectedEphemeralStorage = ephemeral_storage_block_id;
    if (!selectedEphemeralStorage) {
      try {
        const storageBlocks = await getPoolEphemeralStorageBlocks(String(regionId), auth.teamId);
        if (storageBlocks.length > 0) {
          selectedEphemeralStorage = storageBlocks[0].id;
        }
      } catch (e) {
        console.error("Failed to get ephemeral storage:", e);
      }
    }

    if (!selectedEphemeralStorage) {
      throw ApiError.serviceUnavailable("No compatible ephemeral storage available");
    }

    // CRITICAL: Select the optimal pool using centralized logic
    // Enforces: 1) one pod per pool per user, 2) least-used pool first
    let selectedPool = pool;
    let fallbackPools: Awaited<ReturnType<typeof selectOptimalPool>>["fallbackPools"] = [];
    try {
      const optimalResult = await selectOptimalPool({
        requestedPoolId: pool_id,
        teamId: auth.teamId,
        gpuCount,
        allPools: pools,
      });
      selectedPool = optimalResult.pool;
      fallbackPools = optimalResult.fallbackPools;
    } catch (poolErr: any) {
      const status = poolErr.status || 500;
      throw status === 409
        ? ApiError.conflict(poolErr.message)
        : status === 503
        ? ApiError.serviceUnavailable(poolErr.message)
        : ApiError.internal(poolErr.message);
    }
    const selectedPoolId = String(selectedPool?.id ?? pool_id);

    // Validate image UUID format
    const isValidUUID = image_uuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(image_uuid);
    const validImageUuid = isValidUUID ? image_uuid : "";

    // CRITICAL: Check wallet balance BEFORE deploying
    const MINIMUM_BILLING_MINUTES = 30;
    const product = await getProductByPoolId(selectedPoolId);
    const hourlyRateCents = product?.hourly_rate_cents || 0;

    if (hourlyRateCents === 0) {
      throw ApiError.badRequest("No valid pricing found for this GPU pool.");
    }

    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * gpuCount);
    const walletBalance = await getWalletBalance(auth.customerId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      throw ApiError.paymentRequired(
        `Insufficient wallet balance. You need at least $${(prepaidAmountCents / 100).toFixed(2)} to deploy (current balance: $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet first.`
      );
    }

    // CHARGE BEFORE DEPLOYMENT - deduct from wallet upfront
    const deployTime = new Date();
    const prepaidMinutes = MINIMUM_BILLING_MINUTES;
    const prepaidUntil = new Date(deployTime.getTime() + prepaidMinutes * 60 * 1000);
    const preDeployId = `predeploy_${auth.customerId}_${Date.now()}`;

    console.log(`[Billing API] Pre-charging ${prepaidMinutes} minutes: $${(prepaidAmountCents / 100).toFixed(2)} for ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr BEFORE deployment`);

    const deductResult = await deductUsage(
      auth.customerId,
      (prepaidMinutes / 60) * gpuCount,
      `GPU deploy via API: pool ${String(selectedPoolId).slice(0, 8)} - ${gpuCount} GPU(s) @ $${(hourlyRateCents / 100).toFixed(2)}/hr`,
      hourlyRateCents,
      preDeployId
    );

    if (!deductResult.success) {
      console.error(`[Billing API] Failed to pre-charge wallet:`, deductResult.error);
      throw ApiError.paymentRequired("Failed to process payment. Please try again.");
    }

    console.log(`[Billing API] Pre-charged $${(prepaidAmountCents / 100).toFixed(2)} successfully. Now deploying...`);

    // Handle persistent storage: either use existing shared volume or create new one
    let sharedVolumeIds: number[] = [];

    // Option 1: Attach an existing shared volume by ID
    if (existing_shared_volume_id) {
      // Validate the volume belongs to this team
      try {
        const volumes = await getSharedVolumes(auth.teamId);
        const volumeExists = volumes.some(v => v.id === existing_shared_volume_id);
        if (!volumeExists) {
          // Refund pre-charge before throwing
          await refundDeployment(auth.customerId, prepaidAmountCents, `Refund: shared volume not found`);
          throw ApiError.notFound("Shared volume not found or does not belong to your team");
        }
        sharedVolumeIds = [existing_shared_volume_id];
        console.log(`[API] Attaching existing shared volume: ${existing_shared_volume_id}`);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("Failed to verify shared volume:", err);
        await refundDeployment(auth.customerId, prepaidAmountCents, `Refund: volume verification failed`);
        throw ApiError.badRequest("Could not verify shared volume ownership");
      }
    }
    // Option 2: Create a new shared volume with the specified storage block
    else if (persistent_storage_block_id) {
      try {
        console.log(`[API] Creating new shared volume for pool ${pool_id}`);
        const volumeName = `${name || 'gpu'}-storage-${Date.now()}`;
        const volume = await createSharedVolume({
          team_id: auth.teamId,
          region_id: regionId,
          name: volumeName,
          storage_block_id: persistent_storage_block_id,
        });
        sharedVolumeIds = [volume.id];
        console.log(`[API] Created shared volume: ${volume.id}`);
        // Brief delay for volume to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Failed to create shared volume:", err);
        // Continue without storage rather than failing
      }
    }

    // DEPLOY AFTER PAYMENT - refund if deployment fails
    // Uses subscribeWithFallback to automatically retry on "Insufficient resources"
    let result;
    try {
      const deployResult = await subscribeWithFallback({
        primaryPool: selectedPool!,
        fallbackPools,
        subscribeParams: {
          team_id: auth.teamId,
          vgpus: gpuCount,
          instance_type_id: selectedInstanceType,
          ephemeral_storage_block_id: selectedEphemeralStorage,
          shared_volumes: sharedVolumeIds.length > 0 ? sharedVolumeIds : undefined,
          image_uuid: validImageUuid,
        },
      });
      result = { subscription_id: deployResult.subscription_id };
    } catch (deployError) {
      // Deployment failed - REFUND the pre-charge
      const errMsg = deployError instanceof Error ? deployError.message : "Unknown error";
      console.log(`[Billing API] Deployment failed, refunding pre-charge of $${(prepaidAmountCents / 100).toFixed(2)}`);
      await refundDeployment(
        auth.customerId,
        prepaidAmountCents,
        `Refund: deployment failed - ${errMsg.slice(0, 100)}`
      );
      throw deployError;
    }

    const subscriptionId = result.subscription_id;
    const deployId = `deploy_${subscriptionId}`;

    console.log(`[Billing API] Deployment succeeded. Pre-charge of $${(prepaidAmountCents / 100).toFixed(2)} confirmed. Prepaid until: ${prepaidUntil.toISOString()}`);

    // Track lifecycle milestones (first GPU deploy + spend)
    recordFirstGpuDeploy(auth.customerId).catch(() => {});
    addSpend(auth.customerId, prepaidAmountCents).catch(() => {});


    // Save metadata with billing info
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: String(result.subscription_id),
          stripeCustomerId: auth.customerId,
          displayName: name,
          deployTime,
          prepaidUntil,
          prepaidAmountCents,
          poolId: String(selectedPoolId),
          productId: product?.id || null,
          hourlyRateCents,
          startupScript: startup_script || null,
          startupScriptStatus: startup_script ? "pending" : null,
        },
      });
    } catch (e) {
      console.error("Failed to save pod metadata:", e);
    }

    // Run startup script if provided (uses the same function as dashboard)
    if (startup_script) {
      const { runStartupScript } = await import("@/lib/startup-script-runner");
      runStartupScript(String(result.subscription_id), auth.teamId, startup_script, startup_script_preset_id).catch((err: Error) => {
        console.error(`[Startup] Failed to run startup script for ${result.subscription_id}:`, err);
      });
    }

    return withRateLimitHeaders(
      created({
        subscription_id: result.subscription_id,
        name,
        pool_id: selectedPoolId,
        vgpus: gpuCount,
        startup_script_status: startup_script ? "pending" : undefined,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
