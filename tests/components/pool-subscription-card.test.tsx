// @vitest-environment jsdom
//
// PA-288: dashboard mop-up. PoolSubscriptionCard is the main GPU subscription
// card. It renders a header (name/status/price), a compact variant, an always-
// visible quick-actions bar (Terminal/Stop/Start gated by the `can` permission
// map), and wires the per-action lifecycle endpoints
// (.../stop|start|restart and DELETE for terminate). It also owns metadata
// editing (PATCH) and fetches connection info / services.
//
// The dashboard barrel ("../") re-exports heavy + premium-excluded modules
// (BareMetalTab, charts, DashboardContent). We mock it down to exactly what
// index.tsx consumes so the test's import graph stays OSS-clean and light.
// The GPUCard* sub-panels and the two storage modals are stubbed too — they
// have their own dedicated test files.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/dashboard/components", () => ({
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid="status-dot">{status}</span>
  ),
  TerminalModal: () => <div data-testid="terminal-modal" />,
  RunScriptModal: () => <div data-testid="run-script-modal" />,
  getGpuStatusText: (status: string, isActive: boolean) =>
    isActive ? "Running" : status,
  getRunningTimeQuip: () => "Crunching numbers",
}));
vi.mock("@/app/dashboard/components/PoolSubscriptionCard/GPUCardSSHInfo", () => ({
  GPUCardSSHInfo: () => <div data-testid="ssh-info" />,
}));
vi.mock("@/app/dashboard/components/PoolSubscriptionCard/GPUCardServices", () => ({
  GPUCardServices: () => <div data-testid="services" />,
}));
vi.mock("@/app/dashboard/components/PoolSubscriptionCard/GPUCardHfDeployment", () => ({
  GPUCardHfDeployment: () => <div data-testid="hf-deployment" />,
}));
vi.mock("@/app/dashboard/components/PoolSubscriptionCard/AddStorageModal", () => ({
  AddStorageModal: () => <div data-testid="add-storage-modal" />,
}));
vi.mock("@/app/dashboard/components/PoolSubscriptionCard/SaveSnapshotModal", () => ({
  SaveSnapshotModal: () => <div data-testid="save-snapshot-modal" />,
}));

import { PoolSubscriptionCard } from "@/app/dashboard/components/PoolSubscriptionCard";
import type { PoolSubscription } from "@/app/dashboard/components/types";

function makeSub(overrides: Partial<PoolSubscription> = {}): PoolSubscription {
  return {
    id: "sub-1",
    pool_name: "RTX Pool",
    status: "running",
    hourlyRate: 0.66,
    region: { region_name: "us-east", city: "Ashburn" },
    pods: [{ pod_name: "pod-1", pod_status: "Running", gpu_count: 2 }],
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  } as PoolSubscription;
}

function stubFetch() {
  // Default: every endpoint returns an empty-ish ok payload. Individual tests
  // can inspect the recorded calls.
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({}),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseProps = { token: "tok", onRefresh: vi.fn() };

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("PoolSubscriptionCard (PA-288)", () => {
  it("renders the pool name, price and a status dot", () => {
    stubFetch();
    render(<PoolSubscriptionCard {...baseProps} subscription={makeSub()} />);
    expect(screen.getByText("RTX Pool")).toBeInTheDocument();
    expect(screen.getByText("$0.66/hr")).toBeInTheDocument();
    expect(screen.getByTestId("status-dot")).toBeInTheDocument();
  });

  it("renders the compact variant with GPU count and no action bar", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard {...baseProps} subscription={makeSub()} compact />,
    );
    expect(screen.getByText("2 GPU")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /terminal/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the Monthly badge and monthly price display when isMonthly", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub()}
        isMonthly
        monthlyPriceDisplay="$199/mo"
      />,
    );
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("$199/mo")).toBeInTheDocument();
  });

  it("renders Terminal and a Pause (stop) button in the quick-action bar for an active pod", () => {
    stubFetch();
    render(<PoolSubscriptionCard {...baseProps} subscription={makeSub()} />);
    expect(screen.getByRole("button", { name: /terminal/i })).toBeInTheDocument();
    // The stop control is labelled "Pause" (gated by gpu.terminate).
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("hides Terminal and Pause when the permission map denies them", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub()}
        can={{ "gpu.access": false, "gpu.terminate": false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /terminal/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
  });

  it("POSTs the stop endpoint when Pause is clicked and confirmed", async () => {
    const fetchMock = stubFetch();
    render(<PoolSubscriptionCard {...baseProps} subscription={makeSub()} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/instances/pool-subscription/sub-1/stop",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("does not stop when the confirm dialog is dismissed", () => {
    const fetchMock = stubFetch();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PoolSubscriptionCard {...baseProps} subscription={makeSub()} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/instances/pool-subscription/sub-1/stop",
      expect.anything(),
    );
  });

  it("DELETEs the subscription from the expanded Terminate action and refreshes", async () => {
    const fetchMock = stubFetch();
    const onRefresh = vi.fn();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        onRefresh={onRefresh}
        subscription={makeSub()}
      />,
    );
    // Expand the card body to reveal the full action set (incl. Terminate).
    fireEvent.click(screen.getByText("RTX Pool"));
    fireEvent.click(screen.getByRole("button", { name: /terminate/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/instances/pool-subscription/sub-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it("starts a stopped pod via the 'Start Instance' button", async () => {
    const fetchMock = stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({
          pods: [{ pod_name: "pod-1", pod_status: "Stopped", gpu_count: 1 }],
        })}
      />,
    );
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start instance/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/instances/pool-subscription/sub-1/start",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("fetches connection info for an active pod when SSH is allowed", async () => {
    const fetchMock = stubFetch();
    render(<PoolSubscriptionCard {...baseProps} subscription={makeSub()} />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/instances/connection-info?instance_id=sub-1",
        expect.objectContaining({ headers: { Authorization: "Bearer tok" } }),
      ),
    );
  });

  it("skips the connection-info fetch for viewers without gpu.access", async () => {
    const fetchMock = stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub()}
        can={{ "gpu.access": false }}
      />,
    );
    // Give effects a tick.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/instances/connection-info?instance_id=sub-1",
      expect.anything(),
    );
  });

  it("shows a terminating label while un_subscribing", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({ status: "un_subscribing" })}
      />,
    );
    expect(screen.getByText("Terminating...")).toBeInTheDocument();
  });

  // PA-80: local/ephemeral storage-full warning banner. Usage arrives on
  // storage_details (stamped by GET /api/instances); amber at 80%, rose at 90%.
  it("shows an amber local-storage warning at 80%+ with the used amount", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({
          storage_details: { ephemeral_storage_percent: 85, ephemeral_storage_used_gb: 42 },
        })}
      />,
    );
    const banner = screen.getByText(/Local storage 85% full/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/42 GB used/)).toBeInTheDocument();
    expect(banner.closest(".items-start")?.className).toContain("bg-amber-50");
  });

  it("escalates the local-storage warning to critical (rose) at 90%+", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({
          storage_details: { ephemeral_storage_percent: 94 },
        })}
      />,
    );
    const banner = screen.getByText(/Local storage 94% full/);
    expect(banner.closest(".items-start")?.className).toContain("bg-rose-50");
  });

  it("does not show the local-storage warning below 80%", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({
          storage_details: { ephemeral_storage_percent: 50 },
        })}
      />,
    );
    expect(screen.queryByText(/Local storage/i)).not.toBeInTheDocument();
  });

  it("does not show the local-storage warning for a stopped pod even at high usage", () => {
    stubFetch();
    render(
      <PoolSubscriptionCard
        {...baseProps}
        subscription={makeSub({
          pods: [{ pod_name: "pod-1", pod_status: "Stopped", gpu_count: 1 }],
          storage_details: { ephemeral_storage_percent: 95 },
        })}
      />,
    );
    expect(screen.queryByText(/Local storage/i)).not.toBeInTheDocument();
  });
  // PA-676: terminate/stop/start/restart each started a status poll inside their
  // click handler, cleared only by a setTimeout 30-60s later — never on unmount.
  // Terminating unmounts the card by design, so the interval outlived it and kept
  // refetching the whole dashboard.
  describe("post-action status polling (PA-676)", () => {
    it("stops polling when the card unmounts mid-poll", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        stubFetch();
        const onRefresh = vi.fn();
        const { unmount } = render(
          <PoolSubscriptionCard {...baseProps} onRefresh={onRefresh} subscription={makeSub()} />,
        );
        fireEvent.click(screen.getByText("RTX Pool"));
        fireEvent.click(screen.getByRole("button", { name: /terminate/i }));

        // Let the DELETE resolve so the poll actually starts.
        await vi.advanceTimersByTimeAsync(2500);
        const whileMounted = onRefresh.mock.calls.length;
        expect(whileMounted).toBeGreaterThan(0);

        unmount();
        // Well past several 2s ticks and the 60s stop timeout.
        await vi.advanceTimersByTimeAsync(70_000);
        expect(onRefresh.mock.calls.length).toBe(whileMounted);
      } finally {
        vi.useRealTimers();
      }
    });

    it("pauses polling while the tab is hidden", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const hidden = vi.spyOn(document, "hidden", "get");
      try {
        hidden.mockReturnValue(false);
        stubFetch();
        const onRefresh = vi.fn();
        render(
          <PoolSubscriptionCard {...baseProps} onRefresh={onRefresh} subscription={makeSub()} />,
        );
        fireEvent.click(screen.getByText("RTX Pool"));
        fireEvent.click(screen.getByRole("button", { name: /terminate/i }));
        await vi.advanceTimersByTimeAsync(2500);
        expect(onRefresh.mock.calls.length).toBeGreaterThan(0);

        hidden.mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        const whileVisible = onRefresh.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(onRefresh.mock.calls.length).toBe(whileVisible);

        // ...and resumes when the tab comes back.
        hidden.mockReturnValue(false);
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(2500);
        expect(onRefresh.mock.calls.length).toBeGreaterThan(whileVisible);
      } finally {
        hidden.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
