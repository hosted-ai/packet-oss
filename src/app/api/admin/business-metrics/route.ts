import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { readPoolOverviewCache } from "@/lib/pool-overview";
import Stripe from "stripe";

// Helper to get start of day in Unix timestamp
function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// Helper to get days ago
function daysAgo(days: number): number {
  return Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
}

// ==================== CACHE ====================

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  data: Record<string, unknown>;
  cachedAt: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(period: string): CacheEntry | null {
  const entry = cache.get(period);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(period);
    return null;
  }
  return entry;
}

function setCache(period: string, data: Record<string, unknown>): CacheEntry {
  const entry: CacheEntry = {
    data,
    cachedAt: new Date().toISOString(),
    timestamp: Date.now(),
  };
  cache.set(period, entry);
  return entry;
}

// ==================== ROUTE ====================

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30d"; // 7d, 30d, 90d, all
  const forceRefresh = searchParams.get("refresh") === "true";

  // Return cached data if available and not force-refreshing
  if (!forceRefresh) {
    const cached = getCached(period);
    if (cached) {
      return NextResponse.json({ ...cached.data, cachedAt: cached.cachedAt });
    }
  }

  try {
    const stripe = getStripe();
    const now = new Date();

    // Calculate period boundaries
    let periodDays = 30;
    if (period === "7d") periodDays = 7;
    else if (period === "90d") periodDays = 90;
    else if (period === "all") periodDays = 365 * 10; // 10 years

    const periodStart = daysAgo(periodDays);
    const previousPeriodStart = daysAgo(periodDays * 2);

    // ==================== REVENUE METRICS ====================

    // Get all charges in period (paginate through all)
    const chargesData: Stripe.Charge[] = [];
    let chargesHasMore = true;
    let chargesStartingAfter: string | undefined;
    while (chargesHasMore) {
      const batch = await stripe.charges.list({
        created: { gte: periodStart },
        limit: 100,
        starting_after: chargesStartingAfter,
      });
      chargesData.push(...batch.data);
      chargesHasMore = batch.has_more;
      if (batch.data.length > 0) {
        chargesStartingAfter = batch.data[batch.data.length - 1].id;
      }
    }
    const charges = { data: chargesData };

    // Get previous period charges for comparison (paginate through all)
    const prevChargesData: Stripe.Charge[] = [];
    let prevHasMore = true;
    let prevStartingAfter: string | undefined;
    while (prevHasMore) {
      const batch = await stripe.charges.list({
        created: { gte: previousPeriodStart, lt: periodStart },
        limit: 100,
        starting_after: prevStartingAfter,
      });
      prevChargesData.push(...batch.data);
      prevHasMore = batch.has_more;
      if (batch.data.length > 0) {
        prevStartingAfter = batch.data[batch.data.length - 1].id;
      }
    }
    const previousCharges = { data: prevChargesData };

    // Calculate revenue
    const currentRevenue = charges.data
      .filter((c) => c.status === "succeeded" && !c.refunded)
      .reduce((sum, c) => sum + c.amount, 0);

    const previousRevenue = previousCharges.data
      .filter((c) => c.status === "succeeded" && !c.refunded)
      .reduce((sum, c) => sum + c.amount, 0);

    const refunds = charges.data
      .filter((c) => c.refunded)
      .reduce((sum, c) => sum + (c.amount_refunded || 0), 0);

    // Daily revenue breakdown (last 30 days max)
    const dailyDays = Math.min(periodDays, 30);
    const dailyRevenue: { date: string; revenue: number; deposits: number }[] = [];
    for (let i = 0; i < dailyDays; i++) {
      const dayStart = daysAgo(i + 1);
      const dayEnd = daysAgo(i);
      const dayCharges = charges.data.filter(
        (c) => c.created >= dayStart && c.created < dayEnd && c.status === "succeeded"
      );
      const date = new Date(dayEnd * 1000).toISOString().split("T")[0];
      dailyRevenue.unshift({
        date,
        revenue: dayCharges.reduce((sum, c) => sum + c.amount, 0) / 100,
        deposits: dayCharges.length,
      });
    }

    // ==================== CUSTOMER METRICS ====================

    // Get all customers
    const allCustomers: Stripe.Customer[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;
    while (hasMore) {
      const batch = await stripe.customers.list({
        limit: 100,
        starting_after: startingAfter,
      });
      allCustomers.push(...batch.data.filter((c): c is Stripe.Customer => !c.deleted));
      hasMore = batch.has_more;
      if (batch.data.length > 0) {
        startingAfter = batch.data[batch.data.length - 1].id;
      }
    }

    const totalCustomers = allCustomers.length;
    const newCustomers = allCustomers.filter((c) => c.created >= periodStart).length;
    const previousNewCustomers = allCustomers.filter(
      (c) => c.created >= previousPeriodStart && c.created < periodStart
    ).length;

    // Customers by billing type
    const hourlyCustomers = allCustomers.filter(
      (c) => c.metadata?.billing_type === "hourly"
    ).length;
    const monthlyCustomers = allCustomers.filter(
      (c) => c.metadata?.billing_type === "monthly"
    ).length;

    // Active customers (have balance or active subscription)
    let activeCustomers = 0;
    for (const customer of allCustomers) {
      if (customer.balance && customer.balance < 0) {
        activeCustomers++;
      }
    }

    // Total wallet balance across all customers
    const totalWalletBalance = allCustomers.reduce((sum, c) => {
      return sum + Math.abs(Math.min(0, c.balance || 0));
    }, 0);

    // Average customer value (total revenue / new customers in period)
    const avgCustomerValue = newCustomers > 0 ? currentRevenue / newCustomers : 0;

    // Customer signups by day
    const dailySignups: { date: string; count: number }[] = [];
    for (let i = 0; i < dailyDays; i++) {
      const dayStart = daysAgo(i + 1);
      const dayEnd = daysAgo(i);
      const count = allCustomers.filter(
        (c) => c.created >= dayStart && c.created < dayEnd
      ).length;
      const date = new Date(dayEnd * 1000).toISOString().split("T")[0];
      dailySignups.unshift({ date, count });
    }

    // ==================== GPU & USAGE METRICS ====================

    // Get active GPU/pod counts from pool-overview cache
    // (refreshed every 2 min by /api/cron/refresh-pool-overview)
    const poolOverview = readPoolOverviewCache();
    const activePods = poolOverview?.summary.activePods ?? 0;
    const activeGPUs = poolOverview?.summary.allocatedGpus ?? 0;
    const avgGpuUtilization = poolOverview?.summary.utilizationPercent ?? 0;

    // Calculate GPU hours and cost from PodMetadata deploy times (hourly pods only).
    // Monthly pods are billed via subscription, not per-hour — their revenue is
    // already captured in the Stripe charges/revenue section above.
    //
    // To detect whether a specific pod is still running we build a set of active
    // (poolId, teamId) pairs from pool-overview. We map stripeCustomerId → teamId
    // via customerCache since PodMetadata doesn't store teamId directly.
    const activePodKeys = new Set<string>();
    if (poolOverview) {
      for (const pool of poolOverview.pools) {
        for (const pod of pool.pods) {
          if (pod.teamId) {
            activePodKeys.add(`${pool.id}-${pod.teamId}`);
          }
        }
      }
    }

    const allPodMetadata = await prisma.podMetadata.findMany({
      where: {
        deployTime: { not: null },
        // Skip monthly pods — billed via subscription, not hourly.
        // Explicit OR needed because SQLite's != doesn't match NULL.
        OR: [
          { billingType: null },
          { billingType: { not: "monthly" } },
        ],
      },
    });

    // Build stripeCustomerId → teamId map for active-pod matching
    const customerTeamMap = new Map<string, string>();
    if (activePodKeys.size > 0 && allPodMetadata.length > 0) {
      const custIds = [...new Set(allPodMetadata.map((p) => p.stripeCustomerId))];
      const caches = await prisma.customerCache.findMany({
        where: { id: { in: custIds } },
        select: { id: true, teamId: true },
      });
      for (const c of caches) {
        if (c.teamId) customerTeamMap.set(c.id, c.teamId);
      }
    }

    let totalHoursUsed = 0;
    let totalUsageCost = 0; // in cents
    const nowMs = Date.now();
    const periodStartMs = periodStart * 1000;

    for (const pod of allPodMetadata) {
      if (!pod.deployTime) continue;
      const deployMs = pod.deployTime.getTime();

      // A pod is active if this specific pod (pool+team) appears in pool-overview,
      // or it was updated recently (last 2h — covers pods not yet in cache)
      const teamId = customerTeamMap.get(pod.stripeCustomerId);
      const podKey = pod.poolId && teamId ? `${pod.poolId}-${teamId}` : null;
      const isActive = (podKey && activePodKeys.has(podKey))
        || (nowMs - pod.updatedAt.getTime() < 2 * 60 * 60 * 1000);
      const endMs = isActive ? nowMs : pod.updatedAt.getTime();

      // Only count time within the selected period
      const effectiveStart = Math.max(deployMs, periodStartMs);
      if (effectiveStart >= endMs) continue;

      const hoursInPeriod = (endMs - effectiveStart) / (1000 * 60 * 60);
      totalHoursUsed += hoursInPeriod;

      if (pod.hourlyRateCents) {
        totalUsageCost += hoursInPeriod * pod.hourlyRateCents;
      }
    }

    // ==================== PROVIDER METRICS ====================

    const providers = await prisma.serviceProvider.findMany({
      include: {
        nodes: true,
        payouts: {
          where: {
            periodStart: { gte: new Date(periodStart * 1000) },
          },
        },
      },
    });

    const activeProviders = providers.filter((p) => p.status === "approved").length;
    const totalNodes = providers.reduce((sum, p) => sum + p.nodes.length, 0);
    const activeNodes = providers.reduce(
      (sum, p) => sum + p.nodes.filter((n) => n.status === "active" || n.status === "approved").length,
      0
    );

    const providerPayouts = providers.reduce(
      (sum, p) => sum + p.payouts.reduce((s, pay) => s + pay.netPayoutCents, 0),
      0
    );

    // Node usage data
    const nodeUsage = await prisma.providerNodeUsage.findMany({
      where: {
        periodStart: { gte: new Date(periodStart * 1000) },
      },
    });

    const providerRevenue = nodeUsage.reduce((sum, u) => sum + u.customerRevenueCents, 0);
    const providerEarnings = nodeUsage.reduce((sum, u) => sum + u.providerEarningsCents, 0);
    const packetMargin = nodeUsage.reduce((sum, u) => sum + u.packetMarginCents, 0);

    // ==================== VOUCHER & REFERRAL METRICS ====================

    const vouchers = await prisma.voucher.findMany({
      include: {
        redemptions: {
          where: {
            createdAt: { gte: new Date(periodStart * 1000) },
          },
        },
      },
    });

    const voucherRedemptions = vouchers.reduce((sum, v) => sum + v.redemptions.length, 0);
    const voucherCreditsGiven = vouchers.reduce(
      (sum, v) => sum + v.redemptions.reduce((s, r) => s + r.creditCents, 0),
      0
    );

    const referralCodes = await prisma.referralCode.findMany({
      include: {
        claims: {
          where: {
            createdAt: { gte: new Date(periodStart * 1000) },
          },
        },
      },
    });

    const referralClaims = referralCodes.reduce((sum, r) => sum + r.claims.length, 0);
    const referralConversions = referralCodes.reduce(
      (sum, r) => sum + r.claims.filter((c) => c.status === "qualified").length,
      0
    );

    // ==================== TOP CUSTOMERS ====================

    const customerBalances = allCustomers
      .map((c) => ({
        id: c.id,
        email: c.email || "Unknown",
        name: c.name || c.email?.split("@")[0] || "Unknown",
        balance: Math.abs(Math.min(0, c.balance || 0)) / 100,
        created: c.created,
      }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);

    // Get top spenders from charges
    const customerSpending: Record<string, number> = {};
    for (const charge of charges.data) {
      if (charge.status === "succeeded" && charge.customer) {
        const custId = typeof charge.customer === "string" ? charge.customer : charge.customer.id;
        customerSpending[custId] = (customerSpending[custId] || 0) + charge.amount;
      }
    }

    const topSpenders = Object.entries(customerSpending)
      .map(([id, amount]) => {
        const customer = allCustomers.find((c) => c.id === id);
        return {
          id,
          email: customer?.email || "Unknown",
          name: customer?.name || customer?.email?.split("@")[0] || "Unknown",
          spent: amount / 100,
        };
      })
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10);

    // ==================== BUILD RESPONSE & CACHE ====================

    const responseData: Record<string, unknown> = {
      success: true,
      period,
      periodDays,

      // Revenue
      revenue: {
        total: currentRevenue / 100,
        previous: previousRevenue / 100,
        change: previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0,
        refunds: refunds / 100,
        daily: dailyRevenue,
      },

      // Customers
      customers: {
        total: totalCustomers,
        new: newCustomers,
        previousNew: previousNewCustomers,
        change: previousNewCustomers > 0 ? ((newCustomers - previousNewCustomers) / previousNewCustomers) * 100 : 0,
        active: activeCustomers,
        hourly: hourlyCustomers,
        monthly: monthlyCustomers,
        avgValue: avgCustomerValue / 100,
        dailySignups,
      },

      // Wallet/Balance
      wallet: {
        totalBalance: totalWalletBalance / 100,
        avgBalance: totalCustomers > 0 ? totalWalletBalance / totalCustomers / 100 : 0,
      },

      // GPU Usage
      gpu: {
        activeGPUs,
        activePods,
        totalHoursUsed: Math.round(totalHoursUsed * 100) / 100,
        totalUsageCost: Math.round(totalUsageCost) / 100,
        avgUtilization: Math.round(avgGpuUtilization * 100) / 100,
      },

      // Providers
      providers: {
        total: providers.length,
        active: activeProviders,
        totalNodes,
        activeNodes,
        payouts: providerPayouts / 100,
        revenue: providerRevenue / 100,
        earnings: providerEarnings / 100,
        margin: packetMargin / 100,
      },

      // Vouchers & Referrals
      marketing: {
        voucherRedemptions,
        voucherCreditsGiven: voucherCreditsGiven / 100,
        referralClaims,
        referralConversions,
        activeVouchers: vouchers.filter((v) => v.active).length,
        activeReferralCodes: referralCodes.length,
      },

      // Top lists
      topCustomers: {
        byBalance: customerBalances,
        bySpending: topSpenders,
      },
    };

    const entry = setCache(period, responseData);

    return NextResponse.json({ ...responseData, cachedAt: entry.cachedAt });
  } catch (error) {
    console.error("Business metrics error:", error);
    return NextResponse.json({ error: "Failed to fetch business metrics" }, { status: 500 });
  }
}
