// Tests for src/app/api/instances/snapshots/route.ts (PA-287).
//
// GET lists the operating account's PodSnapshot rows. It is a bearer + gate
// route (PA-202): Read-only Member / Finance Manager are denied via the
// `snapshots.manage` permission, and the list is scoped to ctx.accountId
// (PA-175) so an invited member sees the team's snapshots, not their own.
//
// What we pin:
//   * Bearer auth (missing/invalid token -> 401).
//   * 404 when operating context can't be resolved.
//   * gate denial short-circuits BEFORE the prisma read.
//   * happy path scopes the findMany to ctx.accountId and shapes the rows.
//   * unexpected throw -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockFindMany,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/prisma", () => ({
  prisma: { podSnapshot: { findMany: mockFindMany } },
}));

import { GET } from "@/app/api/instances/snapshots/route";

const PAYLOAD = {
  customerId: "cus_jwt",
  email: "alice@example.com",
  userId: "user_alice",
};
const CTX = {
  customer: { id: "cus_op", email: "alice@example.com", metadata: {} },
  accountId: "cus_op",
  allTeamIds: ["team_1"],
};

function req(authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer valid.jwt.token");
  return new NextRequest("http://localhost/api/instances/snapshots", {
    method: "GET",
    headers,
  });
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap_1",
    displayName: "my snap",
    notes: "note",
    snapshotType: "full",
    poolId: "pool_1",
    poolName: "Pool One",
    vgpus: 2,
    persistentVolumeId: 42,
    persistentVolumeName: "vol-a",
    persistentVolumeSize: 100,
    hfItemId: null,
    hfItemName: null,
    hfItemType: null,
    deployScript: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    autoCreatedVolume: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null); // allow by default
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/instances/snapshots", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await GET(req(false));
    expect(res.status).toBe(401);
    expect(mockResolveOperatingContext).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("gate denial short-circuits before the prisma read", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);

    const res = await GET(req());

    expect(res).toBe(denied);
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("passes ctx.customer.email and snapshots.manage to gatePermission", async () => {
    await GET(req());
    expect(mockGatePermission).toHaveBeenCalledTimes(1);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.accountId).toBe("cus_op");
    expect(call.permission).toBe("snapshots.manage");
  });

  it("scopes the findMany to ctx.accountId, newest first", async () => {
    await GET(req());
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_op" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("shapes a full snapshot with storage into the response", async () => {
    mockFindMany.mockResolvedValue([snapshotRow()]);
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    const s = body.snapshots[0];
    expect(s.id).toBe("snap_1");
    expect(s.hasStorage).toBe(true);
    expect(s.storage).toEqual({ id: 42, name: "vol-a", sizeGb: 100 });
    expect(s.hfModel).toBeNull();
  });

  it("reports hasStorage=false and null storage when no volume present", async () => {
    mockFindMany.mockResolvedValue([
      snapshotRow({ persistentVolumeId: null, persistentVolumeName: null }),
    ]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.snapshots[0].hasStorage).toBe(false);
    expect(body.snapshots[0].storage).toBeNull();
  });

  it("emits hfModel for a HuggingFace-backed snapshot", async () => {
    mockFindMany.mockResolvedValue([
      snapshotRow({
        hfItemId: "hf_1",
        hfItemName: "llama",
        hfItemType: "model",
        deployScript: "vllm",
      }),
    ]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.snapshots[0].hfModel).toEqual({
      id: "hf_1",
      name: "llama",
      type: "model",
      deployScript: "vllm",
    });
  });

  it("returns 500 when the prisma read throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
