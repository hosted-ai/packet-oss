import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import {
  getPoolSubscriptions,
  unsubscribeFromPool,
  getConnectionInfo,
} from "@/lib/hostedai";
import { getSkyPilotEntries } from "@/lib/skypilot";

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
}>): { ip: string | null; port: number; user: string; password: string | null } {
  if (!pods || pods.length === 0) {
    return { ip: null, port: 22, user: "root", password: null };
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
            password: service.credentials?.password || null,
          };
        }
      }
    }
  }

  return { ip: null, port: 22, user: "root", password: null };
}

/**
 * @swagger
 * /api/v1/skypilot/instances/{id}:
 *   get:
 *     summary: Get instance details
 *     description: Returns detailed information about a specific instance
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Instance ID (subscription ID)
 *     responses:
 *       200:
 *         description: Instance details
 *       404:
 *         description: Instance not found
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiKey(request);
    const { id } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Fetch pool subscriptions
    const poolSubscriptions = await getPoolSubscriptions(auth.teamId, "last_5m");
    const subscription = poolSubscriptions.find(s => String(s.id) === id);

    if (!subscription) {
      throw ApiError.notFound(`Instance '${id}' not found`);
    }

    // Fetch pod metadata
    let metadata: {
      displayName: string | null;
      notes: string | null;
      skypilotTags: Record<string, string> | null;
      poolId: string | null;
      createdAt: Date;
    } | null = null;

    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: id },
      });
      if (meta) {
        let tags: Record<string, string> | null = null;
        if (meta.skypilotTags) {
          try {
            tags = JSON.parse(meta.skypilotTags);
          } catch {
            tags = null;
          }
        }
        metadata = {
          displayName: meta.displayName,
          notes: meta.notes,
          skypilotTags: tags,
          poolId: meta.poolId,
          createdAt: meta.createdAt,
        };
      }
    } catch (e) {
      console.error("Failed to fetch pod metadata:", e);
    }

    // Get SkyPilot catalog for instance type lookup
    const skypilotEntries = getSkyPilotEntries();
    const poolId = metadata?.poolId || String(subscription.pool_id);
    const entry = skypilotEntries.find(e => e.poolId === poolId);
    const instanceType = entry?.instanceType || `packet-gpu-${subscription.pool_id}`;

    // Extract connection info from subscription pods
    const connInfo = extractConnectionInfo(subscription.pods);

    // Try to get more detailed connection info if available
    if (subscription.status === "subscribed" || subscription.status === "active") {
      try {
        const connections = await getConnectionInfo(auth.teamId, id);
        if (connections.length > 0) {
          const conn = connections[0];
          if (conn.pods && conn.pods.length > 0) {
            const pod = conn.pods[0];
            if (pod.ssh_info?.cmd) {
              // Parse SSH command to extract IP and port
              // Format: ssh -p PORT user@IP
              const match = pod.ssh_info.cmd.match(/-p\s+(\d+)\s+(\w+)@([\d.]+)/);
              if (match) {
                connInfo.port = parseInt(match[1], 10);
                connInfo.user = match[2];
                connInfo.ip = match[3];
              }
            }
            // Get SSH password if available
            if (pod.ssh_info?.pass) {
              connInfo.password = pod.ssh_info.pass;
            }
          }
        }
      } catch (e) {
        // Connection info may not be available yet
      }
    }

    const tags = metadata?.skypilotTags || {};

    return withRateLimitHeaders(
      success({
        instance_id: id,
        name: metadata?.displayName || `instance-${id}`,
        instance_type: instanceType,
        region: subscription.region?.region_name || "eu-north-1",
        status: mapStatus(subscription.status),
        public_ip: connInfo.ip,
        ssh_port: connInfo.port,
        ssh_user: connInfo.user,
        ssh_password: connInfo.password, // Required for SkyPilot to establish SSH connection
        created_at: metadata?.createdAt?.toISOString() || new Date().toISOString(),
        tags: {
          ...tags,
          "packet-subscription-id": id,
          "packet-pool-id": poolId,
        },
        accelerators: {
          name: entry?.acceleratorName || subscription.pool_name?.split(" ")[0] || "GPU",
          count: subscription.per_pod_info?.vgpu_count || entry?.acceleratorCount || 1,
        },
        // Additional details for SkyPilot
        ssh_config: connInfo.ip ? {
          host: connInfo.ip,
          port: connInfo.port,
          user: connInfo.user,
          password: connInfo.password,
        } : null,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/skypilot/instances/{id}:
 *   delete:
 *     summary: Terminate instance
 *     description: Terminates (unsubscribes from) an instance
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Instance ID (subscription ID)
 *     responses:
 *       200:
 *         description: Instance terminated successfully
 *       404:
 *         description: Instance not found
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiKey(request);
    const { id } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Verify instance exists and belongs to team
    const poolSubscriptions = await getPoolSubscriptions(auth.teamId, "last_5m");
    const subscription = poolSubscriptions.find(s => String(s.id) === id);

    if (!subscription) {
      throw ApiError.notFound(`Instance '${id}' not found`);
    }

    // Get pool ID from metadata or subscription
    let poolId = String(subscription.pool_id);
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: id },
      });
      if (meta?.poolId) {
        poolId = meta.poolId;
      }
    } catch (e) {
      // Use pool_id from subscription
    }

    // Unsubscribe from pool
    await unsubscribeFromPool(id, auth.teamId, poolId);

    return withRateLimitHeaders(
      success({
        instance_id: id,
        status: "STOPPING",
        message: "Instance termination initiated",
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
