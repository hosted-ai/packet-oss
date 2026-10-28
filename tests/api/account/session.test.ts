// Tests for src/app/api/account/session/route.ts (PA-287, PA-267 refresh flow).
//
// POST reads the httpOnly `packet_session` refresh cookie, validates + rotates
// the session row, and mints a fresh short-lived access token. The dashboard
// calls it on load (no URL token) and after an access-token 401.
//
// Pinned contracts:
//   * no cookie -> 401 { error: "No session" } (no validation attempt)
//   * cookie present but dead -> 401 { error: "Session expired" } AND the cookie
//     is cleared so the browser stops sending it
//   * valid cookie -> 200 { token }, token minted from the rotated identity,
//     the session cookie is re-set to roll its browser-side expiry

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockValidateAndRotateSession,
  mockBuildSessionCookie,
  mockBuildClearedSessionCookie,
  mockGenerateCustomerToken,
} = vi.hoisted(() => ({
  mockValidateAndRotateSession: vi.fn(),
  mockBuildSessionCookie: vi.fn(),
  mockBuildClearedSessionCookie: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
}));

const SESSION_COOKIE_NAME = "packet_session";

vi.mock("@/lib/auth/customer-session", () => ({
  validateAndRotateSession: mockValidateAndRotateSession,
  buildSessionCookie: mockBuildSessionCookie,
  buildClearedSessionCookie: mockBuildClearedSessionCookie,
  SESSION_COOKIE_NAME: "packet_session",
}));
vi.mock("@/lib/auth/session-core", () => ({ ACCESS_TOKEN_HOURS: 12 }));
vi.mock("@/lib/auth/customer", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
}));

import { POST } from "@/app/api/account/session/route";

function makeRequest(cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookie}`);
  return new NextRequest("http://localhost/api/account/session", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateCustomerToken.mockReturnValue("fresh-access-token");
  // Cookie config objects must have a `name` so NextResponse.cookies.set accepts them.
  mockBuildSessionCookie.mockReturnValue({
    name: SESSION_COOKIE_NAME,
    value: "rolled",
    httpOnly: true,
    path: "/",
    maxAge: 1000,
  });
  mockBuildClearedSessionCookie.mockReturnValue({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  mockValidateAndRotateSession.mockResolvedValue({
    customerId: "cus_1",
    email: "user@example.com",
    userId: "user_1",
    activeAccountId: "cus_active",
  });
});

describe("POST /api/account/session", () => {
  it("returns 401 with no refresh cookie and never validates", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("No session");
    expect(mockValidateAndRotateSession).not.toHaveBeenCalled();
  });

  it("returns 401 and clears the cookie when the session is dead", async () => {
    mockValidateAndRotateSession.mockResolvedValue(null);

    const res = await POST(makeRequest("dead-refresh"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Session expired");
    expect(mockBuildClearedSessionCookie).toHaveBeenCalled();
    // The cleared cookie was applied to the response (maxAge 0 expires it).
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
    expect(mockGenerateCustomerToken).not.toHaveBeenCalled();
  });

  it("mints a fresh access token from the rotated identity and rolls the cookie", async () => {
    const res = await POST(makeRequest("live-refresh"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ token: "fresh-access-token" });
    expect(mockValidateAndRotateSession).toHaveBeenCalledWith("live-refresh");
    expect(mockGenerateCustomerToken).toHaveBeenCalledWith(
      "user@example.com",
      "cus_1",
      {
        userId: "user_1",
        activeAccountId: "cus_active",
        expiresInHours: 12,
      },
    );
    // The existing refresh token is re-set (rolling expiry), not cleared.
    expect(mockBuildSessionCookie).toHaveBeenCalledWith("live-refresh", false);
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("rolled");
  });

  it("propagates a throw from validateAndRotateSession", async () => {
    mockValidateAndRotateSession.mockRejectedValue(new Error("db down"));
    // The route does not wrap this in try/catch, so the rejection surfaces.
    await expect(POST(makeRequest("live-refresh"))).rejects.toThrow("db down");
  });
});
