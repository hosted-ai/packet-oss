// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — GpuAppsTab.
// Self-fetches /api/admin/gpu-apps, renders app cards (active / ready / grayed),
// and POSTs {action: setup|teardown}.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GpuAppsTab } from "@/app/admin/components/GpuAppsTab";

type Json = Record<string, unknown>;

let apps: Json[];

function makeFetch() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (url === "/api/admin/gpu-apps" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => ({ apps }) });
    }
    // POST setup/teardown
    const body = JSON.parse((init?.body as string) || "{}");
    if (body.action === "setup") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ service: { id: "svc-new", name: "Ollama Service" } }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ message: "App disabled" }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// "ollama" is in the component's AVAILABLE_RECIPES set.
const readyApp = (over: Json = {}): Json => ({
  id: "app-1",
  slug: "ollama",
  name: "Ollama",
  description: "Local LLM runner",
  icon: "🦙",
  category: "inference",
  minVramGb: 8,
  recommendedVramGb: 16,
  defaultPort: 11434,
  webUiPort: null,
  displayOrder: 0,
  active: true,
  deployable: true,
  serviceId: null,
  productId: null,
  recipeSlug: "ollama",
  product: null,
  ...over,
});

const activeApp = (over: Json = {}): Json =>
  readyApp({ id: "app-2", slug: "comfyui", name: "ComfyUI", recipeSlug: "comfyui", serviceId: "svc-existing-0123456789", ...over });

beforeEach(() => {
  vi.unstubAllGlobals();
  apps = [];
});

describe("GpuAppsTab", () => {
  it("shows a loading state before the fetch resolves", () => {
    makeFetch();
    render(<GpuAppsTab />);
    expect(screen.getByText(/loading apps/i)).toBeInTheDocument();
  });

  it("fetches apps on mount", async () => {
    const fetchMock = makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText(/no GPU apps found/i);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/gpu-apps");
  });

  it("renders the empty state when no apps are returned", async () => {
    makeFetch();
    render(<GpuAppsTab />);
    expect(await screen.findByText(/no GPU apps found/i)).toBeInTheDocument();
  });

  it("renders a ready (not-configured) app with an Enable button", async () => {
    apps = [readyApp()];
    makeFetch();
    render(<GpuAppsTab />);
    expect(await screen.findByText("Ollama")).toBeInTheDocument();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^enable$/i })).toBeInTheDocument();
  });

  it("renders an active app with Enabled badge plus Configure and Disable actions", async () => {
    apps = [activeApp()];
    makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText("ComfyUI");
    expect(screen.getByText(/^enabled$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /configure/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable/i })).toBeInTheDocument();
  });

  it("renders a grayed app (no known recipe) without action buttons", async () => {
    apps = [readyApp({ id: "g-1", slug: "unknown-app", name: "Mystery", recipeSlug: "unknown-recipe", serviceId: null })];
    makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText("Mystery");
    expect(screen.getByText(/no recipe available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^enable$/i })).not.toBeInTheDocument();
  });

  it("opens the setup modal when Enable is clicked", async () => {
    apps = [readyApp()];
    makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText("Ollama");

    fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));
    expect(screen.getByRole("heading", { name: /enable ollama/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument(); // exec timing select
  });

  it("POSTs action=setup and shows the success state", async () => {
    apps = [readyApp()];
    const fetchMock = makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText("Ollama");

    fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));
    fireEvent.click(screen.getByRole("button", { name: /set up/i }));

    expect(await screen.findByText(/is now enabled/i)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && JSON.parse((c[1]!.body as string)).action === "setup"
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1]!.body as string).id).toBe("app-1");
  });

  it("shows the error state when setup returns non-ok", async () => {
    apps = [readyApp()];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      if (url === "/api/admin/gpu-apps" && method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ apps }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: "Recipe sync failed" }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GpuAppsTab />);
    await screen.findByText("Ollama");

    fireEvent.click(screen.getByRole("button", { name: /^enable$/i }));
    fireEvent.click(screen.getByRole("button", { name: /set up/i }));
    expect(await screen.findByText("Recipe sync failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("opens the teardown confirm and POSTs action=teardown", async () => {
    apps = [activeApp()];
    const fetchMock = makeFetch();
    render(<GpuAppsTab />);
    await screen.findByText("ComfyUI");

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));
    // Confirmation dialog with its own Disable button
    expect(screen.getByRole("heading", { name: /disable app/i })).toBeInTheDocument();
    // There are now two "Disable" buttons (card + dialog); click the last (dialog).
    const disableButtons = screen.getAllByRole("button", { name: /^disable$/i });
    fireEvent.click(disableButtons[disableButtons.length - 1]);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" && JSON.parse((c[1]!.body as string)).action === "teardown"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1]!.body as string).id).toBe("app-2");
    });
  });
});
