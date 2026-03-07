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
import { unsubscribeFromPool, getPoolSubscriptions, getConnectionInfo } from "@/lib/hostedai";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/instances/{id}:
 *   get:
 *     summary: Get instance details
 *     description: Returns details for a specific pool subscription including connection info
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
 *         description: Instance details
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

    // Get subscription info
    const subs = await getPoolSubscriptions(auth.teamId, "last_5m");
    const subscription = subs.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      throw ApiError.notFound("Instance", subscriptionId);
    }

    // Get metadata
    const metadata = await prisma.podMetadata.findUnique({
      where: { subscriptionId },
    });

    // Get connection info
    let connectionInfo = null;
    try {
      const allConnectionInfo = await getConnectionInfo(auth.teamId, subscriptionId);
      connectionInfo = allConnectionInfo.find(c => String(c.id) === String(subscriptionId));
    } catch (e) {
      console.error("Failed to get connection info:", e);
    }

    return withRateLimitHeaders(
      success({
        subscription,
        metadata: {
          displayName: metadata?.displayName || null,
          notes: metadata?.notes || null,
        },
        connectionInfo,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/instances/{id}:
 *   patch:
 *     summary: Update instance metadata
 *     description: Update the display name or notes for an instance
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Metadata updated
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id: subscriptionId } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const { displayName, notes } = body;

    // Validate
    if (displayName !== undefined && typeof displayName !== "string") {
      throw ApiError.invalidField("displayName", "Must be a string");
    }
    if (notes !== undefined && typeof notes !== "string") {
      throw ApiError.invalidField("notes", "Must be a string");
    }

    // Upsert metadata
    const metadata = await prisma.podMetadata.upsert({
      where: { subscriptionId },
      update: {
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      create: {
        subscriptionId,
        stripeCustomerId: auth.customerId,
        displayName: displayName || null,
        notes: notes || null,
      },
    });

    return withRateLimitHeaders(
      success({
        subscriptionId,
        displayName: metadata.displayName,
        notes: metadata.notes,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/instances/{id}:
 *   delete:
 *     summary: Terminate an instance
 *     description: Unsubscribe from a GPU pool and terminate the instance
 *     tags: [Instances]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Instance terminated
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id: subscriptionId } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get subscription info
    const subs = await getPoolSubscriptions(auth.teamId);
    const subscription = subs.find(s => String(s.id) === String(subscriptionId));

    if (!subscription) {
      throw ApiError.notFound("Instance", subscriptionId);
    }

    const poolId = subscription.pool_id || 0;

    // Unsubscribe
    await unsubscribeFromPool(subscriptionId, auth.teamId, poolId);

    return withRateLimitHeaders(
      success({
        id: subscriptionId,
        terminated: true,
        terminatedAt: new Date().toISOString(),
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
