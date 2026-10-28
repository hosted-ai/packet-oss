// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. metrics/PodDetailModal is a pure prop-driven modal
// (the parent owns the data fetch). It renders GPU + system metric tiles from
// the `pod` prop, a period/granularity selector that fires callbacks, and the
// graph area which switches between loading spinner, the recharts chart, and a
// "no historical data" empty state based on `loading`/`data`.
//
// recharts is stubbed to data-echoing divs so the chart branch is testable
// under jsdom (which lacks the layout APIs ResponsiveContainer needs).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Passthrough,
    LineChart: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="line-chart">{children}</div>
    ),
    Line: () => <div data-testid="chart-line" />,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
  };
});

import { PodDetailModal } from "@/app/dashboard/components/metrics/PodDetailModal";

type Pod = Parameters<typeof PodDetailModal>[0]["pod"];

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    subscriptionId: "sub-1",
    podName: "pod-abc",
    poolName: "RTX Pool",
    regionName: "us-east",
    status: "running",
    uptime: "2h",
    gpuCount: 1,
    hoursUsed: 2,
    estimatedCost: 1.32,
    sshAvailable: true,
    exposedServicesCount: 0,
    imageName: "pytorch:2.1",
    vcpuCount: 8,
    ramMb: 32768,
    gpu: {
      utilization: 73.4,
      memoryUsed: 16384,
      memoryTotal: 98304,
      memoryPercent: 16.6,
      temperature: 65.2,
      powerDraw: 210.7,
      powerLimit: 300,
      fanSpeed: 40,
    },
    system: {
      cpuPercent: 22.5,
      memoryUsedMb: 8192,
      memoryTotalMb: 32768,
      memoryPercent: 25,
    },
    ...overrides,
  };
}

const baseProps = {
  period: "24h" as const,
  granularity: "hourly" as const,
  onPeriodChange: vi.fn(),
  onGranularityChange: vi.fn(),
  loading: false,
  data: null,
};

describe("PodDetailModal (PA-288)", () => {
  it("renders the pool and pod names in the header", () => {
    render(<PodDetailModal {...baseProps} pod={makePod()} onClose={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "RTX Pool" }),
    ).toBeInTheDocument();
    expect(screen.getByText("pod-abc")).toBeInTheDocument();
  });

  it("renders formatted GPU metric tiles", () => {
    render(<PodDetailModal {...baseProps} pod={makePod()} onClose={vi.fn()} />);
    expect(screen.getByText("73%")).toBeInTheDocument(); // utilization rounded
    expect(screen.getByText("16.0 GB")).toBeInTheDocument(); // VRAM used /1024
    expect(screen.getByText("65°C")).toBeInTheDocument(); // temperature
    expect(screen.getByText("211W")).toBeInTheDocument(); // power draw
  });

  it("renders em-dashes for missing GPU/system metrics", () => {
    render(
      <PodDetailModal
        {...baseProps}
        pod={makePod({ gpu: null, system: null })}
        onClose={vi.fn()}
      />,
    );
    // 4 GPU tiles (util, VRAM, temp, power) + CPU + System RAM = 6 dashes
    expect(screen.getAllByText("—")).toHaveLength(6);
  });

  it("shows the loading spinner area when loading is true", () => {
    const { container } = render(
      <PodDetailModal {...baseProps} loading pod={makePod()} onClose={vi.fn()} />,
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("renders the chart when graph data is present", () => {
    render(
      <PodDetailModal
        {...baseProps}
        pod={makePod()}
        onClose={vi.fn()}
        data={{
          pods: [],
          totals: {} as never,
          graph: {
            granularity: "hourly",
            data: [
              { timestamp: "2026-06-01T00:00:00Z", utilization: 50, hours: 1 },
            ],
          },
        }}
      />,
    );
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("chart-line")).toBeInTheDocument();
  });

  it("shows the no-data empty state when the graph has zero points", () => {
    render(
      <PodDetailModal
        {...baseProps}
        pod={makePod()}
        onClose={vi.fn()}
        data={{
          pods: [],
          totals: {} as never,
          graph: { granularity: "hourly", data: [] },
        }}
      />,
    );
    expect(
      screen.getByText(/no historical data available/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("fires onPeriodChange when a period button is clicked", () => {
    const onPeriodChange = vi.fn();
    render(
      <PodDetailModal
        {...baseProps}
        onPeriodChange={onPeriodChange}
        pod={makePod()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onPeriodChange).toHaveBeenCalledWith("7d");
  });

  it("shows the granularity selector only for longer periods", () => {
    const { rerender } = render(
      <PodDetailModal
        {...baseProps}
        period="5m"
        pod={makePod()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Hourly" }),
    ).not.toBeInTheDocument();

    rerender(
      <PodDetailModal
        {...baseProps}
        period="24h"
        pod={makePod()}
        onClose={vi.fn()}
      />,
    );
    const onGranularityChange = baseProps.onGranularityChange;
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    expect(onGranularityChange).toHaveBeenCalledWith("daily");
  });

  it("fires onClose from the header close button", () => {
    const onClose = vi.fn();
    render(<PodDetailModal {...baseProps} pod={makePod()} onClose={onClose} />);
    // The first button is the icon-only close button in the header.
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
