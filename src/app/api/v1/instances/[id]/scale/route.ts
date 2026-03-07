import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { scalePoolSubscription, getPoolSubscriptions } from "@/lib/hostedai";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Working values for scaling (from existing implementation)
const WORKING_INSTANCE_TYPE = "a961c0a0-7aca-47a7-9ba2-24cbe84bed9d";
const WORKING_EPHEMERAL_STORAGE = "1ab7434e-39d9-40b5-9cb5-94f4e336d43a";

/**
 * @swagger
 * /api/v1/instances/{id}/scale:
 *   post:
 *     summary: Scale an instance
 *     description: Scale the number of vGPUs for a subscription
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vgpus
 *               - pool_id
 *             properties:
 *               vgpus:
 *                 type: integer
 *                 minimum: 1
 *                 description: New number of vGPUs
 *               pool_id:
 *                 type: string
 *                 description: Pool ID
 *     responses:
 *       200:
 *         description: Scale operation completed
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id: subscriptionId } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "launch");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const { vgpus, pool_id } = body;

    if (!vgpus || vgpus < 1) {
      throw ApiError.invalidField("vgpus", "Must be at least 1");
    }

    // Enforce single GPU per pod - multi-GPU creates multiple pods which UI doesn't support
    if (vgpus > 1) {
      throw ApiError.badRequest("Multi-GPU scaling is not supported. Each pod can only have 1 GPU.");
    }

    if (!pool_id) {
      throw ApiError.missingField("pool_id");
    }

    // Verify subscription exists
    const subs = await getPoolSubscriptions(auth.teamId);
    const subscription = subs.find(
      s => String(s.id) === String(subscriptionId) || String(s.pool_id) === String(pool_id)
    );

    if (!subscription) {
      throw ApiError.notFound("Instance", subscriptionId);
    }

    // Scale the subscription
    const result = await scalePoolSubscription({
      subscriptionId,
      poolId: pool_id,
      teamId: auth.teamId,
      vgpus,
      instanceTypeId: WORKING_INSTANCE_TYPE,
      ephemeralStorageBlockId: WORKING_EPHEMERAL_STORAGE,
    });

    return withRateLimitHeaders(
      success({
        subscription_id: result.subscription_id,
        vgpus,
        status: "scaled",
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
