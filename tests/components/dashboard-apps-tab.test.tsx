// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): AppsTab — one-click app catalogue. Fetches
// /api/apps and (per active GPU) /api/apps/status, renders the catalogue grid,
// filters by category, and installs via POST /api/apps/install. LaunchGPUModal
// (deploy modal) is stubbed so we only exercise the tab's own branches.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/dashboard/components/LaunchGPUModal", () => ({
  LaunchGPUModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="launch-modal" /> : null,
}));

import { AppsTab } from "@/app/dashboard/components/AppsTab";

const APP_JUPYTER = {
  slug: "jupyter",
  id: "app-jupyter",
  name: "Jupyter Lab",
  description: "Notebook IDE",
  category: "development",
  minVramGb: 8,
  recommendedVramGb: 16,
  estimatedInstallMin: 3,
  icon: "📓",
  tags: [],
  deployable: true,
};
const APP_VLLM = {
  slug: "vllm",
  id: "app-vllm",
  name: "vLLM Server",
  description: "Inference engine",
  category: "inference",
  minVramGb: 24,
  recommendedVramGb: 24,
  estimatedInstallMin: 5,
  icon: "🤖",
  tags: [],
};

const ACTIVE_SUB = {
  id: "sub-1",
  status: "active",
  pods: [{ pod_name: "pod-x", pod_status: "Running" }],
};

function stubFetch(opts: {
  apps?: unknown[];
  status?: unknown[];
  installOk?: boolean;
  installBody?: unknown;
}) {
  const fetchMock = vi.fn((url: string, _init?: { method?: string }) => {
    if (url.startsWith("/api/apps/install")) {
      return Promise.resolve({
        ok: opts.installOk ?? true,
        text: async () => JSON.stringify(opts.installBody ?? { success: true }),
        json: async () => opts.installBody ?? { success: true },
      });
    }
    if (url.startsWith("/api/apps/status")) {
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ apps: opts.status ?? [] }),
        json: async () => ({ apps: opts.status ?? [] }),
      });
    }
    // /api/apps
    return Promise.resolve({ ok: true, json: async () => ({ apps: opts.apps ?? [] }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("AppsTab", () => {
  it("renders the catalogue from /api/apps", async () => {
    stubFetch({ apps: [APP_JUPYTER, APP_VLLM] });
    render(<AppsTab token="test-token" subscriptions={[]} />);
    await waitFor(() => screen.getByText("Jupyter Lab"));
    expect(screen.getByText("vLLM Server")).toBeInTheDocument();
  });

  it("fetches the apps endpoint with the auth header", async () => {
    const fetchMock = stubFetch({ apps: [] });
    render(<AppsTab token="test-token" subscriptions={[]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const appsCall = fetchMock.mock.calls.find((c) => c[0] === "/api/apps");
    expect(appsCall![1].headers.Authorization).toBe("Bearer test-token");
  });

  it("filters the catalogue by category", async () => {
    stubFetch({ apps: [APP_JUPYTER, APP_VLLM] });
    render(<AppsTab token="test-token" subscriptions={[]} />);
    await waitFor(() => screen.getByText("Jupyter Lab"));

    fireEvent.click(screen.getByRole("button", { name: /inference/i }));
    expect(screen.queryByText("Jupyter Lab")).not.toBeInTheDocument();
    expect(screen.getByText("vLLM Server")).toBeInTheDocument();
  });

  it("shows the no-apps message when the catalogue is empty", async () => {
    // Category buttons derive from the fetched apps, so the only reachable
    // empty-grid path is an empty catalogue (the default "all" filter).
    stubFetch({ apps: [] });
    render(<AppsTab token="test-token" subscriptions={[]} />);
    await waitFor(() =>
      expect(screen.getByText(/no apps found in this category/i)).toBeInTheDocument()
    );
  });

  it("renders Install buttons per active GPU and posts an install", async () => {
    const fetchMock = stubFetch({ apps: [APP_JUPYTER], status: [] });
    render(
      <AppsTab token="test-token" subscriptions={[ACTIVE_SUB]} />
    );
    await waitFor(() => screen.getByText("Jupyter Lab"));

    const installBtn = await screen.findByRole("button", { name: /^install$/i });
    fireEvent.click(installBtn);

    await waitFor(() => {
      const installCall = fetchMock.mock.calls.find((c) => c[0] === "/api/apps/install");
      expect(installCall).toBeTruthy();
    });
    const installCall = fetchMock.mock.calls.find((c) => c[0] === "/api/apps/install");
    const sent = JSON.parse(installCall![1].body);
    expect(sent).toEqual({ subscriptionId: "sub-1", appSlug: "jupyter" });
  });

  it("renders an Installed Apps section for running installed apps", async () => {
    stubFetch({
      apps: [APP_JUPYTER],
      status: [
        {
          id: "inst-1",
          appSlug: "jupyter",
          appName: "Jupyter Lab",
          appIcon: "📓",
          status: "running",
          installProgress: 100,
          port: 8888,
          webUiPort: null,
          externalUrl: "https://app.example.com",
          webUiUrl: null,
          errorMessage: null,
          startedAt: null,
          createdAt: "2026-06-13",
        },
      ],
    });
    render(<AppsTab token="test-token" subscriptions={[ACTIVE_SUB]} />);
    await waitFor(() => screen.getByText(/installed apps/i));
    expect(screen.getByRole("link", { name: /open app/i })).toHaveAttribute(
      "href",
      "https://app.example.com"
    );
  });

  it("shows an error banner when an install returns not-ok", async () => {
    stubFetch({
      apps: [APP_JUPYTER],
      status: [],
      installOk: false,
      installBody: { error: "no capacity" },
    });
    render(<AppsTab token="test-token" subscriptions={[ACTIVE_SUB]} />);
    await waitFor(() => screen.getByText("Jupyter Lab"));

    fireEvent.click(await screen.findByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(screen.getByText("no capacity")).toBeInTheDocument());
  });

  it("does not render install buttons when there are no active GPUs", async () => {
    stubFetch({ apps: [APP_JUPYTER] });
    render(<AppsTab token="test-token" subscriptions={[]} />);
    await waitFor(() => screen.getByText("Jupyter Lab"));
    expect(screen.queryByRole("button", { name: /^install$/i })).not.toBeInTheDocument();
  });
});
