// Tests for src/app/api/account/api-keys/route.ts (PA-287).
//
// API-key management, scoped to the operating account (PA-175). GET lists
// (secret masked), POST mints (full secret returned ONCE), PATCH updates the
// rate limit. Create + rate-limit edits are gated on api_keys.create
// (Owner/Admin only).
//
// Pinned contracts:
//   * Bearer auth on every verb (missing/invalid -> 401)
//   * unresolvable operating context -> 404
//   * GET returns masked rows (keyPrefix only, no secret) scoped to ctx.accountId
//   * POST gate denial (403) short-circuits before any DB write
//   * POST validates name presence/length, 10-key cap, expiry shape/future
//   * POST returns the full key once + logs activity (fire-and-forget)
//   * PATCH requires id, verifies ownership (404), gate-denies (403), then updates
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockResolveMembership,
  mockComputeEffectivePermissions,
  mockGenerateApiKey,
  mockLogApiKeyCreated,
  mockFindMany,
  mockCount,
  mockCreate,
  mockFindFirst,
  mockUpdate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockResolveMembership: vi.fn(),
  mockComputeEffectivePermissions: vi.fn(),
  mockGenerateApiKey: vi.fn(),
  mockLogApiKeyCreated: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/membership", () => ({
  resolveMembership: mockResolveMembership,
}));
vi.mock("@/lib/auth/api-key-permissions", () => ({
  computeEffectivePermissions: mockComputeEffectivePermissions,
}));
vi.mock("@/lib/auth/role-permissions", () => ({
  PACKET_ROLES: ["owner", "admin", "member"],
}));
vi.mock("@/lib/api", () => ({ generateApiKey: mockGenerateApiKey }));
vi.mock("@/lib/activity", () => ({ logApiKeyCreated: mockLogApiKeyCreated }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findMany: mockFindMany,
      count: mockCount,
      create: mockCreate,
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
  },
}));

import { GET, POST, PATCH } from "@/app/api/account/api-keys/route";

const PAYLOAD = {
  customerId: "cus_self",
  email: "k@example.com",
  userId: "user_1",
  activeAccountId: "cus_team",
};

const CTX = {
  accountId: "cus_team",
  teamId: "team_1",
  customer: {
    id: "cus_team",
    email: "team@example.com",
    metadata: { hostedai_team_id: "team_1" },
  },
};

function makeRequest(
  method: "GET" | "POST" | "PATCH",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/api-keys", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockResolveMembership.mockResolvedValue({
    userId: "user_1",
    role: "owner",
    isOwner: true,
  });
  mockComputeEffectivePermissions.mockReturnValue(["*"]);
  mockGenerateApiKey.mockReturnValue({
    key: "pk_full_secret",
    keyHash: "hash",
    keyPrefix: "pk_abc",
  });
  mockLogApiKeyCreated.mockResolvedValue(undefined);
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/account/api-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest("GET", { auth: null }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(404);
  });

  it("returns masked rows scoped to the operating account, no secret", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "key_1",
        name: "CI",
        keyPrefix: "pk_abc",
        scopes: "read, write",
        lastUsedAt: new Date("2026-01-02T00:00:00Z"),
        expiresAt: null,
        rateLimitRpm: 60,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys[0]).toEqual({
      id: "key_1",
      name: "CI",
      keyPrefix: "pk_abc",
      scopes: ["read", "write"],
      lastUsedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: null,
      rateLimitRpm: 60,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("keyHash");
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCustomerId: "cus_team", revokedAt: null },
      }),
    );
  });

  it("returns 500 when the list query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/account/api-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", { auth: null, body: {} }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { body: { name: "X" } }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await POST(makeRequest("POST", { body: { name: "X" } }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the gate denial (403) without writing when api_keys.create is denied", async () => {
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(makeRequest("POST", { body: { name: "X" } }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "api_keys.create", accountId: "cus_team" }),
    );
  });

  it("rejects a missing name", async () => {
    const res = await POST(makeRequest("POST", { body: {} }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Name is required");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a name over 100 chars", async () => {
    const res = await POST(
      makeRequest("POST", { body: { name: "x".repeat(101) } }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects creation when the 10-key cap is reached", async () => {
    mockCount.mockResolvedValue(10);
    const res = await POST(makeRequest("POST", { body: { name: "X" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Maximum of 10");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unparseable expiration date", async () => {
    const res = await POST(
      makeRequest("POST", { body: { name: "X", expiresAt: "not-a-date" } }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an expiration date in the past", async () => {
    const res = await POST(
      makeRequest("POST", {
        body: { name: "X", expiresAt: "2000-01-01T00:00:00Z" },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a key, returns the full secret ONCE, and logs activity", async () => {
    mockCreate.mockResolvedValue({
      id: "key_new",
      name: "Prod",
      keyPrefix: "pk_abc",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      expiresAt: null,
    });

    const res = await POST(
      makeRequest("POST", { body: { name: "Prod", scopes: ["read"] } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.apiKey.key).toBe("pk_full_secret");
    expect(body.apiKey.keyPrefix).toBe("pk_abc");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Prod",
          stripeCustomerId: "cus_team",
          teamId: "team_1",
          scopes: "read",
          effectivePermissions: ["*"],
        }),
      }),
    );
    expect(mockLogApiKeyCreated).toHaveBeenCalledWith("cus_team", "Prod");
  });

  it("defaults scopes to * when none provided", async () => {
    mockCreate.mockResolvedValue({
      id: "key_new",
      name: "Prod",
      keyPrefix: "pk_abc",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      expiresAt: null,
    });
    await POST(makeRequest("POST", { body: { name: "Prod" } }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopes: "*" }),
      }),
    );
  });

  it("returns 500 when the create throws", async () => {
    mockCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest("POST", { body: { name: "Prod" } }));
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/account/api-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await PATCH(makeRequest("PATCH", { auth: null, body: {} }));
    expect(res.status).toBe(401);
  });

  it("requires an id", async () => {
    const res = await PATCH(makeRequest("PATCH", { body: { rateLimitRpm: 30 } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("id is required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { body: { id: "key_1" } }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the key is not owned by the operating account", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await PATCH(makeRequest("PATCH", { body: { id: "key_x" } }));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns the gate denial (403) without updating", async () => {
    mockFindFirst.mockResolvedValue({ id: "key_1" });
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await PATCH(
      makeRequest("PATCH", { body: { id: "key_1", rateLimitRpm: 30 } }),
    );
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates the rate limit on an owned key", async () => {
    mockFindFirst.mockResolvedValue({ id: "key_1" });
    mockUpdate.mockResolvedValue({});
    const res = await PATCH(
      makeRequest("PATCH", { body: { id: "key_1", rateLimitRpm: 30 } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, id: "key_1", rateLimitRpm: 30 });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "key_1" },
      data: { rateLimitRpm: 30 },
    });
  });

  it("coerces a non-positive rate limit to null", async () => {
    mockFindFirst.mockResolvedValue({ id: "key_1" });
    mockUpdate.mockResolvedValue({});
    const res = await PATCH(
      makeRequest("PATCH", { body: { id: "key_1", rateLimitRpm: 0 } }),
    );
    const body = await res.json();
    expect(body.rateLimitRpm).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "key_1" },
      data: { rateLimitRpm: null },
    });
  });

  it("returns 500 when the update throws", async () => {
    mockFindFirst.mockResolvedValue({ id: "key_1" });
    mockUpdate.mockRejectedValue(new Error("db down"));
    const res = await PATCH(
      makeRequest("PATCH", { body: { id: "key_1", rateLimitRpm: 30 } }),
    );
    expect(res.status).toBe(500);
  });
});
