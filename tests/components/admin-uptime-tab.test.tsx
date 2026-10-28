// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — UptimeTab.
// Self-fetches /api/admin/uptime, renders summary cards + a sortable/filterable
// pod table. Pins the uptime % formatting (0 -> "-", else N.NN%), the filter
// counts, the empty state, the error+retry path, and sorting/expansion.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { UptimeTab } from "@/app/admin/components/UptimeTab";

type Json = Record<string, unknown>;

let payload: Json;

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/admin/uptime") {
      return Promise.resolve({ ok: true, json: async () => payload });
    }
    // history fetch (per-pod, when expanded) — return empty
    return Promise.resolve({ ok: true, json: async () => ({ history: [] }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const summary = (over: Json = {}): Json => ({
  totalPods: 3,
  activePods: 2,
  terminatedPods: 1,
  avgUptime1d: 99.87,
  avgUptime7d: 98.12,
  avgUptime30d: 0, // -> formats as "-"
  ...over,
});

const pod = (over: Json = {}): Json => ({
  subscriptionId: "sub-abcdef123456",
  displayName: "alpha-pod",
  poolName: "pool-a",
  stripeCustomerId: "cus_1",
  createdAt: "2026-01-01T00:00:00Z",
  isActive: true,
  lastSeen: new Date().toISOString(),
  uptime: { lifetime: 99.99, thirtyDay: 99.5, sevenDay: 95.0, oneDay: 100 },
  daily: [],
  totalDays: 10,
  firstDate: "2026-01-01",
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  payload = { summary: summary(), pods: [] };
});

describe("UptimeTab", () => {
  it("shows the loading skeleton before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<UptimeTab />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("fetches /api/admin/uptime on mount", async () => {
    const fetchMock = makeFetch();
    render(<UptimeTab />);
    await screen.findByText("Total Pods");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/uptime");
  });

  it("renders the summary cards with formatted uptime", async () => {
    makeFetch();
    render(<UptimeTab />);
    await screen.findByText("Total Pods");
    expect(screen.getByText("3")).toBeInTheDocument(); // totalPods
    expect(screen.getByText("99.87%")).toBeInTheDocument(); // avgUptime1d
    expect(screen.getByText("98.12%")).toBeInTheDocument(); // avgUptime7d
    expect(screen.getByText("2 active, 1 terminated")).toBeInTheDocument();
  });

  it("formats a zero average uptime as a dash, not 0.00%", async () => {
    makeFetch();
    render(<UptimeTab />);
    await screen.findByText("Avg Uptime (30d)");
    // avgUptime30d === 0 -> "-"
    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("renders the empty table state when there are no pods", async () => {
    makeFetch();
    render(<UptimeTab />);
    expect(
      await screen.findByText(/no pods with uptime data yet/i)
    ).toBeInTheDocument();
  });

  it("renders a pod row with its name and pool", async () => {
    payload = { summary: summary(), pods: [pod()] };
    makeFetch();
    render(<UptimeTab />);
    expect(await screen.findByText("alpha-pod")).toBeInTheDocument();
    expect(screen.getByText("pool-a")).toBeInTheDocument();
    expect(screen.getByText("99.99%")).toBeInTheDocument(); // lifetime
  });

  it("shows the Active badge for an active pod", async () => {
    payload = { summary: summary(), pods: [pod({ isActive: true })] };
    makeFetch();
    render(<UptimeTab />);
    await screen.findByText("alpha-pod");
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders filter buttons with live counts", async () => {
    payload = { summary: summary(), pods: [pod()] };
    makeFetch();
    render(<UptimeTab />);
    await screen.findByText("alpha-pod");
    // all (pods.length=1), active (2), terminated (1)
    expect(screen.getByRole("button", { name: /all \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /active \(2\)/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /terminated \(1\)/i })
    ).toBeInTheDocument();
  });

  it("filters out active pods when the terminated filter is chosen", async () => {
    payload = {
      summary: summary(),
      pods: [pod({ subscriptionId: "a", displayName: "active-pod", isActive: true })],
    };
    makeFetch();
    render(<UptimeTab />);
    await screen.findByText("active-pod");
    fireEvent.click(screen.getByRole("button", { name: /terminated \(1\)/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/no pods with uptime data yet/i)
      ).toBeInTheDocument()
    );
  });

  it("refetches when Refresh is clicked", async () => {
    const fetchMock = makeFetch();
    render(<UptimeTab />);
    await screen.findByText("Total Pods");
    const before = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/admin/uptime"
    ).length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/admin/uptime").length
      ).toBeGreaterThan(before)
    );
  });

  it("expands a pod row when clicked", async () => {
    payload = { summary: summary(), pods: [pod()] };
    makeFetch();
    render(<UptimeTab />);
    const row = await screen.findByText("alpha-pod");
    fireEvent.click(row.closest("tr")!);
    // expanded detail header references the display name + truncated customer id
    expect(
      await screen.findByText(/daily uptime/i)
    ).toBeInTheDocument();
  });

  it("renders the error state with a Retry button when the fetch fails", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UptimeTab />);
    expect(
      await screen.findByText(/failed to fetch uptime data/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  // PA-191 — the active-sort column's arrow was written as an HTML numeric entity
  // ("&#9650;"/"&#9660;") inside a JS string, so JSX rendered the raw entity text
  // (e.g. "24h &#9660;") instead of the ▲/▼ glyph.
  it("renders the sort arrow as a glyph, never as a raw HTML entity", async () => {
    payload = { summary: summary(), pods: [pod()] };
    makeFetch();
    const { container } = render(<UptimeTab />);
    await screen.findByText("alpha-pod");

    // Default sort is name/asc → the "Pod" column shows the up-arrow.
    expect(container.textContent).not.toContain("&#9650;");
    expect(container.textContent).not.toContain("&#9660;");
    expect(container.textContent).toContain("▲");

    // Click "24h" → active descending sort, exactly the ticket's "24h ▼" case.
    fireEvent.click(screen.getByText("24h").closest("th")!);
    await waitFor(() => expect(container.textContent).toContain("▼"));
    expect(container.textContent).not.toContain("&#9660;");
  });
});
