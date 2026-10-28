// @vitest-environment jsdom
//
// PA-288 (coverage) / PA-190 (implementation): GPUUsageChart — a presentational
// TFLOPs/VRAM area chart. It no longer fetches or gates on "active GPUs"; it
// takes a pre-fetched `data` series (from /api/instances/gpu-metrics, HAI's
// Prometheus-backed team_metrics) as a prop. With <2 points it shows a
// "Collecting metrics..." placeholder; otherwise it maps the series (VRAM
// MiB->GB, values clamped at 0) and renders the chart. recharts is stubbed
// (jsdom can't lay it out) and the AreaChart stub exposes the mapped series so
// we can assert the transform.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

type TooltipFormatter = (value: unknown, name: unknown) => [string, string];
let capturedFormatter: TooltipFormatter | undefined;

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data, children }: { data: unknown[]; children?: React.ReactNode }) => (
    <div data-testid="gpu-chart" data-points={data.length} data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: (props: { formatter?: TooltipFormatter }) => {
    if (props.formatter) capturedFormatter = props.formatter;
    return null;
  },
  Legend: () => null,
}));

import { GPUUsageChart } from "@/app/dashboard/components/GPUUsageChart";

interface GpuMetricsPoint {
  unix_timestamp: number;
  formatted_time: string;
  tflops: number;
  vram_mib: number;
}

function point(overrides: Partial<GpuMetricsPoint> = {}): GpuMetricsPoint {
  return { unix_timestamp: 0, formatted_time: "t", tflops: 0, vram_mib: 0, ...overrides };
}

describe("GPUUsageChart", () => {
  it("shows the collecting-metrics placeholder when data is undefined", () => {
    render(<GPUUsageChart data={undefined as unknown as GpuMetricsPoint[]} />);
    expect(screen.getByText(/collecting metrics/i)).toBeInTheDocument();
    expect(screen.queryByTestId("gpu-chart")).not.toBeInTheDocument();
  });

  it("shows the collecting-metrics placeholder with fewer than 2 samples", () => {
    render(<GPUUsageChart data={[point({ tflops: 10, vram_mib: 1024 })]} />);
    expect(screen.getByText(/collecting metrics/i)).toBeInTheDocument();
    expect(screen.queryByTestId("gpu-chart")).not.toBeInTheDocument();
  });

  it("renders the chart once there are 2 or more samples", () => {
    render(
      <GPUUsageChart
        data={[
          point({ formatted_time: "10:00", tflops: 10, vram_mib: 1024 }),
          point({ formatted_time: "10:01", tflops: 20, vram_mib: 2048 }),
        ]}
      />
    );
    expect(screen.queryByText(/collecting metrics/i)).not.toBeInTheDocument();
    const chart = screen.getByTestId("gpu-chart");
    expect(chart).toHaveAttribute("data-points", "2");
  });

  it("maps VRAM MiB->GB and clamps negative values at 0", () => {
    render(
      <GPUUsageChart
        data={[
          point({ formatted_time: "10:00", tflops: 50, vram_mib: 2048 }),
          point({ formatted_time: "10:01", tflops: -5, vram_mib: -512 }),
        ]}
      />
    );
    const series = JSON.parse(screen.getByTestId("gpu-chart").getAttribute("data-series")!);
    expect(series).toHaveLength(2);
    // 2048 MiB -> 2 GB; tflops passes through.
    expect(series[0]).toMatchObject({ time: "10:00", tflops: 50, vram: 2 });
    // Negative tflops and VRAM both clamp to 0.
    expect(series[1]).toMatchObject({ time: "10:01", tflops: 0, vram: 0 });
  });
});

/*
 * A bucket the telemetry never reported came through as null, and
 * Math.max(0, null) is 0 — so a week-long range with sparse data drew a
 * confident flat zero and the tooltip read "0.00 TFLOPs / 0.00 GB".
 */
describe("GPUUsageChart — a missing reading is not a zero", () => {
  const series = (_v: unknown) =>
    JSON.parse(
      screen.getByTestId("gpu-chart").getAttribute("data-series") as string
    ) as Array<{ tflops: number | null; vram: number | null }>;

  it("keeps an unreported bucket null instead of plotting it as 0", () => {
    render(
      <GPUUsageChart
        data={[
          point({ unix_timestamp: 1, tflops: 12.5, vram_mib: 4096 }),
          point({ unix_timestamp: 2, tflops: null as unknown as number, vram_mib: null as unknown as number }),
        ]}
      />
    );

    const mapped = series(null);
    expect(mapped[0]).toMatchObject({ tflops: 12.5, vram: 4 });
    // The gap must stay a gap — 0 would claim the GPU measurably did nothing.
    expect(mapped[1].tflops).toBeNull();
    expect(mapped[1].vram).toBeNull();
  });

  it("tells the reader there is no data rather than formatting a zero", () => {
    render(
      <GPUUsageChart
        data={[point({ unix_timestamp: 1, tflops: 1 }), point({ unix_timestamp: 2, tflops: 2 })]}
      />
    );

    expect(capturedFormatter).toBeDefined();
    expect(capturedFormatter!(null, "tflops")).toEqual(["No data", "Compute"]);
    expect(capturedFormatter!(undefined, "vram")).toEqual(["No data", "VRAM"]);
    // A real reading still formats as before.
    expect(capturedFormatter!(12.5, "tflops")).toEqual(["12.50 TFLOPs", "Compute"]);
  });
});
