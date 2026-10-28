// Tests for src/app/api/instances/pod-metrics/route.ts (PA-287).
//
// GET builds per-pod metrics for the team: it reads a 5-minute prisma cache,
// and on a miss fans out to getPoolSubscriptions / getGPUaaSMetrics /
// getConnectionInfo, joins them with subscription-lineage, then shapes a
// pods[] + totals envelope and fire-and-forgets a cache/history write.
//
// Auth is getAuthenticatedCustomer (NextResponse passthrough on failure).
//
// What we pin:
//   * Auth NextResponse passthrough -> no HAI/DB call.
//   * No team -> 400.
//   * Cache hit: returns cached payload with cached:true, no HAI fan-out.
//   * Cache miss: fans out to HAI, shapes pods + totals, marks cached:false.
//   * subscriptionId filter restricts to the lineage chain.
//   * Empty subscriptions -> empty pods, zeroed totals (no crash).
//   * Top-level throw -> 500.
//
// GOTCHA: every fire-and-forget side effect (the HAI calls all use `.catch()`,
// and storeMetrics is un-awaited) must return a real promise — bare vi.fn()
// returning undefined would throw "Cannot read properties of undefined
// (reading 'catch')". All HAI/prisma mocks below mockResolvedValue.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockGetConnectionInfo,
  mockGetGPUaaSMetrics,
  mockGetGPUaaSMetricsGraph,
  mockGetPoolSubscriptions,
  mockGetSubscriptionLineageChain,
  mockGetRootSubscriptionId,
  mockCacheFindUnique,
  mockCacheUpsert,
  mockHistoryCreateMany,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockGetGPUaaSMetrics: vi.fn(),
  mockGetGPUaaSMetricsGraph: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockGetSubscriptionLineageChain: vi.fn(),
  mockGetRootSubscriptionId: vi.fn(),
  mockCacheFindUnique: vi.fn(),
  mockCacheUpsert: vi.fn(),
  mockHistoryCreateMany: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  getConnectionInfo: mockGetConnectionInfo,
  getGPUaaSMetrics: mockGetGPUaaSMetrics,
  getGPUaaSMetricsGraph: mockGetGPUaaSMetricsGraph,
  getPoolSubscriptions: mockGetPoolSubscriptions,
}));
vi.mock("@/lib/subscription-lineage", () => ({
  getSubscriptionLineageChain: mockGetSubscriptionLineageChain,
  getRootSubscriptionId: mockGetRootSubscriptionId,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    metricsCache: {
      findUnique: mockCacheFindUnique,
      upsert: mockCacheUpsert,
    },
    podMetricsHistory: { createMany: mockHistoryCreateMany },
  },
}));

import { GET } from "@/app/api/instances/pod-metrics/route";

function authOk(teamId: string | null = "team_1") {
  return {
    payload: { customerId: "cus_op", email: "a@example.com" },
    teamId,
    allTeamIds: teamId ? [teamId] : [],
    accountId: "cus_op",
  };
}

function makeRequest(query = "") {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new NextRequest(`http://localhost/api/instances/pod-metrics${query}`, {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authOk());
  // Default HAI fan-out: all resolve so .catch() never fires unexpectedly.
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGetGPUaaSMetrics.mockResolvedValue({ items: [], total_hours: 0, total_cost: 0 });
  mockGetConnectionInfo.mockResolvedValue([]);
  mockGetGPUaaSMetricsGraph.mockResolvedValue({ data: [], granularity: "hourly" });
  mockGetSubscriptionLineageChain.mockResolvedValue([]);
  mockGetRootSubscriptionId.mockImplementation(async (id: string) => id);
  // Cache miss by default; both writes resolve (fire-and-forget).
  mockCacheFindUnique.mockResolvedValue(null);
  mockCacheUpsert.mockResolvedValue({});
  mockHistoryCreateMany.mockResolvedValue({});
});

describe("GET /api/instances/pod-metrics — auth", () => {
  it("returns the helper's NextResponse verbatim when auth fails", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauth);

    const res = await GET(makeRequest());
    expect(res).toBe(unauth);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 400 with no team and never calls HAI", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(authOk(null));
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });
});

describe("GET /api/instances/pod-metrics — cache", () => {
  it("serves a fresh cache entry with cached:true and skips the HAI fan-out", async () => {
    const cachedPayload = {
      pods: [{ subscriptionId: "1", podName: "p1" }],
      totals: { totalHours: 3, totalCost: 6, totalTflops: 0, totalVramGb: 0, activePods: 1 },
      graph: null,
    };
    mockCacheFindUnique.mockResolvedValue({
      cacheData: JSON.stringify(cachedPayload),
      fetchedAt: new Date(), // fresh
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.pods).toHaveLength(1);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("ignores a stale cache entry and refetches (cached:false)", async () => {
    mockCacheFindUnique.mockResolvedValue({
      cacheData: JSON.stringify({ pods: [], totals: {}, graph: null }),
      fetchedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min old > 5 min TTL
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(mockGetPoolSubscriptions).toHaveBeenCalledWith("team_1");
  });

  it("force_refresh=true bypasses the cache", async () => {
    mockCacheFindUnique.mockResolvedValue({
      cacheData: JSON.stringify({ pods: [], totals: {}, graph: null }),
      fetchedAt: new Date(),
    });
    const res = await GET(makeRequest("?force_refresh=true"));
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(mockGetPoolSubscriptions).toHaveBeenCalled();
  });
});

describe("GET /api/instances/pod-metrics — shaping", () => {
  it("shapes pods + totals from the HAI fan-out on a cache miss", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: 1,
        status: "running",
        pool_name: "Pool A",
        region: { region_name: "us-east" },
        per_pod_info: { vgpu_count: 2, image_name: "ubuntu", vcpu_count: 4, ram_mb: 8192 },
        pods: [{ pod_name: "pod-1", pod_status: "running", gpu_count: 2 }],
        metrics: { tflops_usage: 100, vram_usage: 1048576 },
      },
    ]);
    mockGetGPUaaSMetrics.mockResolvedValue({
      items: [{ subscription_id: 1, hours_used: 4, cost: 8 }],
      total_hours: 4,
      total_cost: 8,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cached).toBe(false);
    expect(body.pods).toHaveLength(1);
    const pod = body.pods[0];
    expect(pod.subscriptionId).toBe("1");
    expect(pod.podName).toBe("pod-1");
    expect(pod.poolName).toBe("Pool A");
    expect(pod.gpuCount).toBe(2);
    expect(pod.hoursUsed).toBe(4);
    expect(pod.estimatedCost).toBe(8);
    expect(pod.tflopsUsage).toBe(100);
    expect(body.totals.activePods).toBe(1);
    expect(body.totals.totalTflops).toBe(100);
    expect(body.totals.totalHours).toBe(4);
  });

  it("restricts to the lineage chain when subscriptionId is provided", async () => {
    mockGetSubscriptionLineageChain.mockResolvedValue(["1"]);
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 1, status: "running", pods: [{ pod_name: "keep" }] },
      { id: 2, status: "running", pods: [{ pod_name: "drop" }] },
    ]);

    const res = await GET(makeRequest("?subscription_id=1"));
    const body = await res.json();
    expect(mockGetSubscriptionLineageChain).toHaveBeenCalledWith("1");
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].subscriptionId).toBe("1");
  });

  it("returns empty pods + zeroed totals when there are no subscriptions (no crash)", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toEqual([]);
    expect(body.totals.activePods).toBe(0);
    expect(body.totals.totalTflops).toBe(0);
  });

  it("returns 500 when getAuthenticatedCustomer itself throws", async () => {
    mockGetAuthenticatedCustomer.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
