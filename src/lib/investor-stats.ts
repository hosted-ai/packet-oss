/**
 * Investor Stats Computation
 *
 * Heavy computation extracted from the stats API route so it can be
 * called by both the GET endpoint (fallback) and the hourly cron job.
 *
 * Collects data from: Stripe customers, GPUaaS clusters/nodes/pools,
 * hosted.ai subscriptions, local WalletTransaction table, GPU metrics.
 */

import { getInvestorAssignedNodes, getInvestorRevenueShare } from "@/lib/auth/investor";
import { getStripe } from "@/lib/stripe";
import { readPoolOverviewCache, type PoolDetails } from "@/lib/pool-overview";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), "data", "cache", "investor-stats");

const DEAD_POD_STATUSES = [
  "containerstatusunknown", "error", "crashloopbackoff", "imagepullbackoff",
  "errimagepull", "oomkilled", "evicted", "terminated", "failed",
];

const INTERNAL_EMAIL_DOMAINS: string[] = [];
const EXCLUDED_EMAILS: string[] = [];

function isInternalOrExcluded(email: string): boolean {
  const lower = email.toLowerCase();
  return INTERNAL_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`))
    || EXCLUDED_EMAILS.includes(lower);
}

function cacheFileName(email: string): string {
  return path.join(CACHE_DIR, `${email.toLowerCase().replace(/[^a-z0-9]/g, "_")}.json`);
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Read cached stats for an investor. Returns null if no cache or expired (>1h). */
export function readCachedStats(email: string): object | null {
  try {
    const raw = fs.readFileSync(cacheFileName(email), "utf-8");
    const data = JSON.parse(raw);
    // Check TTL — if cache is older than 1 hour, treat as stale
    if (data._cachedAt) {
      const age = Date.now() - new Date(data._cachedAt).getTime();
      if (age > CACHE_TTL_MS) return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Write stats to cache file for an investor. Stamps _cachedAt and _nextUpdateAt. */
export function writeCachedStats(email: string, data: object): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const now = new Date();
    const nextUpdate = new Date(now.getTime() + CACHE_TTL_MS);
    const stamped = {
      ...data,
      _cachedAt: now.toISOString(),
      _nextUpdateAt: nextUpdate.toISOString(),
    };
    fs.writeFileSync(cacheFileName(email), JSON.stringify(stamped));
  } catch (e) {
    console.warn("[Investor Stats] Failed to write cache:", e);
  }
}

/**
 * Compute investor dashboard stats from scratch.
 * This is the heavy function — calls Stripe, GPUaaS, hosted.ai, Prisma.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeInvestorStats(email: string): Promise<any> {
  const assignedNodeIds = await getInvestorAssignedNodes(email);
  const revenueSharePercent = (await getInvestorRevenueShare(email)) ?? 70;

  const emptyResponse = {
    nodes: [],
    summary: {
      totalNodes: 0, activeNodes: 0, nodesWithPool: 0, totalPhysicalGpus: 0,
      totalVgpuSlots: 0, totalOccupiedSlots: 0, totalCustomers: 0,
      avgOccupancyPercent: 0, avgOvercommitRatio: 0,
      avgGpuUtilization: null, avgTemperature: null, avgMemoryPercent: null,
    },
    revenue: {
      grossRevenueThisMonthCents: 0, grossRevenueLastMonthCents: 0,
      grossRevenueDailyRateCents: 0, grossRevenueProjectedMonthCents: 0,
      revenueSharePercent,
      investorRevenueThisMonthCents: 0, investorRevenueLastMonthCents: 0,
      investorRevenueDailyRateCents: 0, investorRevenueProjectedMonthCents: 0,
      monthOverMonthChangePercent: null, fleetUtilizationPercent: 0,
    },
    businessHealth: {
      revenuePerGpuPerDayCents: 0, arpcCents: 0, sellThroughPercent: 0,
      churnPercent: null, topCustomerPercent: null, avgSessionDurationHours: null,
    },
    dailyRevenue: [],
    lastUpdated: new Date().toISOString(),
  };

  if (assignedNodeIds.length === 0) {
    return emptyResponse;
  }

  // 1. Split IDs: Prisma ProviderNode IDs vs GPUaaS synthetic IDs
  const prismaNodeIds: string[] = [];
  const gpuaasNodeRefs: Array<{ id: string; clusterId: number; nodeId: number }> = [];
  const gpuaasClusterRefs: Array<{ id: string; clusterId: number }> = [];
  const directPoolRefs: Array<{ id: string; poolIds: number[] }> = [];
  for (const nid of assignedNodeIds) {
    const poolsMatch = nid.match(/^pools:(.+)$/);
    if (poolsMatch) {
      const pids = poolsMatch[1].split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
      if (pids.length > 0) directPoolRefs.push({ id: nid, poolIds: pids });
      continue;
    }
    const clusterMatch = nid.match(/^gpuaas-cluster-(\d+)$/);
    if (clusterMatch) {
      gpuaasClusterRefs.push({ id: nid, clusterId: parseInt(clusterMatch[1]) });
      continue;
    }
    const nodeMatch = nid.match(/^gpuaas-(\d+)-(\d+)$/);
    if (nodeMatch) {
      gpuaasNodeRefs.push({ id: nid, clusterId: parseInt(nodeMatch[1]), nodeId: parseInt(nodeMatch[2]) });
    } else {
      prismaNodeIds.push(nid);
    }
  }

  // Load ProviderNodes from DB
  const dbNodes = prismaNodeIds.length > 0
    ? await prisma.providerNode.findMany({
        where: { id: { in: prismaNodeIds } },
        select: {
          id: true, hostname: true, ipAddress: true, gpuModel: true, gpuCount: true,
          gpuaasPoolId: true, gpuaasClusterId: true, status: true,
        },
      })
    : [];

  // Load from pool overview cache (refreshed every 2 min) — no live API calls needed
  const poolCache = readPoolOverviewCache();
  const cachedPools: PoolDetails[] = poolCache?.pools || [];

  // Build lookup maps from cache
  const poolById = new Map<number, PoolDetails>(cachedPools.map((p) => [p.id, p]));
  const poolsByCluster = new Map<number, PoolDetails[]>();
  const nodePoolsFromCache = new Map<number, Set<number>>(); // gpuaasNodeId -> pool IDs
  const cachedNodeInfo = new Map<number, PoolDetails["nodes"][0]>(); // gpuaasNodeId -> node info

  for (const pool of cachedPools) {
    if (!poolsByCluster.has(pool.clusterId)) poolsByCluster.set(pool.clusterId, []);
    poolsByCluster.get(pool.clusterId)!.push(pool);
    for (const gpu of pool.gpus) {
      if (!gpu.nodeId) continue;
      if (!nodePoolsFromCache.has(gpu.nodeId)) nodePoolsFromCache.set(gpu.nodeId, new Set());
      nodePoolsFromCache.get(gpu.nodeId)!.add(pool.id);
    }
    for (const node of pool.nodes) {
      if (!cachedNodeInfo.has(node.id)) cachedNodeInfo.set(node.id, node);
    }
  }

  // Resolve GPUaaS-only nodes from cache
  interface NormalizedNode {
    id: string; hostname: string | null; ipAddress: string; gpuModel: string | null;
    gpuCount: number | null; gpuaasPoolId: number | null; gpuaasClusterId: number | null; status: string;
    allPoolIds?: number[];
  }
  const gpuaasNodes: NormalizedNode[] = [];

  if (gpuaasNodeRefs.length > 0) {
    for (const ref of gpuaasNodeRefs) {
      const cachedNode = cachedNodeInfo.get(ref.nodeId);
      const nodePools = nodePoolsFromCache.get(ref.nodeId);
      const allPoolIdsForNode = nodePools ? Array.from(nodePools) : [];
      // Fallback: if no GPU mapping, use all pools in the cluster
      const resolvedPoolIds = allPoolIdsForNode.length > 0
        ? allPoolIdsForNode
        : (poolsByCluster.get(ref.clusterId) || []).map((p) => p.id);

      gpuaasNodes.push({
        id: ref.id,
        hostname: cachedNode?.name || `node-${ref.nodeId}`,
        ipAddress: cachedNode?.ip || "unknown",
        gpuModel: cachedNode?.gpuModel || null,
        gpuCount: cachedNode?.gpuCount || 0,
        gpuaasPoolId: resolvedPoolIds[0] || null,
        gpuaasClusterId: ref.clusterId,
        status: cachedNode ? (cachedNode.initStatus === 2 ? "active" : "initializing") : "active",
        allPoolIds: resolvedPoolIds,
      });
    }
  }

  // Load cluster-based GPUaaS entries from cache
  if (gpuaasClusterRefs.length > 0) {
    for (const ref of gpuaasClusterRefs) {
      const clusterPools = poolsByCluster.get(ref.clusterId) || [];
      if (clusterPools.length === 0) continue;

      const firstPool = clusterPools[0];
      const gpuModel = firstPool.gpus[0]?.gpuModel || null;
      const baseName = firstPool.name.replace(/-\d+$/, "");
      const modelName = gpuModel || (baseName.includes("-") ? baseName.split("-")[0].toUpperCase() : baseName.toUpperCase());
      const allPoolIds = clusterPools.map((p) => p.id);
      const totalGpus = clusterPools.reduce((s, p) => s + p.totalGpus, 0);

      gpuaasNodes.push({
        id: ref.id,
        hostname: `${modelName} - Cluster ${ref.clusterId}`,
        ipAddress: "Cluster-based",
        gpuModel: modelName || null,
        gpuCount: totalGpus,
        gpuaasPoolId: clusterPools[0].id,
        gpuaasClusterId: ref.clusterId,
        status: "active",
        allPoolIds,
      });
    }
  }

  // Load direct pool-assigned nodes (pools:12,13,14,15 pattern) from cache
  if (directPoolRefs.length > 0) {
    const allDirectPoolIds = new Set<number>();
    for (const ref of directPoolRefs) {
      for (const pid of ref.poolIds) allDirectPoolIds.add(pid);
    }

    // Load products for fallback naming
    const earlyProducts = await prisma.gpuProduct.findMany({ where: { active: true } });
    const earlyPoolToProduct = new Map<number, { name: string; pricePerHourCents: number }>();
    for (const product of earlyProducts) {
      try {
        const pids: number[] = JSON.parse(product.poolIds);
        for (const pid of pids) earlyPoolToProduct.set(pid, { name: product.name, pricePerHourCents: product.pricePerHourCents });
      } catch { /* skip */ }
    }

    // Resolve pools → physical nodes from cache
    const resolvedPoolIds = new Set<number>();
    const seenNodes = new Set<number>();

    for (const pool of cachedPools) {
      if (!allDirectPoolIds.has(pool.id)) continue;
      for (const cachedNode of pool.nodes) {
        if (seenNodes.has(cachedNode.id)) continue;
        seenNodes.add(cachedNode.id);

        const nodePools = nodePoolsFromCache.get(cachedNode.id);
        const investorPools = nodePools
          ? Array.from(nodePools).filter((pid) => allDirectPoolIds.has(pid))
          : [pool.id];

        for (const pid of investorPools) resolvedPoolIds.add(pid);
        const product = earlyPoolToProduct.get(investorPools[0]);

        gpuaasNodes.push({
          id: `gpuaas-${pool.clusterId}-${cachedNode.id}`,
          hostname: cachedNode.name || `Node ${cachedNode.id}`,
          ipAddress: cachedNode.ip,
          gpuModel: cachedNode.gpuModel || product?.name || null,
          gpuCount: cachedNode.gpuCount,
          gpuaasPoolId: investorPools[0],
          gpuaasClusterId: pool.clusterId,
          status: cachedNode.initStatus === 2 ? "active" : "initializing",
          allPoolIds: investorPools,
        });
      }
    }

    // Fallback: pools not mapped to any physical node
    const unresolvedPoolIds = Array.from(allDirectPoolIds).filter((pid) => !resolvedPoolIds.has(pid));
    if (unresolvedPoolIds.length > 0) {
      const product = earlyPoolToProduct.get(unresolvedPoolIds[0]);
      gpuaasNodes.push({
        id: `pools:${unresolvedPoolIds.sort((a, b) => a - b).join(",")}`,
        hostname: product?.name || "GPU Node",
        ipAddress: "",
        gpuModel: product?.name || null,
        gpuCount: null,
        gpuaasPoolId: unresolvedPoolIds[0],
        gpuaasClusterId: null,
        status: "active",
        allPoolIds: unresolvedPoolIds,
      });
    }
  }

  // Resolve ALL pools for Prisma ProviderNodes that have gpuaasClusterId
  const dbNodeAllPools = new Map<string, number[]>();
  const dbClusterIds = [...new Set(dbNodes.filter((n) => n.gpuaasClusterId).map((n) => n.gpuaasClusterId!))];
  for (const clusterId of dbClusterIds) {
    const clusterPools = poolsByCluster.get(clusterId) || [];
    const clusterPoolIds = clusterPools.map((p) => p.id);
    for (const dbNode of dbNodes) {
      if (dbNode.gpuaasClusterId === clusterId && clusterPoolIds.length > 0) {
        dbNodeAllPools.set(dbNode.id, clusterPoolIds);
      }
    }
  }

  const providerNodes: NormalizedNode[] = [
    ...dbNodes.map((n) => ({
      ...n,
      allPoolIds: dbNodeAllPools.get(n.id),
    })),
    ...gpuaasNodes,
  ];

  if (providerNodes.length === 0) {
    return emptyResponse;
  }

  // 2. Get pool IDs from nodes
  const poolIds: number[] = [];
  for (const n of providerNodes) {
    if (n.allPoolIds && n.allPoolIds.length > 0) {
      poolIds.push(...n.allPoolIds);
    } else if (n.gpuaasPoolId != null) {
      poolIds.push(n.gpuaasPoolId);
    }
  }
  const uniquePoolIds = [...new Set(poolIds)];

  // 3. Load GpuProducts for pricing
  const gpuProducts = await prisma.gpuProduct.findMany({ where: { active: true } });
  const poolIdToProduct = new Map<number, { name: string; pricePerHourCents: number; pricePerMonthCents: number | null; billingType: string }>();
  for (const product of gpuProducts) {
    try {
      const pids: number[] = JSON.parse(product.poolIds);
      for (const pid of pids) {
        // Prefer hourly products over monthly for the same pool
        const existing = poolIdToProduct.get(pid);
        if (!existing || (product.billingType === "hourly" && existing.billingType !== "hourly")) {
          poolIdToProduct.set(pid, {
            name: product.name,
            pricePerHourCents: product.pricePerHourCents,
            pricePerMonthCents: product.pricePerMonthCents,
            billingType: product.billingType,
          });
        }
      }
    } catch { /* skip malformed poolIds */ }
  }

  // 4. Build pool capacity from cache (no API calls needed)
  const capacityMap = new Map<number, { gpuCount: number; sharingRatio: number; gpuModel: string | null }>();
  for (const pool of cachedPools) {
    capacityMap.set(pool.id, {
      gpuCount: pool.totalGpus,
      sharingRatio: pool.overcommitRatio || 1,
      gpuModel: pool.gpus[0]?.gpuModel || null,
    });
  }

  // 5. (Occupancy is now calculated locally from subscription data — see section 11)

  // 6. Build team->customer map from Stripe
  const stripe = getStripe();
  const teamToCustomer = new Map<string, { customerId: string; email: string; name: string }>();
  let hasMore = true;
  let startingAfter: string | undefined;
  while (hasMore) {
    const customers = await stripe.customers.list({ limit: 100, starting_after: startingAfter });
    for (const customer of customers.data) {
      const teamId = customer.metadata?.hostedai_team_id;
      if (teamId) {
        teamToCustomer.set(teamId, {
          customerId: customer.id,
          email: customer.email || "unknown",
          name: customer.name || customer.email || "Unknown",
        });
      }
    }
    hasMore = customers.has_more;
    if (customers.data.length > 0) startingAfter = customers.data[customers.data.length - 1].id;
  }

  // 7. Build subscriptions from pool overview cache (no per-team API calls)
  interface RawSub {
    subscriptionId: string; teamId: string; poolId: number; poolName: string;
    status: string; podStatus?: string; isDead: boolean; vgpuCount: number;
    podName?: string; ownerEmail?: string; createdAt?: string; poolHours: number | null;
  }

  const allSubs: RawSub[] = [];
  for (const pool of cachedPools) {
    for (const pod of pool.pods) {
      const owner = teamToCustomer.get(pod.teamId);
      allSubs.push({
        subscriptionId: pod.subscriptionId,
        teamId: pod.teamId,
        poolId: pool.id,
        poolName: pool.name,
        status: pod.status === "active" ? "subscribed" : pod.status,
        podStatus: undefined,
        isDead: false,
        vgpuCount: pod.vgpuCount,
        podName: pod.podName,
        ownerEmail: owner?.email || pod.customerEmail || undefined,
        createdAt: undefined,
        poolHours: null,
      });
    }
  }

  // 8. Group subscriptions by poolId
  // Include ALL subscriptions (internal + external) so occupancy reflects real hardware usage.
  // Internal filtering is applied only to customer counts and revenue attribution below.
  const subsByPool = new Map<number, RawSub[]>();
  for (const sub of allSubs) {
    const existing = subsByPool.get(sub.poolId) || [];
    existing.push(sub);
    subsByPool.set(sub.poolId, existing);
  }

  // 9. Revenue date math
  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const daysIntoMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const hoursIntoMonth = daysIntoMonth * 24 + now.getUTCHours();

  // 9b. Query ACTUAL revenue from local WalletTransaction table
  const revenueByPoolThisMonth = new Map<number, number>();
  const revenueByPoolLastMonth = new Map<number, number>();

  if (uniquePoolIds.length > 0) {
    const thisMonthTxns = await prisma.walletTransaction.groupBy({
      by: ["poolId"],
      where: {
        poolId: { in: uniquePoolIds },
        amountCents: { gt: 0 },
        type: { in: ["gpu_usage", "gpu_deploy"] },
        createdAt: { gte: thisMonthStart },
      },
      _sum: { amountCents: true },
    });
    for (const row of thisMonthTxns) {
      if (row.poolId != null) {
        revenueByPoolThisMonth.set(row.poolId, row._sum.amountCents || 0);
      }
    }

    const lastMonthTxns = await prisma.walletTransaction.groupBy({
      by: ["poolId"],
      where: {
        poolId: { in: uniquePoolIds },
        amountCents: { gt: 0 },
        type: { in: ["gpu_usage", "gpu_deploy"] },
        createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
      },
      _sum: { amountCents: true },
    });
    for (const row of lastMonthTxns) {
      if (row.poolId != null) {
        revenueByPoolLastMonth.set(row.poolId, row._sum.amountCents || 0);
      }
    }
  }

  let hasLocalRevenueData = revenueByPoolThisMonth.size > 0;

  // 9c. Stripe fallback
  if (!hasLocalRevenueData && uniquePoolIds.length > 0) {
    const investorRateStrings = new Set<string>();
    for (const pid of uniquePoolIds) {
      const product = poolIdToProduct.get(pid);
      if (product) {
        investorRateStrings.add(`$${(product.pricePerHourCents / 100).toFixed(2)}/hr`);
      }
    }

    const investorTeamCustomerIds = new Set<string>();
    for (const pid of uniquePoolIds) {
      const poolSubs = subsByPool.get(pid) || [];
      for (const sub of poolSubs) {
        // Only include external customers for revenue attribution
        if (sub.ownerEmail && isInternalOrExcluded(sub.ownerEmail)) continue;
        const customer = teamToCustomer.get(sub.teamId);
        if (customer) investorTeamCustomerIds.add(customer.customerId);
      }
    }

    let stripeRevenueThisMonthCents = 0;
    let stripeRevenueLastMonthCents = 0;
    const thisMonthStartSec = Math.floor(thisMonthStart.getTime() / 1000);
    const lastMonthStartSec = Math.floor(lastMonthStart.getTime() / 1000);
    const lastMonthEndSec = Math.floor(lastMonthEnd.getTime() / 1000);

    for (const customerId of investorTeamCustomerIds) {
      try {
        let hasMoreTxns = true;
        let startingAfterTxn: string | undefined;
        while (hasMoreTxns) {
          const txns = await stripe.customers.listBalanceTransactions(customerId, {
            limit: 100,
            ...(startingAfterTxn && { starting_after: startingAfterTxn }),
          });
          for (const txn of txns.data) {
            if (txn.amount > 0 && txn.description) {
              const matchesInvestorRate = Array.from(investorRateStrings).some(
                (rate) => txn.description!.includes(rate)
              );
              if (matchesInvestorRate) {
                if (txn.created >= thisMonthStartSec) {
                  stripeRevenueThisMonthCents += txn.amount;
                } else if (txn.created >= lastMonthStartSec && txn.created <= lastMonthEndSec) {
                  stripeRevenueLastMonthCents += txn.amount;
                }
              }
            }
            if (txn.created < lastMonthStartSec) {
              hasMoreTxns = false;
              break;
            }
          }
          if (hasMoreTxns) {
            hasMoreTxns = txns.has_more;
            if (txns.data.length > 0) startingAfterTxn = txns.data[txns.data.length - 1].id;
          }
        }
      } catch (e) {
        console.warn(`[Investor Stats] Failed to fetch Stripe txns for ${customerId}:`, e);
      }
    }

    if (stripeRevenueThisMonthCents > 0 || stripeRevenueLastMonthCents > 0) {
      const perPoolThisMonth = Math.round(stripeRevenueThisMonthCents / uniquePoolIds.length);
      const perPoolLastMonth = Math.round(stripeRevenueLastMonthCents / uniquePoolIds.length);
      for (const pid of uniquePoolIds) {
        revenueByPoolThisMonth.set(pid, perPoolThisMonth);
        revenueByPoolLastMonth.set(pid, perPoolLastMonth);
      }
      hasLocalRevenueData = true;
    }
  }

  // 10. Fetch GPU metrics
  const allSubIds = uniquePoolIds.flatMap((pid) => (subsByPool.get(pid) || []).map((s) => s.subscriptionId));
  const metricsMap = new Map<string, {
    gpuUtilization: number; memoryUsedMb: number; memoryTotalMb: number;
    memoryPercent: number; temperature: number; powerDraw: number;
    powerLimit: number; fanSpeed: number; timestamp: Date;
  }>();

  if (allSubIds.length > 0) {
    try {
      const latestMetrics = await prisma.$queryRaw<Array<{
        subscriptionId: string; gpuUtilization: number; memoryUsedMb: number;
        memoryTotalMb: number; memoryPercent: number; temperature: number;
        powerDraw: number; powerLimit: number; fanSpeed: number; timestamp: Date;
      }>>`
        SELECT
          "subscriptionId", "gpuUtilization", "memoryUsedMb", "memoryTotalMb",
          "memoryPercent", "temperature", "powerDraw", "powerLimit", "fanSpeed", "timestamp"
        FROM "GpuHardwareMetrics" m
        WHERE "subscriptionId" IN (${Prisma.join(allSubIds)})
          AND "timestamp" = (
            SELECT MAX(m2."timestamp") FROM "GpuHardwareMetrics" m2
            WHERE m2."subscriptionId" = m."subscriptionId"
          )
      `;
      for (const m of latestMetrics) metricsMap.set(m.subscriptionId, m);
    } catch (e) {
      console.warn("[Investor Stats] Could not fetch GPU metrics:", e);
    }
  }

  // 11. Build investor node objects
  const investorNodes = providerNodes.map((node) => {
    const poolId = node.gpuaasPoolId;
    const nodePoolIds = node.allPoolIds && node.allPoolIds.length > 0
      ? node.allPoolIds
      : (poolId != null ? [poolId] : []);
    const capacity = poolId ? capacityMap.get(poolId) : null;
    const product = poolId ? poolIdToProduct.get(poolId) : null;
    const poolSubs = nodePoolIds.flatMap((pid) => subsByPool.get(pid) || []);
    // Calculate occupancy from actual subscription data, excluding dead pods and inactive subscriptions
    const ACTIVE_SUB_STATUSES = ["subscribed", "active", "running"];
    const occupancy = poolSubs.filter((sub) =>
      !sub.isDead && ACTIVE_SUB_STATUSES.includes(sub.status?.toLowerCase())
    ).reduce((sum, sub) => sum + sub.vgpuCount, 0);

    let gpuCount = node.gpuCount || 0;
    let sharingRatio = capacity?.sharingRatio || 1;
    if (!gpuCount && nodePoolIds.length > 0) {
      let totalPhysical = 0;
      for (const pid of nodePoolIds) {
        const poolCap = capacityMap.get(pid);
        if (poolCap) {
          totalPhysical += poolCap.gpuCount;
          sharingRatio = poolCap.sharingRatio || 1;
        }
      }
      gpuCount = totalPhysical > 0 ? totalPhysical : (capacity?.gpuCount || 0);
    }
    const totalVgpuSlots = nodePoolIds.reduce((sum, pid) => {
      const poolCap = capacityMap.get(pid);
      return sum + (poolCap ? poolCap.gpuCount * (poolCap.sharingRatio || 1) : 0);
    }, 0) || gpuCount * sharingRatio;
    const occupancyPercent = totalVgpuSlots > 0 ? Math.round((occupancy / totalVgpuSlots) * 1000) / 10 : 0;
    const hourlyRateCents = product ? product.pricePerHourCents : 0;
    const monthlyRateCents = product?.pricePerMonthCents || null;
    const billingType = product?.billingType || "hourly";

    // Customer count excludes internal/test accounts (occupancy includes them)
    const externalSubs = poolSubs.filter((s) => !s.ownerEmail || !isInternalOrExcluded(s.ownerEmail));
    const uniqueTeams = new Set(externalSubs.map((s) => s.teamId));
    const customerCount = uniqueTeams.size;
    const customersPerGpu = gpuCount > 0 ? Math.round((customerCount / gpuCount) * 10) / 10 : 0;

    const subscriptions = poolSubs.map((sub, idx) => {
      const uptimeHoursThisMonth = sub.poolHours ?? 0;
      let computedRevenueCents: number;
      if (billingType === "monthly" && monthlyRateCents) {
        // Monthly billing: prorate the monthly rate by days active this month
        const subStart = sub.createdAt ? new Date(sub.createdAt) : thisMonthStart;
        const activeFrom = subStart > thisMonthStart ? subStart : thisMonthStart;
        const activeDays = Math.max(0, (now.getTime() - activeFrom.getTime()) / (1000 * 60 * 60 * 24));
        computedRevenueCents = Math.round((monthlyRateCents / daysInMonth) * activeDays * sub.vgpuCount);
      } else {
        // Hourly billing: hours * rate
        computedRevenueCents = Math.round(uptimeHoursThisMonth * sub.vgpuCount * hourlyRateCents);
      }
      // Strip all customer PII — investors see anonymous pod labels only
      return {
        subscriptionId: `pod-${idx + 1}`,
        teamId: `customer-${idx + 1}`,
        status: sub.isDead ? "dead" : sub.status,
        podStatus: sub.podStatus,
        isDead: sub.isDead,
        vgpuCount: sub.vgpuCount,
        podName: `Pod ${idx + 1}`,
        createdAt: sub.createdAt,
        revenueThisMonthCents: computedRevenueCents,
        revenueLastMonthCents: 0,
        uptimeHoursThisMonth: Math.round(uptimeHoursThisMonth * 10) / 10,
      };
    });

    const localRevenueThisMonth = nodePoolIds.reduce((sum, pid) => sum + (revenueByPoolThisMonth.get(pid) ?? 0), 0);
    const localRevenueLastMonth = nodePoolIds.reduce((sum, pid) => sum + (revenueByPoolLastMonth.get(pid) ?? 0), 0);
    const computedRevenueThisMonth = subscriptions.reduce((s, sub) => s + sub.revenueThisMonthCents, 0);
    const nodeRevenueThisMonth = Math.max(localRevenueThisMonth, computedRevenueThisMonth);
    const nodeRevenueLastMonth = localRevenueLastMonth;
    const nodeUptimeThisMonth = subscriptions.reduce((s, sub) => s + sub.uptimeHoursThisMonth, 0);

    const subsWithMetrics = poolSubs
      .map((s) => metricsMap.get(s.subscriptionId))
      .filter((m): m is NonNullable<typeof m> => !!m);
    const avgGpuUtilization = subsWithMetrics.length > 0
      ? Math.round((subsWithMetrics.reduce((s, m) => s + m.gpuUtilization, 0) / subsWithMetrics.length) * 10) / 10
      : null;
    const avgTemperature = subsWithMetrics.length > 0
      ? Math.round(subsWithMetrics.reduce((s, m) => s + m.temperature, 0) / subsWithMetrics.length)
      : null;
    const avgMemoryPercent = subsWithMetrics.length > 0
      ? Math.round((subsWithMetrics.reduce((s, m) => s + m.memoryPercent, 0) / subsWithMetrics.length) * 10) / 10
      : null;

    const firstMetric = subsWithMetrics[0] || null;
    const metrics = firstMetric ? {
      gpuUtilization: Math.round(firstMetric.gpuUtilization * 10) / 10,
      memoryUsedMb: Math.round(firstMetric.memoryUsedMb),
      memoryTotalMb: Math.round(firstMetric.memoryTotalMb),
      memoryPercent: Math.round(firstMetric.memoryPercent * 10) / 10,
      temperature: Math.round(firstMetric.temperature),
      powerDraw: Math.round(firstMetric.powerDraw),
      powerLimit: Math.round(firstMetric.powerLimit),
      fanSpeed: Math.round(firstMetric.fanSpeed),
      lastMetricAt: firstMetric.timestamp.toISOString(),
    } : null;

    return {
      nodeId: node.id,
      hostname: node.hostname,
      gpuModel: node.gpuModel || product?.name || capacity?.gpuModel || null,
      gpuCount: gpuCount || node.gpuCount,
      status: node.status,
      totalVgpuSlots,
      occupiedSlots: occupancy,
      occupancyPercent,
      hourlyRateCents,
      monthlyRateCents,
      billingType,
      revenueThisMonthCents: nodeRevenueThisMonth,
      revenueLastMonthCents: nodeRevenueLastMonth,
      revenuePerGpuThisMonthCents: gpuCount > 0 ? Math.round(nodeRevenueThisMonth / gpuCount) : nodeRevenueThisMonth,
      uptimeHoursThisMonth: Math.round(nodeUptimeThisMonth * 10) / 10,
      customerCount,
      overcommitRatio: sharingRatio,
      customersPerGpu,
      avgGpuUtilization,
      avgTemperature,
      avgMemoryPercent,
      metrics,
      subscriptions,
    };
  });

  // 12. Aggregate revenue
  const grossThisMonth = investorNodes.reduce((s, n) => s + n.revenueThisMonthCents, 0);
  const grossLastMonth = investorNodes.reduce((s, n) => s + n.revenueLastMonthCents, 0);
  const grossDailyRate = daysIntoMonth > 0 ? Math.round(grossThisMonth / daysIntoMonth) : 0;
  const grossProjected = daysIntoMonth > 0 ? Math.round(grossThisMonth * (daysInMonth / daysIntoMonth)) : 0;

  const investorThisMonth = Math.round(grossThisMonth * revenueSharePercent / 100);
  const investorLastMonth = Math.round(grossLastMonth * revenueSharePercent / 100);
  const investorDailyRate = Math.round(grossDailyRate * revenueSharePercent / 100);
  const investorProjected = Math.round(grossProjected * revenueSharePercent / 100);

  const monthOverMonthChangePercent = grossLastMonth > 0
    ? Math.round(((grossThisMonth - grossLastMonth) / grossLastMonth) * 1000) / 10
    : null;

  const totalOccupied = investorNodes.reduce((s, n) => s + n.occupiedSlots, 0);
  const totalSlots = investorNodes.reduce((s, n) => s + n.totalVgpuSlots, 0);
  const fleetUtilizationPercent = totalSlots > 0
    ? Math.round((totalOccupied / totalSlots) * 1000) / 10
    : 0;

  // 13. Summary
  const activeNodes = investorNodes.filter((n) => n.status === "active");
  const nodesWithPool = investorNodes.filter((n) => n.totalVgpuSlots > 0);
  const totalPhysicalGpus = investorNodes.reduce((s, n) => s + (n.gpuCount || 0), 0);
  const totalVgpuSlots = investorNodes.reduce((s, n) => s + n.totalVgpuSlots, 0);
  const totalOccupiedSlots = investorNodes.reduce((s, n) => s + n.occupiedSlots, 0);
  // Customer count excludes internal accounts
  const internalTeamIds = new Set(
    allSubs.filter((s) => s.ownerEmail && isInternalOrExcluded(s.ownerEmail)).map((s) => s.teamId)
  );
  const totalCustomers = new Set(
    investorNodes.flatMap((n) => n.subscriptions.map((s) => s.teamId))
      .filter((tid) => !internalTeamIds.has(tid))
  ).size;
  const avgOccupancyPercent = nodesWithPool.length > 0
    ? Math.round((nodesWithPool.reduce((s, n) => s + n.occupancyPercent, 0) / nodesWithPool.length) * 10) / 10
    : 0;
  const avgOvercommitRatio = nodesWithPool.length > 0
    ? Math.round((nodesWithPool.reduce((s, n) => s + n.overcommitRatio, 0) / nodesWithPool.length) * 10) / 10
    : 0;

  const nodesWithGpuData = investorNodes.filter((n) => n.avgGpuUtilization !== null);
  const summaryAvgGpu = nodesWithGpuData.length > 0
    ? Math.round((nodesWithGpuData.reduce((s, n) => s + (n.avgGpuUtilization || 0), 0) / nodesWithGpuData.length) * 10) / 10
    : null;
  const summaryAvgTemp = nodesWithGpuData.length > 0
    ? Math.round(nodesWithGpuData.reduce((s, n) => s + (n.avgTemperature || 0), 0) / nodesWithGpuData.length)
    : null;
  const summaryAvgMem = nodesWithGpuData.length > 0
    ? Math.round((nodesWithGpuData.reduce((s, n) => s + (n.avgMemoryPercent || 0), 0) / nodesWithGpuData.length) * 10) / 10
    : null;

  // 14. Daily revenue history (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0);
  interface DailyRow { day: string; totalCents: number; uniqueCustomers: number }
  let dailyRevenue: Array<{ date: string; grossCents: number; investorCents: number; customers: number }> = [];
  const thirtyDaysAgoMs = thirtyDaysAgo.getTime();
  if (uniquePoolIds.length > 0) {
    try {
      const dailyRows = await prisma.$queryRaw<DailyRow[]>`
        SELECT
          strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch') as day,
          SUM("amountCents") as "totalCents",
          COUNT(DISTINCT "stripeCustomerId") as "uniqueCustomers"
        FROM "WalletTransaction"
        WHERE "poolId" IN (${Prisma.join(uniquePoolIds)})
          AND "amountCents" > 0
          AND "type" IN ('gpu_usage', 'gpu_deploy')
          AND "createdAt" >= ${thirtyDaysAgoMs}
        GROUP BY strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch')
        ORDER BY day ASC
      `;
      dailyRevenue = dailyRows.map((r) => ({
        date: r.day,
        grossCents: Number(r.totalCents),
        investorCents: Math.round(Number(r.totalCents) * revenueSharePercent / 100),
        customers: Number(r.uniqueCustomers),
      }));
    } catch (e) {
      console.warn("[Investor Stats] Failed to query daily revenue:", e);
    }
  }

  // 15. Business health KPIs
  const internalCustomerIds = new Set<string>();
  for (const [, customer] of teamToCustomer) {
    if (isInternalOrExcluded(customer.email)) {
      internalCustomerIds.add(customer.customerId);
    }
  }

  const revenuePerGpuPerDayCents = (totalPhysicalGpus > 0 && daysIntoMonth > 0)
    ? Math.round(investorThisMonth / totalPhysicalGpus / daysIntoMonth)
    : 0;

  const arpcCents = totalCustomers > 0 ? Math.round(investorThisMonth / totalCustomers) : 0;

  const totalBilledHours = investorNodes.reduce((s, n) => s + n.uptimeHoursThisMonth, 0);
  const totalPossibleHours = totalPhysicalGpus * hoursIntoMonth;
  const sellThroughPercent = totalPossibleHours > 0
    ? Math.round((totalBilledHours / totalPossibleHours) * 1000) / 10
    : 0;

  let churnPercent: number | null = null;
  if (uniquePoolIds.length > 0) {
    try {
      const lastMonthStartMs = lastMonthStart.getTime();
      const lastMonthEndMs = lastMonthEnd.getTime();
      const thisMonthStartMs = thisMonthStart.getTime();

      const lastMonthCustomers = await prisma.$queryRaw<Array<{ cid: string }>>`
        SELECT DISTINCT "stripeCustomerId" as cid
        FROM "WalletTransaction"
        WHERE "poolId" IN (${Prisma.join(uniquePoolIds)})
          AND "amountCents" > 0
          AND "type" IN ('gpu_usage', 'gpu_deploy')
          AND "createdAt" >= ${lastMonthStartMs}
          AND "createdAt" <= ${lastMonthEndMs}
      `;
      const thisMonthCustomers = await prisma.$queryRaw<Array<{ cid: string }>>`
        SELECT DISTINCT "stripeCustomerId" as cid
        FROM "WalletTransaction"
        WHERE "poolId" IN (${Prisma.join(uniquePoolIds)})
          AND "amountCents" > 0
          AND "type" IN ('gpu_usage', 'gpu_deploy')
          AND "createdAt" >= ${thisMonthStartMs}
      `;
      const extLastMonth = lastMonthCustomers.filter((r) => !internalCustomerIds.has(r.cid));
      const extThisMonth = thisMonthCustomers.filter((r) => !internalCustomerIds.has(r.cid));
      if (extLastMonth.length > 0) {
        const thisMonthSet = new Set(extThisMonth.map((r) => r.cid));
        const churned = extLastMonth.filter((r) => !thisMonthSet.has(r.cid)).length;
        churnPercent = Math.round((churned / extLastMonth.length) * 1000) / 10;
      }
    } catch (e) {
      console.warn("[Investor Stats] Failed to compute churn:", e);
    }
  }

  let topCustomerPercent: number | null = null;
  if (uniquePoolIds.length > 0 && grossThisMonth > 0) {
    try {
      const thisMonthStartMs = thisMonthStart.getTime();
      const revenueByCustomer = await prisma.$queryRaw<Array<{ cid: string; total: number }>>`
        SELECT "stripeCustomerId" as cid, SUM("amountCents") as total
        FROM "WalletTransaction"
        WHERE "poolId" IN (${Prisma.join(uniquePoolIds)})
          AND "amountCents" > 0
          AND "type" IN ('gpu_usage', 'gpu_deploy')
          AND "createdAt" >= ${thisMonthStartMs}
        GROUP BY "stripeCustomerId"
        ORDER BY total DESC
      `;
      const extRevenue = revenueByCustomer.filter((r) => !internalCustomerIds.has(r.cid));
      if (extRevenue.length > 0) {
        const extTotal = extRevenue.reduce((s, r) => s + Number(r.total), 0);
        topCustomerPercent = extTotal > 0
          ? Math.round((Number(extRevenue[0].total) / extTotal) * 1000) / 10
          : null;
      }
    } catch (e) {
      console.warn("[Investor Stats] Failed to compute concentration:", e);
    }
  }

  const subsWithCreatedAt = investorNodes.flatMap((n) => n.subscriptions)
    .filter((s) => s.createdAt && !s.isDead);
  let avgSessionDurationHours: number | null = null;
  if (subsWithCreatedAt.length > 0) {
    const nowMs = now.getTime();
    const totalHrs = subsWithCreatedAt.reduce((sum, s) => {
      const start = new Date(s.createdAt!).getTime();
      return sum + Math.max(0, (nowMs - start) / (1000 * 60 * 60));
    }, 0);
    avgSessionDurationHours = Math.round((totalHrs / subsWithCreatedAt.length) * 10) / 10;
  }

  return {
    nodes: investorNodes,
    summary: {
      totalNodes: investorNodes.length,
      activeNodes: activeNodes.length,
      nodesWithPool: nodesWithPool.length,
      totalPhysicalGpus,
      totalVgpuSlots,
      totalOccupiedSlots,
      totalCustomers,
      avgOccupancyPercent,
      avgOvercommitRatio,
      avgGpuUtilization: summaryAvgGpu,
      avgTemperature: summaryAvgTemp,
      avgMemoryPercent: summaryAvgMem,
    },
    revenue: {
      grossRevenueThisMonthCents: grossThisMonth,
      grossRevenueLastMonthCents: grossLastMonth,
      grossRevenueDailyRateCents: grossDailyRate,
      grossRevenueProjectedMonthCents: grossProjected,
      revenueSharePercent,
      investorRevenueThisMonthCents: investorThisMonth,
      investorRevenueLastMonthCents: investorLastMonth,
      investorRevenueDailyRateCents: investorDailyRate,
      investorRevenueProjectedMonthCents: investorProjected,
      monthOverMonthChangePercent,
      fleetUtilizationPercent,
    },
    businessHealth: {
      revenuePerGpuPerDayCents,
      arpcCents,
      sellThroughPercent,
      churnPercent,
      topCustomerPercent,
      avgSessionDurationHours,
    },
    dailyRevenue,
    lastUpdated: new Date().toISOString(),
  };
}
