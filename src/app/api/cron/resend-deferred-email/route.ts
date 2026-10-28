/**
 * POST /api/cron/resend-deferred-email
 *
 * Re-sends mail refused on quota, rate or credential, once its backoff has
 * elapsed. A message stays queued until it is delivered or its attempts run out.
 *
 * Authentication: Requires CRON_SECRET header or Authorization bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { resendDeferredEmail } from "@/lib/email/client";
import { resendDeferredEmails } from "@/lib/email/deferred";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    const result = await resendDeferredEmails(resendDeferredEmail);
    if (result.resent || result.stillDeferred || result.abandoned) {
      console.log(
        `[Deferred Email] resent=${result.resent} still_deferred=${result.stillDeferred} abandoned=${result.abandoned}`,
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[Deferred Email] Re-send sweep failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Re-send sweep failed" },
      { status: 500 },
    );
  }
}
