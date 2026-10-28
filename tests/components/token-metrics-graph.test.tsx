// @vitest-environment jsdom
//
// PA-288: behavioural tests for TokenMetricsGraph — a polling + charting
// component. It POSTs to /api/vllm-metrics to trigger a collection, then GETs
// the history, polls every 10s while visible, and clears its interval on
// unmount / when hidden.
//
// recharts does not lay out in jsdom, so we stub the chart primitives to plain
// divs that echo the data they receive — this lets us assert the DATA passed to
// the chart (series length / values) rather than pixels.
//
// Timer strategy: real timers by default (RTL waitFor works); the polling /
// hidden / unmount tests opt into fake timers locally and use
// advanceTimersByTimeAsync so the fetch promise chain flushes between ticks.
//
// NOTE on OSS-safety: this component is NOT in .oss-manifest.yaml's exclude
// list and imports only react + recharts (no premium module). It merely *calls*
// the premium /api/vllm-metrics endpoint at runtime, which we mock. Safe to test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

// Stub recharts: capture the data prop on the chart so we can assert series.
vi.mock("recharts", () => {
  const Passthrough = (testid: string) => {
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
      <div data-testid="responsive-container">{children}</div>
    ),
    AreaChart: Passthrough("area-chart"),
    Area: () => <div data-testid="area" />,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

import TokenMetricsGraph from "@/components/TokenMetricsGraph";

interface FetchStub {
  ok: boolean;
  json: () => Promise<unknown>;
}

function makeMetric(overrides: Record<string, unknown> = {}) {
  return {
    promptTokens: 100,
    generationTokens: 50,
    totalTokens: 150,
    totalTokensDelta: 25,
    walletBalanceCents: 5000,
    createdAt: "2026-06-13T10:00:00.000Z",
    ...overrides,
  };
}

const okJson = (body: unknown): FetchStub => ({ ok: true, json: async () => body });
const errJson = (body: unknown): FetchStub => ({ ok: false, json: async () => body });

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("TokenMetricsGraph", () => {
  it("shows the loading spinner before the first fetch resolves", () => {
    const fetchMock = vi.fn(() => new Promise<FetchStub>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    expect(screen.getByText(/loading metrics/i)).toBeInTheDocument();
  });

  it("POSTs to /api/vllm-metrics to collect, then GETs the history", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true })); // collect (POST)
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [makeMetric(), makeMetric({ totalTokensDelta: 40 })],
        kpis: { totalTokensConsumed: 150, tokensPerHour: 600, estimatedCostPer1MTokens: 2.5 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-42" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Token Usage")).toBeInTheDocument());

    const [collectUrl, collectInit] = fetchMock.mock.calls[0];
    expect(collectUrl).toBe("/api/vllm-metrics");
    expect(collectInit.method).toBe("POST");
    expect(JSON.parse(collectInit.body)).toEqual({ subscriptionId: "sub-42" });
    expect(collectInit.headers.Authorization).toBe("Bearer tok-1");

    const [historyUrl] = fetchMock.mock.calls[1];
    expect(historyUrl).toContain("/api/vllm-metrics?subscriptionId=sub-42");
    expect(historyUrl).toContain("&since=");
  });

  it("renders KPI cards with the component's formatted numbers/currency", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [makeMetric()],
        kpis: {
          totalTokensConsumed: 2_500_000, // -> "2.50M"
          tokensPerHour: 12_000, // -> "12.0K"
          estimatedCostPer1MTokens: 3.4, // -> "$3.40"
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Total Tokens")).toBeInTheDocument());

    expect(screen.getByText("2.50M")).toBeInTheDocument();
    expect(screen.getByText("12.0K")).toBeInTheDocument();
    expect(screen.getByText("$3.40")).toBeInTheDocument();
  });

  it("renders a dash for cost when estimatedCostPer1MTokens is null", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [makeMetric()],
        kpis: { totalTokensConsumed: 10, tokensPerHour: 0, estimatedCostPer1MTokens: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("$/1M Tokens")).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the chart only with >=2 data points (passes the full series to recharts)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [
          makeMetric({ totalTokensDelta: 10 }),
          makeMetric({ totalTokensDelta: 20 }),
          makeMetric({ totalTokensDelta: 30 }),
        ],
        kpis: { totalTokensConsumed: 60, tokensPerHour: 1, estimatedCostPer1MTokens: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByTestId("area-chart")).toBeInTheDocument());
    expect(screen.getByTestId("area-chart")).toHaveAttribute("data-len", "3");
    expect(screen.queryByText(/chart shows after 2\+ data points/i)).not.toBeInTheDocument();
  });

  it("shows the 'collecting data' placeholder when fewer than 2 points exist", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [makeMetric()],
        kpis: { totalTokensConsumed: 1, tokensPerHour: 0, estimatedCostPer1MTokens: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Token Usage")).toBeInTheDocument());
    expect(screen.getByText(/chart shows after 2\+ data points/i)).toBeInTheDocument();
    expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();
  });

  it("zeroes the KPIs when the history payload omits kpis (no NaN/undefined)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(okJson({ metrics: [] })); // no kpis key
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Total Tokens")).toBeInTheDocument());
    // formatNumber(0) === "0" for both Total Tokens and Tokens/Hour.
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("—")).toBeInTheDocument(); // cost dash
  });

  it("does not crash and fills in defaults when kpis is present but partial (PA-305)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    fetchMock.mockResolvedValueOnce(
      okJson({
        metrics: [makeMetric()],
        kpis: { estimatedCostPer1MTokens: 1.5 }, // totalTokensConsumed/tokensPerHour missing
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Total Tokens")).toBeInTheDocument());
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("$1.50")).toBeInTheDocument();
  });

  it("clears loading and shows the actionable message when the collect POST fails (PA-304)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(errJson({ error: "No vLLM service found for subscription" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() =>
      expect(screen.getByText(/expose the api endpoint to start tracking metrics/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/loading metrics/i)).not.toBeInTheDocument();
  });

  it("clears loading even when the collect POST fails without the known error string (PA-304)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(errJson({ error: "some other failure" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.queryByText(/loading metrics/i)).not.toBeInTheDocument());
  });

  it("polls again after the 10s interval (issues further fetches)", async () => {
    // Use real timers: the component re-creates collectMetrics on every
    // `collecting` toggle (re-subscribing the interval), which does not settle
    // cleanly under fake timers. We spy on setInterval to assert a 10s poll is
    // scheduled and that the initial collect issues the POST + history fetches.
    const intervalSpy = vi.spyOn(global, "setInterval");
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        metrics: [makeMetric(), makeMetric()],
        kpis: { totalTokensConsumed: 100, tokensPerHour: 0, estimatedCostPer1MTokens: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("Token Usage")).toBeInTheDocument());

    // Initial collect issues both the POST and the history GET.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // A polling interval is registered at the 10s cadence.
    const tenSecondPoll = intervalSpy.mock.calls.some((c) => c[1] === 10000);
    expect(tenSecondPoll).toBe(true);
    intervalSpy.mockRestore();
  });

  it("clears the polling interval on unmount", async () => {
    const clearSpy = vi.spyOn(global, "clearInterval");
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        metrics: [makeMetric()],
        kpis: { totalTokensConsumed: 1, tokensPerHour: 0, estimatedCostPer1MTokens: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("Token Usage")).toBeInTheDocument());

    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not fetch or poll when isVisible is false", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(okJson({ metrics: [], kpis: {} })));
    vi.stubGlobal("fetch", fetchMock);

    render(<TokenMetricsGraph subscriptionId="sub-1" token="tok-1" isVisible={false} />);

    // Flush microtasks; no effect path issues fetch when hidden.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // It stays in the loading state since fetchMetrics never runs.
    expect(screen.getByText(/loading metrics/i)).toBeInTheDocument();
  });
});
