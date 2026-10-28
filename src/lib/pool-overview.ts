/**
 * Pool Overview computation and caching.
 *
 * The heavy computation is done by computePoolOverview(), which calls
 * multiple GPUaaS and Stripe APIs. Results are cached to disk and
 * served instantly by the admin pools endpoint.
 *
 * Refresh is triggered by /api/cron/refresh-pool-overview every 2 minutes.
 */

import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getStripeTeamMap, getResourcePolicyTeams } from "@/lib/admin-cache";
import { gpuaasAdmin, type GPUaaSPool, type GPUaaSNode, type ClusterPoolGPU } from "@/lib/gpuaas-admin";
import { getAllUnifiedInstances } from "@/lib/hostedai";

// Types (shared with frontend)
export interface PoolGPU {
  id: number;
  uuid: string;
  gpuModel: string;
  memoryMb: number;
  nodeId: number;
  nodeName: string;
  nodeIp: string;
  assignmentStatus: string;
}

export interface PoolNode {
  id: number;
  name: string;
  ip: string;
  gpuCount: number;
  gpuModel: string | null;
  initStatus: number;
  cpuModel: string | null;
  cpuCores: number | null;
  memoryGb: number | null;
  storageGb: number | null;
  providerId: string | null;
  providerName: string | null;
}

export interface PoolPod {
  subscriptionId: string;
  podName: string;
  status: string;
  vgpuCount: number;
  customerEmail: string | null;
  customerName: string | null;
  teamId: string;
  teamName: string | null;
}

export interface PoolDetails {
  id: number;
  name: string;
  clusterId: number;
  regionId: number;
  regionName: string;
  totalGpus: number;
  allocatedGpus: number;
  availableGpus: number;
  utilizationPercent: number;
  overcommitRatio: number;
  securityMode: string | null;
  createdAt: string;
  gpus: PoolGPU[];
  nodes: PoolNode[];
  pods: PoolPod[];
}

export interface ClusterSummary {
  id: number;
  regionId: number;
  regionName: string;
  status: string;
  poolCount: number;
  totalGpus: number;
  allocatedGpus: number;
  nodeCount: number;
}

export interface PoolOverviewResponse {
  clusters: ClusterSummary[];
  pools: PoolDetails[];
  summary: {
    totalClusters: number;
    totalPools: number;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    totalNodes: number;
    activePods: number;
  };
  _cachedAt?: string;
  /** True if any GPUaaS API call errored this run (vs. legitimately returning fewer results). */
  hadApiFailures?: boolean;
}

// Cache config
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "pool-overview.json");
const CACHE_TTL_MS = 30 * 60 * 1000; // Serve cache up to 30 minutes (cron refreshes every 2, but GPUaaS may be down)

/** Read cached pool overview. Returns null if no cache or expired. */
export function readPoolOverviewCache(): PoolOverviewResponse | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw) as PoolOverviewResponse;
    if (data._cachedAt) {
      const age = Date.now() - new Date(data._cachedAt).getTime();
      if (age > CACHE_TTL_MS) return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Write pool overview to cache. */
export function writePoolOverviewCache(data: PoolOverviewResponse): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const stamped = { ...data, _cachedAt: new Date().toISOString() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(stamped));
  } catch (e) {
    console.warn("[Pool Overview] Failed to write cache:", e);
  }
}

/** Compute full pool overview from live API data.
 *  When existingCache is provided, per-pool pod data is preserved if the API call fails. */
export async function computePoolOverview(existingCache?: PoolOverviewResponse | null): Promise<PoolOverviewResponse> {
  let hadApiFailures = false;

  const [regions, clusters, stripeTeamMap, policyTeams, unifiedInstances] = await Promise.all([
    gpuaasAdmin.listRegions(),
    gpuaasAdmin.listClusters(),
    getStripeTeamMap(),
    getResourcePolicyTeams(),
    getAllUnifiedInstances().catch((err) => {
      console.warn("[Pool Overview] Failed to fetch unified instances:", err instanceof Error ? err.message : err);
      hadApiFailures = true;
      return null;
    }),
  ]);

  // Build region map
  const regionMap = new Map(regions.map((r) => [r.id, r]));

  // Pool Overview must list every real pod/instance per team (PA-330), not one
  // aggregate row per team — group actual instances by pool_id, same source the
  // Pods tab uses (getAllUnifiedInstances), instead of the team-subscription summary.
  const instancesByPool = new Map<number, PoolPod[]>();
  if (unifiedInstances) {
    for (const inst of unifiedInstances) {
      const poolId = inst.pod_info?.pool_id;
      if (!poolId) continue;
      const teamId = inst.team?.id || "";
      const stripeInfo = teamId ? stripeTeamMap.get(teamId) : undefined;
      const policyTeam = policyTeams.find((t) => t.id === teamId);
      const pod: PoolPod = {
        subscriptionId: inst.id,
        podName: inst.name,
        status: inst.status?.toLowerCase() || "unknown",
        vgpuCount: inst.pod_info?.vgpu_count || 1,
        customerEmail: stripeInfo?.email || policyTeam?.name || null,
        customerName: stripeInfo?.name || policyTeam?.name || null,
        teamId,
        teamName: inst.team?.name || policyTeam?.name || null,
      };
      if (!instancesByPool.has(poolId)) instancesByPool.set(poolId, []);
      instancesByPool.get(poolId)!.push(pod);
    }
  }

  // Get provider nodes for mapping
  const providerNodes = await prisma.providerNode.findMany({
    where: { status: { in: ["active", "online", "provisioning"] } },
    include: { provider: true },
  });
  const providerNodesByGpuaasId = new Map(
    providerNodes
      .filter((n) => n.gpuaasNodeId)
      .map((n) => [n.gpuaasNodeId!, n])
  );

  const clusterSummaries: ClusterSummary[] = [];
  const poolDetails: PoolDetails[] = [];

  for (const cluster of clusters) {
    if (cluster.status !== "GPUAAS_ACTIVE") continue;
    const region = regionMap.get(cluster.region_id);
    if (!region) continue;

    try {
      let pools: GPUaaSPool[] = [];
      let nodes: GPUaaSNode[] = [];
      let allPoolGPUs: ClusterPoolGPU[] = [];

      try { pools = await gpuaasAdmin.listPools(cluster.id); }
      catch { pools = []; hadApiFailures = true; }

      try { nodes = await gpuaasAdmin.listNodes(cluster.region_id); }
      catch { nodes = []; hadApiFailures = true; }

      try { allPoolGPUs = await gpuaasAdmin.getAllPoolGPUs(cluster.id); }
      catch { allPoolGPUs = []; hadApiFailures = true; }

      if (pools.length === 0 && nodes.length === 0) continue;

      const nodeMap = new Map<number, GPUaaSNode>(nodes.map((n) => [n.Id, n]));
      const gpusByPool = new Map<number, ClusterPoolGPU[]>();
      const nodesByPool = new Map<number, Set<number>>();

      for (const gpu of allPoolGPUs) {
        if (!gpusByPool.has(gpu.pool_id)) gpusByPool.set(gpu.pool_id, []);
        gpusByPool.get(gpu.pool_id)!.push(gpu);
        if (!nodesByPool.has(gpu.pool_id)) nodesByPool.set(gpu.pool_id, new Set());
        if (gpu.gpuaas_node_id) nodesByPool.get(gpu.pool_id)!.add(gpu.gpuaas_node_id);
      }

      // Build a map of existing cache pods by pool ID — used only as a fallback if
      // the unified-instances fetch above failed entirely.
      const existingPoolPods = new Map<number, PoolPod[]>();
      if (existingCache?.pools) {
        for (const p of existingCache.pools) {
          if (p.pods.length > 0) existingPoolPods.set(p.id, p.pods);
        }
      }

      let clusterTotalGpus = 0;
      let clusterAllocatedGpus = 0;
      const clusterNodeIds = new Set<number>();

      for (const pool of pools) {
        const poolGPUs = gpusByPool.get(pool.id) || [];
        const poolNodeIds = nodesByPool.get(pool.id) || new Set();
        const poolPods = unifiedInstances
          ? instancesByPool.get(pool.id) || []
          : existingPoolPods.get(pool.id) || [];

        const gpuDetails: PoolGPU[] = poolGPUs.map((gpu) => {
          const node = nodeMap.get(gpu.gpuaas_node_id);
          return {
            id: gpu.id,
            uuid: gpu.uuid,
            gpuModel: gpu.gpu_model,
            memoryMb: gpu.memory_in_mb,
            nodeId: gpu.gpuaas_node_id,
            nodeName: node?.name || `node-${gpu.gpuaas_node_id}`,
            nodeIp: node?.node_ip || "unknown",
            assignmentStatus: gpu.assignment_status,
          };
        });

        const nodeDetails: PoolNode[] = Array.from(poolNodeIds).map((nodeId) => {
          const node = nodeMap.get(nodeId);
          const providerNode = providerNodesByGpuaasId.get(nodeId);
          const nodeGpus = poolGPUs.filter((g) => g.gpuaas_node_id === nodeId);
          clusterNodeIds.add(nodeId);
          return {
            id: nodeId,
            name: node?.name || `node-${nodeId}`,
            ip: node?.node_ip || "unknown",
            gpuCount: nodeGpus.length,
            gpuModel: nodeGpus[0]?.gpu_model || node?.gpus?.[0]?.gpu_model || null,
            initStatus: node?.initialize_state_status_code || 0,
            cpuModel: node?.cpu_model || null,
            cpuCores: node?.cores || null,
            memoryGb: node?.total_memory_in_mb ? Math.round(node.total_memory_in_mb / 1024) : null,
            storageGb: node?.total_disk_in_mb ? Math.round(node.total_disk_in_mb / 1024) : null,
            providerId: providerNode?.providerId || null,
            providerName: providerNode?.provider?.companyName || null,
          };
        });

        const totalGpus = poolGPUs.length || pool.total_gpus;
        // assignment_status is a GPU->pool attachment flag, not a customer-occupancy signal:
        // it's always "assigned" for any GPU already scoped to this pool (pool_id and
        // assignment_status are set atomically), so filtering by it is a near no-op and made
        // utilization read ~100% for any populated pool (PA-369). Real occupancy is the
        // active customer subscriptions already fetched into poolPods.
        const overcommitRatio = pool.overcommit_ratio || 1;
        const allocatedGpus = poolGPUs.length > 0
          ? Math.min(totalGpus, Math.round(poolPods.length / overcommitRatio))
          : pool.allocated_gpus;
        const availableGpus = totalGpus - allocatedGpus;

        clusterTotalGpus += totalGpus;
        clusterAllocatedGpus += allocatedGpus;

        poolDetails.push({
          id: pool.id,
          name: pool.name,
          clusterId: cluster.id,
          regionId: region.id,
          regionName: region.region_name,
          totalGpus,
          allocatedGpus,
          availableGpus,
          utilizationPercent: totalGpus > 0 ? Math.round((allocatedGpus / totalGpus) * 100) : 0,
          overcommitRatio: pool.overcommit_ratio,
          securityMode: pool.security_mode || null,
          createdAt: pool.created_at,
          gpus: gpuDetails,
          nodes: nodeDetails,
          pods: poolPods,
        });
      }

      clusterSummaries.push({
        id: cluster.id,
        regionId: region.id,
        regionName: region.region_name,
        status: cluster.status,
        poolCount: pools.length,
        totalGpus: clusterTotalGpus,
        allocatedGpus: clusterAllocatedGpus,
        nodeCount: clusterNodeIds.size,
      });
    } catch (err) {
      console.error(`[Pool Overview] Error for cluster ${cluster.id}:`, err);
      hadApiFailures = true;
    }
  }

  const summary = {
    totalClusters: clusterSummaries.length,
    totalPools: poolDetails.length,
    totalGpus: poolDetails.reduce((sum, p) => sum + p.totalGpus, 0),
    allocatedGpus: poolDetails.reduce((sum, p) => sum + p.allocatedGpus, 0),
    availableGpus: poolDetails.reduce((sum, p) => sum + p.availableGpus, 0),
    utilizationPercent: 0,
    totalNodes: clusterSummaries.reduce((sum, c) => sum + c.nodeCount, 0),
    activePods: poolDetails.reduce((sum, p) => sum + p.pods.length, 0),
  };
  summary.utilizationPercent = summary.totalGpus > 0
    ? Math.round((summary.allocatedGpus / summary.totalGpus) * 100)
    : 0;

  return { clusters: clusterSummaries, pools: poolDetails, summary, hadApiFailures };
}
