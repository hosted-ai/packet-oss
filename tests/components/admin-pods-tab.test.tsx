// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — PodsTab.
// Self-fetches /api/admin/pods (pods + summary), renders 8 summary cards + a
// sortable/filterable pod table, opens the (mocked) PodDetailModal on row click,
// POSTs /api/admin/pods/metrics for "Refresh Metrics" (PA-187: HAI telemetry,
// keyed by subscriptionId+teamId, no SSH), and toggles the (mocked) HistoryChart.
// Pins loading/error/empty, summary values, the avg-TFLOPs "-" guard, the metrics
// POST payload, and the owner filter.
//
// PodDetailModal + HistoryChart are stubbed so we exercise only PodsTab's own
// branches (both are tested elsewhere / are heavy SVG children).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/admin/components/PodDetailModal", () => ({
  PodDetailModal: ({ isOpen, pod }: { isOpen: boolean; pod: { subscriptionId: string } }) =>
    isOpen ? <div data-testid="pod-detail-modal">{pod.subscriptionId}</div> : null,
}));
vi.mock("@/app/admin/components/pods/HistoryChart", () => ({
  HistoryChart: () => <div data-testid="history-chart" />,
}));

import { PodsTab } from "@/app/admin/components/PodsTab";

type Json = Record<string, unknown>;

let pods: Json[];
let summary: Json | null;
let podsOk = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/pods" && method === "GET") {
      return Promise.resolve({
        ok: podsOk,
        json: async () =>
          podsOk ? { pods, summary } : { error: "pods exploded" },
      });
    }
    if (url === "/api/admin/pods/metrics") {
      return Promise.resolve({ ok: true, json: async () => ({ metrics: [] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ history: [] }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseSummary = (over: Json = {}): Json => ({
  totalPods: 5,
  activePods: 3,
  totalVGPUs: 12,
  ownedPods: 4,
  unownedPods: 1,
  deadPods: 0,
  unbilledPods: 0,
  ...over,
});

const pod = (over: Json = {}): Json => ({
  subscriptionId: "sub-aaa111",
  teamId: "team-1",
  poolId: 1,
  poolName: "pool-x",
  status: "active",
  isDead: false,
  vgpuCount: 2,
  podName: "worker-a",
  owner: { customerId: "cus_1", email: "owner@example.com", name: "Owner One" },
  ssh: { host: "10.0.0.1", port: 22, username: "root", password: "pw" },
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  pods = [];
  summary = baseSummary();
  podsOk = true;
});

describe("PodsTab", () => {
  it("shows the loading state before the fetch resolves", () => {
    makeFetch();
    render(<PodsTab />);
    expect(screen.getByText(/loading pods/i)).toBeInTheDocument();
  });

  it("fetches /api/admin/pods on mount", async () => {
    const fetchMock = makeFetch();
    render(<PodsTab />);
    await screen.findByText("Total Pods");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/pods");
  });

  it("renders the summary cards from the API", async () => {
    makeFetch();
    render(<PodsTab />);
    await screen.findByText("Total Pods");
    expect(screen.getByText("5")).toBeInTheDocument(); // totalPods
    expect(screen.getByText("12")).toBeInTheDocument(); // totalVGPUs
    // "With Owner" is both a summary-card label and an Owner-filter <option>.
    expect(screen.getAllByText("With Owner").length).toBeGreaterThan(0);
    expect(screen.getByText("Dead Pods")).toBeInTheDocument();
  });

  it("shows a dash for Avg TFLOPs when no pod has metrics", async () => {
    pods = [pod()];
    makeFetch();
    render(<PodsTab />);
    await screen.findByText("Avg TFLOPs");
    // avgTflops === null (metrics endpoint returns none) -> "-"
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("renders the empty table state when there are no pods", async () => {
    makeFetch();
    render(<PodsTab />);
    expect(
      await screen.findByText(/no pods found matching your filters/i)
    ).toBeInTheDocument();
  });

  it("renders a pod row with name, pool and id", async () => {
    pods = [pod()];
    makeFetch();
    render(<PodsTab />);
    await screen.findByText("worker-a");
    expect(screen.getByText("pool-x")).toBeInTheDocument();
    expect(screen.getByText("ID: sub-aaa111")).toBeInTheDocument();
  });

  it("reports the showing/total count", async () => {
    pods = [pod()];
    makeFetch();
    render(<PodsTab />);
    expect(await screen.findByText(/showing 1 of 1 pods/i)).toBeInTheDocument();
  });

  it("opens the pod detail modal when a row is clicked", async () => {
    pods = [pod()];
    makeFetch();
    render(<PodsTab />);
    fireEvent.click(await screen.findByText("worker-a"));
    expect(await screen.findByTestId("pod-detail-modal")).toBeInTheDocument();
  });

  it("filters to unowned pods via the Owner dropdown", async () => {
    pods = [
      pod({ subscriptionId: "owned", podName: "owned-pod", owner: { customerId: "c", email: "e", name: "n" } }),
      pod({ subscriptionId: "orphan", podName: "orphan-pod", owner: undefined }),
    ];
    makeFetch();
    render(<PodsTab />);
    await screen.findByText("owned-pod");
    // The Owner select is the one that contains the "With Owner" option.
    const ownerSelect = screen
      .getByRole("option", { name: "With Owner" })
      .closest("select")!;
    fireEvent.change(ownerSelect, { target: { value: "unowned" } });
    await waitFor(() => {
      expect(screen.queryByText("owned-pod")).not.toBeInTheDocument();
      expect(screen.getByText("orphan-pod")).toBeInTheDocument();
    });
  });

  it("POSTs subscriptionId+teamId to /api/admin/pods/metrics when Refresh Metrics is clicked", async () => {
    pods = [pod()]; // active + teamId -> eligible for HAI telemetry
    const fetchMock = makeFetch();
    render(<PodsTab />);
    await screen.findByText("worker-a");
    // The tab auto-fetches metrics on mount; clear so we assert the click's POST.
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /refresh metrics/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pods/metrics" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect((body.pods as Json[])[0]).toMatchObject({
        subscriptionId: "sub-aaa111",
        teamId: "team-1",
      });
    });
  });

  it("toggles the history chart", async () => {
    makeFetch();
    render(<PodsTab />);
    await screen.findByText("Total Pods");
    expect(screen.queryByTestId("history-chart")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(await screen.findByTestId("history-chart")).toBeInTheDocument();
  });

  it("renders the error state with a Retry button when the pods fetch fails", async () => {
    podsOk = false;
    makeFetch();
    render(<PodsTab />);
    expect(await screen.findByText("Error loading pods")).toBeInTheDocument();
    expect(screen.getByText("pods exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
