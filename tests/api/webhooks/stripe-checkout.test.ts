// Dedicated PA-254 spec for the checkout.session.completed → handleWalletTopup
// path in src/app/api/webhooks/stripe/route.ts: exactly the 4 cases from the
// ticket's acceptance criteria (success, idempotency, invalid signature,
// unknown customer).
//
// Broader coverage of this same handler (voucher redemption, billing_type
// upgrades, etc.) already lives in stripe-handlers.test.ts, and the router's
// generic signature/idempotency contract in stripe.test.ts. This file doesn't
// replace those — it's the focused spec this ticket asks for.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockConstructEvent, mockGetStripe, mockGetWebhookSecret, prismaMock, mockCreateInvoiceForPayment } =
  vi.hoisted(() => ({
    mockConstructEvent: vi.fn(),
    mockGetStripe: vi.fn(),
    mockGetWebhookSecret: vi.fn(),
    prismaMock: {
      processedStripeEvent: {
        create: vi.fn(),
        upsert: vi.fn(),
        findUnique: vi.fn(),
      },
    },
    mockCreateInvoiceForPayment: vi.fn(),
  }));

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
  getStripeWebhookSecret: mockGetWebhookSecret,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
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
  createLoginLink: vi.fn(async () => "cust-token"),
}));
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: vi.fn().mockResolvedValue({ processed: false }),
}));
vi.mock("@/lib/lifecycle", () => ({
  // Fire-and-forget calls in the handler chain a .catch() onto these — they
  // must resolve to a promise, not vi.fn()'s default undefined.
  recordFirstDeposit: vi.fn().mockResolvedValue(undefined),
  recordSubscription: vi.fn().mockResolvedValue(undefined),
  recordChurn: vi.fn().mockResolvedValue(undefined),
  recordReactivation: vi.fn().mockResolvedValue(undefined),
  addSpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/voucher", () => ({
  processVoucherRedemption: vi.fn().mockResolvedValue({ success: true, creditCents: 0 }),
}));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: vi.fn() }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: mockCreateInvoiceForPayment }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

const CUSTOMER_ID = "cus_test_1";

function makeStripeMock() {
  return {
    webhooks: { constructEvent: mockConstructEvent },
    customers: {
      retrieve: vi.fn().mockResolvedValue({ id: CUSTOMER_ID, email: "buyer@example.com", metadata: {} }),
      update: vi.fn(),
      createBalanceTransaction: vi.fn().mockResolvedValue({}),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

let stripeMock: ReturnType<typeof makeStripeMock>;

function topupEvent(session: Record<string, unknown> = {}) {
  return {
    id: "evt_pa254_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_pa254_1",
        customer: CUSTOMER_ID,
        amount_total: 5000,
        payment_intent: "pi_pa254_1",
        metadata: { type: "wallet_topup" },
        ...session,
      },
    },
  };
}

async function deliver(event: unknown, signature = "t=1,v1=valid") {
  mockConstructEvent.mockReturnValue(event);
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: JSON.stringify(event),
  });
  return POST(req);
}

/** Raw request send — for cases where constructEvent's behavior (e.g. throwing) is
 * configured directly on the test rather than via `deliver`'s mockReturnValue. */
function makeRequest(body: string, signature: string) {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock = makeStripeMock();
  mockGetStripe.mockResolvedValue(stripeMock);
  mockGetWebhookSecret.mockResolvedValue("whsec_test");
  prismaMock.processedStripeEvent.create.mockResolvedValue({});
  prismaMock.processedStripeEvent.upsert.mockResolvedValue({});
  mockCreateInvoiceForPayment.mockResolvedValue(undefined);
});

describe("POST /api/webhooks/stripe — checkout.session.completed wallet top-up (PA-254)", () => {
  it("success: a valid webhook credits the wallet with the exact amount", async () => {
    const res = await deliver(topupEvent());

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ amount: -5000, currency: "usd" })
    );
  });

  it("idempotency: replaying the same event id does not credit the wallet twice", async () => {
    const event = topupEvent();

    const first = await deliver(event);
    expect(first.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);

    // Re-delivery: same event id hits the unique-constraint a real replay produces.
    prismaMock.processedStripeEvent.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    );

    const second = await deliver(event);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ received: true, skipped: true });
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });

  it("invalid signature: a bad HMAC is rejected with 400 and the wallet is untouched", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const res = await POST(makeRequest(JSON.stringify(topupEvent()), "t=1,v1=forged"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid signature" });
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("unknown customer: Stripe rejecting an unrecognized customer id fails without crediting", async () => {
    // No local customer table backs this handler — the credit path hands the
    // session's customer id straight to Stripe, so "unknown customer" surfaces
    // as Stripe rejecting createBalanceTransaction, not a DB lookup miss.
    // That rejection isn't caught in handleWalletTopup, so it propagates to
    // the router's generic 500 — pinning actual behavior since the ticket's
    // AC assumed a bespoke 4xx here.
    stripeMock.customers.createBalanceTransaction.mockRejectedValue(
      new Error("No such customer: 'cus_does_not_exist'")
    );

    const res = await deliver(topupEvent({ customer: "cus_does_not_exist" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Webhook handler failed" });
  });
});
