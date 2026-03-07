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
  subscribeToPool,
  getPoolSubscriptions,
  getAllPools,
  getPoolEphemeralStorageBlocks,
  selectOptimalPool,
  subscribeWithFallback,
} from "@/lib/hostedai";
import { getWalletBalance } from "@/lib/wallet";
import { getProductByPoolId } from "@/lib/products";
import { getSkyPilotEntryByInstanceType, getSkyPilotEntries } from "@/lib/skypilot";

/**
 * SkyPilot Instances API
 *
 * SkyPilot-compatible endpoints for listing and launching GPU instances.
 * These endpoints map SkyPilot instance types to GPU Cloud GPU pools.
 */

// Map GPU Cloud subscription status to SkyPilot status
function mapStatus(status: string): string {
  switch (status) {
    case "subscribing":
    case "pending":
      return "PENDING";
    case "subscribed":
    case "active":
      return "RUNNING";
    case "unsubscribing":
    case "stopping":
      return "STOPPING";
    case "unsubscribed":
    case "stopped":
    case "terminated":
      return "STOPPED";
    case "error":
    case "failed":
      return "FAILED";
    default:
      return "UNKNOWN";
  }
}

// Extract SSH connection info from pods
function extractConnectionInfo(pods?: Array<{
  pod_name: string;
  pod_status: string;
  gpu_count: number;
  services?: Array<{
    name: string;
    type: string;
    port?: number;
    ip?: string;
    credentials?: {
      username?: string;
      password?: string;
    };
  }>;
}>): { ip: string | null; port: number; user: string } {
  if (!pods || pods.length === 0) {
    return { ip: null, port: 22, user: "root" };
  }

  // Look for SSH service
  for (const pod of pods) {
    if (pod.services) {
      for (const service of pod.services) {
        if (service.name === "ssh" || service.type === "ssh") {
          return {
            ip: service.ip || null,
            port: service.port || 22,
            user: service.credentials?.username || "root",
          };
        }
      }
    }
  }

  return { ip: null, port: 22, user: "root" };
}

/**
 * @swagger
 * /api/v1/skypilot/instances:
 *   get:
 *     summary: List SkyPilot instances
 *     description: Returns all GPU instances with SkyPilot-compatible format
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: cluster_name
 *         schema:
 *           type: string
 *         description: Filter by SkyPilot cluster name
 *     responses:
 *       200:
 *         description: List of instances
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const url = new URL(request.url);
    const clusterName = url.searchParams.get("cluster_name");

    // Fetch pool subscriptions
    let poolSubscriptions: Awaited<ReturnType<typeof getPoolSubscriptions>> = [];
    try {
      poolSubscriptions = await getPoolSubscriptions(auth.teamId, "last_5m");
    } catch (e) {
      console.error("Failed to fetch pool subscriptions:", e);
    }

    // Fetch pod metadata with SkyPilot tags
    const subscriptionIds = poolSubscriptions.map(s => String(s.id));
    let podMetadata: Record<string, {
      displayName: string | null;
      notes: string | null;
      skypilotTags: Record<string, string> | null;
      poolId: string | null;
      createdAt: Date;
    }> = {};

    if (subscriptionIds.length > 0) {
      try {
        const metadata = await prisma.podMetadata.findMany({
          where: { subscriptionId: { in: subscriptionIds } },
        });
        podMetadata = metadata.reduce((acc, m) => {
          let tags: Record<string, string> | null = null;
          if (m.skypilotTags) {
            try {
              tags = JSON.parse(m.skypilotTags);
            } catch {
              tags = null;
            }
          }
          acc[m.subscriptionId] = {
            displayName: m.displayName,
            notes: m.notes,
            skypilotTags: tags,
            poolId: m.poolId,
            createdAt: m.createdAt,
          };
          return acc;
        }, {} as typeof podMetadata);
      } catch (e) {
        console.error("Failed to fetch pod metadata:", e);
      }
    }

    // Get SkyPilot catalog for instance type lookup
    const skypilotEntries = getSkyPilotEntries();
    const poolToInstanceType: Record<string, string> = {};
    for (const entry of skypilotEntries) {
      if (entry.poolId) {
        poolToInstanceType[entry.poolId] = entry.instanceType;
      }
    }

    // Transform to SkyPilot format
    const instances = poolSubscriptions
      .filter(sub => {
        // Filter by cluster name if provided
        if (clusterName) {
          const meta = podMetadata[String(sub.id)];
          const tags = meta?.skypilotTags;
          return tags?.["skypilot-cluster-name"] === clusterName;
        }
        return true;
      })
      .map(sub => {
        const meta = podMetadata[String(sub.id)];
        const tags = meta?.skypilotTags || {};
        const poolId = meta?.poolId || String(sub.pool_id);
        const instanceType = poolToInstanceType[poolId] || `packet-gpu-${sub.pool_id}`;
        const connInfo = extractConnectionInfo(sub.pods);

        return {
          instance_id: String(sub.id),
          name: meta?.displayName || `instance-${sub.id}`,
          instance_type: instanceType,
          region: sub.region?.region_name || "eu-north-1",
          status: mapStatus(sub.status),
          public_ip: connInfo.ip,
          ssh_port: connInfo.port,
          ssh_user: connInfo.user,
          created_at: meta?.createdAt?.toISOString() || new Date().toISOString(),
          tags: {
            ...tags,
            "packet-subscription-id": String(sub.id),
            "packet-pool-id": poolId,
          },
          accelerators: {
            name: sub.pool_name?.split(" ")[0] || "GPU",
            count: sub.per_pod_info?.vgpu_count || sub.gpu_count || 1,
          },
        };
      });

    return withRateLimitHeaders(
      success({
        instances,
        count: instances.length,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/skypilot/instances:
 *   post:
 *     summary: Launch a SkyPilot instance
 *     description: Creates a new GPU instance from a SkyPilot instance type
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - instance_type
 *             properties:
 *               instance_type:
 *                 type: string
 *                 description: SkyPilot instance type (e.g., packet-h100-8x)
 *               name:
 *                 type: string
 *                 description: Instance name (auto-generated if not provided)
 *               region:
 *                 type: string
 *                 description: Target region (default from catalog)
 *               tags:
 *                 type: object
 *                 description: Key-value tags (including skypilot-cluster-name)
 *               disk_size:
 *                 type: integer
 *                 description: Disk size in GB (not currently used)
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
      instance_type,
      name,
      region,
      tags = {},
    } = body;

    if (!instance_type) {
      throw ApiError.missingField("instance_type");
    }

    // Look up instance type in SkyPilot catalog
    const skypilotEntry = getSkyPilotEntryByInstanceType(instance_type);
    if (!skypilotEntry) {
      throw ApiError.notFound(`Instance type '${instance_type}' not found in GPU Cloud catalog`);
    }

    if (!skypilotEntry.poolId) {
      throw ApiError.internal(`Instance type '${instance_type}' is not configured with a pool ID`);
    }

    let poolId = skypilotEntry.poolId;
    const gpuCount = skypilotEntry.acceleratorCount;

    // Get pool info
    const pools = await getAllPools();
    const pool = pools.find(p => String(p.id) === String(poolId));
    const regionId = pool?.region_id || 2;

    // Get instance type from hosted.ai
    let selectedInstanceType: string | undefined;
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

    // Get ephemeral storage
    let selectedEphemeralStorage: string | undefined;
    try {
      const storageBlocks = await getPoolEphemeralStorageBlocks(String(regionId), auth.teamId);
      if (storageBlocks.length > 0) {
        selectedEphemeralStorage = storageBlocks[0].id;
      }
    } catch (e) {
      console.error("Failed to get ephemeral storage:", e);
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
        requestedPoolId: poolId,
        teamId: auth.teamId,
        gpuCount,
        allPools: pools,
      });
      selectedPool = optimalResult.pool;
      fallbackPools = optimalResult.fallbackPools;
      poolId = String(optimalResult.pool.id);
    } catch (poolErr: any) {
      const status = poolErr.status || 500;
      throw status === 409
        ? ApiError.conflict(poolErr.message)
        : status === 503
        ? ApiError.serviceUnavailable(poolErr.message)
        : ApiError.internal(poolErr.message);
    }

    // CRITICAL: Check wallet balance BEFORE deploying
    const MINIMUM_BILLING_MINUTES = 30;
    const product = await getProductByPoolId(poolId);
    const hourlyRateCents = product?.hourly_rate_cents || 0;

    if (hourlyRateCents === 0) {
      throw ApiError.badRequest("No valid pricing found for this GPU pool.");
    }

    const prepaidAmountCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * gpuCount);
    const walletBalance = await getWalletBalance(auth.customerId);

    if (walletBalance.availableBalance < prepaidAmountCents) {
      throw ApiError.paymentRequired(
        `Whoa there, GPU adventurer! 🚀 Your wallet's looking a bit light for this journey. You'll need at least $${(prepaidAmountCents / 100).toFixed(2)} to get started (you've got $${(walletBalance.availableBalance / 100).toFixed(2)}). Top up your wallet and let's get those GPUs spinning!`
      );
    }

    // Subscribe to pool with automatic fallback on "Insufficient resources"
    const deployResult = await subscribeWithFallback({
      primaryPool: selectedPool!,
      fallbackPools,
      subscribeParams: {
        team_id: auth.teamId,
        vgpus: gpuCount,
        instance_type_id: selectedInstanceType,
        ephemeral_storage_block_id: selectedEphemeralStorage,
      },
    });
    const result = { subscription_id: deployResult.subscription_id };
    poolId = String(deployResult.pool.id);

    // Generate instance name
    const instanceName = name || `skypilot-${tags["skypilot-cluster-name"] || "instance"}-${Date.now()}`;

    // Save metadata with SkyPilot tags
    try {
      await prisma.podMetadata.create({
        data: {
          subscriptionId: String(result.subscription_id),
          stripeCustomerId: auth.customerId,
          displayName: instanceName,
          poolId: poolId,
          skypilotTags: JSON.stringify(tags),
        },
      });
    } catch (e) {
      console.error("Failed to save pod metadata:", e);
    }

    return withRateLimitHeaders(
      created({
        instance_id: result.subscription_id,
        name: instanceName,
        instance_type,
        region: skypilotEntry.region || region || "eu-north-1",
        status: "PENDING",
        tags,
        accelerators: {
          name: skypilotEntry.acceleratorName,
          count: gpuCount,
        },
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
