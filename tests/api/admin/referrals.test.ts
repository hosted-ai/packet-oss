// Tests for src/app/api/admin/referrals/route.ts.
//
// GET returns settings + claims + stats; PATCH updates settings (type-gated
// per field); POST performs void/credit actions on a claim. What this suite
// protects:
//   * Admin gating on GET, PATCH, POST.
//   * GET passes the ?status= filter through to getAllReferralClaims and
//     returns 500 when any source throws.
//   * PATCH only forwards fields of the correct primitive type (ignores
//     mistyped values) and never lets a wrong type reach the store.
//   * POST requires action + claimId (400), routes void/credit to the right
//     lib fn, rejects unknown actions, and surfaces the thrown message on 500.
//
// Mocked at the @/lib/referral boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetReferralSettings,
  mockUpdateReferralSettings,
  mockGetAllReferralClaims,
  mockGetReferralProgramStats,
  mockVoidReferralClaim,
  mockProcessReferralReward,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetReferralSettings: vi.fn(),
  mockUpdateReferralSettings: vi.fn(),
  mockGetAllReferralClaims: vi.fn(),
  mockGetReferralProgramStats: vi.fn(),
  mockVoidReferralClaim: vi.fn(),
  mockProcessReferralReward: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/referral", () => ({
  getReferralSettings: mockGetReferralSettings,
  updateReferralSettings: mockUpdateReferralSettings,
  getAllReferralClaims: mockGetAllReferralClaims,
  getReferralProgramStats: mockGetReferralProgramStats,
  voidReferralClaim: mockVoidReferralClaim,
  processReferralReward: mockProcessReferralReward,
}));

import { GET, PATCH, POST } from "@/app/api/admin/referrals/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { query = "", body, withSession = true }: { query?: string; body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/referrals${query}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockGetReferralSettings.mockReturnValue({ enabled: true });
  mockUpdateReferralSettings.mockReturnValue({ enabled: true });
  mockGetAllReferralClaims.mockResolvedValue([]);
  mockGetReferralProgramStats.mockResolvedValue({ total: 0 });
  mockVoidReferralClaim.mockResolvedValue(undefined);
  mockProcessReferralReward.mockResolvedValue(undefined);
});

describe("auth gating (all methods)", () => {
  it("GET returns 401 without a session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetAllReferralClaims).not.toHaveBeenCalled();
  });

  it("PATCH returns 401 when the session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await PATCH(makeReq("PATCH", { body: { enabled: true } }));
    expect(res.status).toBe(401);
    expect(mockUpdateReferralSettings).not.toHaveBeenCalled();
  });

  it("POST returns 401 without a session cookie", async () => {
    const res = await POST(makeReq("POST", { body: { action: "void", claimId: "c1" }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockVoidReferralClaim).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/referrals", () => {
  it("returns settings, claims and stats", async () => {
    mockGetAllReferralClaims.mockResolvedValue([{ id: "c1" }]);
    mockGetReferralProgramStats.mockResolvedValue({ total: 1 });

    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({ enabled: true });
    expect(body.claims).toEqual([{ id: "c1" }]);
    expect(body.stats).toEqual({ total: 1 });
    // No filter param → undefined passed through.
    expect(mockGetAllReferralClaims).toHaveBeenCalledWith(undefined);
  });

  it("forwards the ?status= filter to getAllReferralClaims", async () => {
    await GET(makeReq("GET", { query: "?status=pending" }));
    expect(mockGetAllReferralClaims).toHaveBeenCalledWith("pending");
  });

  it("returns 500 when a data source throws", async () => {
    mockGetReferralProgramStats.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get referral data");
  });
});

describe("PATCH /api/admin/referrals", () => {
  it("forwards only correctly-typed fields", async () => {
    const res = await PATCH(
      makeReq("PATCH", {
        body: { enabled: false, rewardAmountCents: 500, minTopupCents: 1000, maxReferralsPerCustomer: 3 },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockUpdateReferralSettings).toHaveBeenCalledWith({
      enabled: false,
      rewardAmountCents: 500,
      minTopupCents: 1000,
      maxReferralsPerCustomer: 3,
    });
  });

  it("ignores fields with the wrong type (no coercion into the store)", async () => {
    await PATCH(
      makeReq("PATCH", { body: { enabled: "yes", rewardAmountCents: "500", minTopupCents: 1000 } })
    );
    // "yes" and "500" are dropped; only the numeric minTopupCents survives.
    expect(mockUpdateReferralSettings).toHaveBeenCalledWith({ minTopupCents: 1000 });
  });

  it("returns 500 when the update throws", async () => {
    mockUpdateReferralSettings.mockImplementation(() => {
      throw new Error("disk full");
    });
    const res = await PATCH(makeReq("PATCH", { body: { enabled: true } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update settings");
  });
});

describe("POST /api/admin/referrals", () => {
  it("returns 400 when action or claimId is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "void" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Action and claimId are required");
    expect(mockVoidReferralClaim).not.toHaveBeenCalled();
  });

  it("voids a claim", async () => {
    const res = await POST(makeReq("POST", { body: { action: "void", claimId: "c1" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockVoidReferralClaim).toHaveBeenCalledWith("c1");
  });

  it("credits (processes the reward for) a claim", async () => {
    const res = await POST(makeReq("POST", { body: { action: "credit", claimId: "c1" } }));
    expect(res.status).toBe(200);
    expect(mockProcessReferralReward).toHaveBeenCalledWith("c1");
  });

  it("returns 400 for an unknown action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "explode", claimId: "c1" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
    expect(mockVoidReferralClaim).not.toHaveBeenCalled();
  });

  it("surfaces the thrown error message on 500", async () => {
    mockVoidReferralClaim.mockRejectedValue(new Error("already voided"));
    const res = await POST(makeReq("POST", { body: { action: "void", claimId: "c1" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("already voided");
  });
});
