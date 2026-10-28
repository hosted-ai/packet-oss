// Per-handler tests for src/app/api/webhooks/stripe/route.ts.
//
// tests/api/webhooks/stripe.test.ts covers the entry router (signature,
// idempotency claim, event switch) and deliberately defers the individual
// event handlers — this file is that deferred work for the lifecycle
// handlers:
//   * handleWalletTopup            (checkout.session.completed + wallet_topup)
//   * handleSubscriptionCanceled   (customer.subscription.deleted)
//   * handleSubscriptionUpdated    (customer.subscription.updated)
//   * handlePaymentFailed          (invoice.payment_failed)
//   * handlePaymentSucceeded       (invoice.payment_succeeded)
// (handleCheckoutCompleted — the provisioning money-path — has its own
// suite in stripe-checkout-completed.test.ts.)
//
// What this suite protects:
//   * Top-ups credit the wallet exactly once (the balance-transaction
//     secondary idempotency check) and for the exact negative amount.
//   * A canceled monthly subscription tears down its pods but must NOT
//     suspend a team whose primary hourly customer still has wallet credit.
//   * Payment failure must NEVER suspend the team (PA-76 — suspension on
//     retryable failures killed wallet-funded hourly pods).
//   * Renewal payments unsuspend the team and are recorded as revenue.
//
// All handlers are driven through the real POST entry point with a
// constructed event — same approach as the router suite, so the dispatch
// wiring is exercised too.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const {
  mockConstructEvent,
  mockGetStripe,
  mockGetWebhookSecret,
  prismaMock,
  hostedaiMock,
  lifecycleMock,
  mockProcessVoucherRedemption,
  mockCheckReferral,
  mockCreateInvoiceForPayment,
  mockSendOnboardingEvent,
  mockCacheCustomer,
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
    gpuProduct: { findUnique: vi.fn() },
    voucher: { findUnique: vi.fn(), update: vi.fn() },
    voucherRedemption: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  hostedaiMock: {
    createTeam: vi.fn(),
    createOneTimeLogin: vi.fn(),
    suspendTeam: vi.fn(),
    unsuspendTeam: vi.fn(),
    changeTeamPackage: vi.fn(),
    syncTeamsToDefaultPolicy: vi.fn(),
    deleteInstance: vi.fn(),
    ensureDefaultPolicies: vi.fn(),
    ensureRoles: vi.fn(),
  },
  lifecycleMock: {
    recordFirstDeposit: vi.fn(),
    recordSubscription: vi.fn(),
    recordChurn: vi.fn(),
    recordReactivation: vi.fn(),
    addSpend: vi.fn(),
  },
  mockProcessVoucherRedemption: vi.fn(),
  mockCheckReferral: vi.fn(),
  mockCreateInvoiceForPayment: vi.fn(),
  mockSendOnboardingEvent: vi.fn(),
  mockCacheCustomer: vi.fn(),
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
  createLoginLink: vi.fn(async () => "cust-token"), // PA-380
}));
// isPro false keeps the handlers away from the dynamic pipedrive import.
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: mockCheckReferral,
}));
vi.mock("@/lib/voucher", () => ({
  processVoucherRedemption: mockProcessVoucherRedemption,
}));
vi.mock("@/lib/email/onboarding-events", () => ({
  sendOnboardingEvent: mockSendOnboardingEvent,
}));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({
  createInvoiceForPayment: mockCreateInvoiceForPayment,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

const CUSTOMER_ID = "cus_test_1";
const TEAM_ID = "team-uuid-1";

/** A fresh, fully-stubbed Stripe client for each test. */
function makeStripeMock() {
  return {
    webhooks: { constructEvent: mockConstructEvent },
    customers: {
      retrieve: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: CUSTOMER_ID, metadata: {} }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      createBalanceTransaction: vi.fn().mockResolvedValue({}),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
    },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    prices: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    paymentMethods: { attach: vi.fn() },
  };
}

let stripeMock: ReturnType<typeof makeStripeMock>;

function makeCustomer(overrides: Partial<Stripe.Customer> = {}): Stripe.Customer {
  return {
    id: CUSTOMER_ID,
    email: "buyer@example.com",
    name: "Buyer",
    balance: 0,
    metadata: {},
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

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock = makeStripeMock();
  mockGetStripe.mockResolvedValue(stripeMock);
  mockGetWebhookSecret.mockResolvedValue("whsec_test");
  // Idempotency claim succeeds by default (first delivery).
  prismaMock.processedStripeEvent.create.mockResolvedValue({});
  prismaMock.processedStripeEvent.upsert.mockResolvedValue({});
  prismaMock.podMetadata.findMany.mockResolvedValue([]);
  prismaMock.podMetadata.delete.mockResolvedValue({});
  prismaMock.podMetadata.updateMany.mockResolvedValue({ count: 0 });
  // Every fire-and-forget promise the handlers .catch() on must resolve.
  mockCacheCustomer.mockResolvedValue(undefined);
  mockCheckReferral.mockResolvedValue({ processed: false });
  mockProcessVoucherRedemption.mockResolvedValue({ success: true, creditCents: 0 });
  mockCreateInvoiceForPayment.mockResolvedValue(undefined);
  Object.values(lifecycleMock).forEach((fn) => fn.mockResolvedValue(undefined));
  Object.values(hostedaiMock).forEach((fn) => fn.mockResolvedValue(undefined));
  hostedaiMock.ensureDefaultPolicies.mockResolvedValue({
    pricing: "pol-pricing",
    resource: "pol-resource",
    service: "pol-service",
    instanceType: "pol-itype",
    image: "pol-image",
  });
  hostedaiMock.ensureRoles.mockResolvedValue({ teamAdmin: "role-team-admin" });
});

// ───────────────────────────────────────────────────────────────────────────
// handleWalletTopup
// ───────────────────────────────────────────────────────────────────────────

function topupEvent(session: Record<string, unknown>) {
  return {
    id: "evt_topup_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_topup_1",
        customer: CUSTOMER_ID,
        amount_total: 5000,
        payment_intent: "pi_1",
        metadata: { type: "wallet_topup" },
        ...session,
      },
    },
  };
}

describe("handleWalletTopup", () => {
  beforeEach(() => {
    stripeMock.customers.retrieve.mockResolvedValue(makeCustomer());
  });

  it("no-ops (200, no credit) when the session has no customer", async () => {
    const res = await deliver(topupEvent({ customer: null }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("no-ops when the amount is zero", async () => {
    const res = await deliver(topupEvent({ amount_total: 0 }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("credits the wallet with the exact negative amount and invoices the payment", async () => {
    const res = await deliver(topupEvent({}));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        amount: -5000, // negative = credit
        currency: "usd",
        metadata: expect.objectContaining({ checkout_session_id: "cs_topup_1" }),
      })
    );
    expect(mockCreateInvoiceForPayment).toHaveBeenCalledWith(
      stripeMock,
      CUSTOMER_ID,
      5000,
      expect.stringContaining("Wallet Top-up"),
      "pi_1"
    );
    // Lifecycle milestone recorded with the exact amount.
    expect(lifecycleMock.recordFirstDeposit).toHaveBeenCalledWith(CUSTOMER_ID, 5000);
  });

  it("skips the credit when a balance transaction for this session already exists (secondary idempotency)", async () => {
    stripeMock.customers.listBalanceTransactions.mockResolvedValue({
      data: [{ metadata: { checkout_session_id: "cs_topup_1" } }],
    });

    const res = await deliver(topupEvent({}));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
    // Still marked processed so Stripe retries stop.
    expect(prismaMock.processedStripeEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeEventId: "evt_topup_1" } })
    );
  });

  it("upgrades free-trial customers to hourly billing after a successful payment", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { billing_type: "free_trial" } })
    );
    stripeMock.customers.update.mockResolvedValue(
      makeCustomer({ metadata: { billing_type: "hourly" } })
    );

    await deliver(topupEvent({}));

    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          billing_type: "hourly",
          upgraded_from: "free_trial",
        }),
      })
    );
  });

  it("leaves already-hourly customers untouched", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { billing_type: "hourly" } })
    );

    await deliver(topupEvent({}));

    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("redeems an attached voucher with the customer's email and session id", async () => {
    await deliver(
      topupEvent({ metadata: { type: "wallet_topup", voucher_code: "WELCOME50" } })
    );

    expect(mockProcessVoucherRedemption).toHaveBeenCalledWith(
      "WELCOME50",
      CUSTOMER_ID,
      "buyer@example.com",
      5000,
      "cs_topup_1"
    );
  });

  it("treats voucher and referral failures as non-fatal (still 200)", async () => {
    mockProcessVoucherRedemption.mockRejectedValue(new Error("voucher svc down"));
    mockCheckReferral.mockRejectedValue(new Error("referral svc down"));

    const res = await deliver(
      topupEvent({ metadata: { type: "wallet_topup", voucher_code: "WELCOME50" } })
    );

    // The customer got their credit — auxiliary failures must not make
    // Stripe retry (which would re-run the whole handler).
    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// handleSubscriptionCanceled
// ───────────────────────────────────────────────────────────────────────────

function canceledEvent(subscription: Record<string, unknown> = {}) {
  return {
    id: "evt_subdel_1",
    type: "customer.subscription.deleted",
    data: {
      object: { id: "sub_1", customer: CUSTOMER_ID, ...subscription },
    },
  };
}

describe("handleSubscriptionCanceled", () => {
  it("ignores deleted customers", async () => {
    stripeMock.customers.retrieve.mockResolvedValue({ id: CUSTOMER_ID, deleted: true });

    const res = await deliver(canceledEvent());

    expect(res.status).toBe(200);
    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
    expect(prismaMock.podMetadata.findMany).not.toHaveBeenCalled();
  });

  it("terminates the subscription's monthly pods (HAI instance) and deletes their metadata", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    prismaMock.podMetadata.findMany.mockResolvedValue([
      { id: 7, subscriptionId: "instance-i-1", instanceId: "i-1", poolId: "pool-1" },
      { id: 8, subscriptionId: "instance-i-2", instanceId: "i-2", poolId: null },
    ]);

    await deliver(canceledEvent());

    expect(prismaMock.podMetadata.findMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_1",
        billingType: "monthly",
        managedBy: { not: "engine" },
      },
    });
    // PA-347: monthly pods are instance-model — poolId is a revenue-attribution
    // tag only, never a real pool subscription, so termination must call
    // deleteInstance regardless of whether poolId happens to be set.
    expect(hostedaiMock.deleteInstance).toHaveBeenCalledWith("i-1");
    expect(hostedaiMock.deleteInstance).toHaveBeenCalledWith("i-2");
    expect(prismaMock.podMetadata.delete).toHaveBeenCalledTimes(2);
    expect(lifecycleMock.recordChurn).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("still deletes metadata (no orphaned tracking row) when a pod has no instanceId", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    prismaMock.podMetadata.findMany.mockResolvedValue([
      { id: 9, subscriptionId: "instance-i-3", instanceId: null, poolId: null },
    ]);

    await deliver(canceledEvent());

    expect(hostedaiMock.deleteInstance).not.toHaveBeenCalled();
    expect(prismaMock.podMetadata.delete).toHaveBeenCalledWith({ where: { id: 9 } });
  });

  it("suspends the team when no active subscriptions remain", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    stripeMock.subscriptions.list.mockResolvedValue({ data: [] });

    await deliver(canceledEvent());

    expect(hostedaiMock.suspendTeam).toHaveBeenCalledWith(TEAM_ID);
  });

  it("does NOT suspend the team while other active subscriptions exist", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    stripeMock.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_other" }] });

    await deliver(canceledEvent());

    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
  });

  it("resolves the team via the primary customer and skips suspension while the primary wallet is funded", async () => {
    // Monthly customers live on a separate Stripe customer that points at
    // the primary hourly customer. A canceled monthly sub must not kill
    // funded hourly pods on the shared team.
    stripeMock.customers.retrieve.mockImplementation(async (id: string) => {
      if (id === CUSTOMER_ID) {
        return makeCustomer({
          metadata: { primary_stripe_customer_id: "cus_primary" },
        });
      }
      return makeCustomer({
        id: "cus_primary",
        balance: -2500, // negative balance = $25 wallet credit
        metadata: { hostedai_team_id: TEAM_ID, billing_type: "hourly" },
      });
    });
    stripeMock.subscriptions.list.mockResolvedValue({ data: [] });

    await deliver(canceledEvent());

    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
  });

  it("suspends the resolved team when the primary wallet is empty", async () => {
    stripeMock.customers.retrieve.mockImplementation(async (id: string) => {
      if (id === CUSTOMER_ID) {
        return makeCustomer({
          metadata: { primary_stripe_customer_id: "cus_primary" },
        });
      }
      return makeCustomer({
        id: "cus_primary",
        balance: 0,
        metadata: { hostedai_team_id: TEAM_ID, billing_type: "hourly" },
      });
    });
    stripeMock.subscriptions.list.mockResolvedValue({ data: [] });

    await deliver(canceledEvent());

    expect(hostedaiMock.suspendTeam).toHaveBeenCalledWith(TEAM_ID);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// handlePaymentFailed
// ───────────────────────────────────────────────────────────────────────────

describe("handlePaymentFailed", () => {
  function failedEvent(invoice: Record<string, unknown> = {}) {
    return {
      id: "evt_payfail_1",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", customer: CUSTOMER_ID, ...invoice } },
    };
  }

  it("no-ops when the invoice has no customer", async () => {
    const res = await deliver(failedEvent({ customer: null }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
  });

  it("starts the 24h grace clock and does NOT terminate pods on the first failure (PA-361)", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    prismaMock.podMetadata.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      failedEvent({
        parent: { subscription_details: { subscription: "sub_failed" } },
      })
    );

    // Stamps paymentFailedAt only where it is still null, so Stripe's retry
    // storm can't reset the window — the clock runs from the first failure.
    expect(prismaMock.podMetadata.updateMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_failed",
        billingType: "monthly",
        paymentFailedAt: null,
      },
      data: { paymentFailedAt: expect.any(Date) },
    });
    // Pods survive the first failed payment — the cron terminates them later.
    expect(hostedaiMock.deleteInstance).not.toHaveBeenCalled();
    expect(prismaMock.podMetadata.delete).not.toHaveBeenCalled();
  });

  it("NEVER suspends the team on payment failure (PA-76)", async () => {
    // Stripe retries failed payments; suspension here killed hourly pods
    // that were fully funded from the wallet. Suspension only happens via
    // customer.subscription.deleted.
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );

    const res = await deliver(
      failedEvent({
        parent: { subscription_details: { subscription: "sub_failed" } },
      })
    );

    expect(res.status).toBe(200);
    expect(hostedaiMock.suspendTeam).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// handlePaymentSucceeded
// ───────────────────────────────────────────────────────────────────────────

describe("handlePaymentSucceeded", () => {
  function succeededEvent(invoice: Record<string, unknown> = {}) {
    return {
      id: "evt_paysucc_1",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_2",
          customer: CUSTOMER_ID,
          billing_reason: "subscription_cycle",
          amount_paid: 29900,
          ...invoice,
        },
      },
    };
  }

  it("skips the initial subscription_create invoice (handled by checkout)", async () => {
    const res = await deliver(succeededEvent({ billing_reason: "subscription_create" }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
    expect(hostedaiMock.unsuspendTeam).not.toHaveBeenCalled();
  });

  it("unsuspends the team and records the renewal as revenue", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );

    const res = await deliver(succeededEvent());

    expect(res.status).toBe(200);
    expect(hostedaiMock.unsuspendTeam).toHaveBeenCalledWith(TEAM_ID);
    expect(lifecycleMock.recordReactivation).toHaveBeenCalledWith(CUSTOMER_ID);
    expect(lifecycleMock.recordFirstDeposit).toHaveBeenCalledWith(CUSTOMER_ID, 29900);
  });

  it("resolves the team through the primary customer for monthly-only customers", async () => {
    stripeMock.customers.retrieve.mockImplementation(async (id: string) => {
      if (id === CUSTOMER_ID) {
        return makeCustomer({
          metadata: { primary_stripe_customer_id: "cus_primary" },
        });
      }
      return makeCustomer({
        id: "cus_primary",
        metadata: { hostedai_team_id: TEAM_ID },
      });
    });

    await deliver(succeededEvent());

    expect(hostedaiMock.unsuspendTeam).toHaveBeenCalledWith(TEAM_ID);
  });

  it("clears the grace clock for the subscription's monthly pods on a recovered payment (PA-361)", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    prismaMock.podMetadata.updateMany.mockResolvedValue({ count: 1 });

    await deliver(
      succeededEvent({
        parent: { subscription_details: { subscription: "sub_recovered" } },
      })
    );

    // A payment recovered within the window cancels the pending termination.
    expect(prismaMock.podMetadata.updateMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_recovered",
        billingType: "monthly",
        paymentFailedAt: { not: null },
      },
      data: { paymentFailedAt: null },
    });
  });

  it("still returns 200 when unsuspend fails (logged, Stripe must not retry forever)", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({ metadata: { hostedai_team_id: TEAM_ID } })
    );
    hostedaiMock.unsuspendTeam.mockRejectedValue(new Error("hosted.ai 502"));

    const res = await deliver(succeededEvent());

    expect(res.status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// handleSubscriptionUpdated
// ───────────────────────────────────────────────────────────────────────────

describe("handleSubscriptionUpdated", () => {
  function updatedEvent(subscription: Record<string, unknown> = {}) {
    return {
      id: "evt_subupd_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_upd",
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: "price_new" } }] },
          ...subscription,
        },
      },
    };
  }

  it("no-ops when the customer has no team", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(makeCustomer({ metadata: {} }));

    const res = await deliver(updatedEvent());

    expect(res.status).toBe(200);
    expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    expect(hostedaiMock.changeTeamPackage).not.toHaveBeenCalled();
  });

  it("skips the policy update when the product is unchanged", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({
        metadata: { hostedai_team_id: TEAM_ID, gpu_product_id: "prod-same" },
      })
    );
    stripeMock.prices.retrieve.mockResolvedValue({
      product: { metadata: { gpu_product_id: "prod-same" } },
    });
    prismaMock.gpuProduct.findUnique.mockResolvedValue({ name: "A100 Pod" });

    await deliver(updatedEvent());

    expect(hostedaiMock.changeTeamPackage).not.toHaveBeenCalled();
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("applies the new package and updates customer metadata on a product change", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({
        metadata: { hostedai_team_id: TEAM_ID, gpu_product_id: "prod-old" },
      })
    );
    stripeMock.prices.retrieve.mockResolvedValue({
      product: { metadata: { gpu_product_id: "prod-new" } },
    });
    prismaMock.gpuProduct.findUnique.mockResolvedValue({ name: "H100 Pod" });
    stripeMock.customers.update.mockResolvedValue(makeCustomer());

    const res = await deliver(updatedEvent());

    expect(res.status).toBe(200);
    expect(hostedaiMock.changeTeamPackage).toHaveBeenCalledWith(TEAM_ID, {
      pricing_policy_id: "pol-pricing",
      resource_policy_id: "pol-resource",
      service_policy_id: "pol-service",
      instance_type_policy_id: "pol-itype",
      image_policy_id: "pol-image",
    });
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({ gpu_product_id: "prod-new" }),
      })
    );
  });

  it("supports the legacy packet_product_id metadata key", async () => {
    stripeMock.customers.retrieve.mockResolvedValue(
      makeCustomer({
        metadata: { hostedai_team_id: TEAM_ID, packet_product_id: "prod-old" },
      })
    );
    stripeMock.prices.retrieve.mockResolvedValue({
      product: { metadata: { packet_product_id: "prod-legacy-new" } },
    });
    prismaMock.gpuProduct.findUnique.mockResolvedValue(null);
    stripeMock.customers.update.mockResolvedValue(makeCustomer());

    await deliver(updatedEvent());

    expect(hostedaiMock.changeTeamPackage).toHaveBeenCalled();
  });
});
