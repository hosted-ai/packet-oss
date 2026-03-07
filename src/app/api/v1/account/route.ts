import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  checkRateLimit,
  withRateLimitHeaders,
  ApiError,
} from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * @swagger
 * /api/v1/account:
 *   get:
 *     summary: Get account information
 *     description: Returns account details for the authenticated user
 *     tags: [Account]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: Account information
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get customer details from Stripe
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(auth.customerId);

    if ("deleted" in customerResult && customerResult.deleted) {
      throw ApiError.notFound("Account");
    }

    const customer = customerResult as Stripe.Customer;

    return withRateLimitHeaders(
      success({
        id: customer.id,
        email: customer.email,
        name: customer.name,
        teamId: customer.metadata?.hostedai_team_id || null,
        createdAt: new Date(customer.created * 1000).toISOString(),
        metadata: {
          status: customer.metadata?.status,
        },
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
