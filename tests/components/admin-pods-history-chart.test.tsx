// @vitest-environment jsdom
//
// PA-288: Unit coverage for the admin pods HistoryChart — a prop-driven GPU
// usage history panel. It renders a hand-rolled SVG line chart (not recharts),
// a time-range selector (1h/6h/24h/7d), a refresh button, plus loading and
// empty states, an aggregate summary row, and a per-pod breakdown.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { HistoryChart, type PodHistory } from "@/app/admin/components/pods/HistoryChart";

function makePod(overrides: Partial<PodHistory> = {}): PodHistory {
  return {
    subscriptionId: "sub_1",
    poolId: 1,
    poolName: "Pool Alpha",
    dataPoints: [
      { timestamp: "2026-06-14T10:00:00Z", gpuUtilization: 40, memoryPercent: 30, temperature: 55, powerDraw: 200 },
      { timestamp: "2026-06-14T10:03:00Z", gpuUtilization: 60, memoryPercent: 50, temperature: 60, powerDraw: 250 },
      { timestamp: "2026-06-14T10:06:00Z", gpuUtilization: 80, memoryPercent: 70, temperature: 65, powerDraw: 300 },
    ],
    summary: {
      avgUtilization: 60,
      maxUtilization: 80,
      avgMemoryPercent: 50,
      avgTemperature: 60,
      totalDataPoints: 3,
    },
    ...overrides,
  };
}

function baseProps() {
  return {
    historyData: [] as PodHistory[],
    historyLoading: false,
    historyHours: 24,
    setHistoryHours: vi.fn(),
    loadHistory: vi.fn(),
  };
}

describe("HistoryChart", () => {
  it("renders the panel title and time-range buttons", () => {
    render(<HistoryChart {...baseProps()} />);
    expect(
      screen.getByRole("heading", { name: /gpu usage history/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7d" })).toBeInTheDocument();
  });

  it("shows the loading state when historyLoading is true", () => {
    render(<HistoryChart {...baseProps()} historyLoading />);
    expect(screen.getByText(/loading history\.\.\./i)).toBeInTheDocument();
    expect(screen.queryByText(/no historical data/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when there is no data", () => {
    render(<HistoryChart {...baseProps()} historyData={[]} />);
    expect(screen.getByText(/no historical data available yet/i)).toBeInTheDocument();
    expect(screen.getByText(/collected every 3 minutes/i)).toBeInTheDocument();
  });

  it("calls setHistoryHours with the chosen range", () => {
    const props = baseProps();
    render(<HistoryChart {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    expect(props.setHistoryHours).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(props.setHistoryHours).toHaveBeenCalledWith(168);
  });

  it("calls loadHistory when the refresh button is clicked", () => {
    const props = baseProps();
    const { container } = render(<HistoryChart {...props} />);
    // The refresh button is the last button in the header controls.
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(props.loadHistory).toHaveBeenCalledTimes(1);
  });

  it("renders the aggregate chart and pod count when data is present", () => {
    render(<HistoryChart {...baseProps()} historyData={[makePod()]} />);
    expect(
      screen.getByText(/average gpu utilization \(all pods\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText("1 pod tracked")).toBeInTheDocument();
  });

  it("pluralizes the tracked-pod count for multiple pods", () => {
    render(
      <HistoryChart
        {...baseProps()}
        historyData={[makePod(), makePod({ subscriptionId: "sub_2" })]}
      />,
    );
    expect(screen.getByText("2 pods tracked")).toBeInTheDocument();
  });

  it("renders the aggregate summary stats without NaN", () => {
    render(<HistoryChart {...baseProps()} historyData={[makePod()]} />);
    // Labels are unique to the aggregate summary row.
    expect(screen.getByText("Avg Utilization")).toBeInTheDocument();
    expect(screen.getByText("Peak Utilization")).toBeInTheDocument();
    expect(screen.getByText("Avg VRAM Usage")).toBeInTheDocument();
    expect(screen.getByText("60°C")).toBeInTheDocument();
    // The summary percentages render (values may repeat in the per-pod
    // breakdown, so we only assert presence, not uniqueness).
    expect(screen.getAllByText("60.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("renders an SVG path for the line series", () => {
    const { container } = render(
      <HistoryChart {...baseProps()} historyData={[makePod()]} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    // At least the filled-area + line paths should be present.
    expect(container.querySelectorAll("svg path").length).toBeGreaterThan(0);
  });

  it("renders the collapsible per-pod breakdown", () => {
    render(<HistoryChart {...baseProps()} historyData={[makePod()]} />);
    const summary = screen.getByText(/per-pod breakdown \(1 pods\)/i);
    expect(summary).toBeInTheDocument();
    expect(screen.getByText("Pool Alpha")).toBeInTheDocument();
    expect(screen.getByText("3 data points")).toBeInTheDocument();
  });

  it("falls back to a Pod label when poolName is missing", () => {
    render(
      <HistoryChart
        {...baseProps()}
        historyData={[makePod({ poolName: undefined, subscriptionId: "sub_xyz" })]}
      />,
    );
    expect(screen.getByText("Pod sub_xyz")).toBeInTheDocument();
  });

  it("caps the breakdown at 10 pods and notes the remainder", () => {
    const pods = Array.from({ length: 12 }, (_, i) =>
      makePod({ subscriptionId: `sub_${i}`, poolName: `Pool ${i}` }),
    );
    render(<HistoryChart {...baseProps()} historyData={pods} />);
    expect(screen.getByText(/\.\.\. and 2 more pods/i)).toBeInTheDocument();
    // Pool 0..9 shown, Pool 10/11 not in the breakdown rows.
    const details = screen.getByText(/per-pod breakdown/i).closest("details")!;
    expect(within(details).queryByText("Pool 10")).not.toBeInTheDocument();
  });
});
