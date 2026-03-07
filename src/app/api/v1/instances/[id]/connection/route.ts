import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getConnectionInfo, getPoolSubscriptions } from "@/lib/hostedai";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/instances/{id}/connection:
 *   get:
 *     summary: Get connection credentials
 *     description: Returns SSH credentials and connection details for a running instance
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
 *     responses:
 *       200:
 *         description: Connection info including SSH credentials
 *       404:
 *         description: Instance not found
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id: subscriptionId } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Verify subscription exists
    const subs = await getPoolSubscriptions(auth.teamId);
    const subscription = subs.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      throw ApiError.notFound("Instance", subscriptionId);
    }

    // Get connection info
    const connectionInfo = await getConnectionInfo(auth.teamId, subscriptionId);
    const subConnectionInfo = connectionInfo?.find(c => String(c.id) === String(subscriptionId));

    if (!subConnectionInfo) {
      throw ApiError.notFound("Connection info", subscriptionId);
    }

    return withRateLimitHeaders(
      success({
        subscription_id: subscriptionId,
        pods: subConnectionInfo.pods.map(pod => ({
          pod_name: pod.pod_name,
          pod_status: pod.pod_status,
          internal_ip: pod.internal_ip || null,
          ssh: pod.ssh_info ? {
            command: pod.ssh_info.cmd,
            password: pod.ssh_info.pass,
          } : null,
          discovered_services: pod.discovered_services || [],
        })),
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
