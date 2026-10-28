// PA-255: integration coverage for the Stripe *subscription invoice* lifecycle
// (invoice.payment_succeeded / invoice.payment_failed) — as opposed to the
// one-off wallet top-up path. tests/api/webhooks/stripe-handlers.test.ts
// already unit-tests each handler in isolation; this file chains deliveries
// through the real POST entry point to prove the end-to-end story: a
// successful invoice leaves the subscription active with no grace period, a
// first failure starts the grace clock without suspending anything, and once
// Stripe exhausts its retries and cancels the subscription outright, the team
// is finally suspended.
//
// Note: there is no dedicated customer-facing email for a failed subscription
// payment today — "customer notified" is covered here via the GA4/PostHog
// purchase-failed analytics events, the only observable signal the webhook
// currently emits on failure.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const {
  mockConstructEvent,
  mockGetStripe,
  mockGetWebhookSecret,
  prismaMock,
  hostedaiMock,
  lifecycleMock,
  mockCacheCustomer,
  mockTrackPurchaseFailed,
  mockPosthogTrackPurchaseFailed,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetWebhookSecret: vi.fn(),
  prismaMock: {
    processedStripeEvent: {
      create: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    podMetadata: {
      findMany: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  hostedaiMock: {
    suspendTeam: vi.fn(),
    unsuspendTeam: vi.fn(),
    unsubscribeFromPool: vi.fn(),
  },
  lifecycleMock: {
    recordChurn: vi.fn(),
    recordReactivation: vi.fn(),
    recordFirstDeposit: vi.fn(),
  },
  mockCacheCustomer: vi.fn(),
  mockTrackPurchaseFailed: vi.fn().mockResolvedValue(undefined),
  mockPosthogTrackPurchaseFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
  getStripeWebhookSecret: mockGetWebhookSecret,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/hostedai", () => hostedaiMock);
vi.mock("@/lib/lifecycle", () => lifecycleMock);
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: vi.fn(() => "cust-token"),
  createLoginLink: vi.fn(async () => "cust-token"),
}));
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: vi.fn(async () => ({ processed: false })),
}));
vi.mock("@/lib/voucher", () => ({ processVoucherRedemption: vi.fn() }));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: vi.fn() }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: vi.fn() }));
vi.mock("@/lib/analytics/ga4", () => ({
  trackPurchase: vi.fn().mockResolvedValue(undefined),
  trackPurchaseFailed: mockTrackPurchaseFailed,
  trackGA4Event: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics/posthog", () => ({
  posthogTrackPurchase: vi.fn().mockResolvedValue(undefined),
  posthogTrackPurchaseFailed: mockPosthogTrackPurchaseFailed,
  posthogTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

const CUSTOMER_ID = "cus_invoice_1";
const TEAM_ID = "team-invoice-1";
const SUBSCRIPTION_ID = "sub_invoice_1";

function makeStripeMock() {
  return {
    webhooks: { constructEvent: mockConstructEvent },
    customers: {
      retrieve: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: CUSTOMER_ID, metadata: {} }),
    },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

let stripeMock: ReturnType<typeof makeStripeMock>;

function makeCustomer(overrides: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: CUSTOMER_ID,
    email: "subscriber@example.com",
    name: "Subscriber",
    balance: 0,
    metadata: { hostedai_team_id: TEAM_ID },
    ...overrides,
  } as Stripe.Customer;
}

/** Deliver `event` through the real POST entry point. */
async function deliver(event: { id: string; type: string; data: { object: unknown } }) {
  mockConstructEvent.mockReturnValue(event);
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=valid" },
    body: JSON.stringify(event),
  });
  return POST(req);
}

function succeededEvent(invoice: Record<string, unknown> = {}) {
  return {
    id: "evt_inv_succ_1",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_succ_1",
        customer: CUSTOMER_ID,
        billing_reason: "subscription_cycle",
        amount_paid: 29900,
        parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
        ...invoice,
      },
    },
  };
}

function failedEvent(invoice: Record<string, unknown> = {}) {
  return {
    id: "evt_inv_fail_1",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_fail_1",
        customer: CUSTOMER_ID,
        parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
        ...invoice,
      },
    },
  };
}

function canceledEvent(subscription: Record<string, unknown> = {}) {
  return {
    id: "evt_sub_canceled_1",
    type: "customer.subscription.deleted",
    data: {
      object: { id: SUBSCRIPTION_ID, customer: CUSTOMER_ID, ...subscription },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock = makeStripeMock();
  mockGetStripe.mockResolvedValue(stripeMock);
  mockGetWebhookSecret.mockResolvedValue("whsec_test");
  prismaMock.processedStripeEvent.create.mockResolvedValue({});
  prismaMock.processedStripeEvent.upsert.mockResolvedValue({});
  prismaMock.podMetadata.findMany.mockResolvedValue([]);
  prismaMock.podMetadata.delete.mockResolvedValue({});
  prismaMock.podMetadata.updateMany.mockResolvedValue({ count: 0 });
  mockCacheCustomer.mockResolvedValue(undefined);
  Object.values(lifecycleMock).forEach((fn) => fn.mockResolvedValue(undefined));
  Object.values(hostedaiMock).forEach((fn) => fn.mockResolvedValue(undefined));
  stripeMock.customers.retrieve.mockResolvedValue(makeCustomer());
});

describe("Stripe subscription invoice lifecycle (PA-255)", () => {
  it("invoice.payment_succeeded marks the subscription active with no grace period outstanding", async () => {
    const res = await deliver(succeededEvent());

    expect(res.status).toBe(200);
    expect(hostedaiMock.unsuspendTeam).toHaveBeenCalledWith(TEAM_ID);
    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
    // Any outstanding grace clock for this subscription is cleared, never set.
    expect(prismaMock.podMetadata.updateMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: SUBSCRIPTION_ID,
        billingType: "monthly",
        paymentFailedAt: { not: null },
      },
      data: { paymentFailedAt: null },
    });
    expect(prismaMock.podMetadata.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymentFailedAt: expect.any(Date) } })
    );
  });

  it("invoice.payment_failed (first attempt) starts the grace clock and tracks the failure, without suspending", async () => {
    prismaMock.podMetadata.updateMany.mockResolvedValue({ count: 1 });

    const res = await deliver(
      failedEvent({ amount_due: 29900, last_finalization_error: { message: "card_declined" } })
    );

    expect(res.status).toBe(200);
    // Grace clock started for this subscription's monthly pods.
    expect(prismaMock.podMetadata.updateMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: SUBSCRIPTION_ID,
        billingType: "monthly",
        paymentFailedAt: null,
      },
      data: { paymentFailedAt: expect.any(Date) },
    });
    // Customer is tracked as notified of the failure via analytics.
    expect(mockTrackPurchaseFailed).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: CUSTOMER_ID, invoiceId: "in_fail_1" })
    );
    expect(mockPosthogTrackPurchaseFailed).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: CUSTOMER_ID, invoiceId: "in_fail_1" })
    );
    // First failure never suspends or terminates — Stripe still has retries left.
    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
    expect(hostedaiMock.unsubscribeFromPool).not.toHaveBeenCalled();
  });

  it("suspends the subscription once retries are exhausted and Stripe cancels it", async () => {
    // First failure starts the grace clock — no suspension yet.
    await deliver(failedEvent());
    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();

    // Retries exhausted: Stripe gives up and cancels the subscription outright.
    // No other active subscriptions remain, so the team is finally suspended.
    const res = await deliver(canceledEvent());

    expect(res.status).toBe(200);
    expect(hostedaiMock.suspendTeam).toHaveBeenCalledWith(TEAM_ID);
  });
});
