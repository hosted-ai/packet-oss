// Tests for src/lib/fleet-snapshot.ts — the daily capacity-series writer
// (PA-693, metric #11 denominator). One row set per UTC day, idempotent,
// refuses partial overviews, BM row is best-effort.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  snapshotCount: vi.fn(),
  snapshotCreateMany: vi.fn(),
  snapshotCreate: vi.fn(),
  listAllBaremetalNodes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fleetCapacitySnapshot: {
      count: h.snapshotCount,
      createMany: h.snapshotCreateMany,
      create: h.snapshotCreate,
    },
  },
}));
vi.mock("@/lib/gpuaas-admin", () => ({
  gpuaasAdmin: { listAllBaremetalNodes: h.listAllBaremetalNodes },
}));

import { snapshotFleetCapacity } from "@/lib/fleet-snapshot";
import type { PoolOverviewResponse } from "@/lib/pool-overview";

const NOW = new Date("2026-08-07T00:02:00.000Z");

// Pool 1: 3 GPUs listed, 2 on the online node (node 11 still initializing).
// Pool 2: GPU list failed to load → totalGpus fallback, assumed online.
function overview(extra: Partial<PoolOverviewResponse> = {}): PoolOverviewResponse {
  return {
    clusters: [],
    summary: {} as PoolOverviewResponse["summary"],
    pools: [
      {
        id: 1,
        totalGpus: 3,
        overcommitRatio: 1,
        gpus: [
          { gpuModel: "H100", nodeId: 10 },
          { gpuModel: "H100", nodeId: 10 },
          { gpuModel: "H100", nodeId: 11 },
        ],
        nodes: [
          { id: 10, initStatus: 2, gpuModel: "H100" },
          { id: 11, initStatus: 1, gpuModel: "H100" },
        ],
      },
      {
        id: 2,
        totalGpus: 4,
        overcommitRatio: 4,
        gpus: [],
        nodes: [],
      },
    ] as unknown as PoolOverviewResponse["pools"],
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.snapshotCount.mockResolvedValue(0);
  h.snapshotCreateMany.mockResolvedValue({ count: 2 });
  h.snapshotCreate.mockResolvedValue({});
  h.listAllBaremetalNodes.mockResolvedValue([
    { id: 1, gpu_count: 8, status: "Online" },
    { id: 2, gpu_count: 8, status: "Offline" },
  ]);
});

describe("snapshotFleetCapacity", () => {
  it("writes one pool row per pool (online GPUs, vGPU slots) plus a baremetal row", async () => {
    await snapshotFleetCapacity(overview(), NOW);

    expect(h.snapshotCreateMany).toHaveBeenCalledWith({
      data: [
        {
          date: "2026-08-07",
          kind: "pool",
          poolId: 1,
          gpuModel: "H100",
          physicalGpus: 3,
          onlineGpus: 2, // node 11 not init-completed → its GPU excluded
          overcommitRatio: 1,
          vgpuSlots: 2,
          onlineNodes: 1,
          totalNodes: 2,
        },
        {
          date: "2026-08-07",
          kind: "pool",
          poolId: 2,
          gpuModel: "unknown", // GPU list failed → no model resolvable
          physicalGpus: 4, // totalGpus fallback
          onlineGpus: 4, // assumed online (can't know without the node list)
          overcommitRatio: 4,
          vgpuSlots: 16,
          onlineNodes: 0,
          totalNodes: 0,
        },
      ],
    });
    expect(h.snapshotCreate).toHaveBeenCalledWith({
      data: {
        date: "2026-08-07",
        kind: "baremetal",
        poolId: null,
        gpuModel: null,
        physicalGpus: 16,
        onlineGpus: 8, // only the Online node's GPUs
        overcommitRatio: 1,
        vgpuSlots: 8,
        onlineNodes: 1,
        totalNodes: 2,
      },
    });
  });

  it("is idempotent per UTC day — rows already present means no writes", async () => {
    h.snapshotCount.mockResolvedValue(5);
    await snapshotFleetCapacity(overview(), NOW);
    expect(h.snapshotCreateMany).not.toHaveBeenCalled();
    expect(h.snapshotCreate).not.toHaveBeenCalled();
  });

  it("refuses a partial overview (hadApiFailures) — a bad snapshot poisons the whole day", async () => {
    await snapshotFleetCapacity(overview({ hadApiFailures: true }), NOW);
    expect(h.snapshotCount).not.toHaveBeenCalled();
    expect(h.snapshotCreateMany).not.toHaveBeenCalled();
  });

  it("a baremetal fetch failure still writes the pool rows", async () => {
    h.listAllBaremetalNodes.mockRejectedValue(new Error("HAI down"));
    await snapshotFleetCapacity(overview(), NOW);
    expect(h.snapshotCreateMany).toHaveBeenCalledTimes(1);
    expect(h.snapshotCreate).not.toHaveBeenCalled();
  });
});
