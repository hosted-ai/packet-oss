// @vitest-environment jsdom
//
// PA-288: behavioural tests for SystemMetricsCard — fetches Netdata-backed GPU
// hardware metrics from /api/instances/{subscriptionId}/system-metrics, polls
// every 10s, auto-installs Netdata (POST) when it detects it's not installed,
// and renders utilization / VRAM / temperature / power plus an advanced
// drill-down. OSS-safe: imports only react; not in the manifest exclude list.
//
// Timer strategy: real timers by default (RTL waitFor works); auto-install /
// polling / unmount tests opt into fake timers locally with
// advanceTimersByTimeAsync so the fetch promise chain flushes between ticks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";

import SystemMetricsCard from "@/components/SystemMetricsCard";

const okJson = (body: unknown) => ({ ok: true, json: async () => body });
const errJson = (body: unknown) => ({ ok: false, json: async () => body });

function makeGpu(overrides: Record<string, unknown> = {}) {
  return {
    utilization: 65,
    memoryUsed: 8192,
    memoryTotal: 16384,
    memoryPercent: 50,
    temperature: 72,
    powerDraw: 250,
    powerLimit: 300,
    fanSpeed: 40,
    ...overrides,
  };
}

function installed(gpu: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    metrics: {
      gpu,
      netdataInstalled: true,
      netdataRunning: true,
      ...extra,
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe("SystemMetricsCard", () => {
  it("returns nothing and never fetches when isVisible is false", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <SystemMetricsCard subscriptionId="sub-1" token="tok-1" isVisible={false} />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the skeleton loader before the first fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("fetches the per-subscription system-metrics endpoint with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(installed(makeGpu())));
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemMetricsCard subscriptionId="sub-99" token="tok-zzz" />);

    await waitFor(() => expect(screen.getByText("GPU Hardware")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instances/sub-99/system-metrics");
    expect(init.headers.Authorization).toBe("Bearer tok-zzz");
  });

  it("renders utilization, VRAM, temperature and power with the component's formatting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(installed(makeGpu()))));
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);

    await waitFor(() => expect(screen.getByText("GPU Hardware")).toBeInTheDocument());

    expect(screen.getByText("65")).toBeInTheDocument(); // utilization
    expect(screen.getByText("50")).toBeInTheDocument(); // memoryPercent
    expect(screen.getByText("72")).toBeInTheDocument(); // temperature
    expect(screen.getByText("250")).toBeInTheDocument(); // powerDraw
    // formatMemory(8192) -> "8.0 GB", formatMemory(16384) -> "16.0 GB"
    expect(screen.getByText("8.0 GB / 16.0 GB")).toBeInTheDocument();
    expect(screen.getByText(/Limit: 300W/)).toBeInTheDocument();
  });

  it("warns when the GPU is running hot (temperature >= 80)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson(installed(makeGpu({ temperature: 85 })))),
    );
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("GPU Hardware")).toBeInTheDocument());
    expect(screen.getByText(/running hot!/i)).toBeInTheDocument();
  });

  it("renders a 'Full Dashboard' link to the Netdata port when sshHost is given", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(installed(makeGpu()))));
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" sshHost="10.0.0.5" />);
    await waitFor(() => expect(screen.getByText("GPU Hardware")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: /full dashboard/i });
    expect(link).toHaveAttribute("href", "http://10.0.0.5:19999");
  });

  it("shows a 'waiting for GPU metrics' card when Netdata is installed but has no GPU data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(installed(null))));
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() =>
      expect(screen.getByText(/waiting for gpu metrics/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Active")).toBeInTheDocument(); // netdataRunning badge
  });

  it("toggles the advanced metrics drill-down when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson(installed(makeGpu({ smActivity: 30, memoryBandwidth: 45, efficiencyScore: 80, tensorActivity: 12 }))),
      ),
    );
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("GPU Hardware")).toBeInTheDocument());

    const toggle = screen.getByRole("button", { name: /show advanced metrics/i });
    expect(screen.queryByText("SM Activity")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("SM Activity")).toBeInTheDocument();
    expect(screen.getByText("Memory Bandwidth")).toBeInTheDocument();
    expect(screen.getByText("Efficiency Score")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument(); // efficiencyScore 80 -> "Good"
  });

  it("renders the efficiency alert when the GPU reports one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson(installed(makeGpu({ efficiencyAlert: "GPU is memory bound", smActivity: 5 }))),
      ),
    );
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("GPU is memory bound")).toBeInTheDocument());
  });

  it("shows the error state with a retry button when the fetch is not ok and no GPU data exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errJson({ error: "metrics service down" })),
    );
    render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
    await waitFor(() => expect(screen.getByText("metrics service down")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("auto-installs Netdata (POST) once when metrics report it is not installed", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn();
      // initial GET: netdata not installed -> component returns null but triggers install
      fetchMock.mockResolvedValueOnce(
        okJson({ metrics: { gpu: null, netdataInstalled: false, netdataRunning: false } }),
      );
      // POST install ok
      fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
      // refetch after install: now installed with gpu
      fetchMock.mockResolvedValue(okJson(installed(makeGpu())));
      vi.stubGlobal("fetch", fetchMock);

      render(<SystemMetricsCard subscriptionId="sub-7" token="tok-1" />);

      // flush the initial GET + the install effect's POST
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const postCall = fetchMock.mock.calls.find((c) => c[1] && c[1].method === "POST");
      expect(postCall).toBeTruthy();
      expect(postCall![0]).toBe("/api/instances/sub-7/system-metrics");

      // The install path waits 5000ms before refetching; advance past it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText("GPU Hardware")).toBeInTheDocument();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("clears its polling interval on unmount", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearInterval");
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(installed(makeGpu()))));

      const { unmount } = render(<SystemMetricsCard subscriptionId="sub-1" token="tok-1" />);
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
