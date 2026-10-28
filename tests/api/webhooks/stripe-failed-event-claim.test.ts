// Tests for the idempotency claim in src/app/api/webhooks/stripe/route.ts when
// a handler fails.
//
// The claim row is written before the handler runs, so a handler that throws
// leaves an event that looks settled: Stripe's retry and the stuck-webhook
// sweep both find it claimed and report skipped, and a paid customer's
// provisioning is dropped permanently with no alert. These tests pin that a
// failed event releases its claim and stays retryable.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockConstructEvent,
  mockGetStripe,
  mockGetWebhookSecret,
  mockProcessedEventCreate,
  mockProcessedEventDeleteMany,
  mockCustomersRetrieve,
  mockCustomersList,
  mockCreateTeam,
  claimedEvents,
} = vi.hoisted(() => ({
  claimedEvents: new Set<string>(),
  mockConstructEvent: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetWebhookSecret: vi.fn(),
  mockProcessedEventCreate: vi.fn(),
  mockProcessedEventDeleteMany: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersList: vi.fn(),
  mockCreateTeam: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
  getStripeWebhookSecret: mockGetWebhookSecret,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    processedStripeEvent: {
      create: mockProcessedEventCreate,
      deleteMany: mockProcessedEventDeleteMany,
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
    gpuProduct: { findUnique: vi.fn().mockResolvedValue(null) },
    voucher: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/lib/hostedai", () => ({
  createTeam: mockCreateTeam,
  createOneTimeLogin: vi.fn(),
  suspendTeam: vi.fn(),
  unsuspendTeam: vi.fn(),
  changeTeamPackage: vi.fn(),
  syncTeamsToDefaultPolicy: vi.fn(),
  deleteInstance: vi.fn(),
  ensureDefaultPolicies: vi.fn(async () => ({})),
  ensureRoles: vi.fn(async () => ({ teamAdmin: "role-1" })),
}));
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: vi.fn(),
  createLoginLink: vi.fn(async () => "cust-token"),
}));
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
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
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: vi.fn(async () => {}) }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";

function makeRequest() {
  const headers = new Headers();
  headers.set("stripe-signature", "t=1,v1=valid");
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: "{}",
  });
}

function monthlyCheckoutEvent(id: string) {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_live_orphan",
        customer: "cus_new_monthly",
        customer_email: "existing-customer@example.com",
        amount_total: 26280,
        metadata: {
          billing_type: "monthly",
          gpu_product_id: "prod_4090_monthly",
          gpu_product_name: "1 x NVIDIA RTX 4090 - Monthly",
        },
        customer_details: { name: "Existing Customer" },
      },
    },
  };
}

describe("Stripe webhook — a failed event does not stay claimed", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetStripe.mockResolvedValue({
      webhooks: { constructEvent: mockConstructEvent },
      customers: { retrieve: mockCustomersRetrieve, list: mockCustomersList },
    });
    mockGetWebhookSecret.mockResolvedValue("whsec_test_secret");
    // A stateful stand-in for the unique index on stripeEventId, so a claim
    // that outlives a failed handler blocks the re-delivery the way it does live.
    claimedEvents.clear();
    mockProcessedEventCreate.mockImplementation(
      async ({ data }: { data: { stripeEventId: string } }) => {
        if (claimedEvents.has(data.stripeEventId)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        claimedEvents.add(data.stripeEventId);
        return {};
      },
    );
    mockProcessedEventDeleteMany.mockImplementation(
      async ({ where }: { where: { stripeEventId: string } }) => ({
        count: claimedEvents.delete(where.stripeEventId) ? 1 : 0,
      }),
    );
  });

  it("releases the claim when a handler throws", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_fail_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", items: { data: [] } } },
    });
    mockCustomersRetrieve.mockRejectedValue(new Error("Stripe unavailable"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(mockProcessedEventDeleteMany).toHaveBeenCalledWith({
      where: { stripeEventId: "evt_fail_1" },
    });
    errSpy.mockRestore();
  });

  it("processes a re-delivery of an event whose first delivery failed", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_fail_2",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_2", customer: "cus_2", items: { data: [] } } },
    });
    mockCustomersRetrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));
    mockCustomersRetrieve.mockResolvedValueOnce({ id: "cus_2", metadata: {} });

    const first = await POST(makeRequest());
    expect(first.status).toBe(500);

    const second = await POST(makeRequest());
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.skipped).toBeUndefined();
    expect(mockCustomersRetrieve).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it("keeps a monthly subscription retryable when its account link fails", async () => {
    mockConstructEvent.mockReturnValue(monthlyCheckoutEvent("evt_monthly_1"));
    mockCustomersList.mockRejectedValue(new Error("Stripe unavailable"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(mockProcessedEventDeleteMany).toHaveBeenCalledWith({
      where: { stripeEventId: "evt_monthly_1" },
    });
    expect(mockCreateTeam).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
