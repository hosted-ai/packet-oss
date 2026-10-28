// Tests for src/app/api/admin/providers/nodes/[id]/gpuaas/route.ts (GET, POST).
//
// PA-287 — admin GPUaaS node-provisioning coverage. This route drives a node
// through the GPUaaS Admin lifecycle (register → SSH keys → initialize →
// join-cluster → scan → assign-pool). It calls the @/lib/gpuaas-admin client
// (mocked here) and persists progress on the local providerNode row.
//
// Scope note: the "validate" and "install-ssh-key" actions shell out via
// child_process.exec to real sshpass/ssh and are intentionally NOT exercised
// here (they belong to an integration tier, not a unit test). Every other
// action plus GET, auth, validation, not-found and error-mapping are covered.
// Auth is the admin-cookie model (verifySessionToken); [id] handlers await
// a params Promise.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockNodeFindUnique,
  mockNodeUpdate,
  mockActivityCreate,
  mockListRegions,
  mockListClusters,
  mockGetNode,
  mockAddNode,
  mockGetClusterByRegion,
  mockGetNodeSSHKeys,
  mockInitializeNode,
  mockJoinNode,
  mockScanGPUs,
  mockScanNodeResources,
  mockGetPool,
  mockIsGPUaaSEnabled,
  mockGetClusterStatusLabel,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockNodeFindUnique: vi.fn(),
  mockNodeUpdate: vi.fn(),
  mockActivityCreate: vi.fn(),
  mockListRegions: vi.fn(),
  mockListClusters: vi.fn(),
  mockGetNode: vi.fn(),
  mockAddNode: vi.fn(),
  mockGetClusterByRegion: vi.fn(),
  mockGetNodeSSHKeys: vi.fn(),
  mockInitializeNode: vi.fn(),
  mockJoinNode: vi.fn(),
  mockScanGPUs: vi.fn(),
  mockScanNodeResources: vi.fn(),
  mockGetPool: vi.fn(),
  mockIsGPUaaSEnabled: vi.fn(),
  mockGetClusterStatusLabel: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    providerNode: {
      findUnique: mockNodeFindUnique,
      update: mockNodeUpdate,
    },
    providerAdminActivity: { create: mockActivityCreate },
  },
}));
vi.mock("@/lib/gpuaas-admin", () => ({
  gpuaasAdmin: {
    listRegions: mockListRegions,
    listClusters: mockListClusters,
    getNode: mockGetNode,
    addNode: mockAddNode,
    getClusterByRegion: mockGetClusterByRegion,
    getNodeSSHKeys: mockGetNodeSSHKeys,
    initializeNode: mockInitializeNode,
    joinNode: mockJoinNode,
    scanGPUs: mockScanGPUs,
    scanNodeResources: mockScanNodeResources,
    getPool: mockGetPool,
    isGPUaaSEnabled: mockIsGPUaaSEnabled,
    getClusterStatusLabel: mockGetClusterStatusLabel,
  },
}));

import { GET, POST } from "@/app/api/admin/providers/nodes/[id]/gpuaas/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";
const NODE_ID = "node-1";

function makeReq(
  method: string,
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(
    `http://localhost/api/admin/providers/nodes/${NODE_ID}/gpuaas`,
    init
  );
}

function ctx(id = NODE_ID) {
  return { params: Promise.resolve({ id }) };
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: NODE_ID,
    hostname: "gpu-host-1",
    ipAddress: "203.0.113.10",
    sshPort: 22,
    sshUsername: "root",
    externalServiceIp: null,
    gpuaasNodeId: null,
    gpuaasRegionId: null,
    gpuaasClusterId: null,
    gpuaasPoolId: null,
    gpuaasInitStatus: null,
    gpuaasSshKeysInstalled: false,
    status: "approved",
    provider: { id: "prov-1", companyName: "Example Provider" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockNodeFindUnique.mockResolvedValue(node());
  mockNodeUpdate.mockResolvedValue({});
  mockActivityCreate.mockResolvedValue({});
  mockListRegions.mockResolvedValue([]);
  mockListClusters.mockResolvedValue([]);
  mockGetNode.mockResolvedValue({
    Id: 99,
    name: "n",
    initialize_state_status_code: 2,
    role: "worker",
  });
  mockAddNode.mockResolvedValue({ Id: 99 });
  mockGetClusterByRegion.mockResolvedValue({ id: 7 });
  mockGetNodeSSHKeys.mockResolvedValue({ public_keys: ["ssh-rsa AAAA..."] });
  mockInitializeNode.mockResolvedValue({});
  mockJoinNode.mockResolvedValue({});
  mockScanGPUs.mockResolvedValue({ gpus: [] });
  mockScanNodeResources.mockResolvedValue({});
  mockGetPool.mockResolvedValue({ name: "default-pool" });
  mockIsGPUaaSEnabled.mockReturnValue(true);
  mockGetClusterStatusLabel.mockReturnValue("Ready");
});

describe("GET gpuaas — auth", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockNodeFindUnique).not.toHaveBeenCalled();
  });

  it("401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(401);
  });
});

describe("GET gpuaas — status, regions & clusters", () => {
  it("404 when the node does not exist", async () => {
    mockNodeFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Node not found");
  });

  it("returns node info plus formatted regions and clusters", async () => {
    mockListRegions.mockResolvedValue([
      { id: 1, region_name: "US East", city: "NYC", country: "US" },
    ]);
    mockListClusters.mockResolvedValue([{ id: 7, region_id: 1, status: 3 }]);
    const res = await GET(makeReq("GET"), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.node.id).toBe(NODE_ID);
    expect(body.data.regions[0]).toMatchObject({ id: 1, name: "US East", gpuaasEnabled: true });
    expect(body.data.clusters[0]).toMatchObject({ id: 7, regionId: 1, statusLabel: "Ready" });
    // No gpuaasNodeId on the local node → no remote status lookup.
    expect(body.data.gpuaasNodeStatus).toBeNull();
    expect(body.data.gpuaasError).toBeNull();
  });

  it("captures a GPUaaS list error into gpuaasError without failing the request", async () => {
    mockListRegions.mockRejectedValue(new Error("gpuaas down"));
    const res = await GET(makeReq("GET"), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.gpuaasError).toBe("gpuaas down");
    expect(body.data.regions).toEqual([]);
  });

  it("includes remote node status when the node is registered with GPUaaS", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    const body = await (await GET(makeReq("GET"), ctx())).json();
    expect(mockGetNode).toHaveBeenCalledWith(99);
    expect(body.data.gpuaasNodeStatus).toMatchObject({
      id: 99,
      initStatus: 2,
      initStatusLabel: "Completed",
    });
  });

  it("reports a not-found remote node gracefully", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockGetNode.mockRejectedValue(new Error("404"));
    const body = await (await GET(makeReq("GET"), ctx())).json();
    expect(body.data.gpuaasNodeStatus).toEqual({ error: "Node not found in GPUaaS" });
  });
});

describe("POST gpuaas — auth & validation", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await POST(makeReq("POST", { body: { action: "initialize" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockNodeFindUnique).not.toHaveBeenCalled();
  });

  it("400 on an unknown action (enum violation)", async () => {
    const res = await POST(makeReq("POST", { body: { action: "nuke" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });

  it("404 when the node does not exist", async () => {
    mockNodeFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq("POST", { body: { action: "mark-ssh-done" } }), ctx());
    expect(res.status).toBe(404);
  });
});

describe("POST gpuaas — register", () => {
  it("400 when regionId is missing", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "register", externalServiceIp: "1.2.3.4" } }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Region ID is required");
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("400 when externalServiceIp is missing", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "register", regionId: 1 } }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("External service IP is required");
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("registers the node, resolves its cluster and persists gpuaas ids", async () => {
    const res = await POST(
      makeReq("POST", {
        body: { action: "register", regionId: 1, externalServiceIp: "1.2.3.4" },
      }),
      ctx()
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 1, node_ip: "203.0.113.10", external_service_ip: "1.2.3.4" })
    );
    expect(mockGetClusterByRegion).toHaveBeenCalledWith(1);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.gpuaasNodeId).toBe(99);
    expect(data.gpuaasClusterId).toBe(7);
    expect(data.status).toBe("provisioning");
    expect(body.data.gpuaasNodeId).toBe(99);
  });
});

describe("POST gpuaas — get-ssh-keys / mark-ssh-done", () => {
  it("400 on get-ssh-keys when the node is not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "get-ssh-keys" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not registered");
    expect(mockGetNodeSSHKeys).not.toHaveBeenCalled();
  });

  it("returns the public keys when the node is registered", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    const res = await POST(makeReq("POST", { body: { action: "get-ssh-keys" } }), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockGetNodeSSHKeys).toHaveBeenCalledWith(99);
    expect(body.data.publicKeys).toEqual(["ssh-rsa AAAA..."]);
  });

  it("mark-ssh-done flips gpuaasSshKeysInstalled when registered", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    const res = await POST(makeReq("POST", { body: { action: "mark-ssh-done" } }), ctx());
    expect(res.status).toBe(200);
    expect(mockNodeUpdate.mock.calls[0][0].data.gpuaasSshKeysInstalled).toBe(true);
  });

  it("400 on mark-ssh-done when not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "mark-ssh-done" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });
});

describe("POST gpuaas — initialize", () => {
  it("400 when the node is not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "initialize" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockInitializeNode).not.toHaveBeenCalled();
  });

  it("400 when SSH keys are not installed", async () => {
    mockNodeFindUnique.mockResolvedValue(
      node({ gpuaasNodeId: 99, gpuaasSshKeysInstalled: false })
    );
    const res = await POST(makeReq("POST", { body: { action: "initialize" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("SSH keys must be installed first");
    expect(mockInitializeNode).not.toHaveBeenCalled();
  });

  it("initializes the node and records in_progress", async () => {
    mockNodeFindUnique.mockResolvedValue(
      node({ gpuaasNodeId: 99, gpuaasSshKeysInstalled: true })
    );
    const res = await POST(makeReq("POST", { body: { action: "initialize" } }), ctx());
    expect(res.status).toBe(200);
    expect(mockInitializeNode).toHaveBeenCalledWith(99);
    expect(mockNodeUpdate.mock.calls[0][0].data.gpuaasInitStatus).toBe("in_progress");
  });
});

describe("POST gpuaas — check-status", () => {
  it("maps the GPUaaS init status code to completed and stores it", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockGetNode.mockResolvedValue({ initialize_state_status_code: 2, role: "worker" });
    const res = await POST(makeReq("POST", { body: { action: "check-status" } }), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.initStatus).toBe("completed");
    expect(body.data.initStatusLabel).toBe("Completed");
    expect(mockNodeUpdate.mock.calls[0][0].data.gpuaasInitStatus).toBe("completed");
  });

  it("maps an error status code to error", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockGetNode.mockResolvedValue({ initialize_state_status_code: -1, role: "worker" });
    const body = await (await POST(makeReq("POST", { body: { action: "check-status" } }), ctx())).json();
    expect(body.data.initStatus).toBe("error");
  });

  it("400 when not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "check-status" } }), ctx());
    expect(res.status).toBe(400);
  });
});

describe("POST gpuaas — join-cluster", () => {
  it("400 when the node lacks a registration or cluster", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99, gpuaasClusterId: null }));
    const res = await POST(makeReq("POST", { body: { action: "join-cluster" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockJoinNode).not.toHaveBeenCalled();
  });

  it("400 when the node is not yet initialized", async () => {
    mockNodeFindUnique.mockResolvedValue(
      node({ gpuaasNodeId: 99, gpuaasClusterId: 7, gpuaasInitStatus: "in_progress" })
    );
    const res = await POST(makeReq("POST", { body: { action: "join-cluster" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("initialized first");
    expect(mockJoinNode).not.toHaveBeenCalled();
  });

  it("joins the node to its cluster when initialized", async () => {
    mockNodeFindUnique.mockResolvedValue(
      node({ gpuaasNodeId: 99, gpuaasClusterId: 7, gpuaasInitStatus: "completed" })
    );
    const res = await POST(makeReq("POST", { body: { action: "join-cluster" } }), ctx());
    expect(res.status).toBe(200);
    expect(mockJoinNode).toHaveBeenCalledWith({ gpuaas_id: 7, gpuaas_node_id: 99 });
  });
});

describe("POST gpuaas — scan-gpus", () => {
  it("400 when not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "scan-gpus" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockScanGPUs).not.toHaveBeenCalled();
  });

  it("stores detected GPU model/count from the scan", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockScanGPUs.mockResolvedValue({ gpus: [{ name: "H100" }, { name: "H100" }] });
    const res = await POST(makeReq("POST", { body: { action: "scan-gpus" } }), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.gpuModel).toBe("H100");
    expect(data.gpuCount).toBe(2);
    expect(body.data.gpus).toHaveLength(2);
  });

  it("does not write GPU fields when the scan returns none", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockScanGPUs.mockResolvedValue({ gpus: [] });
    const res = await POST(makeReq("POST", { body: { action: "scan-gpus" } }), ctx());
    expect(res.status).toBe(200);
    // No GPU updates → nothing to persist for this node row.
    expect(mockNodeUpdate).not.toHaveBeenCalled();
  });
});

describe("POST gpuaas — scan-resources", () => {
  it("400 when not registered", async () => {
    const res = await POST(makeReq("POST", { body: { action: "scan-resources" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockScanNodeResources).not.toHaveBeenCalled();
  });

  it("converts MB→GB and stores detected resources", async () => {
    vi.useFakeTimers();
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockGetNode.mockResolvedValue({
      total_memory_in_mb: 131072, // 128 GB
      total_disk_in_mb: 1048576, // 1024 GB
      cores: 64,
      cpu_model: "AMD EPYC",
    });
    const resP = POST(makeReq("POST", { body: { action: "scan-resources" } }), ctx());
    await vi.advanceTimersByTimeAsync(3000);
    const res = await resP;
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.ramGb).toBe(128);
    expect(data.storageGb).toBe(1024);
    expect(data.cpuCores).toBe(64);
    expect(data.cpuModel).toBe("AMD EPYC");
  });
});

describe("POST gpuaas — assign-pool", () => {
  it("400 when poolId is missing", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    const res = await POST(makeReq("POST", { body: { action: "assign-pool" } }), ctx());
    expect(res.status).toBe(400);
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it("verifies the pool, assigns it and marks the node active", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    const res = await POST(
      makeReq("POST", { body: { action: "assign-pool", poolId: 5 } }),
      ctx()
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockGetPool).toHaveBeenCalledWith(5);
    const data = mockNodeUpdate.mock.calls[0][0].data;
    expect(data.gpuaasPoolId).toBe(5);
    expect(data.status).toBe("active");
    expect(body.data.poolName).toBe("default-pool");
  });
});

describe("POST gpuaas — audit & error handling", () => {
  it("writes an admin-activity row for a successful action", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    await POST(makeReq("POST", { body: { action: "mark-ssh-done" } }), ctx());
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "gpuaas_mark-ssh-done", nodeId: NODE_ID }),
      })
    );
  });

  it("maps a GPUaaS client failure to 500 with the error message", async () => {
    mockNodeFindUnique.mockResolvedValue(node({ gpuaasNodeId: 99 }));
    mockInitializeNode.mockRejectedValue(new Error("gpuaas 503"));
    mockNodeFindUnique.mockResolvedValue(
      node({ gpuaasNodeId: 99, gpuaasSshKeysInstalled: true })
    );
    const res = await POST(makeReq("POST", { body: { action: "initialize" } }), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("gpuaas 503");
  });
});
