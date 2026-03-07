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
 * SkyPilot Start Instance Endpoint
 *
 * Starts a stopped instance.
 * This allows `sky start` to resume a previously stopped instance.
 *
 * @swagger
 * /api/v1/skypilot/instances/{id}/start:
 *   post:
 *     summary: Start a stopped instance
 *     description: Starts a previously stopped instance
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
 *         description: Instance start initiated
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

    // Check if already running
    if (subscription.status === "subscribed" || subscription.status === "active") {
      return withRateLimitHeaders(
        success({
          instance_id: id,
          status: "RUNNING",
          message: "Instance is already running",
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

    // Start the pod
    await podAction(podName, id, "start");

    return withRateLimitHeaders(
      success({
        instance_id: id,
        status: "PENDING",
        message: "Instance start initiated",
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
