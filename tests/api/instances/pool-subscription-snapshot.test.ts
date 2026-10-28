// Tests for src/app/api/instances/pool-subscription/[id]/snapshot/route.ts (POST).
//
// Auth stack: bearer + resolveOperatingContext + gatePermission
// (snapshots.manage). Input is validated by a zod schema (displayName 1..100).
//
// NOTE: the saveData=true + no-existing-storage path triggers a real
// resubscribe + SSH copy with internal setTimeout polling loops. We
// deliberately exercise the saveData=false ("template") path for the happy
// case — it's the deterministic branch and still pins the gate + Prisma write.
//
// What we pin:
//   * missing/invalid token → 401.
//   * 400 on invalid input (empty displayName) — before ctx/gate.
//   * 404 when ctx unresolved; PA-175 gate gets snapshots.manage; RBAC denial
//     short-circuits before podSnapshot.create.
//   * 400 when no team; 404 when the subscription isn't found.
//   * template happy path creates a podSnapshot with type "template".
//   * Prisma throw → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetPoolSubscriptions,
  mockGetAllPools,
  mockGetSharedVolumes,
  mockHfFindFirst,
  mockSnapshotCreate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockGetAllPools: vi.fn(),
  mockGetSharedVolumes: vi.fn(),
  mockHfFindFirst: vi.fn(),
  mockSnapshotCreate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  getPoolSubscriptions: mockGetPoolSubscriptions,
  getConnectionInfo: vi.fn(),
  getAllPools: mockGetAllPools,
  createSharedVolume: vi.fn(),
  unsubscribeFromPool: vi.fn(),
  subscribeToPool: vi.fn(),
  getPoolEphemeralStorageBlocks: vi.fn(),
  getSharedVolumes: mockGetSharedVolumes,
  getPoolInstanceTypes: vi.fn(),
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    huggingFaceDeployment: { findFirst: mockHfFindFirst },
    podSnapshot: { create: mockSnapshotCreate },
  },
}));

import { POST } from "@/app/api/instances/pool-subscription/[id]/snapshot/route";

const SUB_ID = "777";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team_1",
  customer: { id: "cus_op", email: "alice@example.com", metadata: { hostedai_team_id: "team_1" } },
};

function makeRequest({ auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${SUB_ID}/snapshot`, init);
}

const params = Promise.resolve({ id: SUB_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetPoolSubscriptions.mockResolvedValue([
    {
      id: SUB_ID,
      pool_id: 7,
      pool_name: "Pool A",
      per_pod_info: { vgpu_count: 1, image_uuid: "img-1" },
      storage_details: { shared_volumes: [], persistent_storage_gb: 0 },
    },
  ]);
  mockGetAllPools.mockResolvedValue([{ id: 7, region_id: 2 }]);
  mockGetSharedVolumes.mockResolvedValue([]);
  mockHfFindFirst.mockResolvedValue(null);
  mockSnapshotCreate.mockResolvedValue({
    id: "snap-1",
    displayName: "My Snapshot",
    snapshotType: "template",
    poolName: "Pool A",
    vgpus: 1,
    persistentVolumeName: null,
    persistentVolumeSize: null,
    hfItemName: null,
    createdAt: new Date("2026-01-01"),
  });
});

const VALID_BODY = { displayName: "My Snapshot", saveData: false };

describe("POST /api/instances/pool-subscription/[id]/snapshot", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest({ auth: null, body: VALID_BODY }), { params });
    expect(res.status).toBe(401);
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid input (empty displayName) before ctx/gate", async () => {
    const res = await POST(makeRequest({ body: { displayName: "" } }), { params });
    expect(res.status).toBe(400);
    expect(mockResolveOperatingContext).not.toHaveBeenCalled();
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("PA-175: gatePermission gets snapshots.manage", async () => {
    await POST(makeRequest({ body: VALID_BODY }), { params });
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("snapshots.manage");
    expect(call.customerEmail).toBe("alice@example.com");
  });

  it("RBAC: gate denial short-circuits before podSnapshot.create", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res).toBe(denied);
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(400);
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the subscription isn't found", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(404);
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
  });

  it("template happy path: creates a podSnapshot scoped to the operating account", async () => {
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.snapshot.snapshotType).toBe("template");
    expect(mockSnapshotCreate).toHaveBeenCalledTimes(1);
    const data = mockSnapshotCreate.mock.calls[0][0].data;
    expect(data.stripeCustomerId).toBe("cus_op");
    expect(data.originalSubscriptionId).toBe(SUB_ID);
    expect(data.snapshotType).toBe("template");
  });

  it("returns 500 when podSnapshot.create throws", async () => {
    mockSnapshotCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(500);
  });
});
