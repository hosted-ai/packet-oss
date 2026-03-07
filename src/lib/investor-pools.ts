/**
 * Shared investor pool ID resolution.
 *
 * Resolves an investor's assignedNodeIds into concrete GPUaaS pool IDs.
 * Used by both investor-stats.ts (dashboard) and the admin payouts report
 * to guarantee identical revenue attribution.
 */

import { getInvestorAssignedNodes } from "@/lib/auth/investor";
import { readPoolOverviewCache, type PoolDetails } from "@/lib/pool-overview";
import { prisma } from "@/lib/prisma";

export interface ResolvedInvestorPools {
  poolIds: number[];
}

/**
 * Resolve an investor's assigned node IDs into concrete pool IDs.
 * This is the EXACT same resolution logic used in investor-stats.ts.
 */
export async function resolveInvestorPoolIds(email: string): Promise<ResolvedInvestorPools> {
  const assignedNodeIds = await getInvestorAssignedNodes(email);

  if (assignedNodeIds.length === 0) {
    return { poolIds: [] };
  }

  // Split IDs: Prisma ProviderNode IDs vs GPUaaS synthetic IDs
  const prismaNodeIds: string[] = [];
  const gpuaasNodeRefs: Array<{ clusterId: number; nodeId: number }> = [];
  const gpuaasClusterRefs: Array<{ clusterId: number }> = [];
  const directPoolRefs: Array<{ poolIds: number[] }> = [];

  for (const nid of assignedNodeIds) {
    const poolsMatch = nid.match(/^pools:(.+)$/);
    if (poolsMatch) {
      const pids = poolsMatch[1].split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
      if (pids.length > 0) directPoolRefs.push({ poolIds: pids });
      continue;
    }
    const clusterMatch = nid.match(/^gpuaas-cluster-(\d+)$/);
    if (clusterMatch) {
      gpuaasClusterRefs.push({ clusterId: parseInt(clusterMatch[1]) });
      continue;
    }
    const nodeMatch = nid.match(/^gpuaas-(\d+)-(\d+)$/);
    if (nodeMatch) {
      gpuaasNodeRefs.push({ clusterId: parseInt(nodeMatch[1]), nodeId: parseInt(nodeMatch[2]) });
    } else {
      prismaNodeIds.push(nid);
    }
  }

  // Load ProviderNodes from DB
  const dbNodes = prismaNodeIds.length > 0
    ? await prisma.providerNode.findMany({
        where: { id: { in: prismaNodeIds } },
        select: { id: true, gpuaasPoolId: true, gpuaasClusterId: true },
      })
    : [];

  // Load from pool overview cache
  const poolCache = readPoolOverviewCache();
  const cachedPools: PoolDetails[] = poolCache?.pools || [];

  // Build lookup maps
  const poolsByCluster = new Map<number, PoolDetails[]>();
  const nodePoolsFromCache = new Map<number, Set<number>>();

  for (const pool of cachedPools) {
    if (!poolsByCluster.has(pool.clusterId)) poolsByCluster.set(pool.clusterId, []);
    poolsByCluster.get(pool.clusterId)!.push(pool);
    for (const gpu of pool.gpus) {
      if (!gpu.nodeId) continue;
      if (!nodePoolsFromCache.has(gpu.nodeId)) nodePoolsFromCache.set(gpu.nodeId, new Set());
      nodePoolsFromCache.get(gpu.nodeId)!.add(pool.id);
    }
  }

  const allPoolIds = new Set<number>();

  // Resolve GPUaaS node refs
  for (const ref of gpuaasNodeRefs) {
    const nodePools = nodePoolsFromCache.get(ref.nodeId);
    const resolved = nodePools ? Array.from(nodePools) : [];
    const poolIds = resolved.length > 0
      ? resolved
      : (poolsByCluster.get(ref.clusterId) || []).map((p) => p.id);
    for (const pid of poolIds) allPoolIds.add(pid);
  }

  // Resolve cluster refs
  for (const ref of gpuaasClusterRefs) {
    const clusterPools = poolsByCluster.get(ref.clusterId) || [];
    for (const p of clusterPools) allPoolIds.add(p.id);
  }

  // Resolve direct pool refs
  for (const ref of directPoolRefs) {
    for (const pid of ref.poolIds) allPoolIds.add(pid);
  }

  // Resolve DB ProviderNodes
  const dbClusterIds = [...new Set(dbNodes.filter((n) => n.gpuaasClusterId).map((n) => n.gpuaasClusterId!))];
  for (const clusterId of dbClusterIds) {
    const clusterPools = poolsByCluster.get(clusterId) || [];
    for (const p of clusterPools) allPoolIds.add(p.id);
  }
  for (const n of dbNodes) {
    if (n.gpuaasPoolId != null) allPoolIds.add(n.gpuaasPoolId);
  }

  return { poolIds: [...allPoolIds] };
}
