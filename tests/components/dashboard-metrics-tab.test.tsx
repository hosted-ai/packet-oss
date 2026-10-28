// @vitest-environment jsdom
//
// PA-288 (coverage) / PA-190 (implementation): MetricsTab — account-wide GPU
// telemetry dashboard. It fetches:
//   * /api/instances/gpu-metrics?window=<period>            -> team-wide series
//   * /api/instances                                        -> pod list
//   * /api/instances/gpu-metrics?pod_id=<id>&window=<period> -> per-pod series
// and renders TFLOPs/VRAM summary cards, a usage-over-time chart (GPUUsageChart),
// and a per-pod table. The old SSH/hardware-metrics + pod-detail-modal surface
// was retired in PA-190. recharts is stubbed (via the real GPUUsageChart) and
// TokenUsageDashboard is stubbed so we test the tab's own fetch/merge/render.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="usage-graph" data-points={data.length} />
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));
vi.mock("@/components/TokenUsageDashboard", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="token-usage">
      <button onClick={onClose}>close-token</button>
    </div>
  ),
}));

import { MetricsTab } from "@/app/dashboard/components/MetricsTab";

interface GpuMetricsPoint {
  unix_timestamp: number;
  formatted_time: string;
  tflops: number;
  vram_mib: number;
}

function point(overrides: Partial<GpuMetricsPoint> = {}): GpuMetricsPoint {
  return { unix_timestamp: 0, formatted_time: "t", tflops: 0, vram_mib: 0, ...overrides };
}

function sub(overrides: Record<string, unknown> = {}) {
  return { id: "i-1", pool_name: "A100 Pool", status: "running", ...overrides };
}

/**
 * Route the three endpoints MetricsTab hits:
 *   - team series:  /api/instances/gpu-metrics?window=…      -> { window, data }
 *   - per-pod:      /api/instances/gpu-metrics?pod_id=…      -> { data }
 *   - pod list:     /api/instances                          -> { poolSubscriptions }
 */
function stubMetrics({
  team = [],
  subs = [],
  podSeries = {},
}: {
  team?: GpuMetricsPoint[];
  subs?: Record<string, unknown>[];
  podSeries?: Record<string, GpuMetricsPoint[]>;
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/instances/gpu-metrics")) {
      const params = new URL(url, "http://localhost").searchParams;
      const podId = params.get("pod_id");
      if (podId) {
        return Promise.resolve({ ok: true, json: async () => ({ data: podSeries[podId] ?? [] }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ window: params.get("window"), data: team }),
      });
    }
    if (url.startsWith("/api/instances")) {
      return Promise.resolve({ ok: true, json: async () => ({ poolSubscriptions: subs }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("MetricsTab", () => {
  it("renders the empty pods state when there are no subscriptions", async () => {
    stubMetrics({ subs: [] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() =>
      expect(screen.getByText(/no pods to show metrics for/i)).toBeInTheDocument()
    );
  });

  it("fetches team metrics, the pod list, and per-pod metrics with the auth header", async () => {
    const fetchMock = stubMetrics({ subs: [sub({ id: "i-1" })] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    // team-wide series (no pod_id)
    expect(urls.some((u) => u.startsWith("/api/instances/gpu-metrics?window="))).toBe(true);
    // pod list
    expect(urls.some((u) => u === "/api/instances")).toBe(true);
    // per-pod series for the loaded pod
    expect(urls.some((u) => u.includes("pod_id=i-1"))).toBe(true);

    const gpuCall = fetchMock.mock.calls.find((c) =>
      (c[0] as string).startsWith("/api/instances/gpu-metrics")
    );
    expect(gpuCall![1].headers.Authorization).toBe("Bearer test-token");
  });

  it("renders a per-pod table row once the pod list loads", async () => {
    stubMetrics({ subs: [sub({ id: "i-1", pool_name: "A100 Pool", status: "running" })] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));
    expect(screen.getByText("i-1")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /pod metrics/i })).toBeInTheDocument();
  });

  it("excludes bare-metal subscriptions from the pod table", async () => {
    stubMetrics({
      subs: [
        sub({ id: "i-1", pool_name: "A100 Pool" }),
        sub({ id: "bm-1", pool_name: "Bare Metal Box", nature: "baremetal" }),
      ],
    });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));
    expect(screen.queryByText("Bare Metal Box")).not.toBeInTheDocument();
  });

  it("shows account-wide TFLOPs and VRAM averages in the summary cards", async () => {
    stubMetrics({
      team: [point({ tflops: 10, vram_mib: 1024 }), point({ tflops: 30, vram_mib: 3072 })],
    });
    render(<MetricsTab token="test-token" />);
    // TFLOPs avg (10+30)/2 = 20.0
    await waitFor(() => expect(screen.getByText("20.0")).toBeInTheDocument());
    // VRAM avg (1024+3072)/2 = 2048 MiB / 1024 = 2.0 GB
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
  });

  it("renders the usage-over-time chart when the team series has >=2 points", async () => {
    stubMetrics({ team: [point(), point()] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByTestId("usage-graph"));
    expect(screen.getByTestId("usage-graph")).toHaveAttribute("data-points", "2");
  });

  it("shows the collecting placeholder (no chart) with fewer than 2 team points", async () => {
    stubMetrics({ team: [point()], subs: [sub()] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));
    expect(screen.queryByTestId("usage-graph")).not.toBeInTheDocument();
    expect(screen.getByText(/collecting metrics/i)).toBeInTheDocument();
  });

  it("averages per-pod series into the row, em-dash when the series is empty", async () => {
    stubMetrics({
      subs: [
        sub({ id: "i-1", pool_name: "A100 Pool" }),
        sub({ id: "i-2", pool_name: "H100 Pool" }),
      ],
      podSeries: { "i-1": [point({ tflops: 12, vram_mib: 2048 })] },
      // i-2 has no series -> "—"
    });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => expect(screen.getByText("12.0")).toBeInTheDocument());
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    // i-2 renders an em-dash for both TFLOPs and VRAM cells.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the token-usage dashboard from the header button", async () => {
    stubMetrics({ subs: [sub()] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));

    fireEvent.click(screen.getByRole("button", { name: /token usage/i }));
    expect(screen.getByTestId("token-usage")).toBeInTheDocument();
  });

  it("refetches with the new window when the period is switched", async () => {
    const fetchMock = stubMetrics({ subs: [sub()] });
    render(<MetricsTab token="test-token" />);
    await waitFor(() => screen.getByText("A100 Pool"));

    fireEvent.click(screen.getByRole("button", { name: /24 hours/i }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes("window=last_24h"))).toBe(true);
    });
  });
});
