// Tests for src/app/api/instances/shared-volumes/storage-blocks/route.ts (PA-287).
//
// GET returns the available storage block sizes for a region, sorted ascending.
// Part of the create-volume flow, so it's gated on storage.manage (PA-202)
// after resolving the operating team (PA-175). region_id is a required query
// param.
//
// What we pin:
//   * Bearer auth (missing/invalid -> 401).
//   * 400 when region_id is absent (before context resolution).
//   * 404 when context can't resolve; 400 when no team.
//   * gate denial short-circuits before the HAI call.
//   * happy path: HAI called with (Number(region), teamId); blocks sorted asc.
//   * error mapping -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetSharedStorageBlocks,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetSharedStorageBlocks: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  getSharedStorageBlocks: mockGetSharedStorageBlocks,
}));

import { GET } from "@/app/api/instances/shared-volumes/storage-blocks/route";

const PAYLOAD = {
  customerId: "cus_jwt",
  email: "alice@example.com",
  userId: "user_alice",
};
const CTX = {
  customer: {
    id: "cus_op",
    email: "alice@example.com",
    metadata: { hostedai_team_id: "team_1" },
  },
  accountId: "cus_op",
  teamId: "team_1",
  allTeamIds: ["team_1"],
};

function req({ authorized = true, region = "2" as string | null } = {}) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer valid.jwt.token");
  const url = region
    ? `http://localhost/api/instances/shared-volumes/storage-blocks?region_id=${region}`
    : "http://localhost/api/instances/shared-volumes/storage-blocks";
  return new NextRequest(url, { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetSharedStorageBlocks.mockResolvedValue([]);
});

describe("GET /api/instances/shared-volumes/storage-blocks", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(req({ authorized: false }));
    expect(res.status).toBe(401);
    expect(mockGetSharedStorageBlocks).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 400 when region_id is missing (before context resolution)", async () => {
    const res = await GET(req({ region: null }));
    expect(res.status).toBe(400);
    expect(mockResolveOperatingContext).not.toHaveBeenCalled();
    expect(mockGetSharedStorageBlocks).not.toHaveBeenCalled();
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockGetSharedStorageBlocks).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(mockGetSharedStorageBlocks).not.toHaveBeenCalled();
  });

  it("gate denial short-circuits before the HAI call", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetSharedStorageBlocks).not.toHaveBeenCalled();
  });

  it("passes storage.manage to the gate", async () => {
    await GET(req());
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("storage.manage");
    expect(call.accountId).toBe("cus_op");
  });

  it("calls HAI with numeric region + teamId and returns blocks sorted ascending", async () => {
    mockGetSharedStorageBlocks.mockResolvedValue([
      { id: "c", size: 500 },
      { id: "a", size: 50 },
      { id: "b", size: 100 },
    ]);
    const res = await GET(req({ region: "2" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetSharedStorageBlocks).toHaveBeenCalledWith(2, "team_1");
    expect(body.blocks.map((b: { size: number }) => b.size)).toEqual([50, 100, 500]);
  });

  it("returns 500 when the HAI call throws", async () => {
    mockGetSharedStorageBlocks.mockRejectedValue(new Error("HAI down"));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
