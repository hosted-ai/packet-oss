/**
 * Tests for GET /api/admin/nodes (src/app/api/admin/nodes/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated. Reads the pool-overview
 * cache (recomputing on a miss), reads ProviderNode rows from Prisma, and builds
 * a node-monitoring overview across three sections: DB provider nodes, unowned
 * cache nodes, and synthetic pool-only cluster nodes — plus per-provider and
 * overall summaries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockReadPoolOverviewCache,
  mockComputePoolOverview,
  mockWritePoolOverviewCache,
  mockProviderNodeFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
  mockComputePoolOverview: vi.fn(),
  mockWritePoolOverviewCache: vi.fn(),
  mockProviderNodeFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: mockReadPoolOverviewCache,
  computePoolOverview: mockComputePoolOverview,
  writePoolOverviewCache: mockWritePoolOverviewCache,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { providerNode: { findMany: mockProviderNodeFindMany } },
}));

import { GET } from "@/app/api/admin/nodes/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/nodes", { method: "GET", headers });
}

/** A pool with one node, two GPUs (one assigned), and one running pod. */
function poolWithNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "pool-a",
    clusterId: 10,
    regionName: "us-east",
    totalGpus: 2,
    allocatedGpus: 1,
    availableGpus: 1,
    utilizationPercent: 50,
    gpus: [
      { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
      { nodeId: 100, assignmentStatus: "available", gpuModel: "H100" },
    ],
    nodes: [
      {
        id: 100,
        name: "cache-node",
        ip: "10.0.0.5",
        gpuCount: 2,
        gpuModel: "H100",
        cpuModel: "Xeon",
        cpuCores: 64,
        memoryGb: 512,
        storageGb: 4000,
        initStatus: 2,
        providerId: null,
        providerName: null,
      },
    ],
    pods: [
      {
        subscriptionId: "sub-1",
        podName: "pod-1",
        status: "running",
        vgpuCount: 1,
        customerEmail: "c@x.com",
        customerName: "Cust",
      },
    ],
    ...overrides,
  };
}

function cache(pools: unknown[]) {
  return { clusters: [], pools, summary: {} };
}

function providerNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "pn-1",
    hostname: "host-1",
    ipAddress: "1.2.3.4",
    providerId: "prov-1",
    provider: { companyName: "Acme", email: "ops@acme.com" },
    status: "active",
    statusMessage: null,
    gpuModel: "H100",
    gpuCount: 2,
    gpuaasClusterId: 10,
    gpuaasNodeId: 100,
    gpuaasPoolId: 1,
    cpuModel: "Xeon",
    cpuCores: 64,
    ramGb: 512,
    storageGb: 4000,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockReadPoolOverviewCache.mockReturnValue(cache([poolWithNode()]));
  mockComputePoolOverview.mockResolvedValue(cache([poolWithNode()]));
  mockProviderNodeFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/nodes — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockReadPoolOverviewCache).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockReadPoolOverviewCache).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/nodes — cache behaviour", () => {
  it("recomputes and writes the cache on a miss", async () => {
    mockReadPoolOverviewCache.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(mockComputePoolOverview).toHaveBeenCalledTimes(1);
    expect(mockWritePoolOverviewCache).toHaveBeenCalledTimes(1);
  });

  it("does not recompute on a cache hit", async () => {
    await GET(makeRequest());
    expect(mockComputePoolOverview).not.toHaveBeenCalled();
    expect(mockWritePoolOverviewCache).not.toHaveBeenCalled();
  });

  it("queries only active/online/provisioning provider nodes", async () => {
    await GET(makeRequest());
    const arg = mockProviderNodeFindMany.mock.calls[0][0];
    expect(arg.where.status.in).toEqual(["active", "online", "provisioning"]);
    expect(arg.include).toEqual({ provider: true });
  });
});

describe("GET /api/admin/nodes — provider node section", () => {
  it("builds a provider node with pools, pods, and a provider summary", async () => {
    mockProviderNodeFindMany.mockResolvedValue([providerNode()]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const node = body.data.nodes.find((n: { id: string }) => n.id === "pn-1");
    expect(node).toBeDefined();
    expect(node.status).toBe("online");
    expect(node.hostname).toBe("host-1");
    expect(node.pools[0]).toMatchObject({ id: 1, name: "pool-a", totalGpus: 2, allocatedGpus: 1 });
    expect(node.pods).toHaveLength(1);
    expect(node.summary.allocatedGpus).toBe(1);
    expect(node.summary.activePods).toBe(1);
    expect(node.summary.totalVgpus).toBe(1);

    const provider = body.data.providers.find((p: { id: string }) => p.id === "prov-1");
    expect(provider).toMatchObject({ id: "prov-1", name: "Acme", nodeCount: 1 });
    expect(provider.utilizationPercent).toBe(50);
  });

  it("maps provisioning status to initializing and error status to error", async () => {
    mockProviderNodeFindMany.mockResolvedValue([
      providerNode({ id: "pn-init", gpuaasNodeId: null, gpuaasPoolId: null, status: "provisioning" }),
      providerNode({ id: "pn-err", gpuaasNodeId: null, gpuaasPoolId: null, status: "validation_failed" }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    const byId = Object.fromEntries(body.data.nodes.map((n: { id: string; status: string }) => [n.id, n.status]));
    expect(byId["pn-init"]).toBe("initializing");
    expect(byId["pn-err"]).toBe("error");
  });
});

describe("GET /api/admin/nodes — unowned cache nodes", () => {
  it("includes cache nodes that are not present in the DB", async () => {
    // No provider nodes -> the cache node (id 100) is surfaced as unowned.
    const res = await GET(makeRequest());
    const body = await res.json();
    const unowned = body.data.nodes.find((n: { id: string }) => n.id === "gpuaas-10-100");
    expect(unowned).toBeDefined();
    expect(unowned.providerId).toBe("unowned");
    expect(unowned.status).toBe("online"); // initStatus 2
    expect(unowned.pools).toHaveLength(1);
  });

  it("does not duplicate a node that already exists as a provider node", async () => {
    mockProviderNodeFindMany.mockResolvedValue([providerNode()]);
    const res = await GET(makeRequest());
    const body = await res.json();
    const unowned = body.data.nodes.filter((n: { id: string }) => n.id === "gpuaas-10-100");
    expect(unowned).toHaveLength(0);
  });
});

describe("GET /api/admin/nodes — synthetic pool-only nodes", () => {
  it("creates a synthetic cluster node when a cluster has pools but no nodes", async () => {
    const poolNoNodes = poolWithNode({ id: 2, clusterId: 20, nodes: [], gpus: [] });
    mockReadPoolOverviewCache.mockReturnValue(cache([poolNoNodes]));
    const res = await GET(makeRequest());
    const body = await res.json();
    const synthetic = body.data.nodes.find((n: { id: string }) => n.id === "gpuaas-cluster-20");
    expect(synthetic).toBeDefined();
    expect(synthetic.providerId).toBe("unowned");
    expect(synthetic.pools[0].id).toBe(2);
  });
});

describe("GET /api/admin/nodes — summary & errors", () => {
  it("computes the overall summary across all nodes", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.summary.totalNodes).toBe(body.data.nodes.length);
    expect(body.data.summary.totalGpus).toBeGreaterThanOrEqual(0);
    expect(body.data.summary).toHaveProperty("utilizationPercent");
  });

  it("returns an empty overview when cache and DB are both empty", async () => {
    mockReadPoolOverviewCache.mockReturnValue(cache([]));
    mockProviderNodeFindMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.nodes).toEqual([]);
    expect(body.data.providers).toEqual([]);
    expect(body.data.summary.totalNodes).toBe(0);
  });

  it("returns 500 when the provider node query throws", async () => {
    mockProviderNodeFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("db down");
  });
});

describe("GET /api/admin/nodes — PA-192 negative availableGpus regression", () => {
  // Overcommit / vGPU pools can report more *assigned* GPUs than a node has
  // *physical* GPUs. Node Monitoring must clamp "Available" at 0 — it must never
  // surface the logically-impossible negative count from the reported bug
  // (Total 4, Allocated 5, Available -1).
  const overcommitGpus = [
    { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
    { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
    { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
    { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
    { nodeId: 100, assignmentStatus: "assigned", gpuModel: "H100" },
  ];

  it("clamps a provider node's Available to 0 when allocated exceeds physical GPUs", async () => {
    mockReadPoolOverviewCache.mockReturnValue(
      cache([poolWithNode({ totalGpus: 5, allocatedGpus: 5, availableGpus: 0, gpus: overcommitGpus })])
    );
    // Physical node reports 4 GPUs but the pool has 5 assigned -> naive 4 - 5 = -1.
    mockProviderNodeFindMany.mockResolvedValue([providerNode({ gpuCount: 4 })]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    const node = body.data.nodes.find((n: { id: string }) => n.id === "pn-1");
    expect(node.summary.totalGpus).toBe(4);
    expect(node.summary.allocatedGpus).toBe(5); // overcommit reflected as-is
    expect(node.summary.availableGpus).toBe(0); // clamped, not -1

    // The top-of-page summary from the ticket screenshot must not go negative either.
    expect(body.data.summary.availableGpus).toBe(0);
    expect(body.data.summary.availableGpus).toBeGreaterThanOrEqual(0);
  });

  it("clamps an unowned cache node's Available to 0 when allocated exceeds physical GPUs", async () => {
    const cacheNode = {
      id: 100, name: "cache-node", ip: "10.0.0.5", gpuCount: 4, gpuModel: "H100",
      cpuModel: "Xeon", cpuCores: 64, memoryGb: 512, storageGb: 4000,
      initStatus: 2, providerId: null, providerName: null,
    };
    mockReadPoolOverviewCache.mockReturnValue(
      cache([poolWithNode({ totalGpus: 5, allocatedGpus: 5, availableGpus: 0, gpus: overcommitGpus, nodes: [cacheNode] })])
    );
    mockProviderNodeFindMany.mockResolvedValue([]); // no DB node -> unowned cache-node path

    const res = await GET(makeRequest());
    const body = await res.json();

    const unowned = body.data.nodes.find((n: { id: string }) => n.id === "gpuaas-10-100");
    expect(unowned.summary.totalGpus).toBe(4);
    expect(unowned.summary.allocatedGpus).toBe(5);
    expect(unowned.summary.availableGpus).toBe(0); // clamped, not -1
    expect(body.data.summary.availableGpus).toBeGreaterThanOrEqual(0);
  });
});
