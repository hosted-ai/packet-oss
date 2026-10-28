/**
 * Tests for GET /api/admin/gpuaas (src/app/api/admin/gpuaas/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated. Aggregates GPUaaS
 * infrastructure: lists regions + clusters in parallel, fetches pools per
 * cluster (tolerating per-cluster failures), and shapes a regions array with
 * nested cluster/pool info plus a summary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockListRegions,
  mockListClusters,
  mockListPools,
  mockGetPoolUtilization,
  mockIsGPUaaSEnabled,
  mockGetClusterStatusLabel,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockListRegions: vi.fn(),
  mockListClusters: vi.fn(),
  mockListPools: vi.fn(),
  mockGetPoolUtilization: vi.fn(),
  mockIsGPUaaSEnabled: vi.fn(),
  mockGetClusterStatusLabel: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/gpuaas-admin", () => ({
  gpuaasAdmin: {
    listRegions: mockListRegions,
    listClusters: mockListClusters,
    listPools: mockListPools,
    getPoolUtilization: mockGetPoolUtilization,
    isGPUaaSEnabled: mockIsGPUaaSEnabled,
    getClusterStatusLabel: mockGetClusterStatusLabel,
  },
}));

import { GET } from "@/app/api/admin/gpuaas/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/gpuaas", { method: "GET", headers });
}

const REGION = {
  id: 100,
  region_name: "us-east",
  city: "NYC",
  country: "USA",
  country_code: "US",
  address: "1 St",
  zipcode: "10001",
  lat: 40,
  lng: -74,
  accelerator_type: "H100",
  support_rdma: true,
  status: { compute: "enabled", gpuaas: "enabled" },
};

const CLUSTER = {
  id: 5,
  region_id: 100,
  status: "GPUAAS_ACTIVE",
  k8s_api_server_port: 6443,
  prometheus_reverse_tunnel_port: 9090,
};

const POOL = {
  id: 9,
  name: "pool-x",
  description: "desc",
  region_id: 100,
  overcommit_ratio: 1,
  team_name: "team-a",
  total_gpus: 8,
  available_gpus: 5,
  allocated_gpus: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockListRegions.mockResolvedValue([REGION]);
  mockListClusters.mockResolvedValue([CLUSTER]);
  mockListPools.mockResolvedValue([POOL]);
  mockGetPoolUtilization.mockReturnValue(37);
  mockIsGPUaaSEnabled.mockReturnValue(true);
  mockGetClusterStatusLabel.mockReturnValue("Active");
});

describe("GET /api/admin/gpuaas — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockListRegions).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockListRegions).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/gpuaas — aggregation happy path", () => {
  it("returns formatted regions with nested cluster and pools", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockListPools).toHaveBeenCalledWith(5);

    const region = body.data.regions[0];
    expect(region).toMatchObject({
      id: 100,
      name: "us-east",
      city: "NYC",
      countryCode: "US",
      gpuaasEnabled: true,
      computeEnabled: true,
    });
    expect(region.cluster).toMatchObject({
      id: 5,
      status: "GPUAAS_ACTIVE",
      statusLabel: "Active",
      k8sApiPort: 6443,
      prometheusPort: 9090,
    });
    expect(region.cluster.pools[0]).toEqual({
      id: 9,
      name: "pool-x",
      description: "desc",
      regionId: 100,
      overcommitRatio: 1,
      teamName: "team-a",
      totalGpus: 8,
      availableGpus: 5,
      allocatedGpus: 3,
      utilization: 37,
    });
  });

  it("computes the summary counts", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.summary).toEqual({
      totalRegions: 1,
      gpuaasEnabledRegions: 1,
      totalClusters: 1,
      activeClusters: 1,
    });
  });

  it("sets cluster to null for a region with no matching cluster", async () => {
    mockListClusters.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.regions[0].cluster).toBeNull();
    expect(body.data.summary.totalClusters).toBe(0);
  });
});

describe("GET /api/admin/gpuaas — resilience & errors", () => {
  it("falls back to an empty pool list when a cluster's listPools throws", async () => {
    mockListPools.mockRejectedValue(new Error("pool fetch failed"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.regions[0].cluster.pools).toEqual([]);
  });

  it("returns 500 when listRegions throws", async () => {
    mockListRegions.mockRejectedValue(new Error("regions down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("regions down");
  });

  it("returns sane empty data when there are no regions or clusters", async () => {
    mockListRegions.mockResolvedValue([]);
    mockListClusters.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.regions).toEqual([]);
    expect(body.data.summary.totalRegions).toBe(0);
  });
});
