/**
 * Admin Pods History API
 *
 * Returns historical GPU metrics for charting.
 * Supports filtering by subscription ID, pool ID, time range, and aggregation.
 *
 * GET /api/admin/pods/history?subscriptionId=xxx&hours=24&interval=5
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export interface HistoryDataPoint {
  timestamp: string;
  gpuUtilization: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
}

export interface PodHistoryResponse {
  subscriptionId: string;
  poolId?: number;
  poolName?: string;
  dataPoints: HistoryDataPoint[];
  summary: {
    avgUtilization: number;
    maxUtilization: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    totalDataPoints: number;
  };
}

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

  try {
    const { searchParams } = request.nextUrl;

    // Filter parameters
    const subscriptionId = searchParams.get("subscriptionId");
    const poolId = searchParams.get("poolId");
    const hours = parseInt(searchParams.get("hours") || "24", 10);
    const interval = parseInt(searchParams.get("interval") || "5", 10); // minutes between data points

    // Time range
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Build where clause
    const where: {
      timestamp: { gte: Date };
      subscriptionId?: string;
      poolId?: number;
    } = {
      timestamp: { gte: startTime },
    };

    if (subscriptionId) {
      where.subscriptionId = subscriptionId;
    }

    if (poolId) {
      where.poolId = parseInt(poolId, 10);
    }

    // Fetch raw metrics
    const metrics = await prisma.gpuHardwareMetrics.findMany({
      where,
      orderBy: { timestamp: "asc" },
      select: {
        subscriptionId: true,
        poolId: true,
        poolName: true,
        gpuUtilization: true,
        memoryPercent: true,
        temperature: true,
        powerDraw: true,
        timestamp: true,
      },
    });

    if (metrics.length === 0) {
      return NextResponse.json({
        history: [],
        summary: {
          totalMetrics: 0,
          uniqueSubscriptions: 0,
          timeRange: { start: startTime.toISOString(), end: new Date().toISOString() },
        },
      });
    }

    // Group by subscription
    const bySubscription = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const existing = bySubscription.get(m.subscriptionId) || [];
      existing.push(m);
      bySubscription.set(m.subscriptionId, existing);
    }

    // Process each subscription's metrics with time-based aggregation
    const history: PodHistoryResponse[] = [];
    const intervalMs = interval * 60 * 1000;

    for (const [subId, subMetrics] of bySubscription) {
      // Aggregate data points by time intervals
      const buckets = new Map<number, typeof subMetrics>();

      for (const m of subMetrics) {
        const bucketTime = Math.floor(m.timestamp.getTime() / intervalMs) * intervalMs;
        const bucket = buckets.get(bucketTime) || [];
        bucket.push(m);
        buckets.set(bucketTime, bucket);
      }

      // Calculate averages for each bucket
      const dataPoints: HistoryDataPoint[] = [];
      const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);

      for (const [bucketTime, bucketMetrics] of sortedBuckets) {
        const avgUtilization = bucketMetrics.reduce((s, m) => s + m.gpuUtilization, 0) / bucketMetrics.length;
        const avgMemory = bucketMetrics.reduce((s, m) => s + m.memoryPercent, 0) / bucketMetrics.length;
        const avgTemp = bucketMetrics.reduce((s, m) => s + m.temperature, 0) / bucketMetrics.length;
        const avgPower = bucketMetrics.reduce((s, m) => s + m.powerDraw, 0) / bucketMetrics.length;

        dataPoints.push({
          timestamp: new Date(bucketTime).toISOString(),
          gpuUtilization: Math.round(avgUtilization * 10) / 10,
          memoryPercent: Math.round(avgMemory * 10) / 10,
          temperature: Math.round(avgTemp * 10) / 10,
          powerDraw: Math.round(avgPower * 10) / 10,
        });
      }

      // Calculate summary stats
      const allUtilizations = subMetrics.map((m) => m.gpuUtilization);
      const summary = {
        avgUtilization: Math.round((allUtilizations.reduce((s, v) => s + v, 0) / allUtilizations.length) * 10) / 10,
        maxUtilization: Math.round(Math.max(...allUtilizations) * 10) / 10,
        avgMemoryPercent: Math.round((subMetrics.reduce((s, m) => s + m.memoryPercent, 0) / subMetrics.length) * 10) / 10,
        avgTemperature: Math.round((subMetrics.reduce((s, m) => s + m.temperature, 0) / subMetrics.length) * 10) / 10,
        totalDataPoints: subMetrics.length,
      };

      history.push({
        subscriptionId: subId,
        poolId: subMetrics[0]?.poolId || undefined,
        poolName: subMetrics[0]?.poolName || undefined,
        dataPoints,
        summary,
      });
    }

    // Overall summary
    const allMetrics = metrics;
    const overallSummary = {
      totalMetrics: allMetrics.length,
      uniqueSubscriptions: bySubscription.size,
      timeRange: {
        start: startTime.toISOString(),
        end: new Date().toISOString(),
      },
      avgUtilization: allMetrics.length > 0
        ? Math.round((allMetrics.reduce((s, m) => s + m.gpuUtilization, 0) / allMetrics.length) * 10) / 10
        : 0,
    };

    return NextResponse.json({
      history,
      summary: overallSummary,
    });
  } catch (error) {
    console.error("Admin pods history error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch history";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
