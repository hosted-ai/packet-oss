// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — ActivityTab.
// Self-fetches /api/admin/activity?... on mount (and on filter/search change),
// renders a unified activity feed, and links quote events back to the caller.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ActivityTab } from "@/app/admin/components/ActivityTab";
import type { Quote } from "@/app/admin/types";

type Json = Record<string, unknown>;

let activities: Json[];

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/admin/activity")) {
      return Promise.resolve({ ok: true, json: async () => ({ activities }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const adminEvent = (over: Json = {}): Json => ({
  id: "act-1",
  source: "admin",
  type: "admin_login",
  actor: "admin@example.com",
  customerId: null,
  description: "Admin signed in",
  metadata: null,
  created: 1_700_000_000,
  ...over,
});

const quoteEvent = (over: Json = {}): Json =>
  adminEvent({
    id: "act-q",
    type: "quote_sent",
    description: "Quote sent to customer",
    metadata: { quoteId: "q-1", quoteNumber: "Q-2026-001" },
    ...over,
  });

const sampleQuote = { id: "q-1", quoteNumber: "Q-2026-001" } as unknown as Quote;

function renderTab(overrides: Partial<React.ComponentProps<typeof ActivityTab>> = {}) {
  const props = {
    activities: [],
    activitiesLoading: false,
    quotes: [sampleQuote],
    onRefresh: vi.fn(),
    onViewQuote: vi.fn(),
    onSwitchToQuotes: vi.fn(),
    ...overrides,
  };
  render(<ActivityTab {...props} />);
  return props;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  activities = [];
});

describe("ActivityTab", () => {
  it("renders the heading and fetches activity on mount", async () => {
    const fetchMock = makeFetch();
    renderTab();
    expect(screen.getByText(/platform activity log/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).startsWith("/api/admin/activity"))).toBe(true);
    });
  });

  it("requests up to 300 events by default", async () => {
    const fetchMock = makeFetch();
    renderTab();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).startsWith("/api/admin/activity"));
      expect(call![0]).toContain("limit=300");
    });
  });

  it("shows the empty state when no events are returned", async () => {
    makeFetch();
    renderTab();
    expect(await screen.findByText(/no activities logged yet/i)).toBeInTheDocument();
  });

  it("renders an event row with its source, type and description", async () => {
    activities = [adminEvent()];
    makeFetch();
    renderTab();
    expect(await screen.findByText("Admin signed in")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument(); // source badge
    // "admin login" also appears as a <option> in the type filter, so the badge
    // is not unique — assert at least one match (the row badge + the option).
    expect(screen.getAllByText("admin login").length).toBeGreaterThan(0);
  });

  it("shows the events count summary", async () => {
    activities = [adminEvent(), adminEvent({ id: "act-2", description: "Second event" })];
    makeFetch();
    renderTab();
    await screen.findByText("Admin signed in");
    expect(screen.getByText("Second event")).toBeInTheDocument();
    expect(screen.getByText(/showing 2 events/i)).toBeInTheDocument();
  });

  it("re-fetches with source filter when changed", async () => {
    const fetchMock = makeFetch();
    renderTab();
    await screen.findByText(/no activities logged yet/i);

    fetchMock.mockClear();
    const sourceSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(sourceSelect, { target: { value: "admin" } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("source=admin"))).toBe(true);
    });
  });

  it("re-fetches with a type filter when changed", async () => {
    const fetchMock = makeFetch();
    renderTab();
    await screen.findByText(/no activities logged yet/i);

    fetchMock.mockClear();
    const typeSelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(typeSelect, { target: { value: "gpu_launched" } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("type=gpu_launched"))).toBe(true);
    });
  });

  it("submits the search form and re-fetches with the query", async () => {
    const fetchMock = makeFetch();
    renderTab();
    await screen.findByText(/no activities logged yet/i);

    fetchMock.mockClear();
    const input = screen.getByPlaceholderText(/search descriptions/i);
    fireEvent.change(input, { target: { value: "payment" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("search=payment"))).toBe(true);
    });
  });

  it("calls onViewQuote when a quote event's View Quote link resolves to a known quote", async () => {
    activities = [quoteEvent()];
    makeFetch();
    const props = renderTab({ quotes: [sampleQuote] });
    await screen.findByText("Quote sent to customer");

    fireEvent.click(screen.getByRole("button", { name: /view quote Q-2026-001/i }));
    expect(props.onViewQuote).toHaveBeenCalledWith(sampleQuote);
  });

  it("falls back to onSwitchToQuotes when the quote is not in the list", async () => {
    activities = [quoteEvent({ metadata: { quoteId: "missing", quoteNumber: "Q-2026-999" } })];
    makeFetch();
    const props = renderTab({ quotes: [] });
    await screen.findByText("Quote sent to customer");

    fireEvent.click(screen.getByRole("button", { name: /view quote Q-2026-999/i }));
    expect(props.onSwitchToQuotes).toHaveBeenCalled();
    expect(props.onViewQuote).not.toHaveBeenCalled();
  });

  it("shows the Clear filters button only when a filter is active", async () => {
    makeFetch();
    renderTab();
    await screen.findByText(/no activities logged yet/i);
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "admin" } });
    expect(await screen.findByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });
});
