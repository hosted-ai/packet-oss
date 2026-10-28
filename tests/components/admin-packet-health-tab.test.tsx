// @vitest-environment jsdom
//
// PA-693 — PacketHealthTab. Self-fetches /api/admin/packet-health?period=1d,
// renders one card per metric #1–12 in dictionary order, the Stripe
// reconciliation strip, and the notes (honesty labels). Pins the period
// switch, the custom-range gate (no fetch until both dates picked), the manual
// refresh, and the error+retry path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { PacketHealthTab } from "@/app/admin/components/PacketHealthTab";

type Json = Record<string, unknown>;

let payload: Json;
let succeed = true;

function makeFetch() {
  const fetchMock = vi.fn((url: string) => {
    if ((url as string).startsWith("/api/admin/packet-health")) {
      return Promise.resolve({
        ok: true,
        json: async () =>
          succeed ? { success: true, ...payload } : { success: false, error: "metrics down" },
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const healthPayload = (over: Json = {}): Json => ({
  period: "1d",
  window: { start: "2026-08-06T00:00:00.000Z", end: "2026-08-06T23:59:59.999Z" },
  asOf: "2026-08-06T23:59:59.999Z",
  cachedAt: "2026-08-07T00:30:00.000Z",
  metrics: {
    signups: 7,
    timeToFirstJob: { medianHours: 4.5, n: 3, cohortSize: 5, workloadBasisN: 2, deployProxyN: 1 },
    activePaying: {
      total: 12,
      onDemand: 9,
      monthly: 5,
      dedicated: { total: 6, onDemandByGpuType: { H100: 4 }, monthlyByGpuType: { H100: 2 } },
      dynamic: { total: 5, onDemandByGpuType: { L40S: 5 }, monthlyByGpuType: {} },
      unknownPool: 1,
    },
    mrr: {
      totalCents: 360_000,
      dailyProratedCents: 12_000,
      dedicatedMonthlyByGpuType: { H100: 150_000 },
      dynamicMonthlyByGpuType: { L40S: 210_000 },
      unknownPoolCents: 0,
      stripeLiveCents: 350_000,
      stripeDeltaCents: 10_000,
    },
    consumption: {
      trailing30dCents: 100_000,
      runRateCents: 1_200_000,
      byGrain: { "1d": 4_000, "7d": 28_000, "1m": 100_000 },
      dedicatedByGpuType: { H100: 60_000 },
      dynamicByGpuType: { L40S: 30_000 },
      unknownPoolCents: 10_000,
    },
    revenue: { totalCents: 50_000, subscriptionCents: 30_000, consumptionCents: 21_000, refundCents: 1_000 },
    suppliers: 2,
    activeGpus: {
      total: { physical: 5, vgpuSlots: 14 },
      dedicated: { physical: 2, vgpuSlots: 2 },
      dynamic: { physical: 3, vgpuSlots: 12 },
      byModel: { H100: { physical: 2, vgpuSlots: 2 }, L40S: { physical: 3, vgpuSlots: 12 } },
    },
    availableGpuHours: {
      physicalGpuHours: 120,
      vgpuSlotHours: 336,
      basis: "snapshot",
      snapshotDays: 1,
      windowDays: 1,
    },
    utilization: {
      billedGpuHours: 100,
      committedMonthlyGpuHours: 36,
      rentedGpuHours: 136,
      availableVgpuSlotHours: 336,
      pct: 40.48,
      capacityBasis: "snapshot",
      snapshotDays: 1,
      windowDays: 1,
    },
  },
  reconciliation: {
    stripeWindowPayers: 4,
    stripeGrossVolumeCents: 90_000,
    stripeLiveMrrCents: 350_000,
  },
  notes: ["suppliers and active GPUs are live snapshots (no fleet history exists)"],
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  payload = healthPayload();
  succeed = true;
});

describe("PacketHealthTab", () => {
  it("shows the loading spinner before the fetch resolves", () => {
    makeFetch();
    const { container } = render(<PacketHealthTab />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("fetches the default 1d period on mount and renders the dictionary cards", async () => {
    const fetchMock = makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("1 · Signups (completed)");

    expect(
      fetchMock.mock.calls.some((c) => (c[0] as string).includes("/api/admin/packet-health?period=1d")),
    ).toBe(true);
    expect(screen.getByText("7")).toBeInTheDocument(); // signups
    expect(screen.getByText("4.5 h")).toBeInTheDocument(); // TTFJ median
    expect(screen.getByText("$3,600")).toBeInTheDocument(); // MRR 360_000c
    expect(screen.getByText("$12,000")).toBeInTheDocument(); // run-rate 1_200_000c
    expect(screen.getByText("40.48%")).toBeInTheDocument(); // utilization
    expect(screen.getByText(/subs \$300 \+ usage \$210 − refunds \$10/)).toBeInTheDocument();
  });

  it("renders breakdown rows and the reconciliation strip", async () => {
    makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("4 · Active Paying — Dedicated");

    expect(screen.getAllByText("H100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L40S").length).toBeGreaterThan(0);
    expect(screen.getByText("2 / 2")).toBeInTheDocument(); // H100 physical / vGPU slots
    expect(screen.getByText("3 / 12")).toBeInTheDocument(); // L40S
    expect(screen.getByText("Stripe reconciliation")).toBeInTheDocument();
    expect(screen.getByText("$900")).toBeInTheDocument(); // gross volume 90_000c
  });

  it("renders the notes strip (honesty labels)", async () => {
    makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("Notes");
    expect(screen.getByText(/live snapshots/)).toBeInTheDocument();
  });

  it("refetches when a period pill is clicked", async () => {
    const fetchMock = makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("1 · Signups (completed)");
    fireEvent.click(screen.getByRole("button", { name: /7 days/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("period=7d"))).toBe(true);
    });
  });

  it("custom period waits for BOTH dates before fetching", async () => {
    const fetchMock = makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("1 · Signups (completed)");
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /custom/i }));
    expect(await screen.findByText(/pick both dates/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-07-01" } });
    expect(fetchMock).not.toHaveBeenCalled(); // still only one date

    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-07-31" } });
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          (c[0] as string).includes("period=custom&from=2026-07-01&to=2026-07-31"),
        ),
      ).toBe(true);
    });
  });

  it("refreshes with refresh=true when Refresh is clicked", async () => {
    const fetchMock = makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("1 · Signups (completed)");
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("refresh=true"))).toBe(true);
    });
  });

  it("renders '—' for metrics that degraded to null", async () => {
    payload = healthPayload({
      metrics: {
        ...(healthPayload().metrics as Json),
        signups: null,
        utilization: null,
        availableGpuHours: null,
      },
    });
    makeFetch();
    render(<PacketHealthTab />);
    await screen.findByText("1 · Signups (completed)");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the error state with a Retry button when the API reports failure", async () => {
    succeed = false;
    makeFetch();
    render(<PacketHealthTab />);
    expect(await screen.findByText("metrics down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
