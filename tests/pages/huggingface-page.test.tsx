// @vitest-environment jsdom
//
// PA-289 (Phase 4, batch 3 — heavy OSS client pages): unit tests for the
// /huggingface page (HuggingFacePageContent). This ~560-line client component
// is the model-browse + deploy orchestrator. It does its OWN data loading and
// state management (it is NOT the @/components/HuggingFaceTab); the heavy
// children (ItemCard / ProgressModal / FilterPanel / the shared LaunchGPUModal)
// are stubbed so we exercise only the page's orchestration:
//   - the auth gate: a ?token= URL param unlocks the page; without one it
//     bounces to /account (router.push)
//   - the catalog fetch on mount + tab switching (popular/model/docker/space)
//   - the search flow (min-length gate, results grid, Clear)
//   - the catalog empty-state + loading branches
//   - opening the deploy modal (fires /api/instances/launch-options)
// Children are stubbed; we are NOT exercising their internals.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── next/navigation: controllable router + search params ──────────────────
const routerPush = vi.fn();
const routerReplace = vi.fn();
let searchParamsMap = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, prefetch: vi.fn() }),
  useSearchParams: () => searchParamsMap,
}));

// ── next/link: render an anchor so hrefs are inspectable ──────────────────
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ── heavy children stubbed by path ────────────────────────────────────────
vi.mock("@/app/huggingface/ItemCard", () => ({
  ItemCard: ({
    item,
    onDeploy,
  }: {
    item: { id: string; name: string };
    onDeploy: (item: unknown) => void;
  }) => (
    <div data-testid="item-card">
      <span>{item.name}</span>
      <button onClick={() => onDeploy(item)}>deploy {item.id}</button>
    </div>
  ),
}));
vi.mock("@/app/huggingface/ProgressModal", () => ({
  ProgressModal: ({ modelName }: { modelName: string }) => (
    <div data-testid="progress-modal">{modelName}</div>
  ),
}));
vi.mock("@/app/huggingface/FilterPanel", () => ({
  FilterPanel: () => <div data-testid="filter-panel" />,
}));
vi.mock("@/app/dashboard/components/LaunchGPUModal", () => ({
  LaunchGPUModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="launch-modal" /> : null,
}));

import HuggingFacePage from "@/app/huggingface/page";

type Body = Record<string, unknown>;

/** Queue ok-json responses in order; any extra fetch returns { items: [] }. */
function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: Body }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    });
  }
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function catalogItem(id: string, name = id) {
  return {
    id,
    name,
    description: "desc",
    type: "model",
    downloads: 1,
    likes: 1,
    compatible: true,
  };
}

beforeEach(() => {
  routerPush.mockClear();
  routerReplace.mockClear();
  searchParamsMap = new URLSearchParams("token=hf-test-token");
  vi.unstubAllGlobals();
  // jsdom: localStorage exists, but be defensive about removeItem.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }));
});

describe("HuggingFacePage (PA-289)", () => {
  it("bounces to /account when no ?token= is present", async () => {
    searchParamsMap = new URLSearchParams(); // no token
    render(<HuggingFacePage />);
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/account");
    });
  });

  it("renders the page header once a token unlocks it", async () => {
    mockFetchSequence([{ body: { items: [] } }]);
    render(<HuggingFacePage />);
    expect(
      await screen.findByRole("heading", { name: /hugging face/i }),
    ).toBeInTheDocument();
  });

  it("fetches the popular catalog on mount with the bearer token", async () => {
    const fetchMock = mockFetchSequence([{ body: { items: [catalogItem("a/b")] } }]);
    render(<HuggingFacePage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/huggingface/catalog?type=popular&checkCompatibility=true",
        { headers: { Authorization: "Bearer hf-test-token" } },
      );
    });
  });

  it("renders catalog items returned by the initial fetch", async () => {
    mockFetchSequence([{ body: { items: [catalogItem("meta/llama", "Llama")] } }]);
    render(<HuggingFacePage />);
    expect(await screen.findByText("Llama")).toBeInTheDocument();
    expect(screen.getByTestId("item-card")).toBeInTheDocument();
  });

  it("shows the empty-state message when the catalog returns no items", async () => {
    mockFetchSequence([{ body: { items: [] } }]);
    render(<HuggingFacePage />);
    expect(
      await screen.findByText(/no items found in this category/i),
    ).toBeInTheDocument();
  });

  it("re-fetches the catalog with the new type when a tab is clicked", async () => {
    const fetchMock = mockFetchSequence([
      { body: { items: [] } }, // popular (mount)
      { body: { items: [catalogItem("m/x", "ModelX")] } }, // models (tab click)
    ]);
    render(<HuggingFacePage />);
    // Wait for mount catalog fetch to settle.
    await screen.findByText(/no items found/i);
    fireEvent.click(screen.getByRole("button", { name: /^models$/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/huggingface/catalog?type=model&checkCompatibility=true",
        { headers: { Authorization: "Bearer hf-test-token" } },
      );
    });
    expect(await screen.findByText("ModelX")).toBeInTheDocument();
  });

  it("does not search when the query is shorter than 2 characters", async () => {
    const fetchMock = mockFetchSequence([{ body: { items: [] } }]);
    render(<HuggingFacePage />);
    const input = await screen.findByPlaceholderText(/search hugging face hub/i);
    fireEvent.change(input, { target: { value: "a" } });
    const searchBtn = screen.getByRole("button", { name: /^search$/i });
    // The button is disabled below the 2-char threshold.
    expect(searchBtn).toBeDisabled();
    fireEvent.click(searchBtn);
    // Only the mount catalog fetch should have fired — no /search call.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/huggingface/search")),
    ).toBe(false);
  });

  it("runs a search and renders the results grid", async () => {
    const fetchMock = mockFetchSequence([
      { body: { items: [] } }, // mount catalog
      { body: { results: [{ ...catalogItem("hf/result", "ResultModel") }], filterOptions: null } },
    ]);
    render(<HuggingFacePage />);
    const input = await screen.findByPlaceholderText(/search hugging face hub/i);
    fireEvent.change(input, { target: { value: "llama" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    expect(await screen.findByText(/search results \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("ResultModel")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).startsWith("/api/huggingface/search?"),
      ),
    ).toBe(true);
  });

  it("clears search results when Clear is clicked", async () => {
    mockFetchSequence([
      { body: { items: [] } },
      { body: { results: [{ ...catalogItem("hf/r", "Searched") }], filterOptions: null } },
    ]);
    render(<HuggingFacePage />);
    const input = await screen.findByPlaceholderText(/search hugging face hub/i);
    fireEvent.change(input, { target: { value: "llama" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(await screen.findByText("Searched")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    await waitFor(() => {
      expect(screen.queryByText(/search results/i)).not.toBeInTheDocument();
    });
    // Browse tabs are visible again.
    expect(screen.getByRole("button", { name: /^popular$/i })).toBeInTheDocument();
  });

  it("toggles the filter panel via the Filters button", async () => {
    mockFetchSequence([{ body: { items: [] } }]);
    render(<HuggingFacePage />);
    await screen.findByText(/no items found/i);
    expect(screen.queryByTestId("filter-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByTestId("filter-panel")).toBeInTheDocument();
  });

  it("opens the deploy modal and fetches launch options when an item asks to deploy", async () => {
    const fetchMock = mockFetchSequence([
      { body: { items: [catalogItem("meta/llama", "Llama")] } }, // catalog
      { body: { products: [], categories: [], walletBalanceCents: 0 } }, // launch-options
    ]);
    render(<HuggingFacePage />);
    fireEvent.click(await screen.findByRole("button", { name: /deploy meta\/llama/i }));

    expect(await screen.findByTestId("launch-modal")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/instances/launch-options",
        { headers: { Authorization: "Bearer hf-test-token" } },
      );
    });
  });

  it("redirects to /account on a 401 from the catalog endpoint", async () => {
    mockFetchSequence([{ ok: false, status: 401, body: {} }]);
    render(<HuggingFacePage />);
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/account");
    });
  });

  it("surfaces a catalog load error without crashing", async () => {
    // Non-401 failure → thrown → caught → setError("Failed to load catalog").
    // The page keeps rendering (error state is not a full-screen gate here).
    mockFetchSequence([{ ok: false, status: 500, body: {} }]);
    render(<HuggingFacePage />);
    // Header still renders; the catalog area shows the empty fallback.
    expect(
      await screen.findByRole("heading", { name: /hugging face/i }),
    ).toBeInTheDocument();
  });
});
