/**
 * Admin Node Monitoring API
 *
 * Provides comprehensive node-level stats for the admin dashboard.
 * Shows per-node GPU allocation, utilization, pods, and health.
 *
 * Reads from the pool overview cache (refreshed every 2 min by cron)
 * and merges with ProviderNode database records for provider info.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { readPoolOverviewCache, type PoolDetails } from "@/lib/pool-overview";

export interface NodePod {
  subscriptionId: string;
  podName: string;
  status: string;
  vgpuCount: number;
  customerEmail: string | null;
  customerName: string | null;
}

export interface NodeStats {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  providerId: string;
  providerName: string;
  status: "online" | "active" | "initializing" | "error" | "offline" | "pending";
  statusMessage: string;
  gpuModel: string | null;
  gpuCount: number;
  gpuaasClusterId: number | null;
  gpuaasNodeId: number | null;
  gpuaasPoolId: number | null;
  hardware: {
    cpuModel: string | null;
    cpuCores: number | null;
    memoryGb: number | null;
    storageGb: number | null;
  };
  pools: Array<{
    id: number;
    name: string;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
  }>;
  pods: NodePod[];
  summary: {
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    activePods: number;
    totalPods: number;
    totalVgpus: number;
  };
}

export interface ProviderSummary {
  id: string;
  name: string;
  email: string;
  nodeCount: number;
  totalGpus: number;
  allocatedGpus: number;
  utilizationPercent: number;
  activePods: number;
}

export interface NodeMonitoringResponse {
  providers: ProviderSummary[];
  nodes: NodeStats[];
  summary: {
    totalProviders: number;
    totalNodes: number;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    activePods: number;
    totalVgpus: number;
  };
}

/**
 * Build maps from cached pool overview data:
 * - nodePoolsMap: gpuaasNodeId -> Set of pool IDs
 * - poolGpusByNode: "poolId-nodeId" -> { total, allocated }
 * - poolPodsMap: poolId -> NodePod[]
 * - poolMap: poolId -> { name }
 * - nodeInfoMap: gpuaasNodeId -> cached node info (hardware, etc)
 */
function buildCacheMaps(pools: PoolDetails[]) {
  const nodePoolsMap = new Map<number, Set<number>>();
  const poolGpusByNode = new Map<string, { total: number; allocated: number }>();
  const poolPodsMap = new Map<number, NodePod[]>();
  const poolMap = new Map<number, PoolDetails>();
  const nodeInfoMap = new Map<number, PoolDetails["nodes"][0]>();

  for (const pool of pools) {
    poolMap.set(pool.id, pool);

    // Map GPUs to nodes
    for (const gpu of pool.gpus) {
      if (!gpu.nodeId) continue;

      if (!nodePoolsMap.has(gpu.nodeId)) nodePoolsMap.set(gpu.nodeId, new Set());
      nodePoolsMap.get(gpu.nodeId)!.add(pool.id);

      const key = `${pool.id}-${gpu.nodeId}`;
      if (!poolGpusByNode.has(key)) poolGpusByNode.set(key, { total: 0, allocated: 0 });
      const entry = poolGpusByNode.get(key)!;
      entry.total++;
      if (gpu.assignmentStatus === "assigned") entry.allocated++;
    }

    // Map nodes
    for (const node of pool.nodes) {
      if (!nodeInfoMap.has(node.id)) nodeInfoMap.set(node.id, node);
    }

    // Map pods
    const pods: NodePod[] = pool.pods.map((pod) => ({
      subscriptionId: pod.subscriptionId,
      podName: pod.podName,
      status: pod.status,
      vgpuCount: pod.vgpuCount,
      customerEmail: pod.customerEmail,
      customerName: pod.customerName,
    }));
    poolPodsMap.set(pool.id, pods);
  }

  return { nodePoolsMap, poolGpusByNode, poolPodsMap, poolMap, nodeInfoMap };
}

/**
 * GET /api/admin/nodes
 * Get comprehensive node monitoring data
 */
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
    // Read from pool overview cache (refreshed every 2 min by cron)
    const cached = readPoolOverviewCache();
    if (!cached) {
      return NextResponse.json(
        { success: false, error: "Pool overview cache not available. Wait for cron refresh." },
        { status: 503 }
      );
    }

    // Get provider nodes from database (fast local DB query)
    const providerNodes = await prisma.providerNode.findMany({
      where: {
        status: { in: ["active", "online", "provisioning"] },
      },
      include: {
        provider: true,
      },
      orderBy: { createdAt: "desc" },
    });

    console.log(`[Admin Nodes] ${providerNodes.length} provider nodes, ${cached.pools.length} cached pools`);

    // Build lookup maps from cached data
    const { nodePoolsMap, poolGpusByNode, poolPodsMap, poolMap, nodeInfoMap } =
      buildCacheMaps(cached.pools);

    const nodeStats: NodeStats[] = [];
    const providerMap = new Map<string, ProviderSummary>();

    // === SECTION 1: Provider nodes (from our database) ===
    for (const node of providerNodes) {
      let nodePools: NodeStats["pools"] = [];
      let nodePods: NodePod[] = [];
      let allocatedGpus = 0;

      if (node.gpuaasNodeId) {
        // Find all pools that have GPUs from this node
        const nodePoolIds = nodePoolsMap.get(node.gpuaasNodeId) || new Set();

        for (const poolId of nodePoolIds) {
          const pool = poolMap.get(poolId);
          if (!pool) continue;

          const gpuKey = `${poolId}-${node.gpuaasNodeId}`;
          const gpuStats = poolGpusByNode.get(gpuKey) || { total: 0, allocated: 0 };
          allocatedGpus += gpuStats.allocated;

          nodePools.push({
            id: pool.id,
            name: pool.name,
            totalGpus: gpuStats.total,
            allocatedGpus: gpuStats.allocated,
            availableGpus: gpuStats.total - gpuStats.allocated,
            utilizationPercent:
              gpuStats.total > 0
                ? Math.round((gpuStats.allocated / gpuStats.total) * 100)
                : 0,
          });

          // Get pods from this pool
          const podsForPool = poolPodsMap.get(poolId) || [];
          nodePods.push(...podsForPool);
        }

        // Fallback to gpuaasPoolId if no pools found via node_id mapping
        if (nodePools.length === 0 && node.gpuaasPoolId) {
          const pool = poolMap.get(node.gpuaasPoolId);
          if (pool) {
            nodePools = [{
              id: pool.id,
              name: pool.name,
              totalGpus: pool.totalGpus,
              allocatedGpus: pool.allocatedGpus,
              availableGpus: pool.availableGpus,
              utilizationPercent: pool.utilizationPercent,
            }];
            allocatedGpus = pool.allocatedGpus;
            nodePods = poolPodsMap.get(node.gpuaasPoolId) || [];
          }
        }
      } else if (node.gpuaasPoolId) {
        // Fallback for nodes without gpuaasNodeId
        nodePods = poolPodsMap.get(node.gpuaasPoolId) || [];
      }

      const totalGpus = node.gpuCount || 0;
      const activePods = nodePods.filter(
        (p) => p.status === "running" || p.status === "active" || p.status === "ready"
      );
      const totalVgpus = nodePods.reduce((sum, p) => sum + p.vgpuCount, 0);

      // Map node status
      let status: NodeStats["status"] = "offline";
      if (node.status === "active" || node.status === "online") {
        status = "online";
      } else if (node.status === "provisioning" || node.status === "pending_validation") {
        status = "initializing";
      } else if (node.status === "error" || node.status === "validation_failed") {
        status = "error";
      }

      nodeStats.push({
        id: node.id,
        name: node.hostname,
        hostname: node.hostname,
        ip: node.ipAddress,
        providerId: node.providerId,
        providerName: node.provider.companyName,
        status,
        statusMessage: node.statusMessage || node.status,
        gpuModel: node.gpuModel,
        gpuCount: totalGpus,
        gpuaasClusterId: node.gpuaasClusterId,
        gpuaasNodeId: node.gpuaasNodeId,
        gpuaasPoolId: node.gpuaasPoolId,
        hardware: {
          cpuModel: node.cpuModel,
          cpuCores: node.cpuCores,
          memoryGb: node.ramGb,
          storageGb: node.storageGb,
        },
        pools: nodePools,
        pods: nodePods,
        summary: {
          totalGpus,
          allocatedGpus,
          availableGpus: totalGpus - allocatedGpus,
          utilizationPercent: totalGpus > 0 ? Math.round((allocatedGpus / totalGpus) * 100) : 0,
          activePods: activePods.length,
          totalPods: nodePods.length,
          totalVgpus,
        },
      });

      // Update provider summary
      if (!providerMap.has(node.providerId)) {
        providerMap.set(node.providerId, {
          id: node.providerId,
          name: node.provider.companyName,
          email: node.provider.email,
          nodeCount: 0,
          totalGpus: 0,
          allocatedGpus: 0,
          utilizationPercent: 0,
          activePods: 0,
        });
      }
      const provider = providerMap.get(node.providerId)!;
      provider.nodeCount++;
      provider.totalGpus += totalGpus;
      provider.allocatedGpus += allocatedGpus;
      provider.activePods += activePods.length;
    }

    // Calculate provider utilization
    for (const provider of providerMap.values()) {
      provider.utilizationPercent =
        provider.totalGpus > 0
          ? Math.round((provider.allocatedGpus / provider.totalGpus) * 100)
          : 0;
    }

    // === SECTION 2: Unowned nodes from cache (not in our database) ===
    const dbNodeIds = new Set(
      providerNodes.filter((n) => n.gpuaasNodeId).map((n) => n.gpuaasNodeId)
    );
    const dbClusterIds = new Set(
      providerNodes.filter((n) => n.gpuaasClusterId).map((n) => n.gpuaasClusterId)
    );

    // Collect all unique nodes from the cache that aren't in our DB
    const seenNodeIds = new Set<number>();

    for (const pool of cached.pools) {
      for (const cachedNode of pool.nodes) {
        if (dbNodeIds.has(cachedNode.id) || seenNodeIds.has(cachedNode.id)) continue;
        seenNodeIds.add(cachedNode.id);

        // Find all pools this node belongs to
        const nodePoolIds = nodePoolsMap.get(cachedNode.id) || new Set();
        const nodePools: NodeStats["pools"] = [];
        let allocatedGpus = 0;
        const nodePods: NodePod[] = [];

        for (const poolId of nodePoolIds) {
          const p = poolMap.get(poolId);
          if (!p) continue;

          const gpuKey = `${poolId}-${cachedNode.id}`;
          const gpuStats = poolGpusByNode.get(gpuKey) || { total: 0, allocated: 0 };
          allocatedGpus += gpuStats.allocated;

          nodePools.push({
            id: p.id,
            name: p.name,
            totalGpus: gpuStats.total,
            allocatedGpus: gpuStats.allocated,
            availableGpus: gpuStats.total - gpuStats.allocated,
            utilizationPercent:
              gpuStats.total > 0
                ? Math.round((gpuStats.allocated / gpuStats.total) * 100)
                : 0,
          });

          const podsForPool = poolPodsMap.get(poolId) || [];
          nodePods.push(...podsForPool);
        }

        const totalGpus = cachedNode.gpuCount;
        const activePods = nodePods.filter(
          (p) => p.status === "running" || p.status === "active" || p.status === "ready"
        );
        const totalVgpus = nodePods.reduce((sum, p) => sum + p.vgpuCount, 0);

        // Determine status from initStatus
        let status: NodeStats["status"] = "offline";
        let statusMessage = "Unknown";
        if (cachedNode.initStatus === 2) {
          status = "online";
          statusMessage = "Initialized and ready";
        } else if (cachedNode.initStatus === 1) {
          status = "initializing";
          statusMessage = "Initialization in progress";
        } else if (cachedNode.initStatus === -1) {
          status = "error";
          statusMessage = "Initialization failed";
        }

        // Find which cluster this node belongs to
        const clusterId = pool.clusterId;
        const regionName = pool.regionName;

        nodeStats.push({
          id: `gpuaas-${clusterId}-${cachedNode.id}`,
          name: cachedNode.name,
          hostname: cachedNode.name,
          ip: cachedNode.ip,
          providerId: cachedNode.providerId || "unowned",
          providerName: cachedNode.providerName || `GPUaaS - ${regionName}`,
          status,
          statusMessage,
          gpuModel: cachedNode.gpuModel,
          gpuCount: totalGpus,
          gpuaasClusterId: clusterId,
          gpuaasNodeId: cachedNode.id,
          gpuaasPoolId: nodePools.length > 0 ? nodePools[0].id : null,
          hardware: {
            cpuModel: cachedNode.cpuModel,
            cpuCores: cachedNode.cpuCores,
            memoryGb: cachedNode.memoryGb,
            storageGb: cachedNode.storageGb,
          },
          pools: nodePools,
          pods: nodePods,
          summary: {
            totalGpus,
            allocatedGpus,
            availableGpus: totalGpus - allocatedGpus,
            utilizationPercent:
              totalGpus > 0 ? Math.round((allocatedGpus / totalGpus) * 100) : 0,
            activePods: activePods.length,
            totalPods: nodePods.length,
            totalVgpus,
          },
        });
      }
    }

    // Handle clusters where nodes have no entries in cache (pool-only fallback)
    // Group pools by cluster to see if any cluster has pools but no nodes
    const clusterPoolsMap = new Map<number, PoolDetails[]>();
    for (const pool of cached.pools) {
      if (!clusterPoolsMap.has(pool.clusterId)) clusterPoolsMap.set(pool.clusterId, []);
      clusterPoolsMap.get(pool.clusterId)!.push(pool);
    }

    for (const [clusterId, clusterPools] of clusterPoolsMap) {
      // Skip if already covered by provider nodes or unowned nodes
      const hasNodes = clusterPools.some((p) => p.nodes.length > 0);
      if (hasNodes || dbClusterIds.has(clusterId)) continue;

      // No nodes known for this cluster — create a synthetic node from pool data
      const firstPool = clusterPools[0];
      const gpuModel = firstPool.gpus[0]?.gpuModel || null;
      const hostname = `${gpuModel || "GPU"} - ${firstPool.regionName}`;

      const nodePools: NodeStats["pools"] = [];
      const allNodePods: NodePod[] = [];
      let totalAllocated = 0;
      let totalGpus = 0;

      for (const p of clusterPools) {
        totalGpus += p.totalGpus;
        totalAllocated += p.allocatedGpus;
        nodePools.push({
          id: p.id,
          name: p.name,
          totalGpus: p.totalGpus,
          allocatedGpus: p.allocatedGpus,
          availableGpus: p.availableGpus,
          utilizationPercent: p.utilizationPercent,
        });
        const pods = poolPodsMap.get(p.id) || [];
        allNodePods.push(...pods);
      }

      const activePods = allNodePods.filter(
        (p) => p.status === "running" || p.status === "active" || p.status === "ready"
      );
      const totalVgpus = allNodePods.reduce((sum, p) => sum + p.vgpuCount, 0);

      nodeStats.push({
        id: `gpuaas-cluster-${clusterId}`,
        name: hostname,
        hostname,
        ip: "Unknown",
        providerId: "unowned",
        providerName: `GPUaaS - ${firstPool.regionName}`,
        status: "online",
        statusMessage: `${clusterPools.length} pools`,
        gpuModel,
        gpuCount: totalGpus,
        gpuaasClusterId: clusterId,
        gpuaasNodeId: null,
        gpuaasPoolId: clusterPools[0].id,
        hardware: { cpuModel: null, cpuCores: null, memoryGb: null, storageGb: null },
        pools: nodePools,
        pods: allNodePods,
        summary: {
          totalGpus,
          allocatedGpus: totalAllocated,
          availableGpus: Math.max(0, totalGpus - totalAllocated),
          utilizationPercent: totalGpus > 0 ? Math.round((totalAllocated / totalGpus) * 100) : 0,
          activePods: activePods.length,
          totalPods: allNodePods.length,
          totalVgpus,
        },
      });
    }

    // Calculate overall summary
    const summary = {
      totalProviders: providerMap.size,
      totalNodes: nodeStats.length,
      totalGpus: nodeStats.reduce((sum, n) => sum + n.summary.totalGpus, 0),
      allocatedGpus: nodeStats.reduce((sum, n) => sum + n.summary.allocatedGpus, 0),
      availableGpus: nodeStats.reduce((sum, n) => sum + n.summary.availableGpus, 0),
      utilizationPercent: 0,
      activePods: nodeStats.reduce((sum, n) => sum + n.summary.activePods, 0),
      totalVgpus: nodeStats.reduce((sum, n) => sum + n.summary.totalVgpus, 0),
    };
    summary.utilizationPercent =
      summary.totalGpus > 0
        ? Math.round((summary.allocatedGpus / summary.totalGpus) * 100)
        : 0;

    console.log(`[Admin Nodes] Returning ${nodeStats.length} nodes, ${providerMap.size} providers (from cache)`);

    return NextResponse.json({
      success: true,
      data: {
        providers: Array.from(providerMap.values()),
        nodes: nodeStats,
        summary,
      } as NodeMonitoringResponse,
    });
  } catch (error) {
    console.error("[Admin Nodes] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch node data",
      },
      { status: 500 }
    );
  }
}
