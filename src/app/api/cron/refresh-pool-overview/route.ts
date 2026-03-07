/**
 * CRON: Refresh Pool Overview (Every 2 minutes)
 *
 * Pre-computes pool overview data and writes to disk cache.
 * The /api/admin/pools endpoint serves from this cache for instant loads.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computePoolOverview, writePoolOverviewCache } from "@/lib/pool-overview";

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    console.log("[Pool Overview Cron] Computing pool overview...");
    const data = await computePoolOverview();
    writePoolOverviewCache(data);

    const elapsed = Date.now() - startTime;
    console.log(`[Pool Overview Cron] Done in ${elapsed}ms — ${data.pools.length} pools, ${data.summary.activePods} active pods`);

    return NextResponse.json({
      ok: true,
      pools: data.pools.length,
      activePods: data.summary.activePods,
      elapsedMs: elapsed,
    });
  } catch (e) {
    const elapsed = Date.now() - startTime;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Pool Overview Cron] Failed in ${elapsed}ms:`, e);
    return NextResponse.json(
      { error: "Cron failed", message: msg, elapsedMs: elapsed },
      { status: 500 }
    );
  }
}
