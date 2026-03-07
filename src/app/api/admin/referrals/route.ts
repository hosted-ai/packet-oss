import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getReferralSettings,
  updateReferralSettings,
  getAllReferralClaims,
  getReferralProgramStats,
  voidReferralClaim,
  processReferralReward,
} from "@/lib/referral";

// GET - Get referral settings, claims, and stats
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;

  try {
    const [settings, claims, stats] = await Promise.all([
      getReferralSettings(),
      getAllReferralClaims(status),
      getReferralProgramStats(),
    ]);

    return NextResponse.json({
      settings,
      claims,
      stats,
    });
  } catch (error) {
    console.error("Failed to get referral data:", error);
    return NextResponse.json(
      { error: "Failed to get referral data" },
      { status: 500 }
    );
  }
}

// PATCH - Update referral settings
export async function PATCH(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { enabled, rewardAmountCents, minTopupCents, maxReferralsPerCustomer } = body;

    const updates: Record<string, unknown> = {};
    if (typeof enabled === "boolean") updates.enabled = enabled;
    if (typeof rewardAmountCents === "number") updates.rewardAmountCents = rewardAmountCents;
    if (typeof minTopupCents === "number") updates.minTopupCents = minTopupCents;
    if (typeof maxReferralsPerCustomer === "number") updates.maxReferralsPerCustomer = maxReferralsPerCustomer;

    const updatedSettings = updateReferralSettings(updates);

    console.log(`Admin ${session.email} updated referral settings:`, updates);

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (error) {
    console.error("Failed to update referral settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

// POST - Perform actions on referral claims
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, claimId } = body;

    if (!action || !claimId) {
      return NextResponse.json(
        { error: "Action and claimId are required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "void": {
        await voidReferralClaim(claimId);
        console.log(`Admin ${session.email} voided referral claim ${claimId}`);
        return NextResponse.json({ success: true });
      }

      case "credit": {
        await processReferralReward(claimId);
        console.log(`Admin ${session.email} manually credited referral claim ${claimId}`);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Failed to perform referral action:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to perform action" },
      { status: 500 }
    );
  }
}
