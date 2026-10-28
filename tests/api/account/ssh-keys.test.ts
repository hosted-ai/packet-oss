// Tests for src/app/api/account/ssh-keys/route.ts (PA-287).
//
// SSH-key management, scoped to the operating account (PA-175) so invited
// Members see the team's keys. GET lists (public key truncated), POST adds,
// DELETE removes. Add/remove gated on ssh_keys.manage.
//
// Pinned contracts:
//   * Bearer auth on every verb (missing/invalid -> 401)
//   * unresolvable operating context -> 404
//   * GET truncates the public key (no full key in list) scoped to ctx.accountId
//   * POST validates name+publicKey, gate-denies (403) before adding, enforces
//     the 10-key cap, attributes the key to the issuing user
//   * POST surfaces a lib validation error as 400
//   * DELETE requires id, gate-denies (403) before removing
//   * unexpected throw paths

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockResolveMembership,
  mockGetSSHKeys,
  mockGetSSHKey,
  mockAddSSHKey,
  mockDeleteSSHKey,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockResolveMembership: vi.fn(),
  mockGetSSHKeys: vi.fn(),
  mockGetSSHKey: vi.fn(),
  mockAddSSHKey: vi.fn(),
  mockDeleteSSHKey: vi.fn(),
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
vi.mock("@/lib/ssh-keys", () => ({
  getSSHKeys: mockGetSSHKeys,
  getSSHKey: mockGetSSHKey,
  addSSHKey: mockAddSSHKey,
  deleteSSHKey: mockDeleteSSHKey,
}));

import { GET, POST, DELETE } from "@/app/api/account/ssh-keys/route";

const PAYLOAD = {
  customerId: "cus_self",
  email: "s@example.com",
  userId: "user_1",
  activeAccountId: "cus_team",
};

const CTX = {
  accountId: "cus_team",
  customer: { id: "cus_team", email: "team@example.com" },
};

const LONG_KEY = "ssh-rsa " + "A".repeat(80) + " user@host";

function makeRequest(
  method: "GET" | "POST" | "DELETE",
  { auth = "Bearer t", body, query }: { auth?: string | null; body?: unknown; query?: string } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const url = "http://localhost/api/account/ssh-keys" + (query ?? "");
  return new NextRequest(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockResolveMembership.mockResolvedValue({ userId: "user_1", role: "owner", isOwner: true });
  mockGetSSHKeys.mockResolvedValue([]);
  mockGetSSHKey.mockResolvedValue({ id: "ssh_1", stripeCustomerId: "cus_team" });
  mockAddSSHKey.mockResolvedValue({
    id: "ssh_1",
    name: "laptop",
    fingerprint: "SHA256:abc",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  mockDeleteSSHKey.mockResolvedValue(undefined);
});

describe("GET /api/account/ssh-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest("GET", { auth: null }));
    expect(res.status).toBe(401);
    expect(mockGetSSHKeys).not.toHaveBeenCalled();
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

  it("lists keys with the public key truncated to a preview", async () => {
    mockGetSSHKeys.mockResolvedValue([
      {
        id: "ssh_1",
        name: "laptop",
        fingerprint: "SHA256:abc",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        publicKey: LONG_KEY,
      },
    ]);

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys[0].keyPreview).toBe(LONG_KEY.substring(0, 50) + "...");
    expect(body.keys[0].keyPreview.length).toBeLessThan(LONG_KEY.length);
    expect(mockGetSSHKeys).toHaveBeenCalledWith("cus_team");
  });

  it("returns 500 when the list query throws", async () => {
    mockGetSSHKeys.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/account/ssh-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", { auth: null, body: {} }));
    expect(res.status).toBe(401);
    expect(mockAddSSHKey).not.toHaveBeenCalled();
  });

  it("rejects a missing name or public key with 400", async () => {
    const res = await POST(makeRequest("POST", { body: { name: "laptop" } }));
    expect(res.status).toBe(400);
    expect(mockAddSSHKey).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(
      makeRequest("POST", { body: { name: "laptop", publicKey: LONG_KEY } }),
    );
    expect(res.status).toBe(404);
  });

  it("returns the gate denial (403) without adding when ssh_keys.manage is denied", async () => {
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(
      makeRequest("POST", { body: { name: "laptop", publicKey: LONG_KEY } }),
    );
    expect(res.status).toBe(403);
    expect(mockAddSSHKey).not.toHaveBeenCalled();
    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "ssh_keys.manage", accountId: "cus_team" }),
    );
  });

  it("rejects adding when the 10-key cap is reached", async () => {
    mockGetSSHKeys.mockResolvedValue(new Array(10).fill({ id: "x" }));
    const res = await POST(
      makeRequest("POST", { body: { name: "laptop", publicKey: LONG_KEY } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Maximum of 10");
    expect(mockAddSSHKey).not.toHaveBeenCalled();
  });

  it("adds the key attributed to the issuing user and returns it", async () => {
    const res = await POST(
      makeRequest("POST", { body: { name: "laptop", publicKey: LONG_KEY } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.key.id).toBe("ssh_1");
    expect(mockAddSSHKey).toHaveBeenCalledWith({
      stripeCustomerId: "cus_team",
      userId: "user_1",
      name: "laptop",
      publicKey: LONG_KEY,
    });
  });

  it("surfaces a lib validation error as 400", async () => {
    mockAddSSHKey.mockRejectedValue(new Error("Invalid public key format"));
    const res = await POST(
      makeRequest("POST", { body: { name: "laptop", publicKey: "garbage" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid public key format");
  });
});

describe("DELETE /api/account/ssh-keys", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(makeRequest("DELETE", { auth: null }));
    expect(res.status).toBe(401);
    expect(mockDeleteSSHKey).not.toHaveBeenCalled();
  });

  it("requires an id query param", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Key ID is required");
    expect(mockDeleteSSHKey).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context cannot be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE", { query: "?id=ssh_1" }));
    expect(res.status).toBe(404);
  });

  it("returns the gate denial (403) without removing", async () => {
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await DELETE(makeRequest("DELETE", { query: "?id=ssh_1" }));
    expect(res.status).toBe(403);
    expect(mockDeleteSSHKey).not.toHaveBeenCalled();
  });

  it("removes the key scoped to the operating account", async () => {
    const res = await DELETE(makeRequest("DELETE", { query: "?id=ssh_1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDeleteSSHKey).toHaveBeenCalledWith("ssh_1", "cus_team");
  });

  // PA-265: deleting a key owned by another customer must 404, not 500.
  it("returns 404 (not 500) when the key isn't owned by this account", async () => {
    mockGetSSHKey.mockResolvedValue(null); // scoped lookup finds no row
    const res = await DELETE(makeRequest("DELETE", { query: "?id=other_customers_key" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("SSH key not found");
    expect(mockDeleteSSHKey).not.toHaveBeenCalled();
  });

  it("returns 500 when the delete throws", async () => {
    mockDeleteSSHKey.mockRejectedValue(new Error("db down"));
    const res = await DELETE(makeRequest("DELETE", { query: "?id=ssh_1" }));
    expect(res.status).toBe(500);
  });
});
