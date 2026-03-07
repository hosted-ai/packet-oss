/**
 * CRON: Refresh Investor Stats (Every hour)
 *
 * Pre-computes investor dashboard stats for all investors with assigned nodes
 * and writes them to disk cache. The /api/investor/stats GET endpoint serves
 * from this cache for instant page loads.
 *
 * Triggered by cron-job.org every 60 minutes:
 * GET /api/cron/refresh-investor-stats?secret=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getInvestors } from "@/lib/auth/investor";
import { computeInvestorStats, writeCachedStats } from "@/lib/investor-stats";

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    refreshed: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    const investors = await getInvestors();

    for (const investor of investors) {
      // Only compute for investors who have assigned nodes (or inherit them)
      if (!investor.assignedNodeIds || investor.assignedNodeIds.length === 0) {
        // Check if they inherit nodes via addedBy chain — the compute function handles this
        // but we skip investors with no nodes at all to save time
      }

      try {
        console.log(`[Investor Stats Cron] Computing stats for ${investor.email}...`);
        const data = await computeInvestorStats(investor.email);
        writeCachedStats(investor.email, data);
        results.refreshed++;
        console.log(`[Investor Stats Cron] Cached stats for ${investor.email}`);
      } catch (e) {
        results.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        results.errors.push(`${investor.email}: ${msg}`);
        console.error(`[Investor Stats Cron] Failed for ${investor.email}:`, e);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Cron failed", message: msg },
      { status: 500 }
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Investor Stats Cron] Done in ${elapsed}ms — refreshed: ${results.refreshed}, failed: ${results.failed}`);

  return NextResponse.json({
    ok: true,
    ...results,
    elapsedMs: elapsed,
  });
}
