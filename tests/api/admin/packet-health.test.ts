// Tests for GET /api/admin/packet-health (PA-693) — the queryable endpoint for
// platform metrics #1–12. The compute itself is pinned in
// tests/lib/platform-metrics.test.ts; here we pin the route contract:
//   * auth gating (401 no cookie / bad token)
//   * period param mapping (default 1d, presets pass through, invalid → 400)
//   * custom-range validation (missing/garbage/impossible/inverted/too-large → 400)
//   * module cache (hit without refresh, bypass with refresh=true)
//   * Stripe reconciliation block (payers + gross volume; degrades to nulls)
//   * the 500 path
//
// NOTE: the route keeps a module-level 6h cache keyed by period. Every test
// passes refresh=true or uses a unique custom range so tests never see another
// test's cached payload (business-metrics.test.ts discipline).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  verifySessionToken: vi.fn(),
  getStripe: vi.fn(),
  chargesList: vi.fn(),
  computePlatformMetrics: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: h.verifySessionToken }));
vi.mock("@/lib/stripe", () => ({ getStripe: h.getStripe }));
// resolveWindow stays REAL (it is the validation under test); only the compute
// orchestrator is stubbed.
vi.mock("@/lib/platform-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform-metrics")>()),
  computePlatformMetrics: h.computePlatformMetrics,
}));

import { GET } from "@/app/api/admin/packet-health/route";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", "admin_session=valid-token");
  return new NextRequest(
    `http://localhost/api/admin/packet-health${query ? `?${query}` : ""}`,
    { method: "GET", headers },
  );
}

function fakeMetrics(label = "1d") {
  const start = new Date("2026-08-06T00:00:00.000Z");
  const end = new Date("2026-08-06T23:59:59.999Z");
  return {
    window: { start, end, label },
    asOf: end,
    signups: 3,
    timeToFirstJob: { medianHours: 4, n: 3, cohortSize: 5, workloadBasisN: 2, deployProxyN: 1 },
    activePaying: null,
    mrr: { totalCents: 360_000, dailyProratedCents: 12_000, dedicatedMonthlyByGpuType: {},
      dynamicMonthlyByGpuType: {}, unknownPoolCents: 0, stripeLiveCents: 350_000,
      stripeDeltaCents: 10_000 },
    consumption: null,
    revenue: { totalCents: 50_000, subscriptionCents: 30_000, consumptionCents: 21_000, refundCents: 1_000 },
    suppliers: 2,
    activeGpus: null,
    availableGpuHours: null,
    utilization: null,
    notes: ["fixture note"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.verifySessionToken.mockReturnValue(true);
  h.computePlatformMetrics.mockResolvedValue(fakeMetrics());
  h.getStripe.mockRejectedValue(new Error("Stripe not configured"));
  h.chargesList.mockResolvedValue({ has_more: false, data: [] });
});

describe("GET /api/admin/packet-health", () => {
  it("401 without a session cookie, 401 on a bad token", async () => {
    expect((await GET(makeRequest("", { withSession: false }))).status).toBe(401);
    h.verifySessionToken.mockReturnValue(false);
    expect((await GET(makeRequest())).status).toBe(401);
    expect(h.computePlatformMetrics).not.toHaveBeenCalled();
  });

  it("defaults to period=1d and returns the metrics + notes payload", async () => {
    const res = await GET(makeRequest("refresh=true"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // The same `now` used to resolve/validate the window is threaded into the
    // compute, so the payload can't describe a different window than it used.
    expect(h.computePlatformMetrics).toHaveBeenCalledWith("1d", expect.any(Date));
    expect(body).toMatchObject({
      success: true,
      period: "1d",
      window: { start: "2026-08-06T00:00:00.000Z", end: "2026-08-06T23:59:59.999Z" },
      asOf: "2026-08-06T23:59:59.999Z",
      metrics: {
        signups: 3,
        mrr: { totalCents: 360_000 },
        revenue: { totalCents: 50_000 },
        suppliers: 2,
      },
      reconciliation: {
        stripeWindowPayers: null, // Stripe unconfigured in this run
        stripeGrossVolumeCents: null,
        stripeLiveMrrCents: 350_000, // mirrored from the MRR block
      },
    });
    expect(body.notes).toContain("fixture note");
    expect(body.notes).toContain("Stripe reconciliation unavailable this run");
    expect(body.cachedAt).toBeTruthy();
  });

  it("passes 7d / 1m through and 400s an unknown period", async () => {
    await GET(makeRequest("period=7d&refresh=true"));
    expect(h.computePlatformMetrics).toHaveBeenCalledWith("7d", expect.any(Date));
    await GET(makeRequest("period=1m&refresh=true"));
    expect(h.computePlatformMetrics).toHaveBeenCalledWith("1m", expect.any(Date));

    const res = await GET(makeRequest("period=90d&refresh=true"));
    expect(res.status).toBe(400);
  });

  it("validates custom ranges before any compute runs", async () => {
    const cases = [
      "period=custom", // missing from/to
      "period=custom&from=2026-07-01", // missing to
      "period=custom&from=garbage&to=2026-07-31", // malformed
      "period=custom&from=2026-02-31&to=2026-03-01", // impossible date
      "period=custom&from=2026-07-31&to=2026-07-01", // inverted
      "period=custom&from=2024-01-01&to=2026-07-01", // > 366 days
    ];
    for (const q of cases) {
      const res = await GET(makeRequest(`${q}&refresh=true`));
      expect(res.status, q).toBe(400);
    }
    expect(h.computePlatformMetrics).not.toHaveBeenCalled();

    h.computePlatformMetrics.mockResolvedValue(fakeMetrics("2026-07-01 → 2026-07-31"));
    const ok = await GET(makeRequest("period=custom&from=2026-07-01&to=2026-07-31&refresh=true"));
    expect(ok.status).toBe(200);
    expect(h.computePlatformMetrics).toHaveBeenCalledWith(
      { from: "2026-07-01", to: "2026-07-31" },
      expect.any(Date),
    );
  });

  it("keys the cache on the RESOLVED window, so a preset can't serve the previous day", async () => {
    // "1d" means a different day either side of 00:00 UTC. A label-keyed cache
    // would serve the pre-midnight payload for the rest of the 6h TTL — right
    // when the Daily Ops summary posts (00:30 UTC) and someone compares them.
    vi.useFakeTimers();
    try {
      // Dates deliberately far from the suite's real "now" — the route's cache
      // is module-level and shared across tests in this file.
      // 22:00 UTC — "1d" resolves to May 19.
      vi.setSystemTime(new Date("2026-05-20T22:00:00.000Z"));
      await GET(makeRequest("period=1d"));
      expect(h.computePlatformMetrics).toHaveBeenCalledTimes(1);

      // Same clock → cache hit (the key is stable within a day).
      await GET(makeRequest("period=1d"));
      expect(h.computePlatformMetrics).toHaveBeenCalledTimes(1);

      // 00:31 UTC next day, only 2.5h later (well inside the 6h TTL) — but "1d"
      // now means May 20, so this MUST recompute rather than serve May 19.
      vi.setSystemTime(new Date("2026-05-21T00:31:00.000Z"));
      await GET(makeRequest("period=1d"));
      expect(h.computePlatformMetrics).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the cache on repeat and recomputes on refresh=true", async () => {
    // Unique custom range → guaranteed-cold cache key for this test.
    const q = "period=custom&from=2026-06-01&to=2026-06-02";
    h.computePlatformMetrics.mockResolvedValue(fakeMetrics("2026-06-01 → 2026-06-02"));

    await GET(makeRequest(q));
    await GET(makeRequest(q)); // cache hit
    expect(h.computePlatformMetrics).toHaveBeenCalledTimes(1);

    await GET(makeRequest(`${q}&refresh=true`));
    expect(h.computePlatformMetrics).toHaveBeenCalledTimes(2);
  });

  it("reports Stripe-side payers and gross volume when Stripe is configured", async () => {
    h.getStripe.mockResolvedValue({ charges: { list: h.chargesList } });
    h.chargesList.mockResolvedValue({
      has_more: false,
      data: [
        { id: "ch_1", status: "succeeded", amount: 10_000, amount_refunded: 0, customer: "cus_a" },
        { id: "ch_2", status: "succeeded", amount: 5_000, amount_refunded: 1_000, customer: "cus_a" },
        { id: "ch_3", status: "failed", amount: 7_000, amount_refunded: 0, customer: "cus_b" },
        { id: "ch_4", status: "succeeded", amount: 3_000, amount_refunded: 3_000, customer: "cus_c" }, // fully refunded
      ],
    });

    const res = await GET(makeRequest("refresh=true"));
    const body = await res.json();

    expect(body.reconciliation.stripeWindowPayers).toBe(1); // only cus_a stuck
    expect(body.reconciliation.stripeGrossVolumeCents).toBe(14_000); // 10000 + 4000
    // The sweep covered the resolved window (unix seconds).
    expect(h.chargesList).toHaveBeenCalledWith(
      expect.objectContaining({
        created: {
          gte: Math.floor(new Date("2026-08-06T00:00:00.000Z").getTime() / 1000),
          lte: Math.floor(new Date("2026-08-06T23:59:59.999Z").getTime() / 1000),
        },
      }),
    );
  });

  it("500s when the compute itself fails", async () => {
    h.computePlatformMetrics.mockRejectedValue(new Error("everything is down"));
    const res = await GET(makeRequest("refresh=true"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to compute platform metrics");
  });
});
