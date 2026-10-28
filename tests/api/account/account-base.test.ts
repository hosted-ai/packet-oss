// Tests for src/app/api/account/route.ts (PA-287) — the base /api/account POST.
//
// AUTH MODEL: this route is intentionally UNauthenticated (pre-login). It is an
// anti-enumeration email-lookup + login-link sender: a caller posts an email
// and ALWAYS gets the same generic 200 ("if an account exists..."), whether or
// not an account was found. Abuse is bounded by an IP rate limit (5/min) rather
// than a bearer token. So there is no 401 path to test — the gating surface is
// the 429 rate limit + the email-required 400.
//
// Side flow: if a PAID Stripe customer is found with no hosted.ai team, the
// route auto-provisions one (createTeam) before sending the login email; team
// creation failure is swallowed and the email still goes out.
//
// Pinned contracts:
//   * Rate limit exceeded -> 429, nothing else runs
//   * Missing email -> 400
//   * Anti-enumeration: identical 200 whether or not an account exists
//   * No-customer / free-trial / customer-with-team -> NO auto-provision
//   * Paid customer without a team -> createTeam + stripe.customers.update,
//     then login email sent
//   * createTeam failure is swallowed; the login email still sends
//   * inviteToken / next are threaded into sendLoginEmailForCustomer
//   * No email sent -> logLoginLinkSent(email, false) fire-and-forget
//   * Malformed body / thrown dependency -> 500
//
// Dependencies are mocked at the import boundary. The fire-and-forget
// logLoginLinkSent MUST resolve (it is `.catch()`-chained).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetStripe,
  mockRateLimit,
  mockGetClientIp,
  mockLogLoginLinkSent,
  mockCreateTeam,
  mockGetDefaultPolicies,
  mockGetRoles,
  mockGetBrandName,
  mockSendLoginEmailForCustomer,
  mockCustomersList,
  mockCustomersUpdate,
} = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockLogLoginLinkSent: vi.fn(),
  mockCreateTeam: vi.fn(),
  mockGetDefaultPolicies: vi.fn(),
  mockGetRoles: vi.fn(),
  mockGetBrandName: vi.fn(),
  mockSendLoginEmailForCustomer: vi.fn(),
  mockCustomersList: vi.fn(),
  mockCustomersUpdate: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimit: mockRateLimit,
  getClientIp: mockGetClientIp,
}));
vi.mock("@/lib/admin-activity", () => ({
  logLoginLinkSent: mockLogLoginLinkSent,
}));
vi.mock("@/lib/hostedai", () => ({
  createTeam: mockCreateTeam,
  getDefaultPolicies: mockGetDefaultPolicies,
  getRoles: mockGetRoles,
}));
vi.mock("@/lib/branding", () => ({ getBrandName: mockGetBrandName }));
vi.mock("@/lib/customer-login-email", () => ({
  sendLoginEmailForCustomer: mockSendLoginEmailForCustomer,
}));

import { POST } from "@/app/api/account/route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockReturnValue({ success: true });
  mockGetClientIp.mockReturnValue("10.0.0.1");
  // Fire-and-forget: MUST resolve — the route does logLoginLinkSent(...).catch().
  mockLogLoginLinkSent.mockResolvedValue(undefined);
  mockGetBrandName.mockReturnValue("Packet.ai");
  mockGetRoles.mockResolvedValue({ teamAdmin: "role_admin" });
  mockGetDefaultPolicies.mockResolvedValue({
    pricing: "pp_1",
    resource: "rp_1",
    service: "sp_1",
    instanceType: "it_1",
    image: "ip_1",
  });
  mockCreateTeam.mockResolvedValue({ id: "team_new" });
  mockSendLoginEmailForCustomer.mockResolvedValue(true);
  mockCustomersList.mockResolvedValue({ data: [] });
  mockCustomersUpdate.mockResolvedValue({});
  mockGetStripe.mockResolvedValue({
    customers: { list: mockCustomersList, update: mockCustomersUpdate },
  });
});

describe("POST /api/account — gating (rate limit + validation)", () => {
  it("returns 429 when the IP rate limit is exceeded and runs nothing else", async () => {
    mockRateLimit.mockReturnValue({ success: false });

    const res = await POST(makeRequest({ email: "a@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toContain("Too many requests");
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockSendLoginEmailForCustomer).not.toHaveBeenCalled();
  });

  it("rate-limits per client IP with the 5/min window", async () => {
    await POST(makeRequest({ email: "a@example.com" }));
    expect(mockRateLimit).toHaveBeenCalledWith("account:10.0.0.1", {
      maxRequests: 5,
      windowMs: 60000,
    });
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Email is required");
    expect(mockSendLoginEmailForCustomer).not.toHaveBeenCalled();
  });
});

describe("POST /api/account — anti-enumeration response", () => {
  it("returns the identical generic 200 when no account exists", async () => {
    mockCustomersList.mockResolvedValue({ data: [] });
    mockSendLoginEmailForCustomer.mockResolvedValue(false);

    const res = await POST(makeRequest({ email: "ghost@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("If an account exists");
    // No account -> the miss is logged (fire-and-forget).
    expect(mockLogLoginLinkSent).toHaveBeenCalledWith("ghost@example.com", false);
  });

  it("returns the identical generic 200 when an account does exist", async () => {
    mockCustomersList.mockResolvedValue({
      data: [{ id: "cus_1", email: "real@example.com", metadata: { hostedai_team_id: "team_1" } }],
    });
    mockSendLoginEmailForCustomer.mockResolvedValue(true);

    const res = await POST(makeRequest({ email: "real@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("If an account exists");
    // Email was sent -> no miss logged.
    expect(mockLogLoginLinkSent).not.toHaveBeenCalled();
  });

  it("lowercases the email before lookup + send", async () => {
    await POST(makeRequest({ email: "MixedCase@Example.COM" }));

    expect(mockCustomersList).toHaveBeenCalledWith(
      expect.objectContaining({ email: "mixedcase@example.com" }),
    );
    expect(mockSendLoginEmailForCustomer).toHaveBeenCalledWith(
      "mixedcase@example.com",
      expect.anything(),
    );
  });

  it("threads inviteToken and next through to the login-email sender", async () => {
    await POST(
      makeRequest({ email: "a@example.com", inviteToken: "inv_1", next: "/welcome" }),
    );

    expect(mockSendLoginEmailForCustomer).toHaveBeenCalledWith("a@example.com", {
      inviteToken: "inv_1",
      next: "/welcome",
    });
  });
});

describe("POST /api/account — team auto-provisioning", () => {
  it("does NOT provision a team when no Stripe customer is found", async () => {
    mockCustomersList.mockResolvedValue({ data: [] });

    await POST(makeRequest({ email: "a@example.com" }));

    expect(mockCreateTeam).not.toHaveBeenCalled();
    expect(mockSendLoginEmailForCustomer).toHaveBeenCalledTimes(1);
  });

  it("does NOT provision a team for a customer that already has one", async () => {
    mockCustomersList.mockResolvedValue({
      data: [{ id: "cus_1", email: "a@example.com", metadata: { hostedai_team_id: "team_1", billing_type: "hourly" } }],
    });

    await POST(makeRequest({ email: "a@example.com" }));

    expect(mockCreateTeam).not.toHaveBeenCalled();
  });

  it("does NOT provision a team for a free_trial customer without a team", async () => {
    mockCustomersList.mockResolvedValue({
      data: [{ id: "cus_1", email: "a@example.com", metadata: { billing_type: "free_trial" } }],
    });

    await POST(makeRequest({ email: "a@example.com" }));

    expect(mockCreateTeam).not.toHaveBeenCalled();
  });

  it("provisions a team and stamps the team id for a PAID customer without one", async () => {
    mockCustomersList.mockResolvedValue({
      data: [{ id: "cus_paid", email: "paid@example.com", name: "Paid Co", metadata: { billing_type: "hourly" } }],
    });

    const res = await POST(makeRequest({ email: "paid@example.com" }));

    expect(res.status).toBe(200);
    expect(mockCreateTeam).toHaveBeenCalledTimes(1);
    const teamArg = mockCreateTeam.mock.calls[0][0];
    expect(teamArg.members[0].email).toBe("paid@example.com");
    expect(teamArg.members[0].send_email_invite).toBe(false);
    // The new team id is written back to the Stripe customer metadata.
    expect(mockCustomersUpdate).toHaveBeenCalledWith(
      "cus_paid",
      expect.objectContaining({
        metadata: expect.objectContaining({ hostedai_team_id: "team_new" }),
      }),
    );
    // ...and the login email still goes out.
    expect(mockSendLoginEmailForCustomer).toHaveBeenCalledTimes(1);
  });

  it("swallows a team-creation failure and still sends the login email", async () => {
    mockCustomersList.mockResolvedValue({
      data: [{ id: "cus_paid", email: "paid@example.com", metadata: { billing_type: "hourly" } }],
    });
    mockCreateTeam.mockRejectedValue(new Error("HAI 500"));

    const res = await POST(makeRequest({ email: "paid@example.com" }));

    expect(res.status).toBe(200);
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockSendLoginEmailForCustomer).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/account — error handling", () => {
  it("returns 500 on a malformed (non-JSON) body", async () => {
    const res = await POST(makeRequest("not json"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to process request");
  });

  it("returns 500 when the Stripe customer lookup throws", async () => {
    mockCustomersList.mockRejectedValue(new Error("stripe down"));

    const res = await POST(makeRequest({ email: "a@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to process request");
  });
});
