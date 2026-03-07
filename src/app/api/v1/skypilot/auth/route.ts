import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";

/**
 * SkyPilot Auth Endpoint
 *
 * Validates API key and returns team information for SkyPilot cloud provider.
 * Used by the GPU Cloud SkyPilot plugin to verify credentials.
 *
 * @swagger
 * /api/v1/skypilot/auth:
 *   get:
 *     summary: Verify API key for SkyPilot
 *     description: Validates the API key and returns team information
 *     tags: [SkyPilot]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team_id:
 *                   type: string
 *                 customer_id:
 *                   type: string
 *                 authenticated:
 *                   type: boolean
 *       401:
 *         description: Invalid or missing API key
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    return withRateLimitHeaders(
      success({
        authenticated: true,
        team_id: auth.teamId,
        customer_id: auth.customerId,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
