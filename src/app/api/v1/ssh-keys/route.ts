import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  created,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { getSSHKeys, addSSHKey } from "@/lib/ssh-keys";

/**
 * @swagger
 * /api/v1/ssh-keys:
 *   get:
 *     summary: List SSH keys
 *     description: Returns all SSH keys for the authenticated user
 *     tags: [SSH Keys]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: List of SSH keys
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const keys = await getSSHKeys(auth.customerId);

    return withRateLimitHeaders(
      success(
        keys.map(k => ({
          id: k.id,
          name: k.name,
          fingerprint: k.fingerprint,
          createdAt: k.createdAt.toISOString(),
          keyPreview: k.publicKey.substring(0, 50) + "...",
        }))
      ),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/ssh-keys:
 *   post:
 *     summary: Add an SSH key
 *     description: Add a new SSH public key
 *     tags: [SSH Keys]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - publicKey
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-friendly name for the key
 *               publicKey:
 *                 type: string
 *                 description: SSH public key (starts with ssh-rsa, ssh-ed25519, etc.)
 *     responses:
 *       201:
 *         description: SSH key added successfully
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "write");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    const body = await request.json();
    const { name, publicKey } = body;

    if (!name) {
      throw ApiError.missingField("name");
    }

    if (!publicKey) {
      throw ApiError.missingField("publicKey");
    }

    // Limit number of keys
    const existingKeys = await getSSHKeys(auth.customerId);
    if (existingKeys.length >= 10) {
      throw ApiError.invalidRequest("Maximum of 10 SSH keys allowed");
    }

    const key = await addSSHKey({
      stripeCustomerId: auth.customerId,
      name,
      publicKey,
    });

    return withRateLimitHeaders(
      created({
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        createdAt: key.createdAt.toISOString(),
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
