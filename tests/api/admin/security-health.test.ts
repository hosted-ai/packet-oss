// Tests for the GET handler in src/app/api/admin/security-health/route.ts.
//
// PA-287: admin observability coverage. This route computes a 4-point
// security posture score for the logged-in admin: password set, 2FA enabled,
// email configured, and zero recent failed logins. These tests pin:
// admin-cookie auth gating, the score arithmetic for each posture
// combination (including the all-clear 4/4 and the all-bad 0/4), that the
// failed-login query is keyed on the lowercased session email within a 24h
// window, the table-missing fallback to 0 failed logins, and the 500 path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockAdminHasPassword,
  mockIsTwoFactorEnabled,
  mockIsEmailConfigured,
  mockCount,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockAdminHasPassword: vi.fn(),
  mockIsTwoFactorEnabled: vi.fn(),
  mockIsEmailConfigured: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/auth/admin", () => ({ adminHasPassword: mockAdminHasPassword }));
vi.mock("@/lib/two-factor", () => ({ isTwoFactorEnabled: mockIsTwoFactorEnabled }));
vi.mock("@/lib/settings", () => ({ isEmailConfigured: mockIsEmailConfigured }));
vi.mock("@/lib/prisma", () => ({
  prisma: { adminLoginLog: { count: mockCount } },
}));

import { GET } from "@/app/api/admin/security-health/route";

const ADMIN_EMAIL = "Admin@Example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/security-health", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  // All-clear defaults → score 4/4.
  mockAdminHasPassword.mockReturnValue(true);
  mockIsTwoFactorEnabled.mockResolvedValue(true);
  mockIsEmailConfigured.mockResolvedValue(true);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/admin/security-health — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockAdminHasPassword).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockAdminHasPassword).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/security-health — posture scoring", () => {
  it("scores 4/4 when everything is configured and no recent failures", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      passwordSet: true,
      twoFactorEnabled: true,
      emailConfigured: true,
      recentFailedLogins: 0,
      score: 4,
      maxScore: 4,
    });
  });

  it("scores 0/4 when nothing is configured and there are recent failures", async () => {
    mockAdminHasPassword.mockReturnValue(false);
    mockIsTwoFactorEnabled.mockResolvedValue(false);
    mockIsEmailConfigured.mockResolvedValue(false);
    mockCount.mockResolvedValue(5);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.score).toBe(0);
    expect(body.recentFailedLogins).toBe(5);
  });

  it("does not award the failed-login point when recent failures exist", async () => {
    mockCount.mockResolvedValue(1);
    const body = await (await GET(makeRequest())).json();
    // password + 2FA + email = 3, failed-login point withheld.
    expect(body.score).toBe(3);
  });

  it("withholds the 2FA point when 2FA is disabled", async () => {
    mockIsTwoFactorEnabled.mockResolvedValue(false);
    const body = await (await GET(makeRequest())).json();
    expect(body.twoFactorEnabled).toBe(false);
    expect(body.score).toBe(3);
  });

  it("withholds the password point when no password is set", async () => {
    mockAdminHasPassword.mockReturnValue(false);
    const body = await (await GET(makeRequest())).json();
    expect(body.passwordSet).toBe(false);
    expect(body.score).toBe(3);
  });

  it("withholds the email point when email is not configured", async () => {
    mockIsEmailConfigured.mockResolvedValue(false);
    const body = await (await GET(makeRequest())).json();
    expect(body.emailConfigured).toBe(false);
    expect(body.score).toBe(3);
  });
});

describe("GET /api/admin/security-health — failed-login query", () => {
  it("keys the count on the lowercased session email, only failures, last 24h", async () => {
    await GET(makeRequest());
    expect(mockCount).toHaveBeenCalledTimes(1);
    const where = mockCount.mock.calls[0][0].where;
    expect(where.email).toBe("admin@example.com");
    expect(where.success).toBe(false);
    expect(where.createdAt.gt).toBeInstanceOf(Date);
    // Window should be roughly 24h back from now.
    const ageMs = Date.now() - where.createdAt.gt.getTime();
    expect(ageMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("falls back to 0 failed logins when the login-log table is missing", async () => {
    mockCount.mockRejectedValue(new Error("no such table: AdminLoginLog"));
    const res = await GET(makeRequest());
    // The inner try/catch swallows the table error → still a 200, point awarded.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recentFailedLogins).toBe(0);
    expect(body.score).toBe(4);
  });
});

describe("GET /api/admin/security-health — error handling", () => {
  it("returns 500 when a posture check (outside the inner catch) throws", async () => {
    mockIsTwoFactorEnabled.mockRejectedValue(new Error("kv down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to check security health");
  });
});
