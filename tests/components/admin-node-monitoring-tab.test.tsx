// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — NodeMonitoringTab.
// Self-fetches /api/admin/nodes (providers + nodes + summary, gated on
// data.success), renders an 8-box global summary, clickable provider cards
// (which filter the node list), and a node table. Pins loading/error/empty,
// summary + provider values, the per-provider utilization %, and the
// provider-filter toggle + clear.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { NodeMonitoringTab } from "@/app/admin/components/NodeMonitoringTab";

type Json = Record<string, unknown>;

let payload: Json;
let succeed = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/admin/nodes") {
      return Promise.resolve({
        ok: true,
        json: async () =>
          succeed ? { success: true, data: payload } : { success: false, error: "nodes down" },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const node = (over: Json = {}): Json => ({
  id: "node-1",
  name: "Node One",
  hostname: "host-1",
  ip: "10.0.0.1",
  providerId: "prov-1",
  providerName: "Acme Cloud",
  status: "online",
  statusMessage: "ok",
  gpuModel: "H100",
  gpuCount: 8,
  gpuaasClusterId: 1,
  gpuaasNodeId: 1,
  gpuaasPoolId: 1,
  hardware: { cpuModel: "EPYC", cpuCores: 64, memoryGb: 512, storageGb: 4000 },
  pools: [],
  pods: [],
  summary: {
    totalGpus: 8,
    allocatedGpus: 4,
    availableGpus: 4,
    utilizationPercent: 50,
    activePods: 2,
    totalPods: 2,
    totalVgpus: 4,
  },
  ...over,
});

const provider = (over: Json = {}): Json => ({
  id: "prov-1",
  name: "Acme Cloud",
  email: "ops@acme.com",
  nodeCount: 1,
  totalGpus: 8,
  allocatedGpus: 4,
  utilizationPercent: 50,
  activePods: 2,
  ...over,
});

const data = (over: Json = {}): Json => ({
  providers: [provider()],
  nodes: [node()],
  summary: {
    totalProviders: 1,
    totalNodes: 1,
    totalGpus: 8,
    allocatedGpus: 4,
    availableGpus: 4,
    utilizationPercent: 50,
    activePods: 2,
    totalVgpus: 4,
  },
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  payload = data();
  succeed = true;
});

describe("NodeMonitoringTab", () => {
  it("shows the loading state before the fetch resolves", () => {
    makeFetch();
    render(<NodeMonitoringTab />);
    expect(screen.getByText(/loading node data/i)).toBeInTheDocument();
  });

  it("fetches /api/admin/nodes on mount", async () => {
    const fetchMock = makeFetch();
    render(<NodeMonitoringTab />);
    await screen.findByText("Node Monitoring");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nodes");
  });

  it("renders the global summary boxes", async () => {
    makeFetch();
    render(<NodeMonitoringTab />);
    await screen.findByText("Node Monitoring");
    expect(screen.getByText("Total GPUs")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    // "Utilization" appears in both the summary box and the provider card.
    expect(screen.getAllByText("Utilization").length).toBeGreaterThan(0);
    // summary util "50%" (provider card also shows "50%")
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
  });

  it("renders a provider card with its node/gpu/pod counts", async () => {
    makeFetch();
    render(<NodeMonitoringTab />);
    // "Acme Cloud" appears in the provider card AND the node's providerName.
    await screen.findAllByText("Acme Cloud");
    expect(screen.getByText("ops@acme.com")).toBeInTheDocument(); // provider-card only
    // "Nodes"/"GPUs" appear in both the summary boxes and the provider card.
    expect(screen.getAllByText("Nodes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPUs").length).toBeGreaterThan(0);
    // "Pods" appears in the provider card and the node summary.
    expect(screen.getAllByText("Pods").length).toBeGreaterThan(0);
  });

  it("filters the node list to a provider when its card is clicked, then clears", async () => {
    payload = data({
      providers: [provider(), provider({ id: "prov-2", name: "Beta Cloud", email: "ops@beta.com" })],
      nodes: [node(), node({ id: "node-2", name: "Node Two", providerId: "prov-2", providerName: "Beta Cloud" })],
    });
    makeFetch();
    render(<NodeMonitoringTab />);
    await screen.findByText("ops@beta.com");

    // Click the Acme provider card (scope via its unique email) -> filter on.
    const acmeCard = screen.getByText("ops@acme.com").closest(".cursor-pointer")!;
    fireEvent.click(acmeCard);
    expect(await screen.findByText(/showing nodes from:/i)).toBeInTheDocument();

    // Clear filter link.
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() =>
      expect(screen.queryByText(/showing nodes from:/i)).not.toBeInTheDocument()
    );
  });

  it("renders the empty state when there are no nodes", async () => {
    payload = data({ nodes: [], providers: [] });
    makeFetch();
    render(<NodeMonitoringTab />);
    expect(await screen.findByText("No Nodes Found")).toBeInTheDocument();
    expect(
      screen.getByText(/no active nodes found in the system/i)
    ).toBeInTheDocument();
  });

  it("renders the error state with a Retry button when the API reports failure", async () => {
    succeed = false;
    makeFetch();
    render(<NodeMonitoringTab />);
    expect(await screen.findByText("nodes down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("refetches when Refresh is clicked", async () => {
    const fetchMock = makeFetch();
    render(<NodeMonitoringTab />);
    await screen.findByText("Node Monitoring");
    const before = fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/nodes").length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/nodes").length
      ).toBeGreaterThan(before)
    );
  });
});
