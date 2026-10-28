/**
 * CRON: Refresh Pool Overview (Every 2 minutes)
 *
 * Pre-computes pool overview data and writes to disk cache.
 * The /api/admin/pools endpoint serves from this cache for instant loads.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { computePoolOverview, writePoolOverviewCache, readPoolOverviewCache } from "@/lib/pool-overview";
import { snapshotFleetCapacity } from "@/lib/fleet-snapshot";

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    // Read existing cache first — passed to computePoolOverview so it can
    // preserve per-pool pod data when individual API calls fail
    const existingCache = readPoolOverviewCache();

    console.log("[Pool Overview Cron] Computing pool overview...");
    const data = await computePoolOverview(existingCache);

    // Don't overwrite good cache when a GPUaaS API call actually errored this run —
    // a real pod-count drop (e.g. a team deletion) is legitimate and must write through,
    // even if it's a big percentage of a small pool (PA-633).
    if (existingCache && data.hadApiFailures) {
      const elapsed = Date.now() - startTime;
      console.warn(
        `[Pool Overview Cron] API failures during fetch — keeping existing cache (${existingCache.summary.activePods} active pods)`
      );
      return NextResponse.json({
        ok: true,
        pools: data.pools.length,
        activePods: data.summary.activePods,
        keptExistingCache: true,
        existingActivePods: existingCache.summary.activePods,
        elapsedMs: elapsed,
      });
    }

    writePoolOverviewCache(data);

    // PA-693: first clean refresh of each UTC day persists a capacity snapshot
    // (the "available GPU-hours" series). Best-effort — never fails the refresh.
    try {
      await snapshotFleetCapacity(data);
    } catch (err) {
      console.error("[Pool Overview Cron] fleet capacity snapshot failed:", err);
    }

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
