import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fullSyncCustomerCache } from "@/lib/customer-cache";

/**
 * POST /api/cron/sync-customer-cache
 *
 * Full re-sync of ALL Stripe customers into local CustomerCache.
 * Schedule: Every 12 hours. Also run once after deploy to populate.
 */
export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    console.log("[Customer Cache Sync] Starting full sync...");
    const result = await fullSyncCustomerCache();
    console.log(`[Customer Cache Sync] Done: ${result.synced} synced, ${result.deleted} marked deleted`);

    return NextResponse.json({
      success: true,
      synced: result.synced,
      deleted: result.deleted,
    });
  } catch (error) {
    console.error("[Customer Cache Sync] Failed:", error);
    return NextResponse.json(
      { error: "Failed to sync customer cache", details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
