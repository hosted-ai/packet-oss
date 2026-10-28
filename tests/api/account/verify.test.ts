// Tests for src/app/api/account/verify/route.ts (PA-287, PA-267/PA-175).
//
// POST takes a signed customer token (body.token), resolves the operating
// account, and returns the dashboard bootstrap payload: wallet, subscriptions,
// payments, OTL URL, billing portal, role/permission map, 2FA status, TOS
// gate. On a fresh magic-link arrival it establishes a 15-day session cookie.
//
// What this suite protects:
//   * missing token -> 400 (no Stripe call)
//   * invalid/expired token -> 401
//   * unresolvable account -> 404
//   * SUSPENDED customer -> 403 (fraud lockout, blocks before bootstrap)
//   * happy path -> 200, wallet built, role/can map present, customer echoed
//   * 2FA-required-but-unverified branch -> NO persistent session created
//   * fresh non-ephemeral arrival w/ 2FA satisfied + no cookie -> session created
//     and the Set-Cookie is applied
//   * ephemeral (impersonation) token -> never creates a session
//   * billing redaction: a user without billing.view gets nulled wallet/subs
//   * unexpected throw -> 500
//
// Every fire-and-forget logger is mockResolvedValue'd (the route .catch()es
// them un-awaited; a bare vi.fn() -> undefined.catch() throws).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "packet_session";

const m = vi.hoisted(() => ({
  getStripe: vi.fn(),
  subscriptionsList: vi.fn(),
  paymentIntentsList: vi.fn(),
  invoicesList: vi.fn(),
  billingPortalCreate: vi.fn(),
  verifyCustomerToken: vi.fn(),
  generateCustomerToken: vi.fn(),
  // login-link (PA-380)
  checkLoginLinkLive: vi.fn(),
  consumeLoginLink: vi.fn(),
  // customer-session
  createCustomerSession: vi.fn(),
  buildSessionCookie: vi.fn(),
  isEphemeralToken: vi.fn(),
  // auth/*
  resolveOperatingContext: vi.fn(),
  resolveMembership: vi.fn(),
  // wallet
  getWalletTransactions: vi.fn(),
  // hostedai
  createOneTimeLogin: vi.fn(),
  ensureRoles: vi.fn(),
  // two-factor
  getTwoFactorStatus: vi.fn(),
  // activity / lifecycle
  logCustomerLogin: vi.fn(),
  logAccountLogin: vi.fn(),
  logTeamMemberJoined: vi.fn(),
  recordFirstLogin: vi.fn(),
  // team-members
  getTeamMemberByEmail: vi.fn(),
  acceptTeamInvite: vi.fn(),
  // settings + suspension
  getSetting: vi.fn(),
  findSuspension: vi.fn(),
  // analytics
  trackSignUp: vi.fn(),
  posthogTrackSignUp: vi.fn(),
  // prisma
  gpuProductFindMany: vi.fn(),
  tosAcceptanceFindFirst: vi.fn(),
  activityEventFindFirst: vi.fn(),
  customerSettingsFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  customerLifecycleFindUnique: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: m.getStripe }));
vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: m.verifyCustomerToken,
  generateCustomerToken: m.generateCustomerToken,
}));
vi.mock("@/lib/auth/login-link", () => ({
  checkLoginLinkLive: m.checkLoginLinkLive,
  consumeLoginLink: m.consumeLoginLink,
}));
vi.mock("@/lib/auth/customer-session", () => ({
  createCustomerSession: m.createCustomerSession,
  buildSessionCookie: m.buildSessionCookie,
  isEphemeralToken: m.isEphemeralToken,
  SESSION_COOKIE_NAME: "packet_session",
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: m.resolveOperatingContext,
}));
vi.mock("@/lib/wallet", () => ({
  getWalletTransactions: m.getWalletTransactions,
  formatCents: (c: number) => `$${(c / 100).toFixed(2)}`,
  formatCentsForUser: (c: number) => `$${(Math.max(0, c) / 100).toFixed(2)}`,
  formatCentsSigned: (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`,
}));
vi.mock("@/lib/hostedai", () => ({
  createOneTimeLogin: m.createOneTimeLogin,
  ensureRoles: m.ensureRoles,
}));
vi.mock("@/lib/two-factor", () => ({ getTwoFactorStatus: m.getTwoFactorStatus }));
vi.mock("@/lib/admin-activity", () => ({ logCustomerLogin: m.logCustomerLogin }));
vi.mock("@/lib/activity", () => ({
  logAccountLogin: m.logAccountLogin,
  logTeamMemberJoined: m.logTeamMemberJoined,
}));
vi.mock("@/lib/lifecycle", () => ({ recordFirstLogin: m.recordFirstLogin }));
vi.mock("@/lib/analytics/ga4", () => ({
  trackSignUp: m.trackSignUp,
  trackPurchase: vi.fn(),
}));
vi.mock("@/lib/analytics/posthog", () => ({
  posthogTrackSignUp: m.posthogTrackSignUp,
  posthogTrackPurchase: vi.fn(),
}));
vi.mock("@/lib/team-members", () => ({
  getTeamMemberByEmail: m.getTeamMemberByEmail,
  acceptTeamInvite: m.acceptTeamInvite,
}));
vi.mock("@/lib/settings", () => ({ getSetting: m.getSetting }));
vi.mock("@/lib/customer-suspension", () => ({ findSuspension: m.findSuspension }));
vi.mock("@/lib/auth/membership", () => ({ resolveMembership: m.resolveMembership }));
// Use the REAL role-permissions module — it's pure (no I/O) and exercising it
// gives the role/can map real values rather than re-implementing it in mocks.
vi.mock("@/lib/billing-visibility", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/billing-visibility")>();
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findMany: m.gpuProductFindMany },
    tosAcceptance: { findFirst: m.tosAcceptanceFindFirst },
    activityEvent: { findFirst: m.activityEventFindFirst },
    customerSettings: { findUnique: m.customerSettingsFindUnique },
    user: { findUnique: m.userFindUnique },
    customerLifecycle: { findUnique: m.customerLifecycleFindUnique },
  },
}));

import { POST } from "@/app/api/account/verify/route";

function makeRequest(body: unknown, cookie?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookie}`);
  return new NextRequest("http://localhost/api/account/verify", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const OWNER_EMAIL = "owner@example.com";

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    email: OWNER_EMAIL,
    name: "Owner",
    balance: 0,
    created: 1700000000,
    metadata: { billing_type: "hourly", hostedai_team_id: "team_1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

  m.verifyCustomerToken.mockReturnValue({
    email: OWNER_EMAIL,
    customerId: "cus_1",
    type: "customer-dashboard",
    iat: 1700000000,
  });
  m.generateCustomerToken.mockReturnValue("access.jwt.token");
  // PA-380: default the login-link gate to "live" and "consumed OK". Tokens
  // without a loginLink claim skip these entirely in the route.
  m.checkLoginLinkLive.mockResolvedValue(true);
  m.consumeLoginLink.mockResolvedValue(true);

  m.getStripe.mockResolvedValue({
    subscriptions: { list: m.subscriptionsList },
    paymentIntents: { list: m.paymentIntentsList },
    invoices: { list: m.invoicesList },
    billingPortal: { sessions: { create: m.billingPortalCreate } },
  });
  m.subscriptionsList.mockResolvedValue({ data: [] });
  m.paymentIntentsList.mockResolvedValue({ data: [] });
  m.invoicesList.mockResolvedValue({ data: [] });
  m.billingPortalCreate.mockResolvedValue({ url: "https://billing.stripe/portal" });

  m.resolveOperatingContext.mockResolvedValue({
    customer: customer(),
    accountId: "cus_1",
    teamId: "team_1",
    allTeamIds: ["team_1"],
    allCustomerIds: ["cus_1"],
    monthlyCustomerIds: [],
  });
  m.findSuspension.mockResolvedValue(null);
  m.getWalletTransactions.mockResolvedValue([]);
  m.ensureRoles.mockResolvedValue({
    teamAdmin: "role-admin",
    teamMember: "role-member",
    readOnlyMember: "role-ro",
    financeManager: "role-fin",
  });
  m.createOneTimeLogin.mockResolvedValue({ url: "https://hosted.ai/otl", expires_at: "x" });
  m.getTwoFactorStatus.mockResolvedValue({ enabled: false });
  // Owner membership with full billing visibility by default.
  m.resolveMembership.mockResolvedValue({
    membershipId: "mem_1",
    userId: "user_1",
    accountId: "cus_1",
    role: "teamAdmin",
    isOwner: true,
    revokedAt: null,
    isImplicit: false,
  });
  m.getSetting.mockResolvedValue(null); // no TOS gate
  m.isEphemeralToken.mockReturnValue(false);
  m.createCustomerSession.mockResolvedValue("new-refresh-token");
  m.buildSessionCookie.mockReturnValue({
    name: SESSION_COOKIE_NAME,
    value: "new-refresh-token",
    httpOnly: true,
    path: "/",
    maxAge: 1000,
  });

  // prisma reads
  m.gpuProductFindMany.mockResolvedValue([]);
  m.tosAcceptanceFindFirst.mockResolvedValue(null);
  m.activityEventFindFirst.mockResolvedValue(null);
  m.customerSettingsFindUnique.mockResolvedValue({ bareMetalEnabled: false, teamName: "My Team" });
  m.userFindUnique.mockResolvedValue({ displayName: "Owner Display" });
  // Lifecycle record with firstLoginAt set => returning login, no sign_up_complete.
  m.customerLifecycleFindUnique.mockResolvedValue({ firstLoginAt: new Date("2026-01-01T00:00:00Z") });

  // fire-and-forget loggers
  m.logCustomerLogin.mockResolvedValue(undefined);
  m.logAccountLogin.mockResolvedValue(undefined);
  m.logTeamMemberJoined.mockResolvedValue(undefined);
  m.recordFirstLogin.mockResolvedValue(undefined);
  m.trackSignUp.mockResolvedValue(undefined);
  m.posthogTrackSignUp.mockResolvedValue(undefined);
  m.getTeamMemberByEmail.mockResolvedValue(null);
  m.acceptTeamInvite.mockResolvedValue(undefined);
});

describe("POST /api/account/verify — auth + gating", () => {
  it("returns 400 when no token is supplied", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Token is required");
    expect(m.getStripe).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid/expired token", async () => {
    m.verifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeRequest({ token: "bad" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid or expired token");
    expect(m.resolveOperatingContext).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating account cannot be resolved", async () => {
    m.resolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "t" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Account not found");
  });

  it("returns 403 for a suspended customer before any bootstrap", async () => {
    m.findSuspension.mockResolvedValue({
      suspended: true,
      suspendedAt: new Date(),
      suspendedReason: "fraud",
      suspendedBy: "admin",
    });

    const res = await POST(makeRequest({ token: "t" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("suspended");
    // Blocks before wallet/portal/session work.
    expect(m.getWalletTransactions).not.toHaveBeenCalled();
    expect(m.createCustomerSession).not.toHaveBeenCalled();
  });

  it("checks suspension across all linked customer ids", async () => {
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer(),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1", "cus_2"],
      monthlyCustomerIds: [],
    });
    await POST(makeRequest({ token: "t" }));
    expect(m.findSuspension).toHaveBeenCalledWith(["cus_1", "cus_2"]);
  });
});

describe("POST /api/account/verify — happy path", () => {
  it("returns 200 with the customer, wallet, role and permission map", async () => {
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customer).toMatchObject({
      id: "cus_1",
      email: OWNER_EMAIL,
      teamId: "team_1",
      teamName: "My Team",
    });
    expect(body.wallet).toMatchObject({ currency: "usd" });
    expect(body.role).toBe("teamAdmin");
    expect(body.membershipIsOwner).toBe(true);
    expect(body.can).toBeTruthy();
    // Owner has billing visibility.
    expect(body.can["billing.view"]).toBe(true);
    expect(body.billingPortalUrl).toBe("https://billing.stripe/portal");
    expect(body.userDisplayName).toBe("Owner Display");
    expect(body.gpuDashboardUrl).toBe("https://hosted.ai/otl");
  });

  it("generates an OTL when the account has a team", async () => {
    await POST(makeRequest({ token: "t" }));
    expect(m.createOneTimeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: OWNER_EMAIL, teamId: "team_1" }),
    );
  });

  it("logs customer + account login and records first-login", async () => {
    await POST(makeRequest({ token: "t" }));
    expect(m.logCustomerLogin).toHaveBeenCalled();
    expect(m.logAccountLogin).toHaveBeenCalled();
    expect(m.recordFirstLogin).toHaveBeenCalledWith("cus_1");
  });

  it("surfaces a wallet credit balance (flipped-sign Stripe balance)", async () => {
    // Stripe balance -2000 => $20.00 available credit.
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer({ balance: -2000 }),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1"],
      monthlyCustomerIds: [],
    });
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();
    expect(body.wallet.balance).toBe(2000);
  });

  it("surfaces a NEGATIVE (arrears) balance instead of clamping it to $0.00 (PA-339)", async () => {
    // Stripe balance +24500 => customer owes $245 => availableBalance -24500.
    // Before the fix this clamped to balance:0 / "$0.00", hiding the debt and
    // making top-ups that only reduced the deficit look like they vanished.
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer({ balance: 24500 }),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1"],
      monthlyCustomerIds: [],
    });
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();
    expect(body.wallet.balance).toBe(-24500);
    expect(body.wallet.balanceFormatted).toBe("-$245.00");
  });

  it("reports a TOS consent requirement when the version is unaccepted", async () => {
    m.getSetting.mockResolvedValue("v3");
    m.tosAcceptanceFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(body.tosConsent).toEqual({ required: true, currentVersion: "v3" });
  });

  it("fires sign_up_complete analytics on the first-ever login", async () => {
    m.customerLifecycleFindUnique.mockResolvedValue({ firstLoginAt: null });

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isNewSignup).toBe(true);
    expect(m.trackSignUp).toHaveBeenCalledWith("cus_1");
    expect(m.posthogTrackSignUp).toHaveBeenCalledWith("cus_1", OWNER_EMAIL);
  });

  it("does not fire sign_up_complete on a returning login", async () => {
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(body.isNewSignup).toBe(false);
    expect(m.trackSignUp).not.toHaveBeenCalled();
    expect(m.posthogTrackSignUp).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/verify — billing redaction", () => {
  it("nulls wallet/subscriptions for a user without billing.view", async () => {
    // Read-only member: no billing.view permission.
    m.resolveMembership.mockResolvedValue({
      membershipId: "mem_2",
      userId: "user_2",
      accountId: "cus_1",
      role: "readOnlyMember",
      isOwner: false,
      revokedAt: null,
      isImplicit: false,
    });
    // A non-owner viewer (email differs from the Stripe customer email).
    m.verifyCustomerToken.mockReturnValue({
      email: "viewer@example.com",
      customerId: "cus_1",
      type: "customer-dashboard",
      iat: 1700000000,
    });

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.can["billing.view"]).toBe(false);
    expect(body.wallet).toBeNull();
    expect(body.transactions).toEqual([]);
    expect(body.billingPortalUrl).toBeNull();
  });
});

describe("POST /api/account/verify — session establishment", () => {
  it("creates a 15-day session and sets the cookie on a fresh magic-link arrival", async () => {
    const res = await POST(makeRequest({ token: "t" })); // no session cookie
    const body = await res.json();

    expect(m.createCustomerSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_1", email: OWNER_EMAIL }),
    );
    expect(body.sessionPersisted).toBe(true);
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("new-refresh-token");
  });

  it("does NOT create a session when a session cookie already exists", async () => {
    const res = await POST(makeRequest({ token: "t" }, "existing-refresh"));
    const body = await res.json();
    expect(m.createCustomerSession).not.toHaveBeenCalled();
    expect(body.sessionPersisted).toBe(false);
  });

  it("does NOT create a session for an ephemeral (impersonation) token", async () => {
    m.isEphemeralToken.mockReturnValue(true);
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();
    expect(m.createCustomerSession).not.toHaveBeenCalled();
    expect(body.sessionPersisted).toBe(false);
  });

  it("does NOT create a session while 2FA is enabled but not yet verified", async () => {
    m.getTwoFactorStatus.mockResolvedValue({ enabled: true });
    m.verifyCustomerToken.mockReturnValue({
      email: OWNER_EMAIL,
      customerId: "cus_1",
      type: "customer-dashboard",
      twoFactorVerified: false,
      iat: 1700000000,
    });

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(body.twoFactor.enabled).toBe(true);
    // 2FA not satisfied -> no persistent session yet.
    expect(m.createCustomerSession).not.toHaveBeenCalled();
    expect(body.sessionPersisted).toBe(false);
  });

  it("creates a session once 2FA is satisfied", async () => {
    m.getTwoFactorStatus.mockResolvedValue({ enabled: true });
    m.verifyCustomerToken.mockReturnValue({
      email: OWNER_EMAIL,
      customerId: "cus_1",
      type: "customer-dashboard",
      twoFactorVerified: true,
      iat: 1700000000,
    });

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(m.createCustomerSession).toHaveBeenCalled();
    expect(body.sessionPersisted).toBe(true);
  });

  it("survives a non-fatal createCustomerSession failure (200, no cookie)", async () => {
    m.createCustomerSession.mockRejectedValue(new Error("session db down"));
    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sessionPersisted).toBe(false);
  });
});

describe("POST /api/account/verify — team invite + errors", () => {
  it("accepts a pending team invite for a non-owner viewer", async () => {
    m.verifyCustomerToken.mockReturnValue({
      email: "member@example.com",
      customerId: "cus_1",
      type: "customer-dashboard",
      iat: 1700000000,
    });
    m.getTeamMemberByEmail.mockResolvedValue({
      id: "tm_1",
      acceptedAt: null,
      stripeCustomerId: "cus_1",
    });

    await POST(makeRequest({ token: "t" }));

    expect(m.acceptTeamInvite).toHaveBeenCalledWith("tm_1");
    expect(m.logTeamMemberJoined).toHaveBeenCalled();
  });

  it("returns 500 when account resolution throws", async () => {
    m.resolveOperatingContext.mockRejectedValue(new Error("resolver boom"));
    const res = await POST(makeRequest({ token: "t" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to verify account");
  });

  it("returns 500 on a malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/account/verify", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// PA-380: single-use sign-in / invitation links. The route gates tokens carrying
// a `loginLink` claim + `jti` against the login_link row; access tokens (no such
// claim) are untouched.
describe("POST /api/account/verify — single-use sign-in links (PA-380)", () => {
  const loginLinkPayload = {
    email: OWNER_EMAIL,
    customerId: "cus_1",
    type: "customer-dashboard" as const,
    loginLink: true,
    jti: "jti-1",
    iat: 1700000000,
  };

  it("rejects a dead sign-in link (expired/used/superseded) when there's no session cookie", async () => {
    m.verifyCustomerToken.mockReturnValue(loginLinkPayload);
    m.checkLoginLinkLive.mockResolvedValue(false);

    const res = await POST(makeRequest({ token: "t" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/expired or already been used/i);
    expect(m.consumeLoginLink).not.toHaveBeenCalled();
    expect(m.createCustomerSession).not.toHaveBeenCalled();
  });

  it("consumes the link and establishes a session on first use", async () => {
    m.verifyCustomerToken.mockReturnValue(loginLinkPayload);

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(m.consumeLoginLink).toHaveBeenCalledWith("jti-1");
    expect(m.createCustomerSession).toHaveBeenCalled();
    expect(body.sessionPersisted).toBe(true);
    // Hands the client a fresh 12h access token so it stops using the short link.
    expect(body.accessToken).toBe("access.jwt.token");
  });

  it("rejects when the link loses the consume race (already used concurrently)", async () => {
    m.verifyCustomerToken.mockReturnValue(loginLinkPayload);
    m.consumeLoginLink.mockResolvedValue(false);

    const res = await POST(makeRequest({ token: "t" }));

    expect(res.status).toBe(401);
    expect(m.createCustomerSession).not.toHaveBeenCalled();
  });

  it("skips login-link checks when a live session cookie is already present", async () => {
    m.verifyCustomerToken.mockReturnValue(loginLinkPayload);

    const res = await POST(makeRequest({ token: "t" }, "existing-refresh-cookie"));

    expect(res.status).toBe(200);
    // Cookie is the authority — the stale link token is neither validated nor consumed.
    expect(m.checkLoginLinkLive).not.toHaveBeenCalled();
    expect(m.consumeLoginLink).not.toHaveBeenCalled();
    expect(m.createCustomerSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/verify — a withdrawn monthly product still resolves", () => {
  it("matches the subscription's product without gating on `active`", async () => {
    m.subscriptionsList.mockResolvedValue({
      data: [
        {
          id: "sub_1",
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: "price_withdrawn", product: "prod_withdrawn" },
                current_period_start: 1,
                current_period_end: 2,
                quantity: 1,
              },
            ],
          },
        },
      ],
    });
    m.gpuProductFindMany.mockResolvedValue([
      {
        id: "gpuprod_withdrawn",
        name: "RTX6000 Dynamic Monthly",
        billingType: "monthly",
        stripePriceId: "price_withdrawn",
        stripeProductId: "prod_withdrawn",
        pricePerMonthCents: 29900,
        poolIds: "[41]",
        active: false,
      },
    ]);

    const res = await POST(makeRequest({ token: "t" }));

    expect(res.status).toBe(200);
    const where = m.gpuProductFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("active");
    const body = await res.json();
    expect(body.subscriptions[0].productId).toBe("gpuprod_withdrawn");
  });
});

// The defect this guards: the subscription cards read only the primary customer and the
// ones stamped billing_type=monthly, so a subscription bought on a customer the webhook
// never stamped had no card — and a card is the only way to redeploy that slot.
describe("POST /api/account/verify — subscriptions on an unstamped customer (PA-1725)", () => {
  const subOn = (id: string, priceId: string) => ({
    id,
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: priceId, product: `prod_${priceId}` },
          current_period_start: 1,
          current_period_end: 2,
          quantity: 1,
        },
      ],
    },
  });

  it("reads the subscription accounts the resolver hands it, verbatim", async () => {
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer(),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1", "cus_unstamped"],
      monthlyCustomerIds: ["cus_unstamped"],
    });
    m.subscriptionsList.mockImplementation(async ({ customer: cid }: { customer: string }) =>
      cid === "cus_unstamped" ? { data: [subOn("sub_hidden", "price_b200")] } : { data: [] }
    );

    const res = await POST(makeRequest({ token: "t" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.subscriptions.map((s: { id: string }) => s.id)).toEqual(["sub_hidden"]);
  });

  it("reads every linked customer exactly once", async () => {
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer(),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1", "cus_2"],
      monthlyCustomerIds: ["cus_2"],
    });

    await POST(makeRequest({ token: "t" }));

    const asked = m.subscriptionsList.mock.calls.map((c: [{ customer: string }]) => c[0].customer);
    expect(asked.sort()).toEqual(["cus_1", "cus_2"]);
  });

  it("deduplicates a subscription reachable through two customers", async () => {
    m.resolveOperatingContext.mockResolvedValue({
      customer: customer(),
      accountId: "cus_1",
      teamId: "team_1",
      allTeamIds: ["team_1"],
      allCustomerIds: ["cus_1", "cus_2"],
      monthlyCustomerIds: ["cus_2"],
    });
    m.subscriptionsList.mockResolvedValue({ data: [subOn("sub_same", "price_x")] });

    const body = await (await POST(makeRequest({ token: "t" }))).json();
    expect(body.subscriptions).toHaveLength(1);
  });
});
