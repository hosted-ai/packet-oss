// Which Stripe customers a session's subscriptions are read from, when the JWT pins an
// operating account. That list decided whether a paying customer could redeploy a GPU.

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

import { resolveOperatingContext } from "@/lib/auth/account-resolver";

const OWNER = "owner@example.com";

const cust = (
  id: string,
  opts: { email?: string; created?: number; team?: string; billing?: string; linked?: string } = {},
) => ({
  id,
  email: opts.email ?? OWNER,
  created: opts.created ?? 1000,
  metadata: {
    hostedai_team_id: opts.team ?? "team-1",
    billing_type: opts.billing ?? "monthly",
    ...(opts.linked ? { monthly_stripe_customer_ids: opts.linked } : {}),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.userFindUnique.mockResolvedValue({ id: "user-1" });
  m.membershipFindUnique.mockResolvedValue({ status: "active", revokedAt: null });
});

// The defect this guards: the webhook maintains monthly_stripe_customer_ids on only one
// account, so a session pinned to any other one saw a subset of what it pays for.
describe("resolveOperatingContext — subscriptions on your own accounts", () => {
  it("reads every account on the address, not just the webhook's list", async () => {
    m.customersList.mockResolvedValue({
      data: [
        cust("cus_pinned", { created: 3000, billing: "hourly", linked: "cus_b" }),
        cust("cus_a", { created: 2000 }),
        cust("cus_b", { created: 1000 }),
      ],
    });
    m.customersRetrieve.mockResolvedValue(cust("cus_pinned", { billing: "hourly", linked: "cus_b" }));

    const ctx = await resolveOperatingContext({
      email: OWNER,
      jwtCustomerId: "cus_pinned",
      activeAccountId: "cus_pinned",
    });

    expect(ctx?.accountId).toBe("cus_pinned");
    expect([...(ctx?.monthlyCustomerIds ?? [])].sort()).toEqual(["cus_a", "cus_b"]);
  });

  it("never lists the operating account against itself", async () => {
    m.customersList.mockResolvedValue({
      data: [cust("cus_pinned"), cust("cus_a", { created: 900 })],
    });
    m.customersRetrieve.mockResolvedValue(cust("cus_pinned"));

    const ctx = await resolveOperatingContext({
      email: OWNER,
      activeAccountId: "cus_pinned",
    });

    expect(ctx?.monthlyCustomerIds).not.toContain("cus_pinned");
  });

  it("still honours the webhook's list when it names an account the email scan missed", async () => {
    m.customersList.mockResolvedValue({ data: [cust("cus_pinned", { linked: "cus_elsewhere" })] });
    m.customersRetrieve.mockResolvedValue(cust("cus_pinned", { linked: "cus_elsewhere" }));

    const ctx = await resolveOperatingContext({
      email: OWNER,
      activeAccountId: "cus_pinned",
    });

    expect(ctx?.monthlyCustomerIds).toContain("cus_elsewhere");
  });
});

// The other half of the same decision: operating a team you do not own must not pull your
// own billing into that workspace, so there the webhook's list is all that may be read.
describe("resolveOperatingContext — operating someone else's team", () => {
  it("keeps a member's own subscriptions out of the owner's workspace", async () => {
    m.customersList.mockResolvedValue({
      data: [cust("cus_mine", { email: "member@example.com" })],
    });
    m.customersRetrieve.mockResolvedValue(
      cust("cus_theirs", { email: OWNER, linked: "cus_theirs_2" }),
    );

    const ctx = await resolveOperatingContext({
      email: "member@example.com",
      activeAccountId: "cus_theirs",
    });

    expect(ctx?.accountId).toBe("cus_theirs");
    expect(ctx?.monthlyCustomerIds).toEqual(["cus_theirs_2"]);
    expect(ctx?.monthlyCustomerIds).not.toContain("cus_mine");
  });

  it("still checks suspension across the member's own accounts", async () => {
    m.customersList.mockResolvedValue({
      data: [cust("cus_mine", { email: "member@example.com" })],
    });
    m.customersRetrieve.mockResolvedValue(cust("cus_theirs", { email: OWNER }));

    const ctx = await resolveOperatingContext({
      email: "member@example.com",
      activeAccountId: "cus_theirs",
    });

    expect(ctx?.allCustomerIds).toContain("cus_mine");
  });
});
