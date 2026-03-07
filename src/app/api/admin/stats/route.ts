import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { readPoolOverviewCache } from "@/lib/pool-overview";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Read the two most recent snapshots (today + yesterday)
    const snapshots = await prisma.adminStatsSnapshot.findMany({
      orderBy: { date: "desc" },
      take: 2,
    });

    const latest = snapshots[0];
    const previous = snapshots[1];

    if (!latest) {
      return NextResponse.json({
        totalCustomers: 0,
        activePods: 0,
        mrr: 0,
        newCustomersThisWeek: 0,
        revenueThisWeek: 0,
        growth: null,
      });
    }

    // Use live pool cache for active pods (refreshed every 2 min) instead of daily snapshot
    let liveActivePods = latest.activeGPUs; // fallback to snapshot
    const poolCache = readPoolOverviewCache();
    if (poolCache?.pools) {
      liveActivePods = 0;
      for (const pool of poolCache.pools) {
        for (const pod of pool.pods || []) {
          if (pod.status === "subscribed" || pod.status === "active") {
            liveActivePods++;
          }
        }
      }
    }

    const current = {
      totalCustomers: latest.totalCustomers,
      activePods: liveActivePods,
      mrr: latest.mrrCents,
      newCustomersThisWeek: latest.newThisWeek,
      revenueThisWeek: latest.revenueWeekCents,
    };

    return NextResponse.json({
      ...current,
      growth: previous
        ? {
            totalCustomers: current.totalCustomers - previous.totalCustomers,
            activePods: current.activePods - previous.activeGPUs,
            mrr: current.mrr - previous.mrrCents,
            newCustomersThisWeek: current.newCustomersThisWeek - previous.newThisWeek,
            revenueThisWeek: current.revenueThisWeek - previous.revenueWeekCents,
          }
        : null,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
