// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — ProvidersTab.
// On mount it loads four endpoints in parallel (providers / nodes / gpu-types /
// pricing-tiers), then renders a 3-way sub-tab nav (with live counts) over the
// inline ProvidersSubTab table. Row actions PUT /api/admin/providers/{id}
// (approve -> status:"active"; reject/suspend prompt a reason). Pins loading,
// the tab counts, the provider row + status/type badges, the empty table, the
// approve PUT payload, and the reject-reason prompt path.
//
// The extracted ./providers children (NodesSubTab/GpuTypesSubTab/
// ProviderDetailsModal) are stubbed — they are out of this batch's scope.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/admin/components/providers", () => ({
  NodesSubTab: () => <div data-testid="nodes-subtab" />,
  GpuTypesSubTab: () => <div data-testid="gpu-types-subtab" />,
  ProviderDetailsModal: () => <div data-testid="provider-details-modal" />,
}));

import { ProvidersTab } from "@/app/admin/components/ProvidersTab";

type Json = Record<string, unknown>;

let providers: Json[];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/providers" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ data: { providers } }) });
    }
    if (url.startsWith("/api/admin/providers/nodes")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { nodes: [] } }) });
    }
    if (url === "/api/admin/providers/gpu-types") {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    if (url === "/api/admin/providers/pricing-tiers") {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    // PUT provider action
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const provider = (over: Json = {}): Json => ({
  id: "prov-1",
  companyName: "Acme GPU Co",
  email: "ops@acme.com",
  contactName: "Ops Lead",
  applicationType: "gpu_provider",
  status: "pending",
  activeNodes: 2,
  totalNodes: 3,
  totalGpus: 16,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  providers = [];
});

describe("ProvidersTab", () => {
  it("shows the loading spinner before the initial loads resolve", () => {
    makeFetch();
    const { container } = render(<ProvidersTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("loads all four provider endpoints on mount", async () => {
    const fetchMock = makeFetch();
    render(<ProvidersTab />);
    await screen.findByRole("button", { name: /providers \(/i });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/api/admin/providers");
    expect(urls.some((u) => u.startsWith("/api/admin/providers/nodes"))).toBe(true);
    expect(urls).toContain("/api/admin/providers/gpu-types");
    expect(urls).toContain("/api/admin/providers/pricing-tiers");
  });

  it("renders the sub-tab nav with live counts", async () => {
    providers = [provider()];
    makeFetch();
    render(<ProvidersTab />);
    expect(
      await screen.findByRole("button", { name: /providers \(1\)/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nodes \(0\)/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /gpu types \(0\)/i })
    ).toBeInTheDocument();
  });

  it("renders the empty providers table", async () => {
    makeFetch();
    render(<ProvidersTab />);
    expect(await screen.findByText("No providers yet")).toBeInTheDocument();
  });

  it("renders a provider row with company, status and type badges", async () => {
    providers = [provider()];
    makeFetch();
    render(<ProvidersTab />);
    await screen.findByText("Acme GPU Co");
    expect(screen.getByText("ops@acme.com")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("GPU Provider")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument(); // active/total nodes
  });

  it("renders the White Label badge for white_label providers", async () => {
    providers = [provider({ applicationType: "white_label" })];
    makeFetch();
    render(<ProvidersTab />);
    expect(await screen.findByText("White Label")).toBeInTheDocument();
  });

  it("shows Approve/Reject for a pending provider and PUTs status active on Approve", async () => {
    providers = [provider({ status: "pending" })];
    const fetchMock = makeFetch();
    render(<ProvidersTab />);
    await screen.findByText("Acme GPU Co");
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/providers/prov-1" && c[1]?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).status).toBe("active");
    });
  });

  it("prompts for a reason and PUTs status rejected on Reject", async () => {
    providers = [provider({ status: "pending" })];
    const fetchMock = makeFetch();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("incomplete docs");
    render(<ProvidersTab />);
    await screen.findByText("Acme GPU Co");
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(promptSpy).toHaveBeenCalled();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/providers/prov-1" && c[1]?.method === "PUT" &&
          JSON.parse((c[1]!.body as string)).status === "rejected"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).reason).toBe("incomplete docs");
    });
    promptSpy.mockRestore();
  });

  it("does not PUT when the rejection prompt is cancelled", async () => {
    providers = [provider({ status: "pending" })];
    const fetchMock = makeFetch();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<ProvidersTab />);
    await screen.findByText("Acme GPU Co");
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    // give any (incorrect) async PUT a chance to fire
    await new Promise((r) => setTimeout(r, 0));
    expect(
      fetchMock.mock.calls.some(
        (c) => c[0] === "/api/admin/providers/prov-1" && c[1]?.method === "PUT"
      )
    ).toBe(false);
    promptSpy.mockRestore();
  });

  it("shows Login As / Suspend for an active provider", async () => {
    providers = [provider({ status: "active" })];
    makeFetch();
    render(<ProvidersTab />);
    await screen.findByText("Acme GPU Co");
    expect(screen.getByRole("button", { name: /login as/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /suspend/i })).toBeInTheDocument();
  });

  it("switches to the Nodes sub-tab when clicked", async () => {
    makeFetch();
    render(<ProvidersTab />);
    fireEvent.click(await screen.findByRole("button", { name: /nodes \(/i }));
    expect(await screen.findByTestId("nodes-subtab")).toBeInTheDocument();
  });

  it("switches to the GPU Types sub-tab when clicked", async () => {
    makeFetch();
    render(<ProvidersTab />);
    fireEvent.click(await screen.findByRole("button", { name: /gpu types \(/i }));
    expect(await screen.findByTestId("gpu-types-subtab")).toBeInTheDocument();
  });
});
