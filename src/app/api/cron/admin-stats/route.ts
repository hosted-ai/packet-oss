import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getStripe } from "@/lib/stripe";
import { computeMrrCents, computeRevenueLastNDaysCents } from "@/lib/stripe-metrics";
import { prisma } from "@/lib/prisma";
import { getInternalExclusions, buildExcludeInternalWhere } from "@/lib/internal-accounts";
import { getGlobalInstanceSummary, type UnifiedInstance } from "@/lib/hostedai/instances";
import { hostedaiRequest } from "@/lib/hostedai/client";

/**
 * POST /api/cron/admin-stats
 *
 * Computes admin dashboard stats and stores them as a daily snapshot.
 * Reads customer data from local CustomerCache (not Stripe).
 * Runs every 12 hours via external cron.
 */
export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    console.log("[Admin Stats] Starting stats computation...");

    // Read from local cache instead of Stripe
    const allCustomers = await prisma.customerCache.findMany({
      where: { isDeleted: false },
    });

    // Recent customers (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCustomers = allCustomers.filter(
      (c) => c.stripeCreatedAt >= sevenDaysAgo
    );

    // Revenue this week = Stripe gross volume (succeeded charges minus refunds), last 7 days.
    const stripe = await getStripe();
    const recentRevenue = await computeRevenueLastNDaysCents(stripe, 7);

    // Count active pods from HAI 2.2 /instances/unified (authoritative source)
    let activePods = 0;

    // Map teamId → customerId (for pod attribution)
    const teamToCustomerId = new Map<string, string>();
    for (const customer of allCustomers) {
      if (customer.teamId) teamToCustomerId.set(customer.teamId, customer.id);
    }

    // Group customers by email to find primary customer per email
    // (a customer may have separate hourly + monthly Stripe accounts)
    const emailToPrimary = new Map<string, string>();
    const customerIdToPrimary = new Map<string, string>();
    for (const customer of allCustomers) {
      if (!customer.email) continue;
      const emailKey = customer.email.toLowerCase();
      const existing = emailToPrimary.get(emailKey);
      if (!existing ||
          (customer.billingType === "hourly" && customer.teamId)) {
        emailToPrimary.set(emailKey, customer.id);
      }
    }
    for (const customer of allCustomers) {
      if (!customer.email) continue;
      const primary = emailToPrimary.get(customer.email.toLowerCase());
      if (primary) customerIdToPrimary.set(customer.id, primary);
    }

    // "Active GPUs" = live instances. /instances/unified returns both pods and
    // VMs (nature): a live pod reports "running", a live VM reports "active"
    // (Confluence HP/600178689 §2 — VM ACTIVE is billable/live, the VM analog
    // of pod Running). Both must count, else VM-nature GPUs drop out of this
    // admin per-customer count while still showing on the user dashboard —
    // the PA-134 divergence. pending/starting/restarting are transitional-up.
    const ACTIVE_STATUSES = ["running", "active", "pending", "starting", "restarting"];

    const podCountByCustomer = new Map<string, number>();
    try {
      // Get summary first for the total active count
      const summary = await getGlobalInstanceSummary();
      activePods = summary.statusCounts
        .filter((s) => ACTIVE_STATUSES.includes(s.status.toLowerCase()))
        .reduce((sum, s) => sum + s.count, 0);

      // Paginate through all instances for per-customer attribution
      let page = 0;
      const perPage = 100;
      let fetched = 0;
      while (fetched < summary.totalItems) {
        const response = await hostedaiRequest<{
          items: UnifiedInstance[];
          total_items: number;
        }>("GET", `/instances/unified?page=${page}&per_page=${perPage}`, undefined, 60000);

        for (const instance of response.items || []) {
          if (!ACTIVE_STATUSES.includes(instance.status.toLowerCase())) continue;
          const teamId = instance.team?.id;
          if (!teamId) continue;
          const customerId = teamToCustomerId.get(teamId);
          if (customerId) {
            const primaryId = customerIdToPrimary.get(customerId) || customerId;
            podCountByCustomer.set(primaryId, (podCountByCustomer.get(primaryId) || 0) + 1);
          }
        }

        fetched += (response.items || []).length;
        if ((response.items || []).length < perPage) break;
        page++;
      }
    } catch (err) {
      console.warn("[Admin Stats] Failed to fetch instances from HAI 2.2, pod counts will be 0:", err);
    }

    // Update activePods count in CustomerCache
    // Only skip if HAI API returned 0 and we previously had pods (likely API failure)
    const lastSnapshot = await prisma.adminStatsSnapshot.findFirst({
      orderBy: { date: "desc" },
    });
    const lastActivePods = lastSnapshot?.activeGPUs ?? 0;
    const shouldUpdatePodCounts = activePods > 0 || lastActivePods === 0;

    if (shouldUpdatePodCounts) {
      await prisma.customerCache.updateMany({
        where: { isDeleted: false },
        data: { activePods: 0 },
      });
      for (const [customerId, pods] of podCountByCustomer) {
        await prisma.customerCache.update({
          where: { id: customerId },
          data: { activePods: pods },
        }).catch(() => {});
      }
      console.log(`[Admin Stats] Updated pod counts for ${podCountByCustomer.size} customers (${activePods} running)`);
    } else {
      console.warn(`[Admin Stats] Skipping pod count update — HAI returned 0 pods vs snapshot ${lastActivePods} (likely API failure)`);
      activePods = lastActivePods;
    }

    // MRR = Stripe active recurring subscriptions, normalized to monthly (paginated).
    const totalMrrCents = await computeMrrCents(stripe);
    // Total Customers = Total Signups: real (non-internal) customers with a lifecycle row.
    const totalCustomersCount = await prisma.customerLifecycle.count({ where: buildExcludeInternalWhere(await getInternalExclusions()) });
    const todayStr = new Date().toISOString().split("T")[0];

    await prisma.adminStatsSnapshot.upsert({
      where: { date: todayStr },
      update: {
        totalCustomers: totalCustomersCount,
        activeGPUs: activePods,
        mrrCents: totalMrrCents,
        newThisWeek: recentCustomers.length,
        revenueWeekCents: recentRevenue,
      },
      create: {
        date: todayStr,
        totalCustomers: totalCustomersCount,
        activeGPUs: activePods,
        mrrCents: totalMrrCents,
        newThisWeek: recentCustomers.length,
        revenueWeekCents: recentRevenue,
      },
    });

    console.log(`[Admin Stats] Saved snapshot for ${todayStr}: ${totalCustomersCount} customers, ${activePods} pods, $${(totalMrrCents / 100).toFixed(2)} MRR`);

    return NextResponse.json({
      success: true,
      date: todayStr,
      totalCustomers: totalCustomersCount,
      activePods,
      mrr: totalMrrCents,
      newThisWeek: recentCustomers.length,
      revenueWeekCents: recentRevenue,
    });
  } catch (error) {
    console.error("[Admin Stats] Failed:", error);
    return NextResponse.json(
      { error: "Failed to compute stats", details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
