import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getSSHKeys, deleteSSHKey } from "@/lib/ssh-keys";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/ssh-keys/{id}:
 *   get:
 *     summary: Get an SSH key
 *     description: Returns details for a specific SSH key
 *     tags: [SSH Keys]
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
 *         description: SSH key details
 *       404:
 *         description: SSH key not found
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateApiKey(request);
    const { id } = await params;

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const keys = await getSSHKeys(auth.customerId);
    const key = keys.find(k => k.id === id);

    if (!key) {
      throw ApiError.notFound("SSH key", id);
    }

    return withRateLimitHeaders(
      success({
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        publicKey: key.publicKey,
        createdAt: key.createdAt.toISOString(),
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/ssh-keys/{id}:
 *   delete:
 *     summary: Delete an SSH key
 *     description: Remove an SSH key
 *     tags: [SSH Keys]
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
 *         description: SSH key deleted
 *       404:
 *         description: SSH key not found
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

    await deleteSSHKey(id, auth.customerId);

    return withRateLimitHeaders(
      success({ id, deleted: true }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
