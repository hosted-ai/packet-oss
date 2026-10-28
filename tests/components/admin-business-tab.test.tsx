// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — BusinessTab.
// Self-fetches /api/admin/business-metrics?period=30d (the whole JSON IS the
// metrics object, gated on data.success), renders revenue/customer/GPU/wallet
// cards, two MiniBarChart sparklines, provider economics + top-customer lists.
// Pins the currency/percent formatting, the period switch (refetch with new
// period), the manual refresh (refresh=true), the margin %-with-zero-revenue
// guard, and the error+retry path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { BusinessTab } from "@/app/admin/components/BusinessTab";

type Json = Record<string, unknown>;

let payload: Json;
let succeed = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if ((url as string).startsWith("/api/admin/business-metrics")) {
      return Promise.resolve({
        ok: true,
        json: async () =>
          succeed ? { success: true, ...payload } : { success: false, error: "metrics down" },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const metrics = (over: Json = {}): Json => ({
  period: "30d",
  periodDays: 30,
  cachedAt: "2026-06-01T00:00:00Z",
  revenue: {
    total: 125000,
    previous: 100000,
    change: 25,
    refunds: 0,
    daily: [
      { date: "2026-05-01", revenue: 5000, deposits: 6000 },
      { date: "2026-05-02", revenue: 7000, deposits: 8000 },
    ],
  },
  customers: {
    total: 40,
    new: 8,
    previousNew: 6,
    change: 33.3,
    active: 30,
    hourly: 25,
    monthly: 15,
    avgValue: 0,
    dailySignups: [
      { date: "2026-05-01", count: 2 },
      { date: "2026-05-02", count: 3 },
    ],
  },
  wallet: { totalBalance: 90000, avgBalance: 2250 },
  gpu: { activeGPUs: 12, activePods: 9, totalHoursUsed: 4321, totalUsageCost: 33000, avgUtilization: 73.6 },
  providers: { total: 4, active: 3, totalNodes: 10, activeNodes: 7, payouts: 0, revenue: 80000, earnings: 50000, margin: 30000 },
  marketing: {
    voucherRedemptions: 11,
    voucherCreditsGiven: 5500,
    referralClaims: 4,
    referralConversions: 2,
    activeVouchers: 3,
    activeReferralCodes: 5,
  },
  topCustomers: {
    byBalance: [{ id: "c1", email: "rich@example.com", name: "Rich Buyer", balance: 50000 }],
    bySpending: [{ id: "c2", email: "spend@example.com", name: "Big Spender", spent: 40000 }],
  },
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  payload = metrics();
  succeed = true;
});

describe("BusinessTab", () => {
  it("shows the loading spinner before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<BusinessTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("fetches business metrics for the default 30d period on mount", async () => {
    const fetchMock = makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Business Metrics");
    expect(
      fetchMock.mock.calls.some((c) =>
        (c[0] as string).includes("/api/admin/business-metrics?period=30d")
      )
    ).toBe(true);
  });

  it("renders the revenue card with currency + change", async () => {
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Business Metrics");
    expect(screen.getByText("$125,000")).toBeInTheDocument(); // revenue.total
    expect(screen.getByText("+25.0%")).toBeInTheDocument(); // revenue.change
  });

  it("renders the GPU card with whole-percent utilization", async () => {
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Active GPUs");
    // "{73}% util" is split across text nodes; assert on the util span content.
    const utilSpan = screen.getByText(/util/);
    expect(utilSpan.textContent).toBe("74% util"); // 73.6 -> toFixed(0) rounds to 74
    expect(screen.getByText("12")).toBeInTheDocument(); // activeGPUs
  });

  it("renders the top-spender and top-balance lists", async () => {
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Top Spenders");
    expect(screen.getByText("Big Spender")).toBeInTheDocument();
    expect(screen.getByText("Rich Buyer")).toBeInTheDocument();
  });

  it("computes the margin percentage from margin / revenue", async () => {
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Provider Economics");
    // 30000 / 80000 * 100 = 37.5
    expect(screen.getByText("37.5%")).toBeInTheDocument();
  });

  it("guards the margin percentage against zero revenue (renders 0%, not NaN)", async () => {
    payload = metrics({
      providers: { total: 0, active: 0, totalNodes: 0, activeNodes: 0, payouts: 0, revenue: 0, earnings: 0, margin: 0 },
    });
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Provider Economics");
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("renders the empty-list fallbacks when there are no top customers", async () => {
    payload = metrics({ topCustomers: { byBalance: [], bySpending: [] } });
    makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Top Spenders");
    expect(screen.getByText("No spending data")).toBeInTheDocument();
    expect(screen.getByText("No balance data")).toBeInTheDocument();
  });

  it("refetches with the new period when a period button is clicked", async () => {
    const fetchMock = makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Business Metrics");
    fireEvent.click(screen.getByRole("button", { name: /7 days/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          (c[0] as string).includes("period=7d")
        )
      ).toBe(true);
    });
  });

  it("refreshes with refresh=true when Refresh is clicked", async () => {
    const fetchMock = makeFetch();
    render(<BusinessTab />);
    await screen.findByText("Business Metrics");
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => (c[0] as string).includes("refresh=true"))
      ).toBe(true);
    });
  });

  it("opens the revenue drill-down modal when the revenue card is clicked", async () => {
    makeFetch();
    render(<BusinessTab />);
    const revenueCard = (await screen.findByText("Revenue")).closest("div")!.parentElement!;
    fireEvent.click(revenueCard);
    // The drill-down modal renders a "Deposits" column header for revenue.
    expect(await screen.findByText("Deposits")).toBeInTheDocument();
  });

  it("renders the error state with a Retry button when the API reports failure", async () => {
    succeed = false;
    makeFetch();
    render(<BusinessTab />);
    expect(await screen.findByText("metrics down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
