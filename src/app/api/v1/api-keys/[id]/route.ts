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

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/api-keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     description: Revokes an API key, making it unusable
 *     tags: [API Keys]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: API key ID to revoke
 *     responses:
 *       200:
 *         description: API key revoked successfully
 *       404:
 *         description: API key not found
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Find the API key
    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      throw ApiError.notFound("API key", id);
    }

    // Verify ownership
    if (apiKey.stripeCustomerId !== auth.customerId) {
      throw ApiError.notFound("API key", id);
    }

    // Prevent revoking the key being used for this request
    if (apiKey.id === auth.keyId) {
      throw ApiError.invalidRequest("Cannot revoke the API key currently being used");
    }

    // Already revoked
    if (apiKey.revokedAt) {
      throw ApiError.invalidRequest("API key is already revoked");
    }

    // Revoke the key
    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return withRateLimitHeaders(
      success({ id, revoked: true, revokedAt: new Date().toISOString() }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
