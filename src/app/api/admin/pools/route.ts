/**
 * Admin Pool Overview API
 *
 * Serves pool data from a file cache that is refreshed by the
 * /api/cron/refresh-pool-overview cron job every 2 minutes.
 * Falls back to live computation if no cache exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { readPoolOverviewCache, computePoolOverview } from "@/lib/pool-overview";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/pools
 * Get comprehensive pool overview data (served from cache)
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load maintenance pool IDs from DB
  const maintenanceOverrides = await prisma.poolSettingsOverride.findMany({
    where: { maintenance: true },
    select: { gpuaasPoolId: true },
  });
  const maintenancePoolIds = maintenanceOverrides.map((o) => o.gpuaasPoolId);

  // Serve from cache (refreshed by cron every 2 minutes)
  const cached = readPoolOverviewCache();
  if (cached) {
    return NextResponse.json({ success: true, data: cached, maintenancePoolIds });
  }

  // No cache yet — compute live (first request before cron runs)
  try {
    const data = await computePoolOverview();
    return NextResponse.json({ success: true, data, maintenancePoolIds });
  } catch (error) {
    console.error("[Admin Pools] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch pool data",
      },
      { status: 500 }
    );
  }
}
