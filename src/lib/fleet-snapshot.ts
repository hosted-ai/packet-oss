/**
 * Daily fleet-capacity snapshot writer (PA-693, metrics sheet #11).
 *
 * The refresh-pool-overview cron calls snapshotFleetCapacity after every clean
 * refresh; the first call of each UTC day writes one row per pool (plus one
 * fleet-wide baremetal row) and the rest no-op. The accumulated series is the
 * denominator for "available GPU-hours" — before it existed, utilization could
 * only assume the current fleet held constant.
 */

import { prisma } from "@/lib/prisma";
import type { PoolOverviewResponse } from "@/lib/pool-overview";
import { gpuaasAdmin } from "@/lib/gpuaas-admin";
import {
  classifyPools,
  utcDateStr,
  NODE_INIT_COMPLETED,
  UNKNOWN_GPU_TYPE,
} from "@/lib/platform-metrics";

/** Write today's capacity rows if none exist yet. Idempotent per UTC day.
 *  Refuses partial data: an overview flagged hadApiFailures would under-record
 *  the whole day, so we wait for the next clean refresh instead. A baremetal
 *  fetch failure only skips the baremetal row — pool rows still land. */
export async function snapshotFleetCapacity(
  overview: PoolOverviewResponse,
  now: Date = new Date(),
): Promise<void> {
  if (overview.hadApiFailures) return;
  const date = utcDateStr(now);
  const existing = await prisma.fleetCapacitySnapshot.count({ where: { date } });
  if (existing > 0) return;

  const pc = classifyPools(overview.pools);
  const rows = overview.pools.map((p) => {
    const onlineNodeIds = new Set(
      p.nodes.filter((n) => n.initStatus === NODE_INIT_COMPLETED).map((n) => n.id),
    );
    // GPU-list fallback mirrors pool-overview itself: when the list didn't load,
    // totalGpus is the best available count and is assumed online.
    const physical = p.gpus.length > 0 ? p.gpus.length : p.totalGpus;
    const online =
      p.gpus.length > 0
        ? p.gpus.filter((g) => onlineNodeIds.has(g.nodeId)).length
        : p.totalGpus;
    const ratio = p.overcommitRatio || 1;
    return {
      date,
      kind: "pool",
      poolId: p.id,
      gpuModel: pc.gpuModelByPool.get(p.id) ?? UNKNOWN_GPU_TYPE,
      physicalGpus: physical,
      onlineGpus: online,
      overcommitRatio: ratio,
      vgpuSlots: Math.round(online * ratio),
      onlineNodes: onlineNodeIds.size,
      totalNodes: p.nodes.length,
    };
  });
  if (rows.length > 0) {
    await prisma.fleetCapacitySnapshot.createMany({ data: rows });
  }

  try {
    const nodes = await gpuaasAdmin.listAllBaremetalNodes();
    const online = nodes.filter((n) => (n.status || "").toLowerCase() === "online");
    const onlineGpus = online.reduce((s, n) => s + (n.gpu_count || 0), 0);
    await prisma.fleetCapacitySnapshot.create({
      data: {
        date,
        kind: "baremetal",
        poolId: null,
        gpuModel: null,
        physicalGpus: nodes.reduce((s, n) => s + (n.gpu_count || 0), 0),
        onlineGpus,
        overcommitRatio: 1,
        vgpuSlots: onlineGpus,
        onlineNodes: online.length,
        totalNodes: nodes.length,
      },
    });
  } catch (err) {
    console.error("[Fleet Snapshot] baremetal row failed (pool rows kept):", err);
  }
}
