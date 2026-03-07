import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProviderSessionToken } from "@/lib/auth/provider";

const COOKIE_NAME = "provider_session";

/**
 * GET /api/providers/revenue
 * Get revenue summary and breakdown for the current provider
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    // Get query params for date range
    const searchParams = request.nextUrl.searchParams;
    const period = searchParams.get("period") || "30d";

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "ytd":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "all":
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all nodes for this provider
    const nodes = await prisma.providerNode.findMany({
      where: { providerId: session.providerId },
      select: {
        id: true,
        hostname: true,
        gpuModel: true,
        gpuCount: true,
        status: true,
      },
    });

    // Get usage records for the period
    const usageRecords = await prisma.providerNodeUsage.findMany({
      where: {
        node: { providerId: session.providerId },
        periodStart: { gte: startDate },
      },
      include: {
        node: {
          select: {
            id: true,
            hostname: true,
            gpuModel: true,
            gpuCount: true,
          },
        },
      },
      orderBy: { periodStart: "asc" },
    });

    // Calculate totals
    const totals = usageRecords.reduce(
      (acc, record) => ({
        totalHours: acc.totalHours + record.totalHours,
        occupiedHours: acc.occupiedHours + record.occupiedHours,
        customerRevenueCents: acc.customerRevenueCents + record.customerRevenueCents,
        providerEarningsCents: acc.providerEarningsCents + record.providerEarningsCents,
        packetMarginCents: acc.packetMarginCents + record.packetMarginCents,
      }),
      {
        totalHours: 0,
        occupiedHours: 0,
        customerRevenueCents: 0,
        providerEarningsCents: 0,
        packetMarginCents: 0,
      }
    );

    // Group by day for chart
    const dailyRevenue: Record<string, number> = {};
    for (const record of usageRecords) {
      const dateKey = record.periodStart.toISOString().split("T")[0];
      dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + record.providerEarningsCents;
    }

    // Group by node
    const revenueByNode: Record<
      string,
      {
        hostname: string;
        gpuModel: string | null;
        gpuCount: number | null;
        totalHours: number;
        occupiedHours: number;
        providerEarningsCents: number;
      }
    > = {};

    for (const record of usageRecords) {
      const nodeId = record.node.id;
      if (!revenueByNode[nodeId]) {
        revenueByNode[nodeId] = {
          hostname: record.node.hostname,
          gpuModel: record.node.gpuModel,
          gpuCount: record.node.gpuCount,
          totalHours: 0,
          occupiedHours: 0,
          providerEarningsCents: 0,
        };
      }
      revenueByNode[nodeId].totalHours += record.totalHours;
      revenueByNode[nodeId].occupiedHours += record.occupiedHours;
      revenueByNode[nodeId].providerEarningsCents += record.providerEarningsCents;
    }

    // Current month earnings (for next payout estimate)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthUsage = await prisma.providerNodeUsage.aggregate({
      where: {
        node: { providerId: session.providerId },
        periodStart: { gte: monthStart },
      },
      _sum: {
        providerEarningsCents: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        period,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        summary: {
          totalHours: totals.totalHours,
          occupiedHours: totals.occupiedHours,
          utilizationPercent:
            totals.totalHours > 0
              ? ((totals.occupiedHours / totals.totalHours) * 100).toFixed(1)
              : "0",
          customerRevenue: totals.customerRevenueCents / 100,
          providerEarnings: totals.providerEarningsCents / 100,
          packetMargin: totals.packetMarginCents / 100,
          avgRevenuePerOccupiedHour:
            totals.occupiedHours > 0
              ? totals.providerEarningsCents / 100 / totals.occupiedHours
              : 0,
        },
        currentMonth: {
          estimatedPayout: (currentMonthUsage._sum.providerEarningsCents || 0) / 100,
          payoutDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
        },
        dailyRevenue: Object.entries(dailyRevenue).map(([date, cents]) => ({
          date,
          revenue: cents / 100,
        })),
        revenueByNode: Object.entries(revenueByNode).map(([nodeId, data]) => ({
          nodeId,
          hostname: data.hostname,
          gpuModel: data.gpuModel,
          gpuCount: data.gpuCount,
          totalHours: data.totalHours,
          occupiedHours: data.occupiedHours,
          utilizationPercent:
            data.totalHours > 0
              ? ((data.occupiedHours / data.totalHours) * 100).toFixed(1)
              : "0",
          earnings: data.providerEarningsCents / 100,
        })),
        activeNodes: nodes.filter((n) => n.status === "active").length,
        totalNodes: nodes.length,
        totalGpus: nodes.reduce((sum, n) => sum + (n.gpuCount || 0), 0),
      },
    });
  } catch (error) {
    console.error("Get provider revenue error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get revenue data" },
      { status: 500 }
    );
  }
}
