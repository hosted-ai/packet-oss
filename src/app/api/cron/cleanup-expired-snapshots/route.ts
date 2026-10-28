import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * POST /api/cron/cleanup-expired-snapshots
 *
 * Disabled: auto-preservation of snapshots on billing suspension has been
 * removed (PA-88). Snapshots are now manual-only and do not expire.
 */
export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  return NextResponse.json({ success: true, message: "Auto-preservation disabled. No cleanup required." });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
