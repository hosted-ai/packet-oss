// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — PoolOverviewTab.
// Self-fetches /api/admin/pools ({ success, data, maintenancePoolIds }), renders
// 4 summary cards + an overall utilization bar + clusters each containing pools.
// Pins loading/error/empty-clusters, the summary values, the cluster-utilization
// computation (allocated/total, guarded against zero), the maintenance badge
// (driven by maintenancePoolIds), pool expansion, and refresh.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PoolOverviewTab } from "@/app/admin/components/PoolOverviewTab";

type Json = Record<string, unknown>;

let payload: Json;
let maintenancePoolIds: number[];
let succeed = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/admin/pools") {
      return Promise.resolve({
        ok: true,
        json: async () =>
          succeed
            ? { success: true, data: payload, maintenancePoolIds }
            : { success: false, error: "pools down" },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const pool = (over: Json = {}): Json => ({
  id: 101,
  clusterId: 1,
  name: "Pool Alpha",
  overcommitRatio: 2,
  securityMode: "high",
  totalGpus: 8,
  allocatedGpus: 4,
  utilizationPercent: 50,
  nodes: [],
  pods: [],
  gpus: [],
  ...over,
});

const cluster = (over: Json = {}): Json => ({
  id: 1,
  regionName: "us-east",
  status: "GPUAAS_ACTIVE",
  poolCount: 1,
  nodeCount: 2,
  totalGpus: 8,
  allocatedGpus: 4,
  ...over,
});

const data = (over: Json = {}): Json => ({
  clusters: [cluster()],
  pools: [pool()],
  summary: {
    totalPools: 1,
    allocatedGpus: 4,
    totalGpus: 8,
    totalNodes: 2,
    activePods: 1,
    utilizationPercent: 50,
  },
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  payload = data();
  maintenancePoolIds = [];
  succeed = true;
});

describe("PoolOverviewTab", () => {
  it("shows the loading state before the fetch resolves", () => {
    makeFetch();
    render(<PoolOverviewTab />);
    expect(screen.getByText(/loading pool data/i)).toBeInTheDocument();
  });

  it("fetches /api/admin/pools on mount", async () => {
    const fetchMock = makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Pools by Cluster");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pools");
  });

  it("renders the summary cards", async () => {
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Total Pools");
    expect(screen.getByText("GPUs Allocated")).toBeInTheDocument();
    expect(screen.getByText("Total Nodes")).toBeInTheDocument();
    expect(screen.getByText("Active Pods")).toBeInTheDocument();
  });

  it("renders a cluster header with its utilization", async () => {
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("us-east");
    expect(screen.getByText("Cluster #1 • 1 pools • 2 nodes")).toBeInTheDocument();
    expect(screen.getByText("4/8 GPUs")).toBeInTheDocument();
    // 4/8 -> 50% utilized
    expect(screen.getByText("50% utilized")).toBeInTheDocument();
    // status badge text strips the GPUAAS_ prefix
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("guards cluster utilization against zero total GPUs (0%, not NaN)", async () => {
    payload = data({
      clusters: [cluster({ totalGpus: 0, allocatedGpus: 0 })],
    });
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("us-east");
    expect(screen.getByText("0% utilized")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("renders a pool row with its overcommit/security subtitle", async () => {
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Pool Alpha");
    expect(
      screen.getByText("Pool #101 • Overcommit: 2x • Security: high")
    ).toBeInTheDocument();
  });

  it("renders the Maintenance badge for pools in maintenancePoolIds", async () => {
    maintenancePoolIds = [101];
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Pool Alpha");
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
  });

  it("does not render a Maintenance badge when the pool is not flagged", async () => {
    makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Pool Alpha");
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
  });

  it("expands a pool row when clicked to reveal its section toggles", async () => {
    payload = data({ pools: [pool({ pods: [], nodes: [], gpus: [] })] });
    makeFetch();
    render(<PoolOverviewTab />);
    const poolRow = await screen.findByText("Pool Alpha");
    fireEvent.click(poolRow.closest(".cursor-pointer")!);
    // After expansion the GPUs/Nodes/Pods section toggle buttons appear.
    expect(
      await screen.findByRole("button", { name: /GPUs \(0\)/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pods \(0\)/ })).toBeInTheDocument();
  });

  it("renders the empty-clusters state", async () => {
    payload = data({ clusters: [], pools: [] });
    makeFetch();
    render(<PoolOverviewTab />);
    expect(await screen.findByText("No Active Clusters")).toBeInTheDocument();
    expect(
      screen.getByText(/no gpuaas clusters are currently active/i)
    ).toBeInTheDocument();
  });

  it("renders the error state with a Retry button", async () => {
    succeed = false;
    makeFetch();
    render(<PoolOverviewTab />);
    expect(await screen.findByText(/error: pools down/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("refetches when Refresh is clicked", async () => {
    const fetchMock = makeFetch();
    render(<PoolOverviewTab />);
    await screen.findByText("Pools by Cluster");
    const before = fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/pools").length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/pools").length
      ).toBeGreaterThan(before)
    );
  });
});
