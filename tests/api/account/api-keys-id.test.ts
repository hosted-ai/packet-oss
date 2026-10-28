// Tests for src/app/api/account/api-keys/[id]/route.ts (PA-287).
//
// DELETE revokes an API key (soft delete: revokedAt timestamp). Scoped to the
// operating account (PA-175); revocation gated on api_keys.revoke (Owner/Admin).
//
// Pinned contracts:
//   * Bearer auth (missing/invalid -> 401)
//   * unresolvable operating context -> 404
//   * unknown key -> 404; key owned by another account -> 404 (no info leak)
//   * already-revoked key -> 400
//   * gate denial (403) short-circuits before the update
//   * happy path soft-revokes, logs activity (fire-and-forget), returns revoked:true
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockLogApiKeyDeleted,
  mockFindUnique,
  mockUpdate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockLogApiKeyDeleted: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/activity", () => ({ logApiKeyDeleted: mockLogApiKeyDeleted }));
vi.mock("@/lib/prisma", () => ({
  prisma: { apiKey: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { DELETE } from "@/app/api/account/api-keys/[id]/route";

const PAYLOAD = {
  customerId: "cus_self",
  email: "k@example.com",
  activeAccountId: "cus_team",
};

const CTX = {
  accountId: "cus_team",
  customer: { id: "cus_team", email: "team@example.com" },
};

function makeRequest({ auth = "Bearer t" }: { auth?: string | null } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/api-keys/key_1", {
    method: "DELETE",
    headers,
  });
}

function params(id = "key_1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockLogApiKeyDeleted.mockResolvedValue(undefined);
  mockFindUnique.mockResolvedValue({
    id: "key_1",
    name: "CI",
    stripeCustomerId: "cus_team",
    revokedAt: null,
  });
  mockUpdate.mockResolvedValue({});
});

describe("DELETE /api/account/api-keys/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(makeRequest({ auth: null }), params());
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown key", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeRequest(), params("missing"));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 (no leak) when the key belongs to another account", async () => {
    mockFindUnique.mockResolvedValue({
      id: "key_1",
      name: "CI",
      stripeCustomerId: "cus_other",
      revokedAt: null,
    });
    const res = await DELETE(makeRequest(), params());
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("API key not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the key is already revoked", async () => {
    mockFindUnique.mockResolvedValue({
      id: "key_1",
      name: "CI",
      stripeCustomerId: "cus_team",
      revokedAt: new Date(),
    });
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns the gate denial (403) without revoking", async () => {
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "api_keys.revoke" }),
    );
  });

  it("soft-revokes the key and logs activity", async () => {
    const res = await DELETE(makeRequest(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.revoked).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "key_1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockLogApiKeyDeleted).toHaveBeenCalledWith("cus_team", "CI");
  });

  it("returns 500 when the update throws", async () => {
    mockUpdate.mockRejectedValue(new Error("db down"));
    const res = await DELETE(makeRequest(), params());
    expect(res.status).toBe(500);
  });
});
