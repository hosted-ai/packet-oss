// @vitest-environment jsdom
//
// PA-287: GPUMetricsDoc is a static documentation panel covering the GPU
// metrics dashboard. These tests pin the title, the key feature list, the
// metric-interpretation sections, and the CLI monitoring snippets.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { GPUMetricsDoc } from "@/app/dashboard/components/docs/GPUMetricsDoc";

describe("GPUMetricsDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<GPUMetricsDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/gpu monitoring and analytics for your instances/i),
    ).toBeInTheDocument();
  });

  it("documents the dashboard-sections and understanding-metrics areas", () => {
    render(<GPUMetricsDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /dashboard sections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /understanding metrics/i }),
    ).toBeInTheDocument();
  });

  it("describes the fixed 60-second refresh interval", () => {
    render(<GPUMetricsDoc />);
    expect(screen.getByText(/updates every 60 seconds/i)).toBeInTheDocument();
    expect(
      screen.getByText(/refresh interval is not configurable/i),
    ).toBeInTheDocument();
  });

  it("lists inference metrics including tokens/sec and time to first token", () => {
    render(<GPUMetricsDoc />);
    expect(screen.getAllByText(/tokens\/sec/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/time to first token/i)).toBeInTheDocument();
    expect(
      screen.getByText(/panel refreshes every 10 seconds/i),
    ).toBeInTheDocument();
  });

  it("shows the nvidia-smi CLI monitoring snippet", () => {
    render(<GPUMetricsDoc />);
    expect(
      screen.getByText(/nvidia-smi --query-gpu=utilization\.gpu --format=csv/),
    ).toBeInTheDocument();
  });

  it("documents Prometheus integration with vLLM metric names", () => {
    render(<GPUMetricsDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /prometheus integration/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/vllm:num_requests_running/),
    ).toBeInTheDocument();
  });

  it("describes automatic storage alerts with fixed thresholds", () => {
    render(<GPUMetricsDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /alerting/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/persistent storage/i)).toBeInTheDocument();
    expect(screen.getByText("≥90%")).toBeInTheDocument();
    expect(
      screen.getByText(/per-metric alerts .* are not currently available/i),
    ).toBeInTheDocument();
  });
});
