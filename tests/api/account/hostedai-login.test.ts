// Tests for src/app/api/account/hostedai-login/route.ts (PA-287).
//
// POST mints a fresh single-use OTL URL for the hosted.ai dashboard. Auth is
// delegated to getAuthenticatedCustomer, which returns a NextResponse on
// failure (the route passes it straight through) or { payload, teamId }.
//
// Pinned contracts:
//   * auth failure -> the NextResponse from the helper is returned verbatim
//   * authed but no teamId -> 400 (no OTL attempt)
//   * happy path -> proxies to createOneTimeLogin with the user's email + team
//     + the teamAdmin role, echoes { url, expires_at }
//   * a throw from hosted.ai -> mapped to 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockCreateOneTimeLogin,
  mockEnsureRoles,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockCreateOneTimeLogin: vi.fn(),
  mockEnsureRoles: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  createOneTimeLogin: mockCreateOneTimeLogin,
  ensureRoles: mockEnsureRoles,
}));

import { POST } from "@/app/api/account/hostedai-login/route";

function makeRequest() {
  return new NextRequest("http://localhost/api/account/hostedai-login", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue({
    payload: { email: "user@example.com", customerId: "cus_1" },
    teamId: "team_1",
  });
  mockEnsureRoles.mockResolvedValue({
    teamAdmin: "role-admin",
    teamMember: "role-member",
    readOnlyMember: "role-ro",
    financeManager: "role-fin",
  });
  mockCreateOneTimeLogin.mockResolvedValue({
    url: "https://hosted.ai/otl/abc",
    expires_at: "2026-01-01T00:00:00Z",
  });
});

describe("POST /api/account/hostedai-login", () => {
  it("returns the auth helper's NextResponse verbatim on auth failure", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);

    const res = await POST(makeRequest());

    expect(res).toBe(unauthorized);
    expect(res.status).toBe(401);
    expect(mockCreateOneTimeLogin).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no hosted.ai team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({
      payload: { email: "user@example.com", customerId: "cus_1" },
      teamId: undefined,
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "No hosted.ai team associated with this account",
    );
    expect(mockCreateOneTimeLogin).not.toHaveBeenCalled();
  });

  it("proxies to createOneTimeLogin with the team + teamAdmin role and echoes the OTL", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      url: "https://hosted.ai/otl/abc",
      expires_at: "2026-01-01T00:00:00Z",
    });
    expect(mockCreateOneTimeLogin).toHaveBeenCalledWith({
      email: "user@example.com",
      send_email_invite: false,
      teamId: "team_1",
      roleId: "role-admin",
    });
  });

  it("maps a hosted.ai throw to 500", async () => {
    mockCreateOneTimeLogin.mockRejectedValue(new Error("HAI 503"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to generate login URL");
  });

  it("maps an ensureRoles throw to 500", async () => {
    mockEnsureRoles.mockRejectedValue(new Error("roles unavailable"));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(mockCreateOneTimeLogin).not.toHaveBeenCalled();
  });
});
