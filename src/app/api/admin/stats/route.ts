import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getGlobalInstanceSummary } from "@/lib/hostedai/instances";
import { getStripe } from "@/lib/stripe";
import {
  computeMrrCents,
  computeRevenueLastNDaysCents,
} from "@/lib/stripe-metrics";
import { getInternalExclusions, buildExcludeInternalWhere } from "@/lib/internal-accounts";

// MRR + Revenue This Week come live from Stripe (source of truth). They're expensive
// (paginate subs + charges), so cache briefly in-process. Admin-only route.
const LIVE_TTL_MS = 15 * 60 * 1000; // 15 min
let liveRevenueCache: {
  mrrCents: number;
  revenueWeekCents: number;
  at: number;
} | null = null;

async function getLiveRevenue(): Promise<{
  mrrCents: number;
  revenueWeekCents: number;
}> {
  if (liveRevenueCache && Date.now() - liveRevenueCache.at < LIVE_TTL_MS) {
    return liveRevenueCache;
  }
  const stripe = await getStripe();
  const [mrrCents, revenueWeekCents] = await Promise.all([
    computeMrrCents(stripe),
    computeRevenueLastNDaysCents(stripe, 7),
  ]);
  liveRevenueCache = { mrrCents, revenueWeekCents, at: Date.now() };
  return liveRevenueCache;
}

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

    // Use HAI 2.2 /instances/unified for live active pod count
    // The status_counts field gives us an accurate breakdown without fetching all items
    // "Active" = live instances. status_counts spans both pods and VMs: a live
    // pod reports "running", a live VM reports "active" (Confluence HP/600178689
    // §2 — VM ACTIVE is billable/live). Both must count so this global headline
    // agrees with the per-customer counts and the user dashboard (PA-134).
    // pending/starting/restarting are transitional-up states.
    const ACTIVE_STATUSES = ["running", "active", "pending", "starting", "restarting"];
    let liveActivePods = latest.activeGPUs; // fallback to snapshot
    try {
      const summary = await getGlobalInstanceSummary();
      const activeCount = summary.statusCounts
        .filter((s) => ACTIVE_STATUSES.includes(s.status.toLowerCase()))
        .reduce((sum, s) => sum + s.count, 0);
      liveActivePods = activeCount;
    } catch (err) {
      console.warn(
        "[Stats] Failed to fetch live instance summary, using snapshot:",
        err,
      );
    }

    // MRR + Revenue This Week: live from Stripe (source of truth); fall back to the daily
    // snapshot if Stripe is unavailable. Other fields stay from the snapshot.
    let mrr = latest.mrrCents;
    let revenueThisWeek = latest.revenueWeekCents;
    try {
      const live = await getLiveRevenue();
      mrr = live.mrrCents;
      revenueThisWeek = live.revenueWeekCents;
    } catch (e) {
      console.warn(
        "[Stats] live Stripe MRR/revenue unavailable, using snapshot:",
        e,
      );
    }

    // Total Customers = Total Signups: real (non-internal) customers who signed up. Live count
    // from customer_lifecycle — same source + filter as the marketing funnel's "Total Signups".
    const totalCustomers = await prisma.customerLifecycle.count({
      where: buildExcludeInternalWhere(await getInternalExclusions()),
    });

    const current = {
      totalCustomers,
      activePods: liveActivePods,
      mrr,
      newCustomersThisWeek: latest.newThisWeek,
      revenueThisWeek,
    };

    return NextResponse.json({
      ...current,
      growth: previous
        ? {
            totalCustomers: current.totalCustomers - previous.totalCustomers,
            activePods: current.activePods - previous.activeGPUs,
            mrr: current.mrr - previous.mrrCents,
            newCustomersThisWeek:
              current.newCustomersThisWeek - previous.newThisWeek,
            revenueThisWeek:
              current.revenueThisWeek - previous.revenueWeekCents,
          }
        : null,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
