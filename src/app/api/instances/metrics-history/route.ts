/**
 * GET /api/instances/metrics-history
 *
 * Fetches historical GPU metrics for a subscription or all subscriptions.
 * Returns time-series data for charts and historical analysis.
 *
 * Query params:
 * - subscriptionId: (optional) Filter to specific subscription
 * - hours: (optional) Number of hours to look back (default 24, max 168 = 7 days)
 * - interval: (optional) Aggregation interval in minutes (default auto-calculated)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";

interface MetricsDataPoint {
  timestamp: string;
  gpuUtilization: number;
  memoryPercent: number;
  temperature: number;
  powerDraw: number;
  cpuPercent: number | null;
  systemMemPercent: number | null;
}

interface SubscriptionMetrics {
  subscriptionId: string;
  data: MetricsDataPoint[];
  summary: {
    avgGpuUtilization: number;
    avgMemoryPercent: number;
    avgTemperature: number;
    maxTemperature: number;
    avgPowerDraw: number;
    maxPowerDraw: number;
    avgCpuPercent: number | null;
    avgSystemMemPercent: number | null;
    dataPoints: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Parse query params
    const { searchParams } = request.nextUrl;
    const subscriptionId = searchParams.get("subscriptionId");
    const hours = Math.min(parseInt(searchParams.get("hours") || "24", 10), 168);
    const intervalMinutes = parseInt(searchParams.get("interval") || "0", 10);

    // Calculate time range
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Build query
    const whereClause = {
      stripeCustomerId: payload.customerId,
      timestamp: { gte: startTime },
      ...(subscriptionId && { subscriptionId }),
    };

    // Fetch metrics
    const metrics = await prisma.gpuHardwareMetrics.findMany({
      where: whereClause,
      orderBy: { timestamp: "asc" },
      select: {
        subscriptionId: true,
        timestamp: true,
        gpuUtilization: true,
        memoryPercent: true,
        temperature: true,
        powerDraw: true,
        cpuPercent: true,
        systemMemPercent: true,
      },
    });

    // Group by subscription
    const bySubscription = new Map<string, typeof metrics>();
    for (const metric of metrics) {
      const existing = bySubscription.get(metric.subscriptionId) || [];
      existing.push(metric);
      bySubscription.set(metric.subscriptionId, existing);
    }

    // Process each subscription's data
    const result: SubscriptionMetrics[] = [];

    for (const [subId, data] of bySubscription) {
      // Optionally aggregate data if interval is specified
      let processedData: MetricsDataPoint[];

      if (intervalMinutes > 0 && data.length > 0) {
        // Aggregate into time buckets
        const buckets = new Map<number, typeof data>();
        const intervalMs = intervalMinutes * 60 * 1000;

        for (const point of data) {
          const bucketTime = Math.floor(point.timestamp.getTime() / intervalMs) * intervalMs;
          const bucket = buckets.get(bucketTime) || [];
          bucket.push(point);
          buckets.set(bucketTime, bucket);
        }

        processedData = Array.from(buckets.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([timestamp, points]) => {
            const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
            const avgOrNull = (arr: (number | null)[]) => {
              const valid = arr.filter((x): x is number => x !== null);
              return valid.length > 0 ? avg(valid) : null;
            };

            return {
              timestamp: new Date(timestamp).toISOString(),
              gpuUtilization: avg(points.map(p => p.gpuUtilization)),
              memoryPercent: avg(points.map(p => p.memoryPercent)),
              temperature: avg(points.map(p => p.temperature)),
              powerDraw: avg(points.map(p => p.powerDraw)),
              cpuPercent: avgOrNull(points.map(p => p.cpuPercent)),
              systemMemPercent: avgOrNull(points.map(p => p.systemMemPercent)),
            };
          });
      } else {
        processedData = data.map(point => ({
          timestamp: point.timestamp.toISOString(),
          gpuUtilization: point.gpuUtilization,
          memoryPercent: point.memoryPercent,
          temperature: point.temperature,
          powerDraw: point.powerDraw,
          cpuPercent: point.cpuPercent,
          systemMemPercent: point.systemMemPercent,
        }));
      }

      // Calculate summary statistics
      const gpuUtils = data.map(d => d.gpuUtilization);
      const memPercents = data.map(d => d.memoryPercent);
      const temps = data.map(d => d.temperature);
      const powers = data.map(d => d.powerDraw);
      const cpus = data.map(d => d.cpuPercent).filter((x): x is number => x !== null);
      const sysMems = data.map(d => d.systemMemPercent).filter((x): x is number => x !== null);

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

      result.push({
        subscriptionId: subId,
        data: processedData,
        summary: {
          avgGpuUtilization: avg(gpuUtils),
          avgMemoryPercent: avg(memPercents),
          avgTemperature: avg(temps),
          maxTemperature: max(temps),
          avgPowerDraw: avg(powers),
          maxPowerDraw: max(powers),
          avgCpuPercent: cpus.length > 0 ? avg(cpus) : null,
          avgSystemMemPercent: sysMems.length > 0 ? avg(sysMems) : null,
          dataPoints: data.length,
        },
      });
    }

    return NextResponse.json({
      timeRange: {
        start: startTime.toISOString(),
        end: new Date().toISOString(),
        hours,
      },
      subscriptions: result,
      totalDataPoints: metrics.length,
    });
  } catch (err) {
    console.error("Metrics history error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
