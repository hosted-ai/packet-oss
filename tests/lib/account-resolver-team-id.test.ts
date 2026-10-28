// Which team a session operates in when the JWT is pinned to a monthly billing customer.
// That customer carries no team of its own, only a link to the account that owns one.

import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  customersList: vi.fn(),
  customersRetrieve: vi.fn(),
  userFindUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipFindMany: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    customers: { list: m.customersList, retrieve: m.customersRetrieve },
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: m.userFindUnique },
    teamMembership: { findUnique: m.membershipFindUnique, findMany: m.membershipFindMany },
  },
}));

import { resolveCustomerTeamId, resolveOperatingContext } from "@/lib/auth/account-resolver";
import type Stripe from "stripe";

const EMAIL = "buyer@example.com";

const PRIMARY = {
  id: "cus_primary",
  email: EMAIL,
  created: 1000,
  metadata: { hostedai_team_id: "team-9", billing_type: "hourly" },
};

const MONTHLY = {
  id: "cus_monthly",
  email: EMAIL,
  created: 2000,
  metadata: { billing_type: "monthly", primary_stripe_customer_id: "cus_primary" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.userFindUnique.mockResolvedValue({ id: "user-1" });
  m.membershipFindUnique.mockResolvedValue({ status: "active", revokedAt: null });
  m.customersRetrieve.mockImplementation(async (id: string) =>
    ({ [PRIMARY.id]: PRIMARY, [MONTHLY.id]: MONTHLY })[id] ?? { id, deleted: true },
  );
});

describe("resolveOperatingContext — team id on a monthly billing customer", () => {
  it("follows primary_stripe_customer_id when the pinned account carries no team", async () => {
    m.customersList.mockResolvedValue({ data: [MONTHLY] });

    const ctx = await resolveOperatingContext({
      email: EMAIL,
      jwtCustomerId: MONTHLY.id,
      activeAccountId: MONTHLY.id,
    });

    expect(ctx?.accountId).toBe("cus_monthly");
    expect(ctx?.teamId).toBe("team-9");
    expect(ctx?.allTeamIds).toContain("team-9");
  });

  it("follows the link on the unpinned path too", async () => {
    m.customersList.mockResolvedValue({ data: [MONTHLY] });

    const ctx = await resolveOperatingContext({ email: EMAIL, jwtCustomerId: MONTHLY.id });

    expect(ctx?.accountId).toBe("cus_monthly");
    expect(ctx?.teamId).toBe("team-9");
  });

  it("prefers the account's own team over the link", async () => {
    m.customersList.mockResolvedValue({ data: [PRIMARY] });

    const ctx = await resolveOperatingContext({
      email: EMAIL,
      activeAccountId: PRIMARY.id,
    });

    expect(ctx?.teamId).toBe("team-9");
  });

  it("resolves no team when the link points at a deleted customer", async () => {
    const orphan = {
      id: "cus_orphan",
      email: EMAIL,
      created: 3000,
      metadata: { billing_type: "monthly", primary_stripe_customer_id: "cus_gone" },
    };
    m.customersList.mockResolvedValue({ data: [orphan] });
    m.customersRetrieve.mockImplementation(async (id: string) =>
      id === orphan.id ? orphan : { id, deleted: true },
    );

    const ctx = await resolveOperatingContext({ email: EMAIL, activeAccountId: orphan.id });

    expect(ctx?.teamId).toBeNull();
    expect(ctx?.allTeamIds).toEqual([]);
  });
});

// The account the team came from is what check-ready mints its auto-login token for, so
// the resolver has to hand back that customer and not only its id.
describe("resolveCustomerTeamId — the account the team came from", () => {
  const stripe = { customers: { retrieve: m.customersRetrieve } } as unknown as Stripe;

  it("returns the linked account alongside the team it owns", async () => {
    const r = await resolveCustomerTeamId(stripe, MONTHLY as unknown as Stripe.Customer);

    expect(r.teamId).toBe("team-9");
    expect(r.primaryCustomer?.id).toBe("cus_primary");
  });

  it("returns no linked account when the customer owns the team itself", async () => {
    const r = await resolveCustomerTeamId(stripe, PRIMARY as unknown as Stripe.Customer);

    expect(r.teamId).toBe("team-9");
    expect(r.primaryCustomer).toBeNull();
  });

  it("returns no linked account when the link resolves to no team", async () => {
    const teamless = { id: "cus_teamless", metadata: {} };
    m.customersRetrieve.mockImplementation(async (id: string) =>
      id === teamless.id ? teamless : { id, metadata: {} },
    );
    const linked = {
      id: "cus_linked",
      metadata: { primary_stripe_customer_id: teamless.id },
    };

    const r = await resolveCustomerTeamId(stripe, linked as unknown as Stripe.Customer);

    expect(r.teamId).toBeNull();
    expect(r.primaryCustomer).toBeNull();
  });
});
