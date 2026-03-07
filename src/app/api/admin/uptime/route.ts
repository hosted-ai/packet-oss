/**
 * Admin Pod Uptime API
 *
 * Returns uptime stats for all pods based on heartbeat data.
 * All data comes from local DB — no external API calls.
 */

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
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const todayStr = now.toISOString().slice(0, 10);
    const oneDayAgoStr = oneDayAgo.toISOString().slice(0, 10);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);

    // Get all uptime records, pod metadata, and latest pool names in parallel
    const [uptimeRecords, podMetadataList, latestPoolNames] = await Promise.all([
      prisma.podUptimeDay.findMany({
        orderBy: { date: "asc" },
      }),
      prisma.podMetadata.findMany({
        select: {
          subscriptionId: true,
          displayName: true,
          poolId: true,
          stripeCustomerId: true,
          createdAt: true,
        },
      }),
      // Get the most recent poolName per subscription from GpuHardwareMetrics
      prisma.$queryRaw<Array<{ subscriptionId: string; poolName: string | null }>>`
        SELECT m.subscriptionId, m.poolName
        FROM GpuHardwareMetrics m
        INNER JOIN (
          SELECT subscriptionId, MAX(timestamp) as maxTs
          FROM GpuHardwareMetrics
          GROUP BY subscriptionId
        ) latest ON m.subscriptionId = latest.subscriptionId AND m.timestamp = latest.maxTs
      `,
    ]);

    // Index pod metadata and pool names by subscriptionId
    const podMap = new Map(
      podMetadataList.map((p) => [p.subscriptionId, p])
    );
    const poolNameMap = new Map(
      latestPoolNames.map((p) => [p.subscriptionId, p.poolName || "Unknown"])
    );

    // Get active pods from pool overview cache (local file, refreshed every 2 min)
    const activeSubscriptionIds = new Set<string>();
    const activePodInfo = new Map<string, { podName: string; poolName: string; customerEmail: string | null }>();
    const cache = readPoolOverviewCache();
    if (cache?.pools) {
      for (const pool of cache.pools) {
        for (const pod of pool.pods || []) {
          if (pod.subscriptionId && ["subscribed", "active", "running"].includes(pod.status)) {
            activeSubscriptionIds.add(pod.subscriptionId);
            activePodInfo.set(pod.subscriptionId, {
              podName: pod.podName || "",
              poolName: pool.name || "Unknown",
              customerEmail: pod.customerEmail,
            });
          }
        }
      }
    }

    // Group uptime records by subscriptionId
    const uptimeByPod = new Map<
      string,
      Array<{ date: string; heartbeats: number; firstSeen: Date; lastSeen: Date }>
    >();

    for (const rec of uptimeRecords) {
      const arr = uptimeByPod.get(rec.subscriptionId) || [];
      arr.push({
        date: rec.date,
        heartbeats: rec.heartbeats,
        firstSeen: rec.firstSeen,
        lastSeen: rec.lastSeen,
      });
      uptimeByPod.set(rec.subscriptionId, arr);
    }

    // Ensure all active pods appear even if they have no uptime records yet
    for (const subId of activeSubscriptionIds) {
      if (!uptimeByPod.has(subId)) {
        uptimeByPod.set(subId, []);
      }
    }

    // Helper: compute uptime % for a set of daily records
    function computeUptime(
      days: Array<{ date: string; heartbeats: number; firstSeen: Date; lastSeen: Date }>,
      fromDate: string | null,
      toDate: string
    ): number {
      const filtered = days.filter((d) => {
        if (fromDate && d.date < fromDate) return false;
        if (d.date > toDate) return false;
        return true;
      });

      if (filtered.length === 0) return 0;

      let totalHeartbeats = 0;
      let totalExpected = 0;

      for (const day of filtered) {
        totalHeartbeats += day.heartbeats;

        if (day.date === todayStr) {
          // Partial day: expected = minutes from firstSeen to now
          const minutesSoFar = Math.max(1, (now.getTime() - day.firstSeen.getTime()) / 60000);
          totalExpected += minutesSoFar;
        } else {
          // Full day or partial: use firstSeen to lastSeen span, minimum 1 minute
          const firstMs = day.firstSeen.getTime();
          const lastMs = day.lastSeen.getTime();
          const dayMinutes = Math.max(1, (lastMs - firstMs) / 60000);
          // But cap at 1440 (full day)
          totalExpected += Math.min(1440, dayMinutes);
        }
      }

      if (totalExpected === 0) return 0;
      return Math.min(100, (totalHeartbeats / totalExpected) * 100);
    }

    // Build per-pod stats
    const pods = Array.from(uptimeByPod.entries()).map(([subscriptionId, days]) => {
      const meta = podMap.get(subscriptionId);
      const cacheInfo = activePodInfo.get(subscriptionId);
      const lastDay = days.length > 0 ? days[days.length - 1] : null;
      const isActive = activeSubscriptionIds.has(subscriptionId);

      // Find the earliest date for this pod
      const firstDate = days.length > 0 ? days[0].date : todayStr;

      return {
        subscriptionId,
        displayName: meta?.displayName || cacheInfo?.podName || subscriptionId.slice(0, 8),
        poolName: cacheInfo?.poolName || poolNameMap.get(subscriptionId) || "Unknown",
        stripeCustomerId: meta?.stripeCustomerId || "",
        createdAt: meta?.createdAt?.toISOString() || "",
        isActive,
        lastSeen: lastDay ? lastDay.lastSeen.toISOString() : "",
        uptime: {
          lifetime: Math.round(computeUptime(days, null, todayStr) * 100) / 100,
          thirtyDay: Math.round(computeUptime(days, thirtyDaysAgoStr, todayStr) * 100) / 100,
          sevenDay: Math.round(computeUptime(days, sevenDaysAgoStr, todayStr) * 100) / 100,
          oneDay: Math.round(computeUptime(days, oneDayAgoStr, todayStr) * 100) / 100,
        },
        daily: days.slice(-90).map((d) => {
          // For each day, compute uptime %
          let expected: number;
          if (d.date === todayStr) {
            expected = Math.max(1, (now.getTime() - d.firstSeen.getTime()) / 60000);
          } else {
            const span = Math.max(1, (d.lastSeen.getTime() - d.firstSeen.getTime()) / 60000);
            expected = Math.min(1440, span);
          }
          return {
            date: d.date,
            uptimePercent: Math.min(100, Math.round((d.heartbeats / expected) * 10000) / 100),
            heartbeats: d.heartbeats,
          };
        }),
        totalDays: days.length,
        firstDate,
      };
    });

    // Sort: active pods first, then by name
    pods.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    // Summary stats
    const activePods = pods.filter((p) => p.isActive);
    const avgUptime1d = activePods.length > 0
      ? Math.round((activePods.reduce((sum, p) => sum + p.uptime.oneDay, 0) / activePods.length) * 100) / 100
      : 0;
    const avgUptime7d = activePods.length > 0
      ? Math.round((activePods.reduce((sum, p) => sum + p.uptime.sevenDay, 0) / activePods.length) * 100) / 100
      : 0;
    const avgUptime30d = activePods.length > 0
      ? Math.round((activePods.reduce((sum, p) => sum + p.uptime.thirtyDay, 0) / activePods.length) * 100) / 100
      : 0;

    return NextResponse.json({
      summary: {
        totalPods: pods.length,
        activePods: activePods.length,
        terminatedPods: pods.length - activePods.length,
        avgUptime1d,
        avgUptime7d,
        avgUptime30d,
      },
      pods,
    });
  } catch (error) {
    console.error("Admin uptime error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch uptime stats" },
      { status: 500 }
    );
  }
}
