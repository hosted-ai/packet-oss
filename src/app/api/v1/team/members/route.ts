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
import {
  getTeamMembers,
  addTeamMember,
  isTeamMember,
  ensureOwnerRecord,
} from "@/lib/team-members";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * @swagger
 * /api/v1/team/members:
 *   get:
 *     summary: List team members
 *     description: Returns all members of the team
 *     tags: [Team]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: List of team members
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    // Rate limiting
    const { allowed, info } = checkRateLimit(auth.keyId, "read");
    if (!allowed) {
      return withRateLimitHeaders(error(ApiError.rateLimitExceeded(info.reset)), info);
    }

    // Get customer details
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(auth.customerId);

    if ("deleted" in customerResult && customerResult.deleted) {
      throw ApiError.notFound("Account");
    }

    const customer = customerResult as Stripe.Customer;

    // Get email from customer
    const ownerEmail = customer.email;
    if (!ownerEmail) {
      throw ApiError.internal("Account has no email");
    }

    // Ensure owner record exists
    await ensureOwnerRecord(ownerEmail, auth.customerId, customer.name || undefined);

    // Get all team members
    const members = await getTeamMembers(auth.customerId);

    return withRateLimitHeaders(
      success(
        members.map(m => ({
          id: m.id,
          email: m.email,
          name: m.name,
          role: m.role,
          invitedAt: m.invitedAt.toISOString(),
          acceptedAt: m.acceptedAt?.toISOString() || null,
          invitedBy: m.invitedBy,
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
 * /api/v1/team/members:
 *   post:
 *     summary: Invite a team member
 *     description: Send an invitation to a new team member
 *     tags: [Team]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invitation sent
 *       409:
 *         description: Already a team member
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
    const { email, name } = body;

    if (!email) {
      throw ApiError.missingField("email");
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw ApiError.invalidField("email", "Invalid email format");
    }

    // Check if already a member
    if (await isTeamMember(normalizedEmail, auth.customerId)) {
      throw ApiError.alreadyExists("Team member");
    }

    // Get customer details
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(auth.customerId);

    if ("deleted" in customerResult && customerResult.deleted) {
      throw ApiError.notFound("Account");
    }

    const customer = customerResult as Stripe.Customer;
    const ownerEmail = customer.email;
    if (!ownerEmail) {
      throw ApiError.internal("Account has no email");
    }

    // Add the team member
    const member = await addTeamMember({
      email: normalizedEmail,
      name: name || null,
      stripeCustomerId: auth.customerId,
      invitedBy: ownerEmail,
    });

    // Note: Email invitation is not sent via API - use dashboard for email invites
    // This just creates the record

    return withRateLimitHeaders(
      created({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        invitedAt: member.invitedAt.toISOString(),
        acceptedAt: null,
        invitedBy: member.invitedBy,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
