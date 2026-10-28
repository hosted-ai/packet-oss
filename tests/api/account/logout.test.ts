// Tests for src/app/api/account/logout/route.ts (PA-287, PA-267 logout, PA-459 logout activity).
//
// POST revokes the server-side session row (so a copied refresh token dies
// immediately) and clears the cookie. `?all=1` revokes every session for the
// customer, identified from the refresh cookie first, then the Bearer token.
//
// Pinned contracts:
//   * always 200 { ok: true } and always clears the cookie — even with no session
//   * with a cookie -> revokeSessionByToken(refresh)
//   * ?all=1 -> revokeAllSessionsForCustomer(customerId), customerId resolved
//     from the refresh cookie when present
//   * ?all=1 with no cookie -> customerId comes from the Bearer access token
//   * ?all=1 with no identity at all -> no revoke-all attempt, still 200
//   * whenever a customer id is resolved (cookie, or Bearer fallback under
//     ?all=1) -> logAccountLogout(customerId), fire-and-forget

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockRevokeSessionByToken,
  mockRevokeAllSessionsForCustomer,
  mockDecodeRefreshCustomerId,
  mockDecodeRefreshEmail,
  mockDecodeRefreshActiveAccountId,
  mockBuildClearedSessionCookie,
  mockVerifyCustomerToken,
  mockLogAccountLogout,
} = vi.hoisted(() => ({
  mockRevokeSessionByToken: vi.fn(),
  mockRevokeAllSessionsForCustomer: vi.fn(),
  mockDecodeRefreshCustomerId: vi.fn(),
  mockDecodeRefreshEmail: vi.fn(),
  mockDecodeRefreshActiveAccountId: vi.fn(),
  mockBuildClearedSessionCookie: vi.fn(),
  mockVerifyCustomerToken: vi.fn(),
  mockLogAccountLogout: vi.fn(),
}));

const SESSION_COOKIE_NAME = "packet_session";

vi.mock("@/lib/auth/customer-session", () => ({
  revokeSessionByToken: mockRevokeSessionByToken,
  revokeAllSessionsForCustomer: mockRevokeAllSessionsForCustomer,
  decodeRefreshCustomerId: mockDecodeRefreshCustomerId,
  decodeRefreshEmail: mockDecodeRefreshEmail,
  decodeRefreshActiveAccountId: mockDecodeRefreshActiveAccountId,
  buildClearedSessionCookie: mockBuildClearedSessionCookie,
  SESSION_COOKIE_NAME: "packet_session",
}));
vi.mock("@/lib/auth/customer", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/activity", () => ({
  logAccountLogout: mockLogAccountLogout,
}));

import { POST } from "@/app/api/account/logout/route";

function makeRequest({
  cookie,
  bearer,
  all,
}: { cookie?: string; bearer?: string; all?: boolean } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${SESSION_COOKIE_NAME}=${cookie}`);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  const url = all
    ? "http://localhost/api/account/logout?all=1"
    : "http://localhost/api/account/logout";
  return new NextRequest(url, { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRevokeSessionByToken.mockResolvedValue(undefined);
  mockRevokeAllSessionsForCustomer.mockResolvedValue(1);
  mockDecodeRefreshCustomerId.mockReturnValue("cus_from_cookie");
  mockDecodeRefreshEmail.mockReturnValue("cookie-user@example.com");
  mockDecodeRefreshActiveAccountId.mockReturnValue(null);
  mockVerifyCustomerToken.mockReturnValue({ customerId: "cus_from_bearer" });
  mockLogAccountLogout.mockResolvedValue(undefined);
  mockBuildClearedSessionCookie.mockReturnValue({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
});

describe("POST /api/account/logout", () => {
  it("returns 200 and clears the cookie even with no session", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
    expect(mockRevokeSessionByToken).not.toHaveBeenCalled();
    expect(mockRevokeAllSessionsForCustomer).not.toHaveBeenCalled();
    expect(mockLogAccountLogout).not.toHaveBeenCalled();
  });

  it("revokes only the current session when a cookie is present", async () => {
    const res = await POST(makeRequest({ cookie: "refresh-abc" }));

    expect(res.status).toBe(200);
    expect(mockRevokeSessionByToken).toHaveBeenCalledWith("refresh-abc");
    expect(mockRevokeAllSessionsForCustomer).not.toHaveBeenCalled();
  });

  it("logs an account_logout activity event when the cookie yields a customer id", async () => {
    const res = await POST(makeRequest({ cookie: "refresh-abc" }));

    expect(res.status).toBe(200);
    expect(mockLogAccountLogout).toHaveBeenCalledWith(
      "cus_from_cookie",
      "cookie-user@example.com",
    );
  });

  it("logs the activity using the Bearer-resolved customer id for ?all=1 with no cookie", async () => {
    const res = await POST(makeRequest({ bearer: "access-jwt", all: true }));

    expect(res.status).toBe(200);
    // No refresh cookie -> decodeRefreshEmail is never consulted (it only reads
    // the cookie, not the Bearer token), so the email arg is undefined here.
    expect(mockLogAccountLogout).toHaveBeenCalledWith("cus_from_bearer", undefined);
  });

  it("does not fail the request when logAccountLogout rejects", async () => {
    mockLogAccountLogout.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest({ cookie: "refresh-abc" }));

    expect(res.status).toBe(200);
  });

  it("revokes all sessions using the cookie-derived customer id for ?all=1", async () => {
    const res = await POST(makeRequest({ cookie: "refresh-abc", all: true }));

    expect(res.status).toBe(200);
    expect(mockDecodeRefreshCustomerId).toHaveBeenCalledWith("refresh-abc");
    expect(mockRevokeAllSessionsForCustomer).toHaveBeenCalledWith("cus_from_cookie");
    // The current session row is still revoked too.
    expect(mockRevokeSessionByToken).toHaveBeenCalledWith("refresh-abc");
    // Bearer is not consulted when the cookie yields an id.
    expect(mockVerifyCustomerToken).not.toHaveBeenCalled();
  });

  it("falls back to the Bearer token for ?all=1 when there is no cookie", async () => {
    const res = await POST(makeRequest({ bearer: "access-jwt", all: true }));

    expect(res.status).toBe(200);
    expect(mockVerifyCustomerToken).toHaveBeenCalledWith("access-jwt");
    expect(mockRevokeAllSessionsForCustomer).toHaveBeenCalledWith("cus_from_bearer");
    expect(mockRevokeSessionByToken).not.toHaveBeenCalled();
  });

  it("does not attempt revoke-all when neither cookie nor bearer yields an id", async () => {
    const res = await POST(makeRequest({ all: true }));

    expect(res.status).toBe(200);
    expect(mockRevokeAllSessionsForCustomer).not.toHaveBeenCalled();
    expect(mockLogAccountLogout).not.toHaveBeenCalled();
  });

  it("falls back to the Bearer when the cookie decodes to no customer id", async () => {
    mockDecodeRefreshCustomerId.mockReturnValue(null);

    const res = await POST(
      makeRequest({ cookie: "refresh-abc", bearer: "access-jwt", all: true }),
    );

    expect(res.status).toBe(200);
    expect(mockVerifyCustomerToken).toHaveBeenCalledWith("access-jwt");
    expect(mockRevokeAllSessionsForCustomer).toHaveBeenCalledWith("cus_from_bearer");
  });

  it("propagates a throw from revokeSessionByToken", async () => {
    mockRevokeSessionByToken.mockRejectedValue(new Error("db down"));
    // The route has no try/catch, so the rejection surfaces.
    await expect(POST(makeRequest({ cookie: "refresh-abc" }))).rejects.toThrow(
      "db down",
    );
  });
});
