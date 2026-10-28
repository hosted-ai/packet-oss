// Tests for src/app/api/instances/pool-subscription/[id]/add-storage/route.ts
// (GET storage options, POST attach/create volume).
//
// Auth stack: bearer + resolveOperatingContext. Both GET and POST gate on
// gatePermission (storage.manage): the GET returns the create-volume flow
// (attachable volumes + block sizes), a managed read (PA-295).
//
// What we pin:
//   * GET/POST missing/invalid token → 401.
//   * GET 404 when ctx unresolved; 400 when no team; 404 when instance missing;
//     happy path returns option lists.
//   * GET PA-295: gatePermission gets storage.manage; denial short-circuits
//     before getUnifiedInstanceDetail.
//   * POST PA-175: gatePermission gets storage.manage; denial short-circuits
//     before getUnifiedInstanceDetail + podVolumeAction.
//   * POST validation: neither volume_id nor storage_block_id → 400 (no HAI).
//   * POST ownership: instance.team.id !== teamId → 404 no-leak, no attach.
//   * POST attach-existing happy path calls podVolumeAction(attach_volume).
//   * POST create-new happy path calls createSharedVolume then podVolumeAction.
//   * HAI throw → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetUnifiedInstanceDetail,
  mockGetSharedVolumes,
  mockGetSharedStorageBlocks,
  mockCreateSharedVolume,
  mockPodVolumeAction,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetUnifiedInstanceDetail: vi.fn(),
  mockGetSharedVolumes: vi.fn(),
  mockGetSharedStorageBlocks: vi.fn(),
  mockCreateSharedVolume: vi.fn(),
  mockPodVolumeAction: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  getUnifiedInstanceDetail: mockGetUnifiedInstanceDetail,
  getSharedVolumes: mockGetSharedVolumes,
  getSharedStorageBlocks: mockGetSharedStorageBlocks,
  createSharedVolume: mockCreateSharedVolume,
  podVolumeAction: mockPodVolumeAction,
}));

import { GET, POST } from "@/app/api/instances/pool-subscription/[id]/add-storage/route";

const ID = "i-abc";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team_1",
  customer: { id: "cus_op", email: "alice@example.com", metadata: { hostedai_team_id: "team_1" } },
};

const INSTANCE = {
  name: "my-pod",
  region: { id: "region-1", has_shared_storage_support: true },
  team: { id: "team_1" },
  shared_volumes: [],
};

function makeRequest(
  method: "GET" | "POST",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${ID}/add-storage`, init);
}

const context = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetUnifiedInstanceDetail.mockResolvedValue(INSTANCE);
  mockGetSharedVolumes.mockResolvedValue([]);
  mockGetSharedStorageBlocks.mockResolvedValue([]);
  mockCreateSharedVolume.mockResolvedValue({ id: 99, name: "vol-99" });
  mockPodVolumeAction.mockResolvedValue({});
});

describe("GET /api/instances/pool-subscription/[id]/add-storage", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest("GET", { auth: null }), context);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("GET"), context);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), context);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await GET(makeRequest("GET"), context);
    expect(res.status).toBe(400);
  });

  it("PA-295: gatePermission gets storage.manage", async () => {
    await GET(makeRequest("GET"), context);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("storage.manage");
    expect(call.customerEmail).toBe("alice@example.com");
  });

  it("PA-295 RBAC: gate denial short-circuits before instance lookup → 403", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await GET(makeRequest("GET"), context);
    expect(res).toBe(denied);
    expect(mockGetUnifiedInstanceDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when the instance is not found", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), context);
    expect(res.status).toBe(404);
  });

  it("returns storage options on the happy path", async () => {
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, name: "free-vol", region_id: "region-1", status: "AVAILABLE", size_in_gb: 100 },
      { id: 2, name: "other-region", region_id: "region-2", status: "AVAILABLE", size_in_gb: 50 },
    ]);
    mockGetSharedStorageBlocks.mockResolvedValue([{ size: 200 }, { size: 100 }]);
    const res = await GET(makeRequest("GET"), context);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.instanceId).toBe(ID);
    // only the same-region AVAILABLE volume is offered
    expect(body.availableVolumes).toHaveLength(1);
    expect(body.availableVolumes[0].id).toBe(1);
    // storage blocks sorted ascending by size
    expect(body.storageBlocks.map((b: { size: number }) => b.size)).toEqual([100, 200]);
  });

  it("returns 500 when getUnifiedInstanceDetail throws", async () => {
    mockGetUnifiedInstanceDetail.mockRejectedValue(new Error("HAI down"));
    const res = await GET(makeRequest("GET"), context);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/instances/pool-subscription/[id]/add-storage", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", { auth: null, body: { volume_id: 1 } }), context);
    expect(res.status).toBe(401);
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("PA-175: gatePermission gets storage.manage", async () => {
    await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("storage.manage");
    expect(call.customerEmail).toBe("alice@example.com");
  });

  it("RBAC: gate denial short-circuits before instance lookup + attach", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res).toBe(denied);
    expect(mockGetUnifiedInstanceDetail).not.toHaveBeenCalled();
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
  });

  it("returns 400 when neither volume_id nor storage_block_id is given (no HAI)", async () => {
    const res = await POST(makeRequest("POST", { body: {} }), context);
    expect(res.status).toBe(400);
    expect(mockGetUnifiedInstanceDetail).not.toHaveBeenCalled();
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
  });

  it("ownership: instance belongs to another team → 404 no-leak, no attach", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({ ...INSTANCE, team: { id: "team_OTHER" } });
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res.status).toBe(404);
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
  });

  it("attach existing: 404 when the volume isn't in the team", async () => {
    mockGetSharedVolumes.mockResolvedValue([]);
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res.status).toBe(404);
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
  });

  it("attach existing: 400 when the volume is in a different region", async () => {
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, region_id: "region-2", status: "AVAILABLE" },
    ]);
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res.status).toBe(400);
    expect(mockPodVolumeAction).not.toHaveBeenCalled();
  });

  it("attach existing: happy path attaches the volume", async () => {
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, region_id: "region-1", status: "AVAILABLE" },
    ]);
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
    expect(mockPodVolumeAction).toHaveBeenCalledWith(ID, "attach_volume", [1]);
  });

  it("create new: creates a volume then attaches it", async () => {
    const res = await POST(
      makeRequest("POST", { body: { storage_block_id: "block-1" } }),
      context,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.volume_id).toBe(99);
    expect(mockCreateSharedVolume).toHaveBeenCalledTimes(1);
    expect(mockPodVolumeAction).toHaveBeenCalledWith(ID, "attach_volume", [99]);
  });

  it("returns 500 when podVolumeAction throws", async () => {
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, region_id: "region-1", status: "AVAILABLE" },
    ]);
    mockPodVolumeAction.mockRejectedValue(new Error("HAI down"));
    const res = await POST(makeRequest("POST", { body: { volume_id: 1 } }), context);
    expect(res.status).toBe(500);
  });
});
