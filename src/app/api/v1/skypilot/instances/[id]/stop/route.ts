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
import { getPoolSubscriptions, podAction } from "@/lib/hostedai";

/**
 * SkyPilot Stop Instance Endpoint
 *
 * Stops a running instance without terminating it.
 * This allows `sky stop` to work for cost savings while preserving state.
 *
 * @swagger
 * /api/v1/skypilot/instances/{id}/stop:
 *   post:
 *     summary: Stop a running instance
 *     description: Stops the instance without terminating. Data is preserved.
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Instance ID
 *     responses:
 *       200:
 *         description: Instance stop initiated
 *       404:
 *         description: Instance not found
 */
export async function POST(
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

    // Check if already stopped
    if (subscription.status === "stopped" || subscription.status === "unsubscribed") {
      return withRateLimitHeaders(
        success({
          instance_id: id,
          status: "STOPPED",
          message: "Instance is already stopped",
        }),
        info
      );
    }

    // Get pod name from subscription
    const podName = subscription.pods?.[0]?.pod_name;
    if (!podName) {
      throw ApiError.internal("Could not determine pod name for instance");
    }

    // Get pool ID
    let poolId = String(subscription.pool_id);
    try {
      const meta = await prisma.podMetadata.findUnique({
        where: { subscriptionId: id },
      });
      if (meta?.poolId) {
        poolId = meta.poolId;
      }
    } catch {
      // Use pool_id from subscription
    }

    // Stop the pod
    await podAction(podName, id, "stop");

    return withRateLimitHeaders(
      success({
        instance_id: id,
        status: "STOPPING",
        message: "Instance stop initiated",
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
