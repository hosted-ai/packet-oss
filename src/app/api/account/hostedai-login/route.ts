import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { createOneTimeLogin, ROLES } from "@/lib/hostedai";

/**
 * Generate a fresh one-time login URL for hosted.ai dashboard.
 *
 * OTL tokens are single-use and expire quickly, so we need to generate
 * a fresh one each time the user wants to access the hosted.ai dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json(
        { error: "No hosted.ai team associated with this account" },
        { status: 400 }
      );
    }

    // Generate a fresh OTL token
    const otl = await createOneTimeLogin({
      email: payload.email,
      send_email_invite: false,
      teamId: teamId,
      roleId: ROLES.teamAdmin,
    });

    return NextResponse.json({
      url: otl.url,
      expires_at: otl.expires_at,
    });
  } catch (error) {
    console.error("Failed to generate hosted.ai login:", error);
    return NextResponse.json(
      { error: "Failed to generate login URL" },
      { status: 500 }
    );
  }
}
