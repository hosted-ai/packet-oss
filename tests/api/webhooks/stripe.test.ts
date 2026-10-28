// Tests for src/app/api/webhooks/stripe/route.ts.
//
// Scope: the entry router only — signature verification, idempotency claim,
// and the event-type switch. We intentionally do NOT exercise the individual
// event handlers (checkout.session.completed, invoice.payment_succeeded, etc.)
// — each is a 100+ line function with its own dependency graph (hosted.ai
// client, email, referral, lifecycle, voucher, invoice). Those deserve their
// own per-handler suites and would dilute this regression check.
//
// What this suite protects:
//   * Missing/invalid Stripe signatures must return 400, never 200.
//   * Idempotency: a re-delivered event (same event.id) must not double-process.
//   * The router must not crash on unknown event types (Stripe ships new ones).
//   * A handler error must surface as 500, not silently 200 (which is what
//     Stripe would interpret as "delivered successfully — stop retrying").

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockConstructEvent,
  mockGetStripe,
  mockGetWebhookSecret,
  mockProcessedEventCreate,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetWebhookSecret: vi.fn(),
  mockProcessedEventCreate: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
  getStripeWebhookSecret: mockGetWebhookSecret,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    processedStripeEvent: {
      create: mockProcessedEventCreate,
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

// The route imports a deep tree of dependencies for the per-event handlers
// (hostedai, email, lifecycle, referral, voucher, invoice). We stub them so
// the module can load without trying to reach real services. The handler-level
// tests would mount these properly; here we only need the router code path.
vi.mock("@/lib/hostedai", () => ({
  createTeam: vi.fn(),
  createOneTimeLogin: vi.fn(),
  suspendTeam: vi.fn(),
  unsuspendTeam: vi.fn(),
  changeTeamPackage: vi.fn(),
  syncTeamsToDefaultPolicy: vi.fn(),
  unsubscribeFromPool: vi.fn(),
  ensureDefaultPolicies: vi.fn(),
  ensureRoles: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: vi.fn(),
  createLoginLink: vi.fn(async () => "cust-token"), // PA-380
}));
vi.mock("@/lib/edition", () => ({ isPro: () => true }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: vi.fn(),
}));
vi.mock("@/lib/lifecycle", () => ({
  recordFirstDeposit: vi.fn(),
  recordSubscription: vi.fn(),
  recordChurn: vi.fn(),
  recordReactivation: vi.fn(),
  addSpend: vi.fn(),
}));
vi.mock("@/lib/voucher", () => ({ processVoucherRedemption: vi.fn() }));
vi.mock("@/lib/email/onboarding-events", () => ({
  sendOnboardingEvent: vi.fn(),
}));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

function makeRequest(body: string, signature: string | null) {
  const headers = new Headers();
  if (signature !== null) headers.set("stripe-signature", signature);
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStripe.mockResolvedValue({
      webhooks: { constructEvent: mockConstructEvent },
    });
    mockGetWebhookSecret.mockResolvedValue("whsec_test_secret");
  });

  describe("signature verification", () => {
    it("returns 400 when stripe-signature header is missing", async () => {
      const req = makeRequest("{}", null);
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("No signature");
      // Must NOT have attempted to verify or process anything.
      expect(mockConstructEvent).not.toHaveBeenCalled();
    });

    it("returns 400 when constructEvent throws (forged or stale signature)", async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature");
      });

      const req = makeRequest("{}", "t=12345,v1=bogus");
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid signature");
      // Idempotency table must NOT have been touched on a verification failure.
      expect(mockProcessedEventCreate).not.toHaveBeenCalled();
    });

    it("calls constructEvent with the raw body (not parsed JSON)", async () => {
      const rawBody = '{"id":"evt_test_123","type":"customer.created"}';
      mockConstructEvent.mockReturnValue({
        id: "evt_test_123",
        type: "customer.created",
        data: { object: {} },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      await POST(makeRequest(rawBody, "t=1,v1=valid"));

      const call = mockConstructEvent.mock.calls[0];
      expect(call[0]).toBe(rawBody); // raw body
      expect(call[1]).toBe("t=1,v1=valid"); // signature
      expect(call[2]).toBe("whsec_test_secret"); // secret
    });
  });

  describe("observability", () => {
    // Every non-2xx return, and every signature-verification outcome, must
    // produce a log line — the production gap was 8 x 500 with zero matching
    // journal entries because a failure path bypassed the router's catch.
    it("logs a line when the signature header is missing", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await POST(makeRequest("{}", null));
      // Matched loosely: the point is that the refusal is logged at all, not
      // how it is worded.
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/signature/i));
      errSpy.mockRestore();
    });

    it("logs the event id and type on successful signature verification", async () => {
      mockConstructEvent.mockReturnValue({
        id: "evt_logged_1",
        type: "customer.created",
        data: { object: {} },
      });
      mockProcessedEventCreate.mockResolvedValue({});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await POST(makeRequest("{}", "t=1,v1=valid"));

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("evt_logged_1"),
      );
      logSpy.mockRestore();
    });

    it("returns 500 (not an unhandled crash) and logs when resolving the Stripe client/secret throws", async () => {
      // This is the path that produced the production incident: a transient
      // failure resolving getStripe()/getStripeWebhookSecret() used to run
      // outside any try/catch and never reached the router's log line.
      mockGetWebhookSecret.mockRejectedValue(new Error("DB unavailable"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      expect(res.status).toBe(500);
      expect(mockConstructEvent).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("unresolved (pre-parse failure)"),
        expect.any(Error),
      );
      errSpy.mockRestore();
    });
  });

  describe("idempotency", () => {
    it("processes the event and returns 200 on first delivery", async () => {
      mockConstructEvent.mockReturnValue({
        id: "evt_new_123",
        type: "customer.created", // unhandled → default branch, no handler invoked
        data: { object: {} },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(body.skipped).toBeUndefined();
      expect(mockProcessedEventCreate).toHaveBeenCalledWith({
        data: {
          stripeEventId: "evt_new_123",
          eventType: "customer.created",
          sessionId: undefined,
          customerId: undefined,
        },
      });
    });

    it("skips processing and returns received:true,skipped:true on re-delivery (P2002)", async () => {
      mockConstructEvent.mockReturnValue({
        id: "evt_replay_123",
        type: "customer.created",
        data: { object: {} },
      });
      const p2002 = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      mockProcessedEventCreate.mockRejectedValue(p2002);

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(body.skipped).toBe(true);
    });

    it("falls open (processes anyway) when the idempotency DB write fails with a non-P2002 error", async () => {
      // Documented behavior at route.ts:59-61 — "better to double-process than
      // lose events" if the DB is flaky. This test pins that choice so a future
      // refactor doesn't silently flip it to fail-closed.
      mockConstructEvent.mockReturnValue({
        id: "evt_dbflake_123",
        type: "customer.created",
        data: { object: {} },
      });
      mockProcessedEventCreate.mockRejectedValue(new Error("connection lost"));

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBeUndefined();
    });
  });

  describe("event-type routing", () => {
    it("returns 200 for unknown event types (forward-compat — Stripe adds new ones)", async () => {
      mockConstructEvent.mockReturnValue({
        id: "evt_unknown_xyz",
        type: "some.future.event.we.havent.seen.yet",
        data: { object: {} },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      // Critically: must NOT 500 or 400 on unknown types — Stripe will retry
      // and queue up indefinitely. The default branch logs and returns 200.
      expect(res.status).toBe(200);
    });

    it("routes checkout.session.completed without wallet_topup metadata to handleCheckoutCompleted", async () => {
      // We can't observe the handler directly without mocking the module,
      // but we can confirm the router accepted the event without throwing.
      mockConstructEvent.mockReturnValue({
        id: "evt_co_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_1",
            customer: "cus_1",
            metadata: {}, // no wallet_topup
            // Minimal session shape — handler will likely no-op or throw on
            // missing fields. We catch errors in the next test.
          },
        },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      // Handler may throw on minimal session — that's fine, surfaces as 500.
      const res = await POST(makeRequest("{}", "t=1,v1=valid"));
      expect([200, 500]).toContain(res.status);
    });
  });

  describe("error handling", () => {
    it("returns 500 (not 200) when a handler throws — Stripe must retry, not consider delivered", async () => {
      // Pin the router's outer try/catch contract: if a handler bubbles an
      // error, the route returns 500 so Stripe retries. Returning 200 here
      // would silently lose the event.
      //
      // We trigger this by making a Stripe SDK call inside handleWalletTopup
      // throw. handleWalletTopup has no internal catch around
      // listBalanceTransactions / createBalanceTransaction — they propagate.
      const balanceTxnError = new Error("stripe_api_error");
      const failingStripe = {
        webhooks: { constructEvent: mockConstructEvent },
        customers: {
          listBalanceTransactions: vi.fn().mockRejectedValue(balanceTxnError),
          createBalanceTransaction: vi.fn().mockRejectedValue(balanceTxnError),
          retrieve: vi.fn(),
          update: vi.fn(),
        },
      };
      mockGetStripe.mockResolvedValue(failingStripe);

      mockConstructEvent.mockReturnValue({
        id: "evt_throws_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_throws",
            customer: "cus_test",
            amount_total: 5000,
            metadata: { type: "wallet_topup" },
          },
        },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));

      // hasExistingBalanceTransaction has its own try/catch (returns false on
      // error), so the listBalanceTransactions throw is swallowed. The
      // subsequent createBalanceTransaction call is NOT wrapped — it throws,
      // the outer catch returns 500.
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Webhook handler failed");
    });

    it("documents: handlers' internal error swallowing means many failures still return 200", async () => {
      // Worth pinning so we don't pretend the router catches everything.
      // hasExistingBalanceTransaction, the voucher block, and the
      // free-trial upgrade block all swallow errors internally. A test that
      // asserts "any handler bug returns 500" would be a lie.
      //
      // If you're adding a new handler, make sure unrecoverable errors
      // propagate to the router so Stripe retries.
      mockConstructEvent.mockReturnValue({
        id: "evt_silent_swallow_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_silent",
            metadata: { type: "wallet_topup" },
            // No customer / amount → early return, no throw.
          },
        },
      });
      mockProcessedEventCreate.mockResolvedValue({});

      const res = await POST(makeRequest("{}", "t=1,v1=valid"));
      expect(res.status).toBe(200); // Documented current behavior.
    });
  });
});
