import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken || !verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Exclude internal users from all lifecycle queries
    const excludeInternal = {
      NOT: [
        // Add internal email domains/addresses to exclude from marketing analytics
      ],
    };

    // ─── Overview metrics ───

    const [
      totalPageViews,
      pageViewsToday,
      pageViews7d,
      pageViews30d,
      uniqueSessions30d,
      totalLifecycles,
      lifecyclesPaid,
      lifecyclesChurned,
    ] = await Promise.all([
      prisma.pageView.count(),
      prisma.pageView.count({ where: { createdAt: { gte: today } } }),
      prisma.pageView.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.pageView.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.pageView.groupBy({
        by: ["sessionId"],
        where: { createdAt: { gte: thirtyDaysAgo } },
      }).then((r) => r.length),
      prisma.customerLifecycle.count({ where: excludeInternal }),
      prisma.customerLifecycle.count({
        where: { ...excludeInternal, firstDepositAt: { not: null } },
      }),
      prisma.customerLifecycle.count({
        where: { ...excludeInternal, churnedAt: { not: null } },
      }),
    ]);

    // ─── Visit → Signup conversion ───
    // Count unique visitors (sessions) and how many converted to signups
    // Uses sessionId link between PageView and CustomerLifecycle

    const [uniqueSessionsAll, convertedSessions] = await Promise.all([
      // Total unique sessions (all time)
      prisma.pageView.groupBy({ by: ["sessionId"] }).then((r) => r.length),
      // Sessions that resulted in a signup (sessionId exists in both tables)
      prisma.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(DISTINCT cl.sessionId) as count
         FROM CustomerLifecycle cl
         WHERE cl.sessionId IS NOT NULL
           AND cl.sessionId IN (SELECT DISTINCT pv.sessionId FROM PageView pv)
           AND cl.email NOT LIKE '%@example.com'`
      ).then((r) => Number(r[0]?.count || 0)),
    ]);

    // ─── Revenue / financial aggregates ───

    const revenueAgg = await prisma.customerLifecycle.aggregate({
      _sum: { totalDepositsCents: true, totalSpendCents: true },
      _avg: { totalDepositsCents: true, totalSpendCents: true },
      where: excludeInternal,
    });

    const paidCustomerRevenue = await prisma.customerLifecycle.aggregate({
      _sum: { totalDepositsCents: true, totalSpendCents: true },
      _avg: { totalDepositsCents: true, totalSpendCents: true, gpuHoursTotal: true },
      where: { ...excludeInternal, firstDepositAt: { not: null } },
    });

    // ─── Billing type breakdown ───

    const billingBreakdown = await prisma.customerLifecycle.groupBy({
      by: ["currentBillingType"],
      _count: { id: true },
      _sum: { totalDepositsCents: true, totalSpendCents: true },
      _avg: { totalDepositsCents: true },
      where: excludeInternal,
      orderBy: { _sum: { totalDepositsCents: "desc" } },
    });

    // ─── Top customers by revenue ───

    const topCustomers = await prisma.customerLifecycle.findMany({
      where: excludeInternal,
      select: {
        email: true,
        totalDepositsCents: true,
        totalSpendCents: true,
        depositCount: true,
        gpuHoursTotal: true,
        inferenceTokens: true,
        currentBillingType: true,
        signedUpAt: true,
        firstDepositAt: true,
        firstGpuDeployAt: true,
        subscribedAt: true,
        utmSource: true,
      },
      orderBy: { totalDepositsCents: "desc" },
      take: 25,
    });

    // ─── Attribution (UTM breakdown) ───

    const [utmSourceBreakdown, utmCampaignBreakdown, utmMediumBreakdown] =
      await Promise.all([
        prisma.customerLifecycle.groupBy({
          by: ["utmSource"],
          _count: { id: true },
          _sum: { totalDepositsCents: true, totalSpendCents: true },
          where: excludeInternal,
          orderBy: { _count: { id: "desc" } },
          take: 20,
        }),
        prisma.customerLifecycle.groupBy({
          by: ["utmCampaign"],
          _count: { id: true },
          _sum: { totalDepositsCents: true, totalSpendCents: true },
          where: excludeInternal,
          orderBy: { _count: { id: "desc" } },
          take: 20,
        }),
        prisma.customerLifecycle.groupBy({
          by: ["utmMedium"],
          _count: { id: true },
          _sum: { totalDepositsCents: true, totalSpendCents: true },
          where: excludeInternal,
          orderBy: { _count: { id: "desc" } },
          take: 20,
        }),
      ]);

    // Count how many have actual UTM data
    const utmTrackedCount = await prisma.customerLifecycle.count({
      where: { ...excludeInternal, utmSource: { not: null } },
    });

    // ─── Funnel data ───

    const [
      totalSignups,
      loggedIn,
      deposited,
      deployed,
      subscribed,
      usedApi,
    ] = await Promise.all([
      prisma.customerLifecycle.count({ where: excludeInternal }),
      prisma.customerLifecycle.count({ where: { ...excludeInternal, firstLoginAt: { not: null } } }),
      prisma.customerLifecycle.count({ where: { ...excludeInternal, firstDepositAt: { not: null } } }),
      prisma.customerLifecycle.count({ where: { ...excludeInternal, firstGpuDeployAt: { not: null } } }),
      prisma.customerLifecycle.count({ where: { ...excludeInternal, subscribedAt: { not: null } } }),
      prisma.customerLifecycle.count({ where: { ...excludeInternal, firstApiCallAt: { not: null } } }),
    ]);

    const funnel = [
      { stage: "Visited", count: uniqueSessionsAll },
      { stage: "Signed Up", count: totalSignups },
      { stage: "Logged In", count: loggedIn },
      { stage: "First Deposit", count: deposited },
      { stage: "First GPU Deploy", count: deployed },
      { stage: "Used Inference API", count: usedApi },
      { stage: "Subscribed (Monthly)", count: subscribed },
    ];

    // ─── Top pages (page views) ───

    const topPages = await prisma.pageView.groupBy({
      by: ["page"],
      _count: { id: true },
      where: { createdAt: { gte: thirtyDaysAgo } },
      orderBy: { _count: { id: "desc" } },
      take: 15,
    });

    // ─── Daily trend (last 30 days) ───

    const dailyPageViews = await prisma.$queryRawUnsafe<
      Array<{ day: string; count: number }>
    >(
      `SELECT date(createdAt) as day, COUNT(*) as count
       FROM PageView
       WHERE createdAt >= ?
       GROUP BY date(createdAt)
       ORDER BY day ASC`,
      thirtyDaysAgo.toISOString()
    );

    const dailySignups = await prisma.$queryRawUnsafe<
      Array<{ day: string; count: number }>
    >(
      `SELECT date(signedUpAt) as day, COUNT(*) as count
       FROM CustomerLifecycle
       WHERE signedUpAt >= ?
         AND email NOT LIKE '%@example.com'
       GROUP BY date(signedUpAt)
       ORDER BY day ASC`,
      thirtyDaysAgo.toISOString()
    );

    // ─── Recent signups ───

    const recentConversions = await prisma.customerLifecycle.findMany({
      where: excludeInternal,
      select: {
        email: true,
        utmSource: true,
        utmCampaign: true,
        utmMedium: true,
        signedUpAt: true,
        firstDepositAt: true,
        firstGpuDeployAt: true,
        subscribedAt: true,
        totalDepositsCents: true,
        totalSpendCents: true,
        currentBillingType: true,
        landingPage: true,
        depositCount: true,
        gpuHoursTotal: true,
      },
      orderBy: { signedUpAt: "desc" },
      take: 30,
    });

    return NextResponse.json({
      overview: {
        totalPageViews,
        pageViewsToday,
        pageViews7d,
        pageViews30d,
        uniqueSessions30d,
        totalLifecycles,
        lifecyclesPaid,
        lifecyclesChurned,
        uniqueVisitors: uniqueSessionsAll,
        convertedVisitors: convertedSessions,
      },
      revenue: {
        totalDepositsCents: revenueAgg._sum.totalDepositsCents || 0,
        totalSpendCents: revenueAgg._sum.totalSpendCents || 0,
        avgDepositsCents: Math.round(paidCustomerRevenue._avg.totalDepositsCents || 0),
        avgSpendCents: Math.round(paidCustomerRevenue._avg.totalSpendCents || 0),
        avgGpuHours: Math.round((paidCustomerRevenue._avg.gpuHoursTotal || 0) * 10) / 10,
      },
      billingBreakdown: billingBreakdown.map((r) => ({
        billingType: r.currentBillingType,
        customers: r._count.id,
        totalDeposits: r._sum.totalDepositsCents || 0,
        totalSpend: r._sum.totalSpendCents || 0,
        avgDeposits: Math.round(r._avg.totalDepositsCents || 0),
      })),
      topCustomers,
      attribution: {
        utmTrackedCount,
        bySource: utmSourceBreakdown.map((r) => ({
          source: r.utmSource || "(direct)",
          customers: r._count.id,
          deposits: r._sum.totalDepositsCents || 0,
          spend: r._sum.totalSpendCents || 0,
        })),
        byCampaign: utmCampaignBreakdown.map((r) => ({
          campaign: r.utmCampaign || "(none)",
          customers: r._count.id,
          deposits: r._sum.totalDepositsCents || 0,
          spend: r._sum.totalSpendCents || 0,
        })),
        byMedium: utmMediumBreakdown.map((r) => ({
          medium: r.utmMedium || "(none)",
          customers: r._count.id,
          deposits: r._sum.totalDepositsCents || 0,
          spend: r._sum.totalSpendCents || 0,
        })),
      },
      funnel,
      topPages: topPages.map((r) => ({
        page: r.page,
        views: r._count.id,
      })),
      trends: {
        dailyPageViews: dailyPageViews.map((r) => ({
          day: r.day,
          count: Number(r.count),
        })),
        dailySignups: dailySignups.map((r) => ({
          day: r.day,
          count: Number(r.count),
        })),
      },
      recentConversions,
    });
  } catch (error) {
    console.error("Marketing API error:", error);
    return NextResponse.json(
      { error: "Failed to load marketing data" },
      { status: 500 }
    );
  }
}
