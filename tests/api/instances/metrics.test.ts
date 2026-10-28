// Tests for src/app/api/instances/metrics/route.ts (PA-287).
//
// GET returns GPUaaS usage metrics for the team. Auth is getAuthenticatedCustomer
// (returns a NextResponse on failure → handler does `instanceof NextResponse`).
// Two shapes by `type` query param: "metrics" (default) and "graph".
//
// What we pin:
//   * Auth NextResponse passthrough (the 401/403 the helper builds is returned
//     verbatim) — no HAI call.
//   * No team -> 400, no HAI call.
//   * type=metrics: forwards page/limit/date params to getGPUaaSMetrics and
//     shapes the response (items|metrics fallback, totals).
//   * type=graph: forwards timestamps + granularity to getGPUaaSMetricsGraph.
//   * Empty HAI payload -> sane zeroed envelope (no crash).
//   * HAI throw -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockGetGPUaaSMetrics,
  mockGetGPUaaSMetricsGraph,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetGPUaaSMetrics: vi.fn(),
  mockGetGPUaaSMetricsGraph: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  getGPUaaSMetrics: mockGetGPUaaSMetrics,
  getGPUaaSMetricsGraph: mockGetGPUaaSMetricsGraph,
}));

import { GET } from "@/app/api/instances/metrics/route";

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
  return new NextRequest(`http://localhost/api/instances/metrics${query}`, {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authOk());
});

describe("GET /api/instances/metrics — auth", () => {
  it("returns the helper's NextResponse verbatim when auth fails (401/403 passthrough)", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauth);

    const res = await GET(makeRequest());
    expect(res).toBe(unauth);
    expect(res.status).toBe(401);
    expect(mockGetGPUaaSMetrics).not.toHaveBeenCalled();
  });

  it("returns 400 with no team and never calls HAI", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(authOk(null));
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(mockGetGPUaaSMetrics).not.toHaveBeenCalled();
  });
});

describe("GET /api/instances/metrics — type=metrics", () => {
  it("forwards page/limit/date params and shapes the response", async () => {
    mockGetGPUaaSMetrics.mockResolvedValue({
      items: [{ subscription_id: 1, hours_used: 5, cost: 10 }],
      total_hours: 5,
      total_cost: 10,
      page: 2,
      per_page: 25,
      total_items: 1,
      total_pages: 1,
    });

    const res = await GET(
      makeRequest("?page=2&limit=25&start_date=2026-06-01&end_date=2026-06-07"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.type).toBe("metrics");
    expect(body.items).toHaveLength(1);
    expect(body.total_hours).toBe(5);
    expect(body.total_cost).toBe(10);
    expect(mockGetGPUaaSMetrics).toHaveBeenCalledWith("team_1", {
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      page: 2,
      limit: 25,
    });
  });

  it("falls back to the metrics[] key when items is absent", async () => {
    mockGetGPUaaSMetrics.mockResolvedValue({
      metrics: [{ subscription_id: 9 }],
      total_hours: 1,
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.items).toEqual([{ subscription_id: 9 }]);
  });

  it("returns a zeroed envelope for an empty HAI payload (no crash)", async () => {
    mockGetGPUaaSMetrics.mockResolvedValue({});
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total_hours).toBe(0);
    expect(body.total_cost).toBe(0);
    expect(body.total_pages).toBe(1);
  });

  it("returns 500 when getGPUaaSMetrics throws", async () => {
    mockGetGPUaaSMetrics.mockRejectedValue(new Error("HAI 500"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/instances/metrics — type=graph", () => {
  it("forwards explicit timestamps + granularity to the graph call", async () => {
    mockGetGPUaaSMetricsGraph.mockResolvedValue({
      data: [{ timestamp: "t", tflops: 1 }],
      granularity: "daily",
      total_tflops: 1,
      total_hours: 2,
    });

    const res = await GET(
      makeRequest("?type=graph&granularity=daily&start_timestamp=100&end_timestamp=200"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.type).toBe("graph");
    expect(body.granularity).toBe("daily");
    expect(body.total_tflops).toBe(1);
    expect(mockGetGPUaaSMetricsGraph).toHaveBeenCalledWith("team_1", 100, 200, "daily");
    expect(mockGetGPUaaSMetrics).not.toHaveBeenCalled();
  });

  it("defaults the graph window to the last 7 days when timestamps are absent", async () => {
    mockGetGPUaaSMetricsGraph.mockResolvedValue({ data: [] });
    await GET(makeRequest("?type=graph"));
    const [team, start, end, gran] = mockGetGPUaaSMetricsGraph.mock.calls[0];
    expect(team).toBe("team_1");
    expect(gran).toBe("hourly");
    expect(end - start).toBe(7 * 24 * 60 * 60);
  });

  it("returns an empty graph envelope when HAI returns no data (no crash)", async () => {
    mockGetGPUaaSMetricsGraph.mockResolvedValue({});
    const res = await GET(makeRequest("?type=graph"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total_tflops).toBe(0);
  });
});
