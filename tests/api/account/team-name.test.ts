// Tests for src/app/api/account/team-name/route.ts (PA-287).
//
// PATCH updates the team display name on customer_settings, gated on
// team.manage (Team Admin / Owner). NULL / "" clears the override.
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * team.manage denial (403) short-circuits before the upsert
//   * non-string teamName -> 400
//   * null / undefined / "" -> stored as null (clears override)
//   * a real name is trimmed, capped at 80 chars, upserted on accountId
//   * the audit log write is fire-and-forget

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockUpsert,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockUpsert: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerSettings: { upsert: mockUpsert },
    teamAuditLog: { create: mockAuditCreate },
  },
}));

import { PATCH } from "@/app/api/account/team-name/route";

function authContext() {
  return {
    accountId: "cus_team",
    membership: { userId: "user_1", role: "owner", isOwner: true },
  };
}

function makeRequest(body?: unknown) {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  const init: RequestInit = { method: "PATCH", headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/team-name", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authContext());
  mockRequirePermission.mockReturnValue(null);
  mockUpsert.mockResolvedValue({});
  mockAuditCreate.mockResolvedValue({});
});

describe("PATCH /api/account/team-name", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(makeRequest({ teamName: "X" }));
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns the team.manage denial (403) before the upsert", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await PATCH(makeRequest({ teamName: "X" }));
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "team.manage",
      expect.anything(),
    );
  });

  it("rejects a non-string teamName with 400", async () => {
    const res = await PATCH(makeRequest({ teamName: 123 }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("must be a string");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("stores a trimmed name and echoes it", async () => {
    const res = await PATCH(makeRequest({ teamName: "  My Team  " }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teamName).toBe("My Team");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: "cus_team" },
        update: { teamName: "My Team" },
      }),
    );
  });

  it("caps the name at 80 chars", async () => {
    const long = "x".repeat(120);
    const res = await PATCH(makeRequest({ teamName: long }));
    const body = await res.json();
    expect(body.teamName).toHaveLength(80);
  });

  it("clears the override (null) when teamName is null", async () => {
    const res = await PATCH(makeRequest({ teamName: null }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teamName).toBeNull();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { teamName: null } }),
    );
  });

  it("clears the override when teamName is an empty / whitespace string", async () => {
    const res = await PATCH(makeRequest({ teamName: "   " }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teamName).toBeNull();
  });

  it("clears the override when the body is empty", async () => {
    const res = await PATCH(makeRequest({}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.teamName).toBeNull();
  });

  it("writes a team.renamed audit log entry", async () => {
    await PATCH(makeRequest({ teamName: "My Team" }));
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeCustomerId: "cus_team",
          action: "team.renamed",
        }),
      }),
    );
  });
});
