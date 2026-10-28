// THE INVARIANT
//
//   For every active Stripe subscription on an email address, session resolution from ANY
//   account that email owns must return that subscription.
//
// Monthly checkout deliberately mints a fresh Stripe customer per subscription, so one human
// legitimately owns many. The link between them is a metadata string the webhook writes onto
// whichever customer IT ranks primary, and session resolution reads from whichever customer
// the SESSION pinned. Those are different customers whenever a JWT carries activeAccountId,
// and a customer with seven paid subscriptions was told "All subscriptions deployed" with
// five slots free.
//
// Every existing test passed through that. The webhook's suites assert it writes the link;
// the resolver's suites hand it a context and assert it reads what it was handed. Neither
// can see the two disagreeing. This one spans them: ONE mutable Stripe store, written by the
// real webhook POST and then read by the real resolver, checked from every account in turn
// through the same lookup set /api/instances/launch-options builds.
//
// The fixture is the shape that broke — nine Stripe customers on one address, seven active
// subscriptions one per customer, one account with no team, one stamped hourly while holding
// a monthly subscription, and the cross-link string on only one of the nine.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Metadata = Record<string, string>;
type FakeCustomer = { id: string; email: string; created: number; metadata: Metadata };
type FakeSub = { id: string; customer: string; status: string };

const store = vi.hoisted(() => ({
  customers: [] as FakeCustomer[],
  subs: [] as FakeSub[],
}));

const m = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  userFindUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
}));

const stripeFake = vi.hoisted(() => ({
  webhooks: { constructEvent: (...a: unknown[]) => m.constructEvent(...a) },
  customers: {
    // Stripe lists newest-first, and both ranking loops depend on that order.
    list: async ({ email }: { email: string }) => ({
      data: store.customers
        .filter((c) => c.email.toLowerCase() === email.toLowerCase())
        .slice()
        .sort((a, b) => b.created - a.created),
    }),
    retrieve: async (id: string) => store.customers.find((c) => c.id === id) ?? null,
    update: async (id: string, patch: { metadata?: Metadata }) => {
      const c = store.customers.find((x) => x.id === id);
      if (!c) throw new Error(`no such customer ${id}`);
      if (patch.metadata) c.metadata = { ...patch.metadata };
      return c;
    },
    create: async () => {
      throw new Error("the fixture creates its own customers");
    },
    createBalanceTransaction: async () => ({}),
    listBalanceTransactions: async () => ({ data: [] }),
  },
  subscriptions: {
    list: async ({ customer, status }: { customer: string; status?: string }) => ({
      data: store.subs.filter(
        (s) => s.customer === customer && (!status || s.status === status),
      ),
    }),
  },
  prices: { retrieve: async () => ({}) },
  paymentIntents: { retrieve: async () => ({}) },
  paymentMethods: { attach: async () => ({}) },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => stripeFake,
  getStripeWebhookSecret: async () => "whsec_test",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: m.userFindUnique },
    teamMembership: { findUnique: m.membershipFindUnique, findMany: m.membershipFindMany },
    processedStripeEvent: {
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
    },
    gpuProduct: { findUnique: vi.fn(async () => ({ name: "H100 x1 Monthly" })) },
    voucher: { findUnique: vi.fn(async () => null), update: vi.fn() },
    voucherRedemption: { create: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/hostedai", () => ({
  createTeam: vi.fn(async () => ({ id: "team-new", name: "T" })),
  createOneTimeLogin: vi.fn(async () => ({ url: "https://otl.example/x" })),
  ensureDefaultPolicies: vi.fn(async () => ({})),
  ensureRoles: vi.fn(async () => ({ teamAdmin: "role-1" })),
  syncTeamsToDefaultPolicy: vi.fn(async () => undefined),
  suspendTeam: vi.fn(),
  unsuspendTeam: vi.fn(),
  changeTeamPackage: vi.fn(),
  unsubscribeFromPool: vi.fn(),
}));
vi.mock("@/lib/lifecycle", () => ({
  recordFirstDeposit: vi.fn(async () => undefined),
  recordSubscription: vi.fn(async () => undefined),
  recordChurn: vi.fn(),
  recordReactivation: vi.fn(),
  addSpend: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: vi.fn() }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: vi.fn(() => "tok"),
  createLoginLink: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: vi.fn(async () => undefined) }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/edition", () => ({ isPro: () => false }));
vi.mock("@/lib/referral", () => ({
  checkAndProcessReferralQualification: vi.fn(async () => ({ processed: false })),
}));
vi.mock("@/lib/voucher", () => ({ processVoucherRedemption: vi.fn() }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: vi.fn(async () => undefined) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/stripe/route";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";

const EMAIL = "whale@example.com";

const customer = (
  id: string,
  created: number,
  opts: { team?: string | null; billing?: string; linked?: string } = {},
): FakeCustomer => ({
  id,
  email: EMAIL,
  created,
  metadata: {
    ...(opts.team === null ? {} : { hostedai_team_id: opts.team ?? "team-1" }),
    billing_type: opts.billing ?? "monthly",
    ...(opts.linked ? { monthly_stripe_customer_ids: opts.linked } : {}),
  },
});

function seedTheWhale() {
  store.customers = [
    customer("cus_primary", 1000, { billing: "hourly", linked: "cus_m2" }),
    customer("cus_m1", 2000),
    customer("cus_m2", 3000),
    customer("cus_m3", 4000),
    customer("cus_m4", 5000),
    customer("cus_m5", 6000),
    customer("cus_noteam", 7000, { team: null }),
    customer("cus_mislabelled_hourly", 8000, { billing: "hourly" }),
    customer("cus_idle", 9000),
  ];
  store.subs = [
    { id: "sub_1", customer: "cus_m1", status: "active" },
    { id: "sub_2", customer: "cus_m2", status: "active" },
    { id: "sub_3", customer: "cus_m3", status: "active" },
    { id: "sub_4", customer: "cus_m4", status: "active" },
    { id: "sub_5", customer: "cus_m5", status: "active" },
    { id: "sub_6", customer: "cus_noteam", status: "active" },
    { id: "sub_7", customer: "cus_mislabelled_hourly", status: "active" },
    { id: "sub_cancelled", customer: "cus_idle", status: "canceled" },
  ];
}

function activeSubscriptionIds() {
  return store.subs.filter((s) => s.status === "active").map((s) => s.id).sort();
}

// The read side is not the resolver alone but what a consumer does with it, and the
// invariant has to hold for the STRICTEST consumer. /api/account/verify — the endpoint
// behind the subscription cards that said "All subscriptions deployed" — is that one:
// it looks up `ctx.monthlyCustomerIds` and the operating account, and nothing else.
// /api/instances/launch-options unions `allCustomerIds` on top, so it is a superset and
// modelling it here would let the resolver regress without a failure.
async function subscriptionsVisibleFrom(accountId: string) {
  const ctx = await resolveOperatingContext({
    email: EMAIL,
    jwtCustomerId: accountId,
    activeAccountId: accountId,
  });
  if (!ctx) return null;

  const lookupIds = Array.from(new Set([ctx.accountId, ...ctx.monthlyCustomerIds]));
  const found = new Set<string>();
  for (const id of lookupIds) {
    const { data } = await stripeFake.subscriptions.list({ customer: id, status: "active" });
    for (const sub of data) found.add(sub.id);
  }
  return [...found].sort();
}

// A real monthly checkout through the real webhook entry point, so the cross-link string the
// resolver then reads is the one the writing subsystem actually produced.
async function deliverMonthlyCheckout(customerId: string) {
  const event = {
    id: `evt_${customerId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${customerId}`,
        customer: customerId,
        customer_email: EMAIL,
        customer_details: { name: "Whale Customer" },
        amount_total: 0,
        metadata: { gpu_product_id: "prod-h100", billing_type: "monthly" },
      },
    },
  };
  m.constructEvent.mockReturnValue(event);
  return POST(
    new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=valid" },
      body: JSON.stringify(event),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seedTheWhale();
  m.userFindUnique.mockResolvedValue({ id: "user-1" });
  m.membershipFindUnique.mockResolvedValue({ status: "active", revokedAt: null });
  m.membershipFindMany.mockResolvedValue([]);
});

describe("every active subscription is reachable from every account its owner holds", () => {
  it("holds for all nine accounts, with the cross-link string on only one of them", async () => {
    const expected = activeSubscriptionIds();
    expect(expected).toHaveLength(7);

    const unreachable: Array<{ account: string; missing: string[] }> = [];
    for (const account of store.customers) {
      const visible = await subscriptionsVisibleFrom(account.id);
      const missing = expected.filter((id) => !(visible ?? []).includes(id));
      if (missing.length) unreachable.push({ account: account.id, missing });
    }

    expect(unreachable).toEqual([]);
  });

  // An account with no team is still an account its owner pays through, and the pinned
  // session may be any of them — including that one.
  it("holds from the account that has no team of its own", async () => {
    expect(await subscriptionsVisibleFrom("cus_noteam")).toEqual(activeSubscriptionIds());
  });

  // billing_type is a stamp the webhook applies, and it can be absent or wrong. Metadata
  // disagreeing with Stripe must not make a paid subscription invisible.
  it("holds from an account stamped hourly while holding a monthly subscription", async () => {
    expect(await subscriptionsVisibleFrom("cus_mislabelled_hourly")).toEqual(
      activeSubscriptionIds(),
    );
  });

  it("holds from the one account the webhook's cross-link string lives on", async () => {
    expect(store.customers.find((c) => c.id === "cus_primary")?.metadata)
      .toHaveProperty("monthly_stripe_customer_ids");
    expect(await subscriptionsVisibleFrom("cus_primary")).toEqual(activeSubscriptionIds());
  });

  it("still holds after the webhook writes a new subscription's link", async () => {
    store.customers.push(customer("cus_m6", 10000));
    store.subs.push({ id: "sub_8", customer: "cus_m6", status: "active" });

    expect((await deliverMonthlyCheckout("cus_m6")).status).toBe(200);

    // The webhook and the resolver rank identically, so the link is written to the
    // account the resolver reads it from — the oldest team-carrying customer.
    const stamped = store.customers.filter((c) => c.metadata.monthly_stripe_customer_ids);
    expect(stamped.map((c) => c.id).sort()).toEqual(["cus_primary"]);
    expect(
      store.customers.find((c) => c.id === "cus_primary")?.metadata
        .monthly_stripe_customer_ids,
    ).toContain("cus_m6");

    const expected = activeSubscriptionIds();
    expect(expected).toHaveLength(8);
    for (const account of store.customers) {
      expect([account.id, await subscriptionsVisibleFrom(account.id)]).toEqual([
        account.id,
        expected,
      ]);
    }
  });

  // The counterpart: a member operating someone ELSE'S team must not see their own
  // subscriptions in that workspace, so email-wide resolution is scoped to ownership.
  it("does not leak a member's own subscriptions into an owner's workspace", async () => {
    store.customers.push({
      id: "cus_other_owner",
      email: "someone.else@example.com",
      created: 500,
      metadata: { hostedai_team_id: "team-other", billing_type: "hourly" },
    });

    const ctx = await resolveOperatingContext({
      email: EMAIL,
      jwtCustomerId: "cus_primary",
      activeAccountId: "cus_other_owner",
    });

    expect(ctx?.accountId).toBe("cus_other_owner");
    expect(ctx?.monthlyCustomerIds).toEqual([]);
  });
});
