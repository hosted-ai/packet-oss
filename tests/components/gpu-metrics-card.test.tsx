// @vitest-environment jsdom
//
// PA-288: behavioural tests for GPUMetricsCard — fetches vLLM-style inference
// metrics from /api/instances/{subscriptionId}/gpu-metrics, polls every 10s,
// and renders cache / throughput / TTFT / request-count cards. OSS-safe: the
// file imports only react and is not in .oss-manifest.yaml's exclude list.
//
// Timer strategy: real timers by default (so RTL's waitFor works); the polling
// / unmount tests opt into fake timers locally and use advanceTimersByTimeAsync
// so the fetch promise chain flushes between ticks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

import GPUMetricsCard from "@/components/GPUMetricsCard";

const okJson = (body: unknown) => ({ ok: true, json: async () => body });
const errJson = (body: unknown) => ({ ok: false, json: async () => body });

function makeMetrics(overrides: Record<string, unknown> = {}) {
  return {
    gpuCacheUsagePercent: 42,
    cpuCacheUsagePercent: 10,
    numRequestsRunning: 3,
    numRequestsWaiting: 1,
    numRequestsSwapped: 0,
    promptTokensTotal: 1500,
    generationTokensTotal: 2500,
    avgPromptThroughput: 12.4,
    avgGenerationThroughput: 34.6,
    avgTimeToFirstToken: 250,
    modelId: "meta-llama/Llama-3.1-8B-Instruct",
    isHealthy: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("GPUMetricsCard", () => {
  it("returns nothing when isVisible is false and never fetches", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <GPUMetricsCard subscriptionId="sub-1" token="tok-1" isVisible={false} />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the skeleton loading state before the first fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("fetches the per-subscription gpu-metrics endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GPUMetricsCard subscriptionId="sub-77" token="tok-abc" />);

    await waitFor(() => expect(screen.getByText("GPU Metrics")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/sub-77/gpu-metrics");
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
  });

  it("renders the model id and the healthy badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() })));
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("GPU Metrics")).toBeInTheDocument());
    expect(screen.getByText("meta-llama/Llama-3.1-8B-Instruct")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders the unhealthy badge when isHealthy is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics({ isHealthy: false }) })),
    );
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("Unhealthy")).toBeInTheDocument());
  });

  it("renders throughput, TTFT and request counts with the component's formatting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() })));
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("GPU Metrics")).toBeInTheDocument());

    expect(screen.getByText("42")).toBeInTheDocument(); // gpuCacheUsagePercent toFixed(0)
    expect(screen.getByText("34.6")).toBeInTheDocument(); // gen throughput toFixed(1)
    expect(screen.getByText("12.4")).toBeInTheDocument(); // prompt throughput toFixed(1)
    expect(screen.getByText("250")).toBeInTheDocument(); // TTFT toFixed(0)
    expect(screen.getByText("3")).toBeInTheDocument(); // running
    expect(screen.getByText("1")).toBeInTheDocument(); // waiting
    // total tokens = 1500 + 2500 = 4000 -> "4.0K"
    expect(screen.getByText("4.0K")).toBeInTheDocument();
  });

  it("renders the compact summary line when compact is true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() })));
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" compact />);

    await waitFor(() => expect(screen.getByText(/GPU Cache: 42%/)).toBeInTheDocument());
    expect(screen.getByText(/Throughput: 34.6 tok\/s/)).toBeInTheDocument();
    expect(screen.getByText(/3 active/)).toBeInTheDocument();
  });

  it("shows the error state with a retry button when the fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errJson({ error: "Metrics endpoint unreachable" })),
    );
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() =>
      expect(screen.getByText("Metrics endpoint unreachable")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("falls back to a generic message on a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("polls every 10s, refetching the endpoint", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() }));
      vi.stubGlobal("fetch", fetchMock);

      render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);
      // flush the initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsAfterInitial = fetchMock.mock.calls.length;
      expect(callsAfterInitial).toBeGreaterThanOrEqual(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterInitial);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("clears its interval on unmount (no fetch after unmount)", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearInterval");
    try {
      const fetchMock = vi.fn().mockResolvedValue(okJson({ metrics: makeMetrics() }));
      vi.stubGlobal("fetch", fetchMock);

      const { unmount } = render(<GPUMetricsCard subscriptionId="sub-1" token="tok-1" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsBefore = fetchMock.mock.calls.length;

      unmount();
      expect(clearSpy).toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    } finally {
      clearSpy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
