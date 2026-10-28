// Tests for handleCheckoutCompleted in src/app/api/webhooks/stripe/route.ts —
// the provisioning money-path: paid checkout → wallet credit → hosted.ai
// team creation → OTL → welcome email → customer metadata.
//
// What this suite protects:
//   * The wallet is credited the FULL deposit (original_deposit_cents, which
//     includes voucher credit) while the invoice covers only what was paid.
//   * The hosted.ai team is created with the default policies/roles fetched
//     from the API, and is added to the resource policy (without that sync
//     the team can't access GPU pools at all).
//   * Team-creation failure must propagate to a 500 so Stripe retries —
//     a customer who paid but got no team is the worst outcome.
//   * Monthly subscriptions with an existing primary (hourly) customer
//     reuse that customer's team — no duplicate team creation, and the two
//     Stripe customers get cross-referencing metadata.
//
// Driven through the real POST entry point, same as the other webhook suites.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockConstructEvent,
  mockGetStripe,
  mockGetWebhookSecret,
  prismaMock,
  hostedaiMock,
  lifecycleMock,
  mockSendWelcomeEmail,
  mockCheckReferral,
  mockCreateInvoiceForPayment,
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
    unsubscribeFromPool: vi.fn(),
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
  mockSendWelcomeEmail: vi.fn(),
  mockCheckReferral: vi.fn(),
  mockCreateInvoiceForPayment: vi.fn(),
  mockCacheCustomer: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
  getStripeWebhookSecret: mockGetWebhookSecret,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/hostedai", () => hostedaiMock);
vi.mock("@/lib/lifecycle", () => lifecycleMock);
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: mockSendWelcomeEmail }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: vi.fn(() => "dashboard-token"),
  createLoginLink: vi.fn(async () => "dashboard-token"), // PA-380
}));
// isPro false keeps the handler away from the dynamic pipedrive import.
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: mockCheckReferral,
}));
vi.mock("@/lib/voucher", () => ({ processVoucherRedemption: vi.fn() }));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: vi.fn() }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({
  createInvoiceForPayment: mockCreateInvoiceForPayment,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

const CUSTOMER_ID = "cus_checkout_1";
const CUSTOMER_EMAIL = "newbuyer@example.com";
const TEAM = { id: "team-new-1", name: "Newbuyer-hourly-123" };

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
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    prices: { retrieve: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    paymentMethods: { attach: vi.fn().mockResolvedValue({}) },
  };
}

let stripeMock: ReturnType<typeof makeStripeMock>;

function checkoutEvent(session: Record<string, unknown> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_checkout_1",
        customer: CUSTOMER_ID,
        customer_email: CUSTOMER_EMAIL,
        customer_details: { name: "New Buyer" },
        amount_total: 10000,
        payment_intent: "pi_checkout_1",
        metadata: { gpu_product_id: "prod-gpu-1", billing_type: "hourly" },
        ...session,
      },
    },
  };
}

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
  prismaMock.processedStripeEvent.create.mockResolvedValue({});
  prismaMock.processedStripeEvent.upsert.mockResolvedValue({});
  prismaMock.gpuProduct.findUnique.mockResolvedValue({ name: "RTX 6000 Pod" });
  prismaMock.voucher.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockResolvedValue([]);
  mockCacheCustomer.mockResolvedValue(undefined);
  mockCheckReferral.mockResolvedValue({ processed: false });
  mockCreateInvoiceForPayment.mockResolvedValue(undefined);
  mockSendWelcomeEmail.mockResolvedValue(undefined);
  Object.values(lifecycleMock).forEach((fn) => fn.mockResolvedValue(undefined));
  hostedaiMock.createTeam.mockResolvedValue(TEAM);
  hostedaiMock.createOneTimeLogin.mockResolvedValue({ url: "https://otl.example/x" });
  hostedaiMock.syncTeamsToDefaultPolicy.mockResolvedValue(undefined);
  hostedaiMock.ensureDefaultPolicies.mockResolvedValue({
    pricing: "pol-pricing",
    resource: "pol-resource",
    service: "pol-service",
    instanceType: "pol-itype",
    image: "pol-image",
  });
  hostedaiMock.ensureRoles.mockResolvedValue({ teamAdmin: "role-team-admin" });
});

describe("handleCheckoutCompleted — guards", () => {
  it("returns 500 when the session has no customer email (Stripe must retry)", async () => {
    const res = await deliver(checkoutEvent({ customer_email: null }));

    expect(res.status).toBe(500);
    expect(hostedaiMock.createTeam).not.toHaveBeenCalled();
  });
});

describe("handleCheckoutCompleted — hourly wallet provisioning", () => {
  it("credits the wallet, invoices the payment, and provisions a team end-to-end", async () => {
    const res = await deliver(checkoutEvent());

    expect(res.status).toBe(200);

    // Wallet credit: negative amount, wallet_funding metadata.
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        amount: -10000,
        metadata: expect.objectContaining({
          type: "wallet_funding",
          checkout_session_id: "cs_checkout_1",
        }),
      })
    );

    // Invoice covers what was paid.
    expect(mockCreateInvoiceForPayment).toHaveBeenCalledWith(
      stripeMock,
      CUSTOMER_ID,
      10000,
      expect.stringContaining("Initial Wallet Deposit"),
      "pi_checkout_1"
    );

    // Team created with API-fetched policies and a pre-onboarded member.
    expect(hostedaiMock.createTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing_policy_id: "pol-pricing",
        resource_policy_id: "pol-resource",
        service_policy_id: "pol-service",
        instance_type_policy_id: "pol-itype",
        image_policy_id: "pol-image",
        members: [
          expect.objectContaining({
            email: CUSTOMER_EMAIL,
            role: "role-team-admin",
            send_email_invite: false,
            pre_onboard: true,
            password: expect.any(String),
          }),
        ],
      })
    );

    // Without this sync the team cannot access GPU pools at all.
    expect(hostedaiMock.syncTeamsToDefaultPolicy).toHaveBeenCalledWith([TEAM.id]);

    expect(hostedaiMock.createOneTimeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: CUSTOMER_EMAIL, teamId: TEAM.id })
    );
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: CUSTOMER_EMAIL })
    );

    // Customer metadata links back to the team.
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          hostedai_team_id: TEAM.id,
          billing_type: "hourly",
        }),
      })
    );

    expect(lifecycleMock.recordFirstDeposit).toHaveBeenCalledWith(CUSTOMER_ID, 10000);
  });

  it("credits the FULL original deposit (incl. voucher) while invoicing only the paid amount", async () => {
    const res = await deliver(
      checkoutEvent({
        amount_total: 7500, // paid after voucher discount
        metadata: {
          gpu_product_id: "prod-gpu-1",
          billing_type: "hourly",
          voucher_code: "BONUS25",
          voucher_credit_cents: "2500",
          original_deposit_cents: "10000",
        },
      })
    );

    expect(res.status).toBe(200);
    // The customer gets the full deposit value...
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ amount: -10000 })
    );
    // ...but the invoice reflects only the money that changed hands.
    expect(mockCreateInvoiceForPayment).toHaveBeenCalledWith(
      stripeMock,
      CUSTOMER_ID,
      7500,
      expect.any(String),
      "pi_checkout_1"
    );
  });

  it("records the voucher redemption atomically when a voucher was applied", async () => {
    prismaMock.voucher.findUnique.mockResolvedValue({ id: 42, code: "BONUS25" });

    await deliver(
      checkoutEvent({
        amount_total: 7500,
        metadata: {
          gpu_product_id: "prod-gpu-1",
          billing_type: "hourly",
          voucher_code: "BONUS25",
          voucher_credit_cents: "2500",
          original_deposit_cents: "10000",
        },
      })
    );

    expect(prismaMock.voucher.findUnique).toHaveBeenCalledWith({
      where: { code: "BONUS25" },
    });
    // Redemption row + counter increment must go through one transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.voucherRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        voucherId: 42,
        stripeCustomerId: CUSTOMER_ID,
        customerEmail: CUSTOMER_EMAIL,
        topupCents: 7500,
        creditCents: 2500,
      }),
    });
  });

  it("skips the duplicate deposit but still provisions the team (replay after partial failure)", async () => {
    // Scenario: first delivery credited the wallet then crashed before team
    // creation. On retry the deposit must not double-credit, but the
    // provisioning must still complete.
    stripeMock.customers.listBalanceTransactions.mockResolvedValue({
      data: [{ metadata: { checkout_session_id: "cs_checkout_1" } }],
    });

    const res = await deliver(checkoutEvent());

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(hostedaiMock.createTeam).toHaveBeenCalledTimes(1);
  });

  it("falls back to a $100 wallet credit when amount_total is missing", async () => {
    // Pins a quirk: depositAmount = original || (amountPaid || 10000).
    // A session with no amount still credits $100 — flagging here so a
    // deliberate change to this default shows up as a test diff.
    const res = await deliver(checkoutEvent({ amount_total: null }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ amount: -10000 })
    );
    // Nothing was paid, so no invoice.
    expect(mockCreateInvoiceForPayment).not.toHaveBeenCalled();
  });

  it("returns 500 when team creation fails — the customer paid and MUST get a team via retry", async () => {
    hostedaiMock.createTeam.mockRejectedValue(new Error("hosted.ai API down"));

    const res = await deliver(checkoutEvent());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Webhook handler failed");
    // The failure happens after the wallet credit — retry relies on the
    // balance-transaction idempotency check to avoid double-crediting.
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);
  });

  it("survives non-fatal failures (OTL, welcome email, metadata) and still returns 200", async () => {
    hostedaiMock.createOneTimeLogin.mockRejectedValue(new Error("OTL down"));
    mockSendWelcomeEmail.mockRejectedValue(new Error("smtp down"));
    stripeMock.customers.update.mockRejectedValue(new Error("stripe blip"));

    const res = await deliver(checkoutEvent());

    // Team exists and wallet is funded — auxiliary failures must not make
    // Stripe replay the whole provisioning.
    expect(res.status).toBe(200);
    expect(hostedaiMock.createTeam).toHaveBeenCalledTimes(1);
  });
});

describe("handleCheckoutCompleted — customer resolution (payment-mode sessions)", () => {
  it("reuses an existing Stripe customer found by email when the session has none", async () => {
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: "cus_existing_9", email: CUSTOMER_EMAIL }],
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ payment_method: "pm_9" });

    const res = await deliver(checkoutEvent({ customer: null }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    // The checkout payment method is attached for future auto-refills.
    expect(stripeMock.paymentMethods.attach).toHaveBeenCalledWith("pm_9", {
      customer: "cus_existing_9",
    });
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_existing_9",
      expect.anything()
    );
  });

  it("creates a new Stripe customer when none exists for the email", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [] });
    stripeMock.customers.create.mockResolvedValue({
      id: "cus_brand_new",
      email: CUSTOMER_EMAIL,
      metadata: {},
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ payment_method: "pm_new" });

    const res = await deliver(checkoutEvent({ customer: null }));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: CUSTOMER_EMAIL })
    );
    expect(stripeMock.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_brand_new",
      expect.anything()
    );
  });
});

describe("handleCheckoutCompleted — monthly subscriptions", () => {
  const monthlySession = {
    metadata: { gpu_product_id: "prod-gpu-1", billing_type: "monthly" },
  };

  it("reuses the primary hourly customer's team instead of creating a new one", async () => {
    const primary = {
      id: "cus_primary_7",
      email: CUSTOMER_EMAIL,
      metadata: {
        billing_type: "hourly",
        hostedai_team_id: "team-existing-7",
      },
    };
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: CUSTOMER_ID, metadata: {} }, primary],
    });
    stripeMock.customers.update.mockResolvedValue({ id: "x", metadata: {} });

    const res = await deliver(checkoutEvent(monthlySession));

    expect(res.status).toBe(200);
    // No new team, no wallet deposit for monthly.
    expect(hostedaiMock.createTeam).not.toHaveBeenCalled();
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();

    // OTL on the EXISTING team.
    expect(hostedaiMock.createOneTimeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-existing-7" })
    );

    // Cross-references written to both customers.
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      "cus_primary_7",
      expect.objectContaining({
        metadata: expect.objectContaining({
          monthly_stripe_customer_ids: expect.stringContaining(CUSTOMER_ID),
        }),
      })
    );
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          billing_type: "monthly",
          primary_stripe_customer_id: "cus_primary_7",
        }),
      })
    );

    expect(mockSendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: CUSTOMER_EMAIL })
    );
    expect(lifecycleMock.recordSubscription).toHaveBeenCalledWith("cus_primary_7", CUSTOMER_EMAIL);
    // PA-415: a monthly payment counts as a "first deposit" too, per PA-341's
    // funnel spec — credited to the primary customer, not the monthly one.
    expect(lifecycleMock.recordFirstDeposit).toHaveBeenCalledWith(
      "cus_primary_7",
      10000,
      "monthly"
    );
  });

  it("links to a free-tier primary with a team (was skipped, orphaning the monthly customer)", async () => {
    // A free signup who buys a monthly sub has a free-with-team primary; the
    // finder demanded exactly "hourly", so the monthly customer never got its
    // billing_type stamp and the launch wizard showed "No GPUs Available".
    const freePrimary = {
      id: "cus_free_primary",
      email: CUSTOMER_EMAIL,
      metadata: {
        billing_type: "free",
        hostedai_team_id: "team-free-9",
      },
    };
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: CUSTOMER_ID, metadata: {} }, freePrimary],
    });
    stripeMock.customers.update.mockResolvedValue({ id: "x", metadata: {} });

    const res = await deliver(checkoutEvent(monthlySession));

    expect(res.status).toBe(200);
    expect(hostedaiMock.createTeam).not.toHaveBeenCalled();
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      "cus_free_primary",
      expect.objectContaining({
        metadata: expect.objectContaining({
          monthly_stripe_customer_ids: expect.stringContaining(CUSTOMER_ID),
        }),
      })
    );
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          billing_type: "monthly",
          primary_stripe_customer_id: "cus_free_primary",
        }),
      })
    );
  });

  it("prefers an hourly primary over a free one when both exist", async () => {
    const freePrimary = {
      id: "cus_free_first",
      email: CUSTOMER_EMAIL,
      metadata: { billing_type: "free", hostedai_team_id: "team-a" },
    };
    const hourlyPrimary = {
      id: "cus_hourly_second",
      email: CUSTOMER_EMAIL,
      metadata: { billing_type: "hourly", hostedai_team_id: "team-b" },
    };
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: CUSTOMER_ID, metadata: {} }, freePrimary, hourlyPrimary],
    });
    stripeMock.customers.update.mockResolvedValue({ id: "x", metadata: {} });

    const res = await deliver(checkoutEvent(monthlySession));

    expect(res.status).toBe(200);
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          primary_stripe_customer_id: "cus_hourly_second",
        }),
      })
    );
  });

  it("falls through to fresh team creation when no primary customer exists", async () => {
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: CUSTOMER_ID, metadata: {} }],
    });

    const res = await deliver(checkoutEvent(monthlySession));

    expect(res.status).toBe(200);
    expect(hostedaiMock.createTeam).toHaveBeenCalledTimes(1);
    // Monthly still skips the wallet deposit even on the fallback path.
    expect(stripeMock.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(lifecycleMock.recordSubscription).toHaveBeenCalledWith(CUSTOMER_ID, CUSTOMER_EMAIL);
    // PA-415: same funnel credit on the fresh-team-creation path.
    expect(lifecycleMock.recordFirstDeposit).toHaveBeenCalledWith(
      CUSTOMER_ID,
      10000,
      "monthly"
    );
  });
});
