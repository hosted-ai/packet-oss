// @vitest-environment jsdom
//
// PA-288: PodDetailModal (src/components/PodDetailModal.tsx) — the customer-side
// per-pod GPU/system metrics modal. This is a PURE presentational component: it
// takes a `pod` snapshot prop and renders it (no fetch, no internal data load).
// Tests pin the conditional render branches (GPU present vs absent, system
// metrics, monitoring status, threshold-driven colour/warning copy) plus the
// two close affordances (backdrop click + close button) and stopPropagation on
// the inner panel.
//
// NOTE: this is the CUSTOMER PodDetailModal at src/components/, distinct from
// the admin one at src/app/admin/components/PodDetailModal.tsx (separately tested).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PodDetailModal } from "@/components/PodDetailModal";

type Pod = Parameters<typeof PodDetailModal>[0]["pod"];

function makeGpu(overrides: Record<string, number> = {}) {
  return {
    utilization: 42,
    memoryUsed: 4096,
    memoryTotal: 24576,
    memoryPercent: 17,
    temperature: 55,
    powerDraw: 120,
    powerLimit: 350,
    fanSpeed: 40,
    ...overrides,
  };
}

function makeSystem(overrides: Record<string, number> = {}) {
  return {
    cpuPercent: 30,
    memoryUsedMb: 8192,
    memoryTotalMb: 16384,
    memoryPercent: 50,
    ...overrides,
  };
}

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    subscriptionId: "sub-1",
    podName: "test-pod-abc",
    poolName: "test-pool",
    status: "running",
    gpu: makeGpu(),
    system: makeSystem(),
    netdataInstalled: true,
    netdataRunning: true,
    ...overrides,
  } as Pod;
}

describe("PodDetailModal (customer) — header + close affordances", () => {
  it("renders the pool name and pod name in the header", () => {
    render(<PodDetailModal pod={makePod()} onClose={() => {}} />);
    expect(screen.getByText("test-pool")).toBeInTheDocument();
    expect(screen.getByText("test-pod-abc")).toBeInTheDocument();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<PodDetailModal pod={makePod()} onClose={onClose} />);
    // The outermost fixed overlay carries the backdrop onClick.
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<PodDetailModal pod={makePod()} onClose={onClose} />);
    // The header X is the only <button> rendered.
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when the inner panel is clicked (stopPropagation)", () => {
    const onClose = vi.fn();
    render(<PodDetailModal pod={makePod()} onClose={onClose} />);
    fireEvent.click(screen.getByText("GPU Metrics"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PodDetailModal (customer) — status + monitoring", () => {
  it("shows the running status pill and 'Monitoring Active' badge when netdata is running", () => {
    render(<PodDetailModal pod={makePod({ status: "running", netdataRunning: true })} onClose={() => {}} />);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Monitoring Active")).toBeInTheDocument();
    expect(screen.getByText("Real-time monitoring active")).toBeInTheDocument();
  });

  it("reports 'installed but not running' when netdata is installed but stopped", () => {
    render(
      <PodDetailModal
        pod={makePod({ netdataRunning: false, netdataInstalled: true })}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Monitoring Active")).not.toBeInTheDocument();
    expect(screen.getByText("Monitoring installed but not running")).toBeInTheDocument();
  });

  it("reports 'not installed' when netdata is absent", () => {
    render(
      <PodDetailModal
        pod={makePod({ netdataRunning: false, netdataInstalled: false })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Monitoring not installed")).toBeInTheDocument();
  });
});

describe("PodDetailModal (customer) — GPU metrics branch", () => {
  it("renders utilization, VRAM, temperature and power when gpu data is present", () => {
    render(<PodDetailModal pod={makePod()} onClose={() => {}} />);
    expect(screen.getByText("GPU Metrics")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument(); // utilization
    expect(screen.getByText("55°C")).toBeInTheDocument(); // temperature
    expect(screen.getByText("120W")).toBeInTheDocument(); // power draw
    expect(screen.getByText("Limit: 350W")).toBeInTheDocument();
  });

  it("formats VRAM in GB above 1024 MB", () => {
    // 4096 MB used / 24576 MB total → "4.0 GB / 24.0 GB"
    render(<PodDetailModal pod={makePod()} onClose={() => {}} />);
    expect(screen.getByText("4.0 GB / 24.0 GB")).toBeInTheDocument();
  });

  it("shows a 'Running hot!' warning at 80°C and above", () => {
    render(<PodDetailModal pod={makePod({ gpu: makeGpu({ temperature: 85 }) })} onClose={() => {}} />);
    expect(screen.getByText("Running hot!")).toBeInTheDocument();
    expect(screen.getByText("85°C")).toBeInTheDocument();
  });

  it("labels a sub-60°C GPU 'Cool' and 60–79°C 'Normal'", () => {
    const { rerender } = render(
      <PodDetailModal pod={makePod({ gpu: makeGpu({ temperature: 50 }) })} onClose={() => {}} />,
    );
    expect(screen.getByText("Cool")).toBeInTheDocument();

    rerender(<PodDetailModal pod={makePod({ gpu: makeGpu({ temperature: 70 }) })} onClose={() => {}} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("hides the Fan Speed tile when fanSpeed is 0", () => {
    render(<PodDetailModal pod={makePod({ gpu: makeGpu({ fanSpeed: 0 }) })} onClose={() => {}} />);
    expect(screen.queryByText("Fan Speed")).not.toBeInTheDocument();
  });

  it("falls back to a 'GPU metrics not available' message with the error when gpu is null", () => {
    render(
      <PodDetailModal
        pod={makePod({ gpu: null, error: "agent unreachable" })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("GPU metrics not available")).toBeInTheDocument();
    expect(screen.getByText("agent unreachable")).toBeInTheDocument();
    expect(screen.queryByText("GPU Metrics")).not.toBeInTheDocument();
  });
});

describe("PodDetailModal (customer) — system metrics + timestamp", () => {
  it("renders CPU and system RAM when system data is present", () => {
    render(<PodDetailModal pod={makePod({ system: makeSystem({ cpuPercent: 30, memoryPercent: 50 }) })} onClose={() => {}} />);
    const heading = screen.getByText("System Metrics");
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    expect(screen.getByText("System RAM")).toBeInTheDocument();
  });

  it("omits the System Metrics section entirely when system is null", () => {
    render(<PodDetailModal pod={makePod({ system: null })} onClose={() => {}} />);
    expect(screen.queryByText("System Metrics")).not.toBeInTheDocument();
  });

  it("renders the 'Last updated' timestamp only when timestamp is provided", () => {
    const { rerender } = render(<PodDetailModal pod={makePod()} onClose={() => {}} />);
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();

    rerender(<PodDetailModal pod={makePod()} timestamp="2026-06-14T12:00:00Z" onClose={() => {}} />);
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });
});
