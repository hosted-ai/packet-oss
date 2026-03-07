import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { readPoolOverviewCache } from "@/lib/pool-overview";

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

    // Recent charges still need Stripe (no local cache for charges)
    const stripe = getStripe();
    const sevenDaysAgoUnix = Math.floor(sevenDaysAgo.getTime() / 1000);
    const charges = await stripe.charges.list({
      limit: 100,
      created: { gte: sevenDaysAgoUnix },
    });
    const recentRevenue = charges.data
      .filter((c) => c.status === "succeeded")
      .reduce((sum, c) => sum + c.amount, 0);

    // Count active pods using pool overview cache (0 hosted.ai API calls)
    let activePods = 0;
    const teamToCustomerId = new Map<string, string>();
    for (const customer of allCustomers) {
      if (customer.teamId) teamToCustomerId.set(customer.teamId, customer.id);
    }

    const podCountByCustomer = new Map<string, number>();
    const poolCache = readPoolOverviewCache();
    if (poolCache?.pools) {
      for (const pool of poolCache.pools) {
        for (const pod of pool.pods || []) {
          if (pod.teamId && ["subscribed", "active", "running"].includes(pod.status)) {
            activePods++;
            const customerId = teamToCustomerId.get(pod.teamId);
            if (customerId) {
              podCountByCustomer.set(customerId, (podCountByCustomer.get(customerId) || 0) + 1);
            }
          }
        }
      }
    } else {
      console.warn("[Admin Stats] Pool overview cache not available, pod counts will be 0");
    }

    // Update activePods count in CustomerCache for all customers
    // First reset all to 0, then set actual counts
    await prisma.customerCache.updateMany({
      where: { isDeleted: false },
      data: { activePods: 0 },
    });
    for (const [customerId, pods] of podCountByCustomer) {
      await prisma.customerCache.update({
        where: { id: customerId },
        data: { activePods: pods },
      }).catch(() => {}); // skip if customer not in cache
    }
    console.log(`[Admin Stats] Updated pod counts for ${podCountByCustomer.size} customers`);

    // MRR = Stripe recurring subscriptions only (monthly contracts)
    const subscriptions = await stripe.subscriptions.list({ status: "active", limit: 100 });
    let totalMrrCents = 0;
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        if (item.price.recurring?.interval === "month") {
          totalMrrCents += (item.price.unit_amount || 0) * (item.quantity || 1);
        } else if (item.price.recurring?.interval === "year") {
          totalMrrCents += Math.round(((item.price.unit_amount || 0) * (item.quantity || 1)) / 12);
        }
      }
    }
    const todayStr = new Date().toISOString().split("T")[0];

    await prisma.adminStatsSnapshot.upsert({
      where: { date: todayStr },
      update: {
        totalCustomers: allCustomers.length,
        activeGPUs: activePods,
        mrrCents: totalMrrCents,
        newThisWeek: recentCustomers.length,
        revenueWeekCents: recentRevenue,
      },
      create: {
        date: todayStr,
        totalCustomers: allCustomers.length,
        activeGPUs: activePods,
        mrrCents: totalMrrCents,
        newThisWeek: recentCustomers.length,
        revenueWeekCents: recentRevenue,
      },
    });

    console.log(`[Admin Stats] Saved snapshot for ${todayStr}: ${allCustomers.length} customers, ${activePods} pods, $${(totalMrrCents / 100).toFixed(2)} MRR`);

    return NextResponse.json({
      success: true,
      date: todayStr,
      totalCustomers: allCustomers.length,
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
