// @vitest-environment jsdom
//
// PA-288: behavioural tests for GPUHardwareMetrics — fetches aggregated GPU
// hardware metrics from /api/instances/gpu-hardware-metrics, polls on a
// configurable refreshInterval, filters to active pods, and renders three
// variants (compact / dashboard / metrics). PodDetailModal is stubbed.
// OSS-safe: imports only react + ./PodDetailModal (a pure presentational
// component); neither is in .oss-manifest.yaml's exclude list.
//
// Timer strategy: real timers by default (RTL waitFor works); polling / unmount
// tests opt into fake timers locally with advanceTimersByTimeAsync.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("@/components/PodDetailModal", () => ({
  PodDetailModal: ({ pod, onClose }: { pod: { poolName: string }; onClose: () => void }) => (
    <div data-testid="pod-detail-modal">
      <span>{pod.poolName}</span>
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));

import { GPUHardwareMetrics } from "@/components/GPUHardwareMetrics";

const okJson = (body: unknown) => ({ ok: true, json: async () => body });
const errJson = (body: unknown) => ({ ok: false, json: async () => body });

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: "sub-a",
    podName: "pod-a",
    poolName: "Pool Alpha",
    status: "running",
    gpu: {
      utilization: 70,
      memoryUsed: 8192,
      memoryTotal: 16384,
      memoryPercent: 50,
      temperature: 65,
      powerDraw: 200,
      powerLimit: 300,
      fanSpeed: 45,
    },
    system: null,
    netdataInstalled: true,
    netdataRunning: true,
    ...overrides,
  };
}

function aggregate(pods: Record<string, unknown>[], totals: Record<string, unknown> = {}) {
  return {
    pods,
    totals: {
      avgUtilization: 70,
      totalMemoryUsed: 8192,
      totalMemoryTotal: 16384,
      avgMemoryPercent: 50,
      avgTemperature: 65,
      totalPowerDraw: 200,
      maxTemperature: 65,
      avgCpuPercent: 0,
      totalSystemMemoryUsedMb: 0,
      totalSystemMemoryTotalMb: 0,
      avgSystemMemoryPercent: 0,
      activePods: pods.length,
      podsWithMetrics: pods.length,
      ...totals,
    },
    timestamp: "2026-06-13T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("GPUHardwareMetrics", () => {
  it("fetches the aggregated endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(aggregate([makePod()])));
    vi.stubGlobal("fetch", fetchMock);

    render(<GPUHardwareMetrics token="tok-xyz" variant="metrics" />);

    await waitFor(() => expect(screen.getByText("GPU Hardware Metrics")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/gpu-hardware-metrics");
    expect(init.headers.Authorization).toBe("Bearer tok-xyz");
  });

  // ── compact variant ──────────────────────────────────────────────────────
  it("compact: shows a skeleton before the first fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<GPUHardwareMetrics token="tok-1" variant="compact" />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("compact: shows 'No GPU metrics available' when no pods report metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson(aggregate([], { podsWithMetrics: 0 }))),
    );
    render(<GPUHardwareMetrics token="tok-1" variant="compact" />);
    await waitFor(() =>
      expect(screen.getByText(/no gpu metrics available/i)).toBeInTheDocument(),
    );
  });

  it("compact: renders avg utilization, temp and power from totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson(
          aggregate([makePod()], { avgUtilization: 73, avgTemperature: 66, totalPowerDraw: 210 }),
        ),
      ),
    );
    render(<GPUHardwareMetrics token="tok-1" variant="compact" />);
    await waitFor(() => expect(screen.getByText("Utilization")).toBeInTheDocument());
    expect(screen.getByText("73%")).toBeInTheDocument();
    // Temp/Power render with inline labels in the compact variant.
    expect(screen.getByText("66°C")).toBeInTheDocument();
    expect(screen.getByText(/Power: 210W/)).toBeInTheDocument();
  });

  // ── dashboard variant ────────────────────────────────────────────────────
  it("dashboard: renders nothing when there are no active pods", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson(aggregate([makePod({ status: "terminated" })]))),
    );
    const { container } = render(<GPUHardwareMetrics token="tok-1" variant="dashboard" />);
    // After load resolves it returns null (no active pods).
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeFalsy());
    expect(screen.queryByText("GPU Load")).not.toBeInTheDocument();
  });

  it("dashboard: renders GPU Load + Hardware cards for active pods", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(aggregate([makePod()]))));
    render(<GPUHardwareMetrics token="tok-1" variant="dashboard" />);
    await waitFor(() => expect(screen.getByText("GPU Load")).toBeInTheDocument());
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    // avgTemperature (summary) and the per-pod temp both read 65°C.
    expect(screen.getAllByText("65°C").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("200W").length).toBeGreaterThanOrEqual(1); // totalPowerDraw + per-pod
    expect(screen.getAllByText("Pool Alpha").length).toBeGreaterThanOrEqual(1);
  });

  it("dashboard: opens the PodDetailModal when a pod card is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(aggregate([makePod()]))));
    render(<GPUHardwareMetrics token="tok-1" variant="dashboard" />);
    await waitFor(() => expect(screen.getByText("GPU Load")).toBeInTheDocument());

    fireEvent.click(screen.getByText("GPU Load"));
    expect(screen.getByTestId("pod-detail-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByTestId("pod-detail-modal")).not.toBeInTheDocument();
  });

  // ── metrics variant ──────────────────────────────────────────────────────
  it("metrics: renders the summary cards and a per-pod row", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(aggregate([makePod()]))));
    render(<GPUHardwareMetrics token="tok-1" variant="metrics" />);
    await waitFor(() => expect(screen.getByText("GPU Hardware Metrics")).toBeInTheDocument());

    expect(screen.getByText("Avg Utilization")).toBeInTheDocument();
    expect(screen.getByText("VRAM Usage")).toBeInTheDocument();
    expect(screen.getByText("8.0 GB")).toBeInTheDocument(); // formatMemory(8192)
    expect(screen.getByText("1 GPU monitored")).toBeInTheDocument();
    expect(screen.getByText("pod-a")).toBeInTheDocument(); // per-pod row pod name
  });

  it("metrics: shows the error + Retry state when the fetch fails before any data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errJson({ error: "aggregation failed" })));
    render(<GPUHardwareMetrics token="tok-1" variant="metrics" />);
    await waitFor(() => expect(screen.getByText("aggregation failed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("metrics: shows the empty state when there are no active pods", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(aggregate([]))));
    render(<GPUHardwareMetrics token="tok-1" variant="metrics" />);
    await waitFor(() =>
      expect(screen.getByText(/no active gpus to show hardware metrics/i)).toBeInTheDocument(),
    );
  });

  // ── polling / lifecycle ──────────────────────────────────────────────────
  it("polls on the supplied refreshInterval", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue(okJson(aggregate([makePod()])));
      vi.stubGlobal("fetch", fetchMock);

      render(<GPUHardwareMetrics token="tok-1" variant="metrics" refreshInterval={5000} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsAfterInitial = fetchMock.mock.calls.length;
      expect(callsAfterInitial).toBeGreaterThanOrEqual(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterInitial);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("clears its polling interval on unmount", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearInterval");
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(aggregate([makePod()]))));

      const { unmount } = render(<GPUHardwareMetrics token="tok-1" variant="metrics" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      unmount();
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
