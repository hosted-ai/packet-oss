// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 3): UsageChart — 14-day spend area chart driven by a
// transactions prop. recharts doesn't lay out in jsdom, so we stub it to echo
// the data it receives and assert the shaped series rather than pixels.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Echo the AreaChart's `data` prop so we can assert the bucketed series.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data }: { data: Array<{ spend: number }> }) => (
    <div data-testid="area-chart" data-points={data.length} data-total={data.reduce((s, d) => s + d.spend, 0)} />
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

import { UsageChart } from "@/app/dashboard/components/UsageChart";

function daysAgo(n: number): number {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

describe("UsageChart", () => {
  it("renders the empty placeholder when there is no debit spend", () => {
    render(<UsageChart transactions={[]} />);
    expect(screen.getByText(/no usage data yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();
  });

  it("treats credit-only history as no spend (placeholder shown)", () => {
    render(
      <UsageChart
        transactions={[{ created: daysAgo(1), amount: 5000, type: "credit" }]}
      />
    );
    expect(screen.getByText(/no usage data yet/i)).toBeInTheDocument();
  });

  it("renders the chart with 14 day-buckets once there is debit spend", () => {
    render(
      <UsageChart
        transactions={[{ created: daysAgo(2), amount: -1000, type: "debit" }]}
      />
    );
    const chart = screen.getByTestId("area-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute("data-points", "14");
  });

  it("sums debit amounts into the spend series (cents → dollars)", () => {
    render(
      <UsageChart
        transactions={[
          { created: daysAgo(1), amount: -1000, type: "debit" }, // $10
          { created: daysAgo(1), amount: -500, type: "debit" }, //  $5
          { created: daysAgo(3), amount: -2000, type: "debit" }, // $20
        ]}
      />
    );
    const chart = screen.getByTestId("area-chart");
    // 10 + 5 + 20 = 35 dollars total across the buckets
    expect(Number(chart.getAttribute("data-total"))).toBeCloseTo(35, 2);
  });

  it("ignores debits older than the 14-day window", () => {
    render(
      <UsageChart
        transactions={[{ created: daysAgo(40), amount: -9999, type: "debit" }]}
      />
    );
    // No debit lands in a bucket, so it reads as empty.
    expect(screen.getByText(/no usage data yet/i)).toBeInTheDocument();
  });

  it("ignores credits even when debits are present", () => {
    render(
      <UsageChart
        transactions={[
          { created: daysAgo(1), amount: -1000, type: "debit" },
          { created: daysAgo(1), amount: 5000, type: "credit" },
        ]}
      />
    );
    const chart = screen.getByTestId("area-chart");
    expect(Number(chart.getAttribute("data-total"))).toBeCloseTo(10, 2);
  });
});
