import { NextRequest } from "next/server";
import {
  authenticateApiKey,
  success,
  error,
  ApiError,
  checkRateLimit,
  withRateLimitHeaders,
} from "@/lib/api";
import { removeTeamMember, getTeamMembers } from "@/lib/team-members";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * @swagger
 * /api/v1/team/members/{id}:
 *   get:
 *     summary: Get a team member
 *     description: Returns details for a specific team member
 *     tags: [Team]
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
 *         description: Team member details
 *       404:
 *         description: Team member not found
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

    const members = await getTeamMembers(auth.customerId);
    const member = members.find(m => m.id === id);

    if (!member) {
      throw ApiError.notFound("Team member", id);
    }

    return withRateLimitHeaders(
      success({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        invitedAt: member.invitedAt.toISOString(),
        acceptedAt: member.acceptedAt?.toISOString() || null,
        invitedBy: member.invitedBy,
      }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}

/**
 * @swagger
 * /api/v1/team/members/{id}:
 *   delete:
 *     summary: Remove a team member
 *     description: Remove a member from the team
 *     tags: [Team]
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
 *         description: Team member removed
 *       404:
 *         description: Team member not found
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

    await removeTeamMember(id, auth.customerId);

    return withRateLimitHeaders(
      success({ id, removed: true }),
      info
    );
  } catch (err) {
    return error(err as Error);
  }
}
