// Tests for src/app/api/account/referral/route.ts (PA-291).
//
// GET returns the operating account's referral code + stats; POST either
// validates or applies a code. Both are Team-Admin gated (referral.view) and
// scoped to the resolved OPERATING account (PA-230), not the JWT's own customer.
//
// Pinned contracts:
//   * Bearer auth (missing/invalid -> 401)
//   * unresolvable operating context -> 404
//   * referral.view denial short-circuits (gate denial returned verbatim)
//   * GET with referrals disabled -> { enabled: false } (no code minted)
//   * GET enabled -> code/stats scoped to ctx.accountId; dollars/hours derived
//   * POST action=validate -> forwards to validateReferralCode
//   * POST action=apply -> requires code; applies onto ctx.accountId
//   * POST unknown action -> 400
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetReferralSettings,
  mockGetOrCreateReferralCode,
  mockGetReferralStats,
  mockApplyReferralCode,
  mockValidateReferralCode,
  mockReferralCodeFindUnique,
  mockReferralClaimFindUnique,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetReferralSettings: vi.fn(),
  mockGetOrCreateReferralCode: vi.fn(),
  mockGetReferralStats: vi.fn(),
  mockApplyReferralCode: vi.fn(),
  mockValidateReferralCode: vi.fn(),
  mockReferralCodeFindUnique: vi.fn(),
  mockReferralClaimFindUnique: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/referral", () => ({
  getReferralSettings: mockGetReferralSettings,
  getOrCreateReferralCode: mockGetOrCreateReferralCode,
  getReferralStats: mockGetReferralStats,
  applyReferralCode: mockApplyReferralCode,
  validateReferralCode: mockValidateReferralCode,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    referralCode: { findUnique: mockReferralCodeFindUnique },
    referralClaim: { findUnique: mockReferralClaimFindUnique },
  },
}));

import { GET, POST } from "@/app/api/account/referral/route";

const PAYLOAD = {
  customerId: "cus_self",
  email: "ref@example.com",
  activeAccountId: "cus_team",
};

const ENABLED_SETTINGS = {
  enabled: true,
  rewardAmountCents: 2000,
  minTopupCents: 10000,
  maxReferralsPerCustomer: 0,
};

function makeRequest(
  method: "GET" | "POST",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/referral", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue({
    accountId: "cus_team",
    customer: { id: "cus_team", email: "team@example.com" },
  });
  mockGatePermission.mockResolvedValue(null);
  mockGetReferralSettings.mockReturnValue(ENABLED_SETTINGS);
  mockGetOrCreateReferralCode.mockResolvedValue("REF123");
  mockGetReferralStats.mockResolvedValue({ totalReferrals: 0, creditedCents: 0 });
  mockReferralCodeFindUnique.mockResolvedValue(null);
  mockReferralClaimFindUnique.mockResolvedValue(null);
});

describe("GET /api/account/referral", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest("GET", { auth: null }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Account not found");
  });

  it("returns the gate denial when referral.view is denied", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
    });
    mockGatePermission.mockResolvedValue(denial as never);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(403);
    expect(mockGetOrCreateReferralCode).not.toHaveBeenCalled();
    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "referral.view",
        accountId: "cus_team",
        customerEmail: "team@example.com",
      }),
    );
  });

  it("reports disabled without minting a code when referrals are off", async () => {
    mockGetReferralSettings.mockReturnValue({ ...ENABLED_SETTINGS, enabled: false });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: false, code: null, stats: null });
    expect(mockGetOrCreateReferralCode).not.toHaveBeenCalled();
  });

  it("returns the code, stats and derived reward figures scoped to the operating account", async () => {
    mockReferralCodeFindUnique.mockResolvedValue({
      claims: [
        {
          id: "claim_1",
          refereeEmail: "friend@example.com",
          status: "pending",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          creditedAt: null,
        },
      ],
    });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.code).toBe("REF123");
    expect(body.rewardAmount).toBe(20); // 2000c / 100
    expect(body.rewardHours).toBe(10); // floor(2000 / 200)
    expect(body.minTopupRequired).toBe(100); // 10000c / 100
    expect(body.referrals).toEqual([
      {
        id: "claim_1",
        email: "friend@example.com",
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        creditedAt: null,
      },
    ]);
    expect(mockGetOrCreateReferralCode).toHaveBeenCalledWith("cus_team");
    expect(mockGetReferralStats).toHaveBeenCalledWith("cus_team");
  });

  it("surfaces a previously-used referral code", async () => {
    mockReferralClaimFindUnique.mockResolvedValue({
      status: "qualified",
      referralCode: { code: "FRIENDCODE" },
    });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(body.usedReferralCode).toBe("FRIENDCODE");
    expect(body.usedReferralStatus).toBe("qualified");
  });

  it("returns 500 when stats lookup throws", async () => {
    mockGetReferralStats.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/account/referral", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", { auth: null, body: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(
      makeRequest("POST", { body: { action: "validate", code: "X" } }),
    );
    expect(res.status).toBe(404);
  });

  it("returns the gate denial when referral.view is denied", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
    });
    mockGatePermission.mockResolvedValue(denial as never);

    const res = await POST(
      makeRequest("POST", { body: { action: "apply", code: "X" } }),
    );

    expect(res.status).toBe(403);
    expect(mockApplyReferralCode).not.toHaveBeenCalled();
  });

  it("validates a code without applying it", async () => {
    mockValidateReferralCode.mockResolvedValue({ valid: true, code: "REF123" });

    const res = await POST(
      makeRequest("POST", { body: { action: "validate", code: "REF123" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ valid: true, code: "REF123" });
    expect(mockValidateReferralCode).toHaveBeenCalledWith("REF123");
    expect(mockApplyReferralCode).not.toHaveBeenCalled();
  });

  it("rejects an apply with no code", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "apply" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Referral code is required");
    expect(mockApplyReferralCode).not.toHaveBeenCalled();
  });

  it("applies a code onto the operating account", async () => {
    mockApplyReferralCode.mockResolvedValue({ success: true });

    const res = await POST(
      makeRequest("POST", { body: { action: "apply", code: "REF123" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockApplyReferralCode).toHaveBeenCalledWith(
      "REF123",
      "cus_team",
      "team@example.com",
    );
  });

  it("returns 400 with the lib error when apply fails", async () => {
    mockApplyReferralCode.mockResolvedValue({
      success: false,
      error: "Cannot use your own code",
    });

    const res = await POST(
      makeRequest("POST", { body: { action: "apply", code: "REF123" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: "Cannot use your own code" });
  });

  it("rejects an unknown action with 400", async () => {
    const res = await POST(
      makeRequest("POST", { body: { action: "frobnicate", code: "X" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid action");
  });

  it("returns 500 when apply throws", async () => {
    mockApplyReferralCode.mockRejectedValue(new Error("db down"));
    const res = await POST(
      makeRequest("POST", { body: { action: "apply", code: "REF123" } }),
    );
    expect(res.status).toBe(500);
  });
});
