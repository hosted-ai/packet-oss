// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — admin PodDetailModal
// (src/app/admin/components/PodDetailModal.tsx — NOT src/components/PodDetailModal).
// Controlled by isOpen (null when closed). On open it loads
// /api/admin/pods/history?subscriptionId=...&hours=24&interval=5, renders the
// pod header / status / owner / IDs, and exposes start/stop/restart/terminate
// actions that POST /api/admin/pods/{subscriptionId} with { action, teamId }.
// Terminate requires a two-step confirm. Pins the conditional action buttons by
// status, the SSH command, owner-less rendering, and the no-history state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PodDetailModal } from "@/app/admin/components/PodDetailModal";

type Json = Record<string, unknown>;

let historyPayload: Json;

function makeFetch() {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    if (url.startsWith("/api/admin/pods/history")) {
      return Promise.resolve({ ok: true, json: async () => historyPayload });
    }
    // POST action
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

 
const pod = (over: Json = {}): any => ({
  subscriptionId: "sub-123456789012",
  teamId: "team-9",
  poolId: 4,
  poolName: "pool-zeta",
  status: "active",
  vgpuCount: 2,
  podName: "worker-1",
  owner: { customerId: "cus_1", email: "owner@example.com", name: "Pod Owner" },
  ssh: { host: "10.0.0.5", port: 2222, username: "ubuntu" },
  metadata: { displayName: "Zeta Worker", deployTime: "2026-01-01T00:00:00Z" },
  ...over,
});

function renderOpen(over: Json = {}) {
  const onClose = vi.fn();
  const onActionComplete = vi.fn();
  render(
    <PodDetailModal
      pod={pod(over)}
      isOpen
      onClose={onClose}
      onActionComplete={onActionComplete}
    />
  );
  return { onClose, onActionComplete };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // default: no history
  historyPayload = { history: [] };
  // jsdom has no clipboard by default
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("admin PodDetailModal", () => {
  it("renders nothing when isOpen is false", () => {
    makeFetch();
    const { container } = render(
      <PodDetailModal
        pod={pod()}
        isOpen={false}
        onClose={vi.fn()}
        onActionComplete={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the display name, pool and status", async () => {
    makeFetch();
    renderOpen();
    expect(await screen.findByText("Zeta Worker")).toBeInTheDocument();
    expect(screen.getByText("pool-zeta")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("loads pod history on open with the default 24h window", async () => {
    const fetchMock = makeFetch();
    renderOpen();
    await screen.findByText("Zeta Worker");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          (c[0] as string).startsWith(
            "/api/admin/pods/history?subscriptionId=sub-123456789012&hours=24&interval=5"
          )
        )
      ).toBe(true);
    });
  });

  it("renders the owner block with email and customer id", async () => {
    makeFetch();
    renderOpen();
    await screen.findByText("Pod Owner");
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("cus_1")).toBeInTheDocument();
  });

  it("renders the unowned-pod notice when there is no owner", async () => {
    makeFetch();
    renderOpen({ owner: undefined });
    expect(await screen.findByText(/unowned pod - no billing/i)).toBeInTheDocument();
  });

  it("renders the SSH command from host/port/username", async () => {
    makeFetch();
    renderOpen();
    await screen.findByText("Zeta Worker");
    expect(
      screen.getByText("ssh -p 2222 ubuntu@10.0.0.5")
    ).toBeInTheDocument();
  });

  it("shows the no-history placeholder when there are no data points", async () => {
    makeFetch();
    renderOpen();
    expect(
      await screen.findByText(/no historical data available for this pod yet/i)
    ).toBeInTheDocument();
  });

  it("shows Stop and Restart (but not Start) for an active pod", async () => {
    makeFetch();
    renderOpen({ status: "active" });
    await screen.findByText("Zeta Worker");
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^restart$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start$/i })).not.toBeInTheDocument();
  });

  it("shows Start (but not Stop) for a stopped pod", async () => {
    makeFetch();
    renderOpen({ status: "stopped" });
    await screen.findByText("Zeta Worker");
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
  });

  it("hides the Terminate button while the pod is transitioning", async () => {
    makeFetch();
    renderOpen({ status: "subscribing" });
    await screen.findByText("Zeta Worker");
    expect(
      screen.queryByRole("button", { name: /terminate/i })
    ).not.toBeInTheDocument();
  });

  it("POSTs a stop action with the team id", async () => {
    const fetchMock = makeFetch();
    const { onActionComplete } = renderOpen({ status: "active" });
    await screen.findByText("Zeta Worker");
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/admin/pods/sub-123456789012" && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(call![1]!.body as string);
      expect(body.action).toBe("stop");
      expect(body.teamId).toBe("team-9");
    });
    await waitFor(() => expect(onActionComplete).toHaveBeenCalled());
  });

  it("requires a confirmation before terminating (first click shows confirm, no POST)", async () => {
    const fetchMock = makeFetch();
    renderOpen({ status: "active" });
    await screen.findByText("Zeta Worker");
    fireEvent.click(screen.getByRole("button", { name: /^terminate$/i }));
    expect(await screen.findByText(/confirm termination/i)).toBeInTheDocument();
    // No terminate POST has fired yet.
    expect(
      fetchMock.mock.calls.some(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "terminate"
      )
    ).toBe(false);
  });

  it("POSTs terminate after the confirmation is accepted and closes the modal", async () => {
    const fetchMock = makeFetch();
    const { onClose } = renderOpen({ status: "active" });
    await screen.findByText("Zeta Worker");
    fireEvent.click(screen.getByRole("button", { name: /^terminate$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm terminate/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST" &&
          JSON.parse((c[1]!.body as string)).action === "terminate"
      );
      expect(call).toBeTruthy();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("calls onClose when the header close button is clicked", async () => {
    makeFetch();
    const { onClose } = renderOpen();
    await screen.findByText("Zeta Worker");
    // The header close button has no accessible name; it's the first button.
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
