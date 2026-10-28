// Tests for src/app/api/session/accounts/route.ts (PA-1950).
//
// GET /api/session/accounts — returns all accounts the authenticated user can
// switch between. Merges team_membership rows + implicit-Owner Stripe customers.
//
// PA-1950 bug: an invited-only user (whose own Stripe customer has no HAI
// workspace) sees a misleading "My account / Owner" entry alongside the correct
// "Read-only Member" team entry. Fix: suppress the own-account entry when the
// primary customer has no hostedai_team_id.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/* ─── hoisted mocks ──────────────────────────────────────────────────── */

const {
  mockVerifyCustomerToken,
  mockUserFindUnique,
  mockTeamMembershipFindMany,
  mockCustomerSettingsFindUnique,
  mockResolveAllTeamsForEmail,
  mockStripeCustomersRetrieve,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockTeamMembershipFindMany: vi.fn(),
  mockCustomerSettingsFindUnique: vi.fn(),
  mockResolveAllTeamsForEmail: vi.fn(),
  mockStripeCustomersRetrieve: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    teamMembership: { findMany: mockTeamMembershipFindMany },
    customerSettings: { findUnique: mockCustomerSettingsFindUnique },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: { retrieve: mockStripeCustomersRetrieve },
  }),
}));

vi.mock("@/lib/customer-resolver", () => ({
  resolveAllTeamsForEmail: mockResolveAllTeamsForEmail,
}));

/* ─── import under test ──────────────────────────────────────────────── */

import { GET } from "@/app/api/session/accounts/route";

/* ─── helpers ────────────────────────────────────────────────────────── */

function makeRequest(token = "valid-jwt") {
  return new NextRequest("http://localhost/api/session/accounts", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Stripe.Customer-like object (only fields the route reads). */
function stripeCustomer(
  id: string,
  email: string,
  metadata: Record<string, string> = {},
) {
  return { id, email, deleted: false, metadata };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockVerifyCustomerToken.mockReturnValue({
    email: "invited@test.com",
    customerId: "cus_own",
  });

  mockUserFindUnique.mockResolvedValue({ id: "user_1" });
  mockTeamMembershipFindMany.mockResolvedValue([]);
  mockCustomerSettingsFindUnique.mockResolvedValue(null);
  mockStripeCustomersRetrieve.mockImplementation(async (id: string) => {
    throw new Error(`Unexpected Stripe retrieve for ${id}`);
  });
});

/* ─── tests ──────────────────────────────────────────────────────────── */

describe("GET /api/session/accounts", () => {
  it("returns 401 without an authorization header", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/session/accounts"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("bad"));
    expect(res.status).toBe(401);
  });

  // ── PA-1950: invited-only user should NOT see their empty own account ──

  it("omits the own-account entry when the primary customer has no hostedai_team_id (PA-1950)", async () => {
    // Setup: user was invited to cus_team as readOnlyMember.
    // Their own Stripe customer (cus_own) has NO hostedai_team_id.
    const ownCustomer = stripeCustomer("cus_own", "invited@test.com", {});
    const teamCustomer = stripeCustomer("cus_team", "owner@team.com", {
      hostedai_team_id: "hai_team_1",
    });

    mockResolveAllTeamsForEmail.mockResolvedValue({
      primaryCustomer: ownCustomer,
      allTeamIds: [],
      allCustomerIds: ["cus_own"],
      monthlyCustomerIds: [],
      hourlyCustomerId: null,
    });

    mockTeamMembershipFindMany.mockResolvedValue([
      {
        stripeCustomerId: "cus_team",
        userId: "user_1",
        role: "readOnlyMember",
        isOwner: false,
        status: "active",
        revokedAt: null,
        acceptedAt: new Date(),
      },
    ]);

    mockStripeCustomersRetrieve.mockImplementation(async (id: string) => {
      if (id === "cus_team") return teamCustomer;
      if (id === "cus_own") return ownCustomer;
      throw new Error(`Unexpected retrieve: ${id}`);
    });

    mockCustomerSettingsFindUnique.mockResolvedValue({ teamName: "Alpha Team" });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only the invited team should appear — NOT the empty own account.
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].accountId).toBe("cus_team");
    expect(body.accounts[0].role).toBe("readOnlyMember");
    expect(body.accounts[0].isOwner).toBe(false);
  });

  // ── Normal user: own account WITH a team_id should still appear ──

  it("includes the own-account entry when the primary customer has hostedai_team_id", async () => {
    const ownCustomer = stripeCustomer("cus_own", "user@test.com", {
      hostedai_team_id: "hai_team_own",
      billing_type: "hourly",
    });
    const teamCustomer = stripeCustomer("cus_team", "owner@team.com", {
      hostedai_team_id: "hai_team_1",
    });

    mockVerifyCustomerToken.mockReturnValue({
      email: "user@test.com",
      customerId: "cus_own",
    });

    mockResolveAllTeamsForEmail.mockResolvedValue({
      primaryCustomer: ownCustomer,
      allTeamIds: ["hai_team_own"],
      allCustomerIds: ["cus_own"],
      monthlyCustomerIds: [],
      hourlyCustomerId: "cus_own",
    });

    mockTeamMembershipFindMany.mockResolvedValue([
      {
        stripeCustomerId: "cus_team",
        userId: "user_1",
        role: "member",
        isOwner: false,
        status: "active",
        revokedAt: null,
        acceptedAt: new Date(),
      },
    ]);

    mockStripeCustomersRetrieve.mockImplementation(async (id: string) => {
      if (id === "cus_own") return ownCustomer;
      if (id === "cus_team") return teamCustomer;
      throw new Error(`Unexpected retrieve: ${id}`);
    });

    mockCustomerSettingsFindUnique.mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Both accounts should appear: own (Owner) + invited team (Member).
    expect(body.accounts).toHaveLength(2);
    const ownEntry = body.accounts.find(
      (a: { accountId: string }) => a.accountId === "cus_own",
    );
    const teamEntry = body.accounts.find(
      (a: { accountId: string }) => a.accountId === "cus_team",
    );
    expect(ownEntry).toBeDefined();
    expect(ownEntry.isOwner).toBe(true);
    expect(teamEntry).toBeDefined();
    expect(teamEntry.role).toBe("member");
  });
});
