// Three customers were blocked in one day because their checkout webhook was
// answered non-2xx and Stripe just retried into the same failure. This sweep is
// the safety net: it settles events Stripe could not deliver.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifyCronAuth, mockEventsList, mockDispatch } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(),
  mockEventsList: vi.fn(),
  mockDispatch: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ verifyCronAuth: mockVerifyCronAuth }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    events: { list: (params: unknown) => mockEventsList(params) },
  }),
}));
vi.mock("@/app/api/webhooks/stripe/route", () => ({
  dispatchStripeEvent: mockDispatch,
  REPLAY_EVENT_TYPES: ["checkout.session.completed", "invoice.payment_succeeded"],
}));

import { POST } from "@/app/api/cron/replay-stuck-webhooks/route";

const NOW = 1_800_000_000_000;
const req = () => new NextRequest("http://localhost/api/cron/replay-stuck-webhooks", { method: "POST" });

function event(id: string, pending: number, agoMs: number, type = "checkout.session.completed") {
  return { id, type, pending_webhooks: pending, created: Math.floor((NOW - agoMs) / 1000) };
}

// stripe.events.list(...).autoPagingToArray(...) — the shape every test drives.
function listResolving(events: ReturnType<typeof event>[]) {
  mockEventsList.mockReturnValue({
    autoPagingToArray: async () => events,
  });
}

describe("replay-stuck-webhooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockVerifyCronAuth.mockReturnValue(null);
    mockDispatch.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("replays an event Stripe still has not delivered", async () => {
    listResolving([event("evt_stuck", 1, 30 * 60 * 1000)]);

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ success: true, stuck: 1, replayed: 1, errors: 0 });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0].id).toBe("evt_stuck");
  });

  it("finds an event outside the old ~7-minute page but inside the lookback window", async () => {
    // Older than the page-of-100 ever reached in production, well inside the 24h lookback.
    listResolving([event("evt_old", 1, 45 * 60 * 1000)]);

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ stuck: 1, replayed: 1 });
    expect(mockDispatch.mock.calls[0][0].id).toBe("evt_old");
  });

  it("queries Stripe with the type filter and the bounded created range", async () => {
    listResolving([]);

    await POST(req());

    const params = mockEventsList.mock.calls[0][0];
    expect(params.types).toEqual(["checkout.session.completed", "invoice.payment_succeeded"]);
    expect(params.created.lte).toBe(Math.floor((NOW - 10 * 60 * 1000) / 1000));
    expect(params.created.gte).toBe(Math.floor((NOW - 24 * 60 * 60 * 1000) / 1000));
  });

  it("leaves delivered events and fresh ones alone", async () => {
    listResolving([
      event("evt_delivered", 0, 30 * 60 * 1000), // Stripe got a 2xx
      event("evt_fresh", 1, 60 * 1000), // inside the grace window
    ]);

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ stuck: 0, replayed: 0 });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("reports an already-claimed event as processed rather than replayed", async () => {
    listResolving([event("evt_done", 1, 30 * 60 * 1000)]);
    mockDispatch.mockResolvedValue(false);

    const body = await (await POST(req())).json();

    expect(body.replayed).toBe(0);
    expect(body.results[0].outcome).toBe("already_processed");
  });

  it("keeps going when one event throws, and counts it", async () => {
    listResolving([event("evt_bad", 1, 30 * 60 * 1000), event("evt_ok", 1, 20 * 60 * 1000)]);
    mockDispatch.mockRejectedValueOnce(new Error("handler blew up")).mockResolvedValueOnce(true);

    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ errors: 1, replayed: 1 });
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("drains oldest-first and caps the batch", async () => {
    const many = Array.from({ length: 25 }, (_, i) => event("evt_" + i, 1, (60 - i) * 60 * 1000));
    listResolving(many);

    const body = await (await POST(req())).json();

    expect(body.stuck).toBe(25);
    expect(mockDispatch).toHaveBeenCalledTimes(20);
    // evt_0 is the oldest (60 min), so it must be first out.
    expect(mockDispatch.mock.calls[0][0].id).toBe("evt_0");
  });

  it("reports a truncated discovery window and raises an ops alert instead of staying silent", async () => {
    const page = Array.from({ length: 501 }, (_, i) => event("evt_" + i, 1, (600 - i) * 60 * 1000));
    listResolving(page);

    const body = await (await POST(req())).json();

    expect(body.success).toBe(false);
    expect(body.coverageIncomplete).toBe(true);
    expect(body.stuck).toBe(500);
  });

  it("does not report truncation when the discovered page is under the cap", async () => {
    listResolving([event("evt_one", 1, 30 * 60 * 1000)]);

    const body = await (await POST(req())).json();

    expect(body.success).toBe(true);
    expect(body.coverageIncomplete).toBe(false);
  });

  it("refuses without cron auth", async () => {
    mockVerifyCronAuth.mockReturnValue(
      new Response("no", { status: 401 }) as unknown as ReturnType<typeof mockVerifyCronAuth>,
    );
    listResolving([]);

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(mockEventsList).not.toHaveBeenCalled();
  });

  it("surfaces a Stripe listing failure instead of reporting success", async () => {
    mockEventsList.mockRejectedValue(new Error("stripe down"));

    const res = await POST(req());

    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });
});
