// @vitest-environment jsdom
//
// PA-288: behavioural tests for TokenUsageDashboard — a modal that fetches
// aggregated token-usage stats from /api/token-usage, renders summary cards,
// two recharts charts, a breakdown table, and supports a CSV export + range /
// aggregation controls that refetch.
//
// recharts is stubbed (does not lay out in jsdom) so we assert the data passed
// to each chart, not pixels.
//
// NOTE on OSS-safety: this component is NOT in .oss-manifest.yaml's exclude
// list and imports only react + recharts (no premium module). It merely *calls*
// the premium /api/token-usage endpoint at runtime, which we mock. Safe to test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("recharts", () => {
  const WithData = (testid: string) => {
    const C = ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => (
      <div data-testid={testid} data-len={data ? data.length : ""}>
        {children}
      </div>
    );
    C.displayName = `MockRecharts-${testid}`;
    return C;
  };
  return {
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    BarChart: WithData("bar-chart"),
    Bar: () => <div data-testid="bar" />,
    PieChart: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="pie-chart">{children}</div>
    ),
    Pie: WithData("pie"),
    Cell: () => <div data-testid="cell" />,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

import TokenUsageDashboard from "@/components/TokenUsageDashboard";

const okJson = (body: unknown) => ({ ok: true, json: async () => body });
const errJson = (body: unknown) => ({ ok: false, json: async () => body });

function fullData(overrides: Record<string, unknown> = {}) {
  return {
    summary: {
      totalPromptTokens: 1_200_000,
      totalGenerationTokens: 800_000,
      totalTokens: 2_000_000,
      totalEstimatedCost: 42.5,
      periodStart: "2026-05-14T00:00:00.000Z",
      periodEnd: "2026-06-13T00:00:00.000Z",
      aggregation: "day",
    },
    byPeriod: [
      { period: "2026-06-11", promptTokens: 100, generationTokens: 50, totalTokens: 150, estimatedCost: 1 },
      { period: "2026-06-12", promptTokens: 200, generationTokens: 80, totalTokens: 280, estimatedCost: 2 },
    ],
    byInstance: [
      {
        subscriptionId: "sub-a",
        displayName: "Instance A",
        promptTokens: 600_000,
        generationTokens: 400_000,
        totalTokens: 1_000_000,
        estimatedCost: 21,
        lastActive: "2026-06-12T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("TokenUsageDashboard", () => {
  it("shows the loading state before data resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<TokenUsageDashboard token="tok-1" />);
    expect(screen.getByText(/loading usage data/i)).toBeInTheDocument();
  });

  it("fetches /api/token-usage with the default period=day & 30d range and a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okJson(fullData()));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenUsageDashboard token="tok-xyz" />);

    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/token-usage?period=day");
    expect(url).toContain("&from=");
    expect(url).toContain("&to=");
    expect(init.headers.Authorization).toBe("Bearer tok-xyz");
  });

  it("renders summary cards using the component's number/currency formatting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(okJson(fullData())));
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());

    // totalTokens 2,000,000 -> "2.00M"; prompt 1.2M -> "1.20M"; gen 800K -> "800.0K"
    expect(screen.getByText("2.00M")).toBeInTheDocument();
    expect(screen.getByText("1.20M")).toBeInTheDocument();
    expect(screen.getByText("800.0K")).toBeInTheDocument();
    // cost -> "$42.50"
    expect(screen.getByText("$42.50")).toBeInTheDocument();
  });

  it("passes byPeriod to the bar chart and byInstance to the pie chart", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(okJson(fullData())));
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByTestId("bar-chart")).toBeInTheDocument());
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-len", "2"); // byPeriod
    expect(screen.getByTestId("pie")).toHaveAttribute("data-len", "1"); // byInstance
  });

  it("renders the detailed breakdown table row for each instance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(okJson(fullData())));
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Detailed Breakdown")).toBeInTheDocument());
    // displayName appears in both the legend and the table; just assert presence.
    expect(screen.getAllByText("Instance A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("$21.00")).toBeInTheDocument(); // per-instance est cost
  });

  it("shows empty-state placeholders when byPeriod and byInstance are empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(okJson(fullData({ byPeriod: [], byInstance: [] }))),
    );
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());
    expect(screen.getByText(/no data for this period/i)).toBeInTheDocument();
    expect(screen.getByText(/no instances with usage/i)).toBeInTheDocument();
    // table only renders when byInstance.length > 0
    expect(screen.queryByText("Detailed Breakdown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("shows the API error message when the fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(errJson({ error: "Usage service unavailable" })),
    );
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Usage service unavailable")).toBeInTheDocument());
    // controls header still renders; no summary cards
    expect(screen.queryByText("Detailed Breakdown")).not.toBeInTheDocument();
  });

  it("falls back to a generic error message on a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network down")));
    render(<TokenUsageDashboard token="tok-1" />);

    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());
  });

  it("refetches with period=week when the 'week' grouping is selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(fullData()))
      .mockResolvedValueOnce(okJson(fullData()));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenUsageDashboard token="tok-1" />);
    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^week$/i }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    expect(fetchMock.mock.calls[1][0]).toContain("period=week");
  });

  it("refetches when the 7-day range is selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(fullData()))
      .mockResolvedValueOnce(okJson(fullData()));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenUsageDashboard token="tok-1" />);
    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /7 days/i }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
  });

  it("requests a CSV export with format=csv when Export is clicked", async () => {
    const blob = new Blob(["a,b"], { type: "text/csv" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(fullData()))
      .mockResolvedValueOnce({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);

    // jsdom lacks URL.createObjectURL / revokeObjectURL — provide stubs.
    const createObjURL = vi.fn(() => "blob:mock");
    const revokeObjURL = vi.fn();
    // window.URL and global URL are the same object in jsdom.
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: createObjURL,
      revokeObjectURL: revokeObjURL,
    }));

    render(<TokenUsageDashboard token="tok-1" />);
    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
    expect(fetchMock.mock.calls[1][0]).toContain("format=csv");
    expect(createObjURL).toHaveBeenCalledWith(blob);
  });

  it("invokes onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(okJson(fullData())));
    render(<TokenUsageDashboard token="tok-1" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText("Token Usage Dashboard")).toBeInTheDocument());
    // The close button is the only button without text in the header area; it
    // is the first button rendered (range/group/export come later).
    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
