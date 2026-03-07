import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getConnectionInfo,
  getGPUaaSMetrics,
  getGPUaaSMetricsGraph,
  getPoolSubscriptions,
  PoolSubscription,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import { getSubscriptionLineageChain, getRootSubscriptionId } from "@/lib/subscription-lineage";

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

interface PodMetric {
  subscriptionId: string;
  podName: string;
  poolName: string;
  regionName: string | null;
  status: string;
  uptime: string | null;
  // GPU metrics (from subscription metrics)
  tflopsUsage: number;
  vramUsageKb: number;
  vramUsageGb: number;
  gpuCount: number;
  // Usage stats
  hoursUsed: number;
  estimatedCost: number;
  // Connection info
  sshAvailable: boolean;
  exposedServicesCount: number;
  // Per-pod info
  imageName: string | null;
  vcpuCount: number | null;
  ramMb: number | null;
}

interface MetricsResponse {
  pods: PodMetric[];
  totals: {
    totalHours: number;
    totalCost: number;
    totalTflops: number;
    totalVramGb: number;
    activePods: number;
  };
  graph: {
    data: Array<{
      timestamp: string;
      tflops: number;
      hours: number;
    }>;
    granularity: string;
  } | null;
}

// Helper to check if cache is valid
async function getCachedMetrics(teamId: string): Promise<MetricsResponse | null> {
  try {
    const cache = await prisma.metricsCache.findUnique({
      where: { teamId },
    });
    if (!cache) return null;

    const cacheAge = Date.now() - cache.fetchedAt.getTime();
    if (cacheAge > CACHE_TTL_MS) return null;

    return JSON.parse(cache.cacheData) as MetricsResponse;
  } catch {
    return null;
  }
}

// Helper to store metrics in cache and history
async function storeMetrics(teamId: string, response: MetricsResponse): Promise<void> {
  try {
    // Update or create cache
    await prisma.metricsCache.upsert({
      where: { teamId },
      update: {
        cacheData: JSON.stringify(response),
        fetchedAt: new Date(),
      },
      create: {
        teamId,
        cacheData: JSON.stringify(response),
      },
    });

    // Store history points for each pod (for persistent graph data)
    const historyRecords = response.pods.map((pod) => ({
      teamId,
      subscriptionId: pod.subscriptionId,
      tflopsUsage: pod.tflopsUsage,
      vramUsageKb: pod.vramUsageKb,
      hoursUsed: pod.hoursUsed,
      cost: pod.estimatedCost,
      status: pod.status,
      gpuCount: pod.gpuCount,
    }));

    if (historyRecords.length > 0) {
      await prisma.podMetricsHistory.createMany({
        data: historyRecords,
      });
    }
  } catch (error) {
    console.error("Failed to store metrics:", error);
  }
}

// GET - Get detailed pod metrics for all subscriptions
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, teamId } = auth;

    if (!teamId) {
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get("subscription_id");
    const includeGraph = searchParams.get("include_graph") !== "false";
    const graphDays = parseInt(searchParams.get("graph_days") || "7", 10);
    const granularity = (searchParams.get("granularity") || "hourly") as
      | "hourly"
      | "daily"
      | "weekly";
    const forceRefresh = searchParams.get("force_refresh") === "true";

    // Try to get cached data first (unless force refresh)
    if (!forceRefresh) {
      const cachedResponse = await getCachedMetrics(teamId);
      if (cachedResponse) {
        // For cached responses, we still need to build the graph from local history
        // if graph is requested but cached data might not have all historical data
        return NextResponse.json({
          ...cachedResponse,
          cached: true,
        });
      }
    }

    // Fetch fresh data from hosted.ai (only happens every 5 minutes)
    const [subscriptions, metrics, connectionInfo] = await Promise.all([
      getPoolSubscriptions(teamId).catch(() => [] as PoolSubscription[]),
      getGPUaaSMetrics(teamId, {
        limit: 500,
      }).catch(() => ({ items: [], total_hours: 0, total_cost: 0 })),
      getConnectionInfo(teamId).catch(() => []),
    ]);

    // Get graph data if requested
    let graphData = null;
    if (includeGraph) {
      const now = Math.floor(Date.now() / 1000);
      const startTimestamp = now - graphDays * 24 * 60 * 60;
      try {
        const graph = await getGPUaaSMetricsGraph(
          teamId,
          startTimestamp,
          now,
          granularity
        );
        graphData = {
          data:
            graph.data?.map((d) => ({
              timestamp: d.timestamp || "",
              tflops: d.tflops || d.value || 0,
              hours: d.hours || 0,
            })) || [],
          granularity: graph.granularity || granularity,
        };
      } catch (error) {
        console.error("Failed to fetch metrics graph:", error);
      }
    }

    // Build pod metrics from subscriptions
    const subs = subscriptions;
    const connInfo = connectionInfo || [];

    // Get lineage chain if a specific subscription ID is requested
    // This allows us to aggregate metrics across pod restarts
    let lineageIds: string[] = [];
    if (subscriptionId) {
      lineageIds = await getSubscriptionLineageChain(subscriptionId);
      console.log(`[Metrics] Subscription ${subscriptionId} lineage chain:`, lineageIds);
    }

    // Filter by subscription ID if provided (including all lineage IDs)
    const filteredSubs = subscriptionId
      ? subs.filter((s) => lineageIds.includes(String(s.id)))
      : subs;

    // Build per-subscription usage from metrics
    // The API returns { items?: [], metrics?: [] } - handle both
    const metricsResponse = metrics as { items?: unknown[]; metrics?: unknown[]; total_hours?: number; total_cost?: number };
    const metricsItems = (metricsResponse.items || metricsResponse.metrics || []) as Array<{ subscription_id?: number; hours_used?: number; cost?: number }>;
    const usageBySubscription = new Map<
      string,
      { hours: number; cost: number }
    >();
    for (const m of metricsItems) {
      const subId = String(m.subscription_id);
      const existing = usageBySubscription.get(subId) || { hours: 0, cost: 0 };
      existing.hours += m.hours_used || 0;
      existing.cost += m.cost || 0;
      usageBySubscription.set(subId, existing);
    }

    // For lineage aggregation: also build usage by root subscription ID
    // so we can show cumulative metrics across restarts
    const usageByRootSubscription = new Map<
      string,
      { hours: number; cost: number }
    >();
    for (const [subId, usage] of usageBySubscription.entries()) {
      const rootId = await getRootSubscriptionId(subId);
      const existing = usageByRootSubscription.get(rootId) || { hours: 0, cost: 0 };
      existing.hours += usage.hours;
      existing.cost += usage.cost;
      usageByRootSubscription.set(rootId, existing);
    }

    // Map subscriptions to pod metrics
    const pods: PodMetric[] = [];
    let totalTflops = 0;
    let totalVramKb = 0;
    let activePods = 0;

    for (const sub of filteredSubs) {
      const subId = String(sub.id);
      const isActive = sub.status === "subscribed" || sub.status === "active";

      // Find connection info for this subscription
      const conn = connInfo.find((c) => String(c.id) === subId);
      const pod = sub.pods?.[0] || conn?.pods?.[0];

      // Get usage stats - use aggregated usage from root subscription to include all restarts
      const rootId = await getRootSubscriptionId(subId);
      const usage = usageByRootSubscription.get(rootId) || usageBySubscription.get(subId) || { hours: 0, cost: 0 };

      // Get metrics from subscription (if available)
      const subMetrics = (sub as unknown as { metrics?: { tflops_usage?: number; vram_usage?: number } }).metrics;
      const tflopsUsage = subMetrics?.tflops_usage || 0;
      const vramUsageKb = subMetrics?.vram_usage || 0;

      if (isActive) {
        totalTflops += tflopsUsage;
        totalVramKb += vramUsageKb;
        activePods++;
      }

      // Calculate uptime (if we have start time)
      let uptime: string | null = null;
      // Uptime could be calculated from subscription created_at if available

      pods.push({
        subscriptionId: subId,
        podName: pod?.pod_name || `pod-${subId}`,
        poolName: sub.pool_name || "Unknown Pool",
        regionName: sub.region?.region_name || sub.region?.city || null,
        status: pod?.pod_status || sub.status,
        uptime,
        tflopsUsage,
        vramUsageKb,
        vramUsageGb: vramUsageKb / (1024 * 1024),
        gpuCount: sub.per_pod_info?.vgpu_count || (pod as { gpu_count?: number } | undefined)?.gpu_count || 1,
        hoursUsed: usage.hours,
        estimatedCost: usage.cost || 0, // Cost comes from billing API, not hardcoded
        sshAvailable: !!conn?.pods?.[0]?.ssh_info,
        exposedServicesCount: (pod as { discovered_services?: unknown[] } | undefined)?.discovered_services?.length || 0,
        imageName: sub.per_pod_info?.image_name || null,
        vcpuCount: sub.per_pod_info?.vcpu_count || null,
        ramMb: sub.per_pod_info?.ram_mb || null,
      });
    }

    const response: MetricsResponse = {
      pods,
      totals: {
        totalHours: metrics.total_hours || 0,
        totalCost: metrics.total_cost || 0,
        totalTflops,
        totalVramGb: totalVramKb / (1024 * 1024),
        activePods,
      },
      graph: graphData,
    };

    // Store metrics in cache and history (async, don't wait)
    storeMetrics(teamId, response).catch((err) =>
      console.error("Failed to store metrics:", err)
    );

    return NextResponse.json({ ...response, cached: false });
  } catch (error) {
    console.error("Get pod metrics error:", error);
    return NextResponse.json(
      { error: "Failed to get pod metrics" },
      { status: 500 }
    );
  }
}
