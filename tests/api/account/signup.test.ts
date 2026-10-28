// Tests for src/app/api/account/signup/route.ts (PA-287).
//
// POST is the UNAUTHENTICATED free-account creation flow. It rate-limits per
// IP, validates email + terms, runs embargo + domain-blocklist gates, dedupes
// against Stripe, then creates a Stripe customer + hosted.ai team + API key,
// issues a signed dashboard token, and fires a welcome email + many
// fire-and-forget side effects (cache, activity, lifecycle, onboarding event).
//
// What this suite protects (security-relevant pre-checks especially):
//   * rate limit is enforced BEFORE any Stripe/Prisma create (429)
//   * embargoed region is rejected with NO downstream state created (403)
//   * a blocklisted email domain is rejected with NO account created (400)
//   * missing email / missing terms / malformed email -> 400, no creates
//   * a duplicate Stripe customer -> login link, NOT a second customer (no 2nd create)
//   * happy path -> Stripe customer + Prisma apiKey + token + welcome email,
//     each with the right args
//   * an unexpected throw -> 500
//
// NOTE: every fire-and-forget dependency is mockResolvedValue'd in beforeEach.
// The route calls `.catch()` on un-awaited promises (cacheCustomer, the
// activity loggers); a bare vi.fn() returning undefined throws
// "Cannot read properties of undefined (reading 'catch')".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  // stripe
  getStripe: vi.fn(),
  customersList: vi.fn(),
  customersCreate: vi.fn(),
  customersUpdate: vi.fn(),
  // ratelimit
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  // gates
  embargoCheck: vi.fn(),
  isBlockedDomain: vi.fn(),
  // prisma
  apiKeyCreate: vi.fn(),
  tosAcceptanceCreate: vi.fn(),
  customerLifecycleCreate: vi.fn(),
  pageViewUpdateMany: vi.fn(),
  dripSequenceFindFirst: vi.fn(),
  dripEnrollmentCreate: vi.fn(),
  customerCacheFindFirst: vi.fn(),
  // misc libs
  getSetting: vi.fn(),
  generateCustomerToken: vi.fn(),
  createLoginLink: vi.fn(),
  generateApiKey: vi.fn(),
  sendEmail: vi.fn(),
  loadTemplate: vi.fn(),
  isPro: vi.fn(),
  // hostedai
  createTeam: vi.fn(),
  createOneTimeLogin: vi.fn(),
  syncTeamsToDefaultPolicy: vi.fn(),
  ensureDefaultPolicies: vi.fn(),
  ensureRoles: vi.fn(),
  // fire-and-forget
  logAccountCreated: vi.fn(),
  logApiKeyCreated: vi.fn(),
  sendOnboardingEvent: vi.fn(),
  cacheCustomer: vi.fn(),
  sendLoginEmailForCustomer: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: m.getStripe }));
vi.mock("@/lib/settings", () => ({ getSetting: m.getSetting }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: m.rateLimit,
  getClientIp: m.getClientIp,
}));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: m.generateCustomerToken,
  createLoginLink: m.createLoginLink,
}));
vi.mock("@/lib/api", () => ({ generateApiKey: m.generateApiKey }));
vi.mock("@/lib/email", () => ({
  sendEmail: m.sendEmail,
  escapeHtml: (s: string) => s,
}));
vi.mock("@/lib/email/template-loader", () => ({ loadTemplate: m.loadTemplate }));
vi.mock("@/lib/email/onboarding-events", () => ({
  sendOnboardingEvent: m.sendOnboardingEvent,
}));
vi.mock("@/lib/edition", () => ({ isPro: m.isPro }));
vi.mock("@/lib/hostedai", () => ({
  createTeam: m.createTeam,
  createOneTimeLogin: m.createOneTimeLogin,
  syncTeamsToDefaultPolicy: m.syncTeamsToDefaultPolicy,
  ensureDefaultPolicies: m.ensureDefaultPolicies,
  ensureRoles: m.ensureRoles,
}));
vi.mock("@/lib/activity", () => ({
  logAccountCreated: m.logAccountCreated,
  logApiKeyCreated: m.logApiKeyCreated,
}));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: m.cacheCustomer }));
vi.mock("@/lib/branding", () => ({
  getBrandName: () => "Packet.ai",
  getDashboardUrl: () => "https://app.example.com",
  getCompanyName: () => "Hosted.AI",
}));
vi.mock("@/lib/customer-login-email", () => ({
  sendLoginEmailForCustomer: m.sendLoginEmailForCustomer,
}));
vi.mock("@/lib/email-blocklist", () => ({ isBlockedDomain: m.isBlockedDomain }));
vi.mock("@/lib/embargo", () => ({ embargoCheck: m.embargoCheck }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: { create: m.apiKeyCreate },
    customerCache: { findFirst: m.customerCacheFindFirst },
    tosAcceptance: { create: m.tosAcceptanceCreate },
    customerLifecycle: { create: m.customerLifecycleCreate },
    pageView: { updateMany: m.pageViewUpdateMany },
    dripSequence: { findFirst: m.dripSequenceFindFirst },
    dripEnrollment: { create: m.dripEnrollmentCreate },
  },
}));

import { POST } from "@/app/api/account/signup/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  const h = new Headers({ "content-type": "application/json", ...headers });
  return new NextRequest("http://localhost/api/account/signup", {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { email: "New.User@Example.com", termsAccepted: true };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

  m.rateLimit.mockReturnValue({ success: true, remaining: 2, resetAt: 0 });
  m.getClientIp.mockReturnValue("10.0.0.1");
  m.embargoCheck.mockResolvedValue({ blocked: false, country: null });
  m.isBlockedDomain.mockResolvedValue(false);

  m.getStripe.mockResolvedValue({
    customers: {
      list: m.customersList,
      create: m.customersCreate,
      update: m.customersUpdate,
    },
  });
  m.customersList.mockResolvedValue({ data: [] });
  m.customersCreate.mockResolvedValue({ id: "cus_new", metadata: {} });
  m.customersUpdate.mockResolvedValue({ id: "cus_new", metadata: {} });

  m.ensureDefaultPolicies.mockResolvedValue({
    pricing: "p_pricing",
    resource: "p_resource",
    service: "p_service",
    instanceType: "p_it",
    image: "p_image",
  });
  m.ensureRoles.mockResolvedValue({
    teamAdmin: "role-admin",
    teamMember: "role-member",
    readOnlyMember: "role-ro",
    financeManager: "role-fin",
  });
  m.createTeam.mockResolvedValue({ id: "team_1", name: "team" });
  m.syncTeamsToDefaultPolicy.mockResolvedValue(undefined);
  m.createOneTimeLogin.mockResolvedValue({ url: "https://hosted.ai/otl", expires_at: "x" });

  m.generateApiKey.mockReturnValue({
    key: "sk_live_abc",
    keyHash: "hash",
    keyPrefix: "sk_live",
  });
  m.generateCustomerToken.mockReturnValue("signed-token");
  m.createLoginLink.mockResolvedValue("signed-token");
  m.getSetting.mockResolvedValue(null); // no TOS version by default
  m.loadTemplate.mockResolvedValue({ subject: "s", html: "h", text: "t" });
  m.sendEmail.mockResolvedValue(undefined);
  m.isPro.mockReturnValue(false);

  // Prisma creates
  m.apiKeyCreate.mockResolvedValue({ id: "key_1" });
  m.tosAcceptanceCreate.mockResolvedValue({ id: "tos_1" });
  m.customerLifecycleCreate.mockResolvedValue({ id: "lc_1" });
  m.pageViewUpdateMany.mockResolvedValue({ count: 0 });
  m.dripSequenceFindFirst.mockResolvedValue(null);
  m.dripEnrollmentCreate.mockResolvedValue({ id: "drip_1" });
  // Default: the mirror knows nothing either, so signup is a genuinely new one.
  m.customerCacheFindFirst.mockResolvedValue(null);

  // Fire-and-forget — MUST resolve so `.catch()` exists.
  m.logAccountCreated.mockResolvedValue(undefined);
  m.logApiKeyCreated.mockResolvedValue(undefined);
  m.sendOnboardingEvent.mockReturnValue(undefined);
  m.cacheCustomer.mockResolvedValue(undefined);
  m.sendLoginEmailForCustomer.mockResolvedValue(true);
});

describe("POST /api/account/signup — pre-checks (no downstream state)", () => {
  it("returns 429 when rate limited, before any Stripe/Prisma call", async () => {
    m.rateLimit.mockReturnValue({ success: false, remaining: 0, resetAt: 0 });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Too many requests");
    expect(m.getStripe).not.toHaveBeenCalled();
    expect(m.customersCreate).not.toHaveBeenCalled();
    expect(m.apiKeyCreate).not.toHaveBeenCalled();
  });

  it("rate-limits on the per-IP key", async () => {
    await POST(makeRequest(VALID_BODY));
    expect(m.rateLimit).toHaveBeenCalledWith("signup:10.0.0.1", {
      maxRequests: 3,
      windowMs: 60000,
    });
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ termsAccepted: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Email is required");
    expect(m.customersCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when terms are not accepted", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("accept");
    expect(m.getStripe).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email", termsAccepted: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid email address");
    expect(m.customersCreate).not.toHaveBeenCalled();
  });

  it("returns 403 and creates nothing when the region is embargoed", async () => {
    m.embargoCheck.mockResolvedValue({ blocked: true, country: "XX", reason: "embargo" });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("region");
    expect(m.customersList).not.toHaveBeenCalled();
    expect(m.customersCreate).not.toHaveBeenCalled();
    expect(m.apiKeyCreate).not.toHaveBeenCalled();
  });

  it("returns 400 and creates nothing when the email domain is blocklisted", async () => {
    m.isBlockedDomain.mockResolvedValue(true);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("domain");
    expect(m.customersCreate).not.toHaveBeenCalled();
    expect(m.apiKeyCreate).not.toHaveBeenCalled();
  });

  it("checks blocklist + embargo on the normalized (lower-cased, trimmed) email", async () => {
    await POST(makeRequest({ email: "  Mixed.Case@Example.com  ", termsAccepted: true }));
    expect(m.embargoCheck).toHaveBeenCalledWith(
      expect.anything(),
      "/api/account/signup",
      "mixed.case@example.com",
    );
    expect(m.isBlockedDomain).toHaveBeenCalledWith("mixed.case@example.com");
  });
});

describe("POST /api/account/signup — duplicate account", () => {
  it("sends a login link and does NOT create a second Stripe customer", async () => {
    m.customersList.mockResolvedValue({ data: [{ id: "cus_existing" }] });

    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.redirect).toContain("type=existing");
    expect(m.sendLoginEmailForCustomer).toHaveBeenCalledWith(
      "new.user@example.com",
      { inviteToken: undefined },
    );
    // Critical: no duplicate account is created.
    expect(m.customersCreate).not.toHaveBeenCalled();
    expect(m.apiKeyCreate).not.toHaveBeenCalled();
    expect(m.createTeam).not.toHaveBeenCalled();
  });

  it("forwards an invite token to the login-link email for an existing customer", async () => {
    m.customersList.mockResolvedValue({ data: [{ id: "cus_existing" }] });

    const res = await POST(
      makeRequest({ ...VALID_BODY, inviteToken: "inv-123" }),
    );
    const body = await res.json();

    expect(m.sendLoginEmailForCustomer).toHaveBeenCalledWith(
      "new.user@example.com",
      { inviteToken: "inv-123" },
    );
    expect(body.redirect).toContain("invite=inv-123");
  });
});

describe("POST /api/account/signup — happy path", () => {
  it("creates the Stripe customer, API key, token, and welcome email", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.redirect).toContain("type=free");
    expect(body.redirect).toContain("new.user%40example.com");

    // Stripe customer created with the normalized email + free metadata.
    expect(m.customersCreate).toHaveBeenCalledTimes(1);
    const createArg = m.customersCreate.mock.calls[0][0];
    expect(createArg.email).toBe("new.user@example.com");
    expect(createArg.metadata.billing_type).toBe("free");

    // API key persisted against the real team id.
    expect(m.apiKeyCreate).toHaveBeenCalledTimes(1);
    expect(m.apiKeyCreate.mock.calls[0][0].data).toMatchObject({
      keyHash: "hash",
      keyPrefix: "sk_live",
      stripeCustomerId: "cus_new",
      teamId: "team_1",
    });

    // PA-380: single-use sign-in link minted for this customer.
    expect(m.createLoginLink).toHaveBeenCalledWith({
      email: "new.user@example.com",
      customerId: "cus_new",
      next: undefined,
    });

    // Welcome email actually sent (the API key rides in it).
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    // Onboarding event fired.
    expect(m.sendOnboardingEvent).toHaveBeenCalledTimes(1);
    expect(m.sendOnboardingEvent.mock.calls[0][0].type).toBe("user.signup");
    // Activity logged.
    expect(m.logAccountCreated).toHaveBeenCalled();
    expect(m.logApiKeyCreated).toHaveBeenCalled();
  });

  it("provisions a hosted.ai team and links it to the resource policy", async () => {
    await POST(makeRequest(VALID_BODY));

    expect(m.ensureDefaultPolicies).toHaveBeenCalled();
    expect(m.ensureRoles).toHaveBeenCalled();
    expect(m.createTeam).toHaveBeenCalledTimes(1);
    expect(m.syncTeamsToDefaultPolicy).toHaveBeenCalledWith(["team_1"]);
    // Stripe customer updated with the team id afterwards.
    expect(m.customersUpdate).toHaveBeenCalledWith(
      "cus_new",
      expect.objectContaining({
        metadata: expect.objectContaining({ hostedai_team_id: "team_1" }),
      }),
    );
  });

  it("records TOS acceptance when a TOS_VERSION is configured", async () => {
    m.getSetting.mockResolvedValue("v2");

    await POST(makeRequest(VALID_BODY));

    expect(m.tosAcceptanceCreate).toHaveBeenCalledTimes(1);
    expect(m.tosAcceptanceCreate.mock.calls[0][0].data).toMatchObject({
      stripeCustomerId: "cus_new",
      tosVersion: "v2",
    });
  });

  it("does not record TOS acceptance when no version is set", async () => {
    m.getSetting.mockResolvedValue(null);
    await POST(makeRequest(VALID_BODY));
    expect(m.tosAcceptanceCreate).not.toHaveBeenCalled();
  });

  it("still succeeds (200) when the non-fatal welcome email fails", async () => {
    m.sendEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // The account was still created.
    expect(m.apiKeyCreate).toHaveBeenCalled();
  });

  it("carries the gpu signup source into Stripe metadata", async () => {
    await POST(makeRequest({ ...VALID_BODY, gpu: "h100" }));
    const createArg = m.customersCreate.mock.calls[0][0];
    expect(createArg.metadata.signup_source).toBe("gpu-h100");
    expect(createArg.metadata.signup_gpu).toBe("h100");
  });
});

describe("POST /api/account/signup — fatal errors", () => {
  it("returns 500 when team creation fails", async () => {
    m.createTeam.mockRejectedValue(new Error("HAI down"));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create account");
    // No API key persisted when team provisioning failed.
    expect(m.apiKeyCreate).not.toHaveBeenCalled();
  });

  it("returns 500 when the request body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/account/signup", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create account");
  });

  it("returns 500 when persisting the API key fails", async () => {
    m.apiKeyCreate.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
  });
});

/*
 * An account minted while Stripe was unconfigured has a local id and no Stripe
 * customer, so every later signup on that address found nothing in Stripe and
 * provisioned a second account and team. The customer then landed on the empty
 * one: no GPU, no billing, "created" the day the duplicate appeared.
 */
describe("signup — a Stripe miss is not proof the address is new", () => {
  it("sends a login link instead of minting a second account when only the mirror knows it", async () => {
    m.customersList.mockResolvedValue({ data: [] });
    m.customerCacheFindFirst.mockResolvedValue({
      id: "acct_local_abc",
      email: "known@example.com",
      isDeleted: false,
    });

    const res = await POST(makeRequest({ email: "known@example.com", termsAccepted: true }));

    expect(res.status).toBe(200);
    expect(m.customersCreate).not.toHaveBeenCalled();
    expect(m.customerCacheFindFirst).toHaveBeenCalledWith({
      where: { email: "known@example.com", isDeleted: false },
    });
  });

  it("still creates the account when neither Stripe nor the mirror knows the address", async () => {
    m.customersList.mockResolvedValue({ data: [] });
    m.customerCacheFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ email: "brand-new@example.com", termsAccepted: true }));

    expect(res.status).toBe(200);
    expect(m.customersCreate).toHaveBeenCalled();
  });
});

