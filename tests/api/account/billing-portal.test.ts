// Tests for src/app/api/account/billing-portal/route.ts (PA-287).
//
// Creates a fresh Stripe Billing Portal session for the OPERATING account
// (PA-175: an invited Finance Manager opens the team owner's portal, not their
// own personal Stripe customer). The portal exposes payment methods + invoices,
// so it's billing.manage-gated and must scope to the resolved account id.
//
// Pinned contracts (POST):
//   * Bearer auth (missing token -> 401, invalid token -> 401)
//   * resolveOperatingContext consulted; unresolvable -> 404, no portal create
//   * PA-175 gate: billing.manage denial short-circuits before portal create
//   * Gate receives ctx.accountId + ctx.customer.email (null when absent)
//   * Happy path creates the portal session scoped to ctx.accountId with the
//     dashboard return_url (PA-267: no token in the URL) and returns its url
//   * Stripe / unexpected throw -> 500
//
// Dependencies are mocked at the import boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGetStripe,
  mockGatePermission,
  mockResolveOperatingContext,
  mockPortalCreate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGatePermission: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockPortalCreate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));

import { POST } from "@/app/api/account/billing-portal/route";

const PAYLOAD = {
  customerId: "cus_jwt",
  email: "owner@example.com",
  activeAccountId: undefined,
};

const CTX = {
  customer: { id: "cus_op", email: "owner@example.com" },
  accountId: "cus_op",
  allTeamIds: ["team_1"],
  allCustomerIds: ["cus_op"],
  monthlyCustomerIds: [],
};

function makeRequest({ auth = "Bearer good-token" }: { auth?: string | null } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/billing-portal", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null); // allowed by default
  mockPortalCreate.mockResolvedValue({
    id: "bps_1",
    url: "https://billing.stripe.com/p/session/bps_1",
  });
  mockGetStripe.mockResolvedValue({
    billingPortal: { sessions: { create: mockPortalCreate } },
  });
});

describe("POST /api/account/billing-portal — auth", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const res = await POST(makeRequest({ auth: null }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockVerifyCustomerToken).not.toHaveBeenCalled();
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when the token fails verification", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid or expired token");
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/billing-portal — operating context + gate", () => {
  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Account not found");
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });

  it("resolves the operating context from the JWT identity", async () => {
    await POST(makeRequest());
    expect(mockResolveOperatingContext).toHaveBeenCalledWith({
      email: "owner@example.com",
      jwtCustomerId: "cus_jwt",
      activeAccountId: undefined,
    });
  });

  it("returns the gate denial verbatim when billing.manage is denied — before portal create", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);

    const res = await POST(makeRequest());

    expect(res).toBe(denied);
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });

  it("gates against the OPERATING accountId + customer email (not the JWT customer)", async () => {
    await POST(makeRequest());

    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "billing.manage",
        accountId: "cus_op",
        customerEmail: "owner@example.com",
      }),
    );
  });

  it("passes null customerEmail to the gate when the operating customer has no email", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { id: "cus_op", email: null },
    });

    await POST(makeRequest());

    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: null }),
    );
  });
});

describe("POST /api/account/billing-portal — happy path + errors", () => {
  it("creates a portal session scoped to the operating account and returns its url", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://billing.stripe.com/p/session/bps_1");

    expect(mockPortalCreate).toHaveBeenCalledTimes(1);
    const arg = mockPortalCreate.mock.calls[0][0];
    expect(arg.customer).toBe("cus_op");
    // PA-267: return URL is the bare dashboard — no token leaked into history.
    expect(arg.return_url).toContain("/dashboard");
    expect(arg.return_url).not.toContain("token=");
  });

  it("returns 500 when the portal session create throws", async () => {
    mockPortalCreate.mockRejectedValue(new Error("stripe down"));

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to create billing portal session");
    expect(mockPortalCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when resolveOperatingContext throws", async () => {
    mockResolveOperatingContext.mockRejectedValue(new Error("resolver boom"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });
});
