import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { podAction, getPoolSubscriptions, getConnectionInfo } from "@/lib/hostedai";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/instances/{id}/restart:
 *   post:
 *     summary: Restart an instance
 *     description: Restart a GPU pod
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               podName:
 *                 type: string
 *                 description: Optional pod name for multi-pod subscriptions
 *     responses:
 *       200:
 *         description: Restart initiated
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id: subscriptionId } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get optional pod name from body
    let targetPodName: string | undefined;
    try {
      const body = await request.json();
      targetPodName = body.podName;
    } catch {
      // No body provided
    }

    // Verify subscription exists
    const subs = await getPoolSubscriptions(auth.teamId);
    const subscription = subs.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      throw ApiError.notFound("Instance", subscriptionId);
    }

    // Get connection info to find pod names
    const connectionInfo = await getConnectionInfo(auth.teamId, subscriptionId);
    const subConnectionInfo = connectionInfo?.find(c => String(c.id) === String(subscriptionId));

    if (!subConnectionInfo?.pods?.length) {
      throw ApiError.invalidRequest("No pods found for this subscription");
    }

    // Find target pod
    let podToRestart = subConnectionInfo.pods[0];
    if (targetPodName) {
      const found = subConnectionInfo.pods.find(p => p.pod_name === targetPodName);
      if (found) {
        podToRestart = found;
      } else {
        throw ApiError.notFound("Pod", targetPodName);
      }
    }

    const podName = podToRestart.pod_name;
    if (!podName) {
      throw ApiError.invalidRequest("Pod name not found");
    }

    // Execute restart
    await podAction(podName, subscriptionId, "restart");

    return withRateLimitHeaders(
      success({
        subscription_id: subscriptionId,
        pod_name: podName,
        action: "restart",
        status: "initiated",
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
