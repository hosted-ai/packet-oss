// Tests for src/app/api/instances/gpu-hardware-metrics/route.ts (PA-287).
//
// GET aggregates live GPU hardware metrics across the team's running pods.
// Auth is getAuthenticatedCustomer (NextResponse passthrough on failure).
// Two modes:
//   * DB MODE (GPU_METRICS_SOURCE=db): reads prisma.gpuHardwareMetrics for the
//     running subscriptions and shapes pods[] + aggregated totals. No SSH.
//   * SSH MODE (default): joins getPoolSubscriptions + getConnectionInfo and
//     shells out per pod via sshpass.
//
// What we pin:
//   * Auth NextResponse passthrough -> no HAI/DB call.
//   * No team -> 400.
//   * DB MODE: shapes pods/totals from the latest metric rows; pods with no
//     recent row get a gpu:null "No recent metrics data" entry (no crash);
//     no running subs -> empty pods, zeroed totals.
//   * SSH MODE: a running sub WITHOUT ssh_info yields a gpu:null
//     "SSH credentials not available" pod entry (returns before any spawn);
//     a non-running sub yields "Pod not running"; no running subs -> empty.
//   * Cache-Control no-store header is set.
//   * Top-level throw -> 500.
//
// We exercise the no-spawn SSH branches only; the live sshpass path needs a
// real subprocess. DB mode covers the metric-shaping happy path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockGetConnectionInfo,
  mockGetPoolSubscriptions,
  mockHwFindMany,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockHwFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  getConnectionInfo: mockGetConnectionInfo,
  getPoolSubscriptions: mockGetPoolSubscriptions,
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { gpuHardwareMetrics: { findMany: mockHwFindMany } },
}));

import { GET } from "@/app/api/instances/gpu-hardware-metrics/route";

function authOk(teamId: string | null = "team_1") {
  return {
    payload: { customerId: "cus_op", email: "a@example.com" },
    teamId,
    allTeamIds: teamId ? [teamId] : [],
    accountId: "cus_op",
  };
}

function makeRequest() {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new NextRequest("http://localhost/api/instances/gpu-hardware-metrics", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authOk());
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockGetConnectionInfo.mockResolvedValue([]);
  mockHwFindMany.mockResolvedValue([]);
  delete process.env.GPU_METRICS_SOURCE;
});

afterEach(() => {
  delete process.env.GPU_METRICS_SOURCE;
});

describe("GET /api/instances/gpu-hardware-metrics — auth", () => {
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

describe("GET /api/instances/gpu-hardware-metrics — DB mode", () => {
  beforeEach(() => {
    process.env.GPU_METRICS_SOURCE = "db";
  });

  it("shapes pods + aggregated totals from the latest metric rows", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 1, status: "running", pool_name: "Pool A", per_pod_info: { ram_mb: 8192 }, pods: [{ pod_name: "pod-1", pod_status: "running" }] },
    ]);
    mockHwFindMany.mockResolvedValue([
      {
        subscriptionId: "1",
        gpuUtilization: 70,
        memoryUsedMb: 4000,
        memoryTotalMb: 8000,
        memoryPercent: 50,
        temperature: 65,
        powerDraw: 150,
        powerLimit: 250,
        fanSpeed: 45,
        cpuPercent: 30,
        systemMemUsedMb: 2048,
        systemMemTotalMb: 16000,
        timestamp: new Date(),
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].subscriptionId).toBe("1");
    expect(body.pods[0].gpu.utilization).toBe(70);
    expect(body.pods[0].system.cpuPercent).toBe(30);
    expect(body.totals.avgUtilization).toBe(70);
    expect(body.totals.podsWithMetrics).toBe(1);
    expect(body.totals.activePods).toBe(1);
    expect(body.totals.maxTemperature).toBe(65);
  });

  it("emits a gpu:null 'No recent metrics data' entry for a sub with no row (no crash)", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 2, status: "running", pool_name: "Pool B", pods: [{ pod_name: "pod-2", pod_status: "running" }] },
    ]);
    mockHwFindMany.mockResolvedValue([]); // no metrics for sub 2

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].gpu).toBeNull();
    expect(body.pods[0].error).toBe("No recent metrics data");
  });

  it("returns empty pods + zeroed totals when no subscriptions are running", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 3, status: "terminated", pods: [] },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods).toEqual([]);
    expect(body.totals.podsWithMetrics).toBe(0);
    expect(body.totals.avgUtilization).toBe(0);
  });

  it("sets the no-store Cache-Control header", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("GET /api/instances/gpu-hardware-metrics — SSH mode no-spawn branches", () => {
  it("emits an 'SSH credentials not available' entry for a running pod without ssh_info", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 1, status: "running", pool_name: "Pool A", pods: [{ pod_name: "pod-1", pod_status: "running" }] },
    ]);
    mockGetConnectionInfo.mockResolvedValue([]); // no conn -> no ssh_info

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].gpu).toBeNull();
    expect(body.pods[0].error).toBe("SSH credentials not available");
  });

  it("emits a 'Pod not running' entry for a non-running pod that has ssh_info", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 1, status: "running", pool_name: "Pool A", pods: [{ pod_name: "pod-1", pod_status: "stopped" }] },
    ]);
    mockGetConnectionInfo.mockResolvedValue([
      {
        id: 1,
        pods: [
          {
            pod_name: "pod-1",
            pod_status: "stopped",
            ssh_info: { cmd: "ssh -p 22 root@10.0.0.1", pass: "secret" },
          },
        ],
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].error).toBe("Pod not running");
  });

  it("returns empty pods when no subscriptions are running (SSH mode)", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: 9, status: "unsubscribed", pods: [] },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.pods).toEqual([]);
    expect(body.timestamp).toBeTypeOf("string");
  });

  it("returns 500 when getAuthenticatedCustomer throws", async () => {
    mockGetAuthenticatedCustomer.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
