// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. GPUCardApps fetches the available-apps catalogue
// (/api/apps) and installed-app status (/api/apps/status) on mount, then lets
// the user install an app (POST /api/apps/install) or dismiss a failed one
// (DELETE /api/apps). It shows a loading state first, an "Installed Apps"
// section, and an install grid (capped at 4 with a "Show all" toggle).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GPUCardApps } from "@/app/dashboard/components/PoolSubscriptionCard/GPUCardApps";

function makeApp(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    name: `App ${slug}`,
    description: "desc",
    category: "development",
    minVramGb: 8,
    recommendedVramGb: 16,
    estimatedInstallMin: 5,
    icon: "🛠️",
    tags: [],
    installed: false,
    installStatus: null,
    installedPort: null,
    externalUrl: null,
    ...extra,
  };
}

/** Mock fetch routing by URL + method so the two mount fetches resolve. */
function routeFetch(routes: {
  apps?: unknown[];
  status?: unknown[];
  onInstall?: () => { ok: boolean; body: unknown };
  onDelete?: () => { ok: boolean; body: unknown };
}) {
  const fetchMock = vi.fn((url: string, opts?: { method?: string }) => {
    const method = opts?.method || "GET";
    if (url.startsWith("/api/apps/status")) {
      return Promise.resolve({ ok: true, json: async () => ({ apps: routes.status || [] }) });
    }
    if (url.startsWith("/api/apps/install")) {
      const r = routes.onInstall?.() || { ok: true, body: {} };
      return Promise.resolve({ ok: r.ok, json: async () => r.body });
    }
    if (url.startsWith("/api/apps") && method === "DELETE") {
      const r = routes.onDelete?.() || { ok: true, body: {} };
      return Promise.resolve({ ok: r.ok, json: async () => r.body });
    }
    if (url.startsWith("/api/apps")) {
      return Promise.resolve({ ok: true, json: async () => ({ apps: routes.apps || [] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("GPUCardApps (PA-288)", () => {
  it("shows a loading state before the catalogue resolves", () => {
    routeFetch({ apps: [], status: [] });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    expect(screen.getByText(/loading apps/i)).toBeInTheDocument();
  });

  it("renders available apps from the catalogue", async () => {
    routeFetch({ apps: [makeApp("vllm"), makeApp("jupyter")], status: [] });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    expect(await screen.findByText("App vllm")).toBeInTheDocument();
    expect(screen.getByText("App jupyter")).toBeInTheDocument();
  });

  it("renders the empty state when there are no apps at all", async () => {
    routeFetch({ apps: [], status: [] });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    expect(await screen.findByText(/no apps available yet/i)).toBeInTheDocument();
  });

  it("shows installed apps in their own section and hides them from the grid", async () => {
    routeFetch({
      apps: [makeApp("vllm"), makeApp("jupyter")],
      status: [
        {
          id: "i1",
          appSlug: "vllm",
          appName: "vLLM",
          appIcon: "🤖",
          status: "running",
          installProgress: 100,
          port: 8000,
          externalUrl: "https://vllm.test",
          errorMessage: null,
        },
      ],
    });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    expect(await screen.findByText("Installed Apps")).toBeInTheDocument();
    expect(screen.getByText("vLLM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "href",
      "https://vllm.test",
    );
    // Installed slug is filtered out of the available grid.
    expect(screen.queryByText("App vllm")).not.toBeInTheDocument();
  });

  it("offers a 'Show all' toggle when more than four apps are available", async () => {
    routeFetch({
      apps: ["a", "b", "c", "d", "e"].map((s) => makeApp(s)),
      status: [],
    });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    const toggle = await screen.findByRole("button", { name: /show all 5/i });
    // Only 4 shown initially.
    expect(screen.queryByText("App e")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("App e")).toBeInTheDocument();
  });

  it("POSTs to the install endpoint when an app is clicked", async () => {
    const fetchMock = routeFetch({
      apps: [makeApp("vllm")],
      status: [],
      onInstall: () => ({ ok: true, body: {} }),
    });
    render(<GPUCardApps subscriptionId="sub-9" token="tok" />);
    fireEvent.click((await screen.findByText("App vllm")).closest("button")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/apps/install",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const installCall = fetchMock.mock.calls.find((c) => c[0] === "/api/apps/install")!;
    expect(JSON.parse(installCall[1].body)).toEqual({
      subscriptionId: "sub-9",
      appSlug: "vllm",
    });
  });

  it("surfaces an install error", async () => {
    routeFetch({
      apps: [makeApp("vllm")],
      status: [],
      onInstall: () => ({ ok: false, body: { error: "Not enough VRAM" } }),
    });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    fireEvent.click((await screen.findByText("App vllm")).closest("button")!);
    expect(await screen.findByText("Not enough VRAM")).toBeInTheDocument();
  });

  it("renders a Dismiss button for a failed install with its error message", async () => {
    routeFetch({
      apps: [],
      status: [
        {
          id: "i2",
          appSlug: "broken",
          appName: "Broken App",
          appIcon: "💥",
          status: "failed",
          installProgress: 0,
          port: null,
          externalUrl: null,
          errorMessage: "boom",
        },
      ],
    });
    render(<GPUCardApps subscriptionId="sub-1" token="tok" />);
    expect(await screen.findByText("Broken App")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });
});
