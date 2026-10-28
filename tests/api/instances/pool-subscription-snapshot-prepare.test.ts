// Tests for src/app/api/instances/pool-subscription/[id]/snapshot/prepare/route.ts
// (GET — calculate data size + storage options before a snapshot).
//
// Auth stack: bearer + resolveOperatingContext (PA-175). Gated on gatePermission
// (snapshots.manage) — PA-296: this GET feeds the snapshot-creation flow, the
// same managed read as PA-295's add-storage GET.
//
// NOTE: when a pod has ssh_info the route shells out (sshpass) to size the home
// dir. We exercise the deterministic branches that DON'T touch SSH:
//   - no ssh_info  → returns canSaveData:false, dataSizeGb:null.
//   - max storage  → returns remainingStorageSlots:0 early.
//
// What we pin:
//   * missing/invalid token → 401.
//   * 404 when the operating context can't be resolved.
//   * 400 when no team.
//   * PA-296: gatePermission gets snapshots.manage; denial short-circuits
//     before getPoolSubscriptions.
//   * 404 when the subscription isn't found.
//   * max-storage branch returns the "0 slots" envelope.
//   * no-ssh_info branch returns canSaveData:false.
//   * HAI throw → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetPoolSubscriptions,
  mockGetConnectionInfo,
  mockGetAllPools,
  mockGetStorageBlocks,
  mockGetStoragePrice,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockGetAllPools: vi.fn(),
  mockGetStorageBlocks: vi.fn(),
  mockGetStoragePrice: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  getPoolSubscriptions: mockGetPoolSubscriptions,
  getConnectionInfo: mockGetConnectionInfo,
  getAllPools: mockGetAllPools,
  getStorageBlocks: mockGetStorageBlocks,
}));
vi.mock("@/lib/pricing", () => ({ getStoragePricePerGBHourCents: mockGetStoragePrice }));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));

import { GET } from "@/app/api/instances/pool-subscription/[id]/snapshot/prepare/route";

const SUB_ID = "888";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team_1",
  customer: { id: "cus_op", email: "alice@example.com", metadata: { hostedai_team_id: "team_1" } },
};

function makeRequest({ auth = "Bearer t" }: { auth?: string | null } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  return new NextRequest(
    `http://localhost/api/instances/pool-subscription/${SUB_ID}/snapshot/prepare`,
    { method: "GET", headers },
  );
}

const params = Promise.resolve({ id: SUB_ID });

const baseSub = {
  id: SUB_ID,
  pool_id: 7,
  storage_details: { shared_volumes: [], persistent_storage_gb: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetPoolSubscriptions.mockResolvedValue([baseSub]);
  mockGetConnectionInfo.mockResolvedValue([{ id: SUB_ID, pods: [{}] }]); // pod with no ssh_info
  mockGetAllPools.mockResolvedValue([{ id: 7, region_id: 2 }]);
  mockGetStorageBlocks.mockResolvedValue([]);
  mockGetStoragePrice.mockReturnValue(1);
});

describe("GET /api/instances/pool-subscription/[id]/snapshot/prepare", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest({ auth: null }), { params });
    expect(res.status).toBe(401);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("returns 400 when the customer has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("PA-296: gates on snapshots.manage; denial short-circuits before getPoolSubscriptions", async () => {
    const denial = new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    mockGatePermission.mockResolvedValue(denial);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(403);
    expect(mockGatePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "snapshots.manage", accountId: CTX.accountId }),
    );
    expect(mockGetPoolSubscriptions).not.toHaveBeenCalled();
  });

  it("returns 404 when the subscription isn't found", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns the 0-slots envelope when storage is already at max", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        ...baseSub,
        storage_details: {
          shared_volumes: [
            { id: "a", name: "v1", size_in_gb: 100 },
            { id: "b", name: "v2", size_in_gb: 100 },
            { id: "c", name: "v3", size_in_gb: 100 },
          ],
          persistent_storage_gb: 0,
        },
      },
    ]);
    const res = await GET(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.remainingStorageSlots).toBe(0);
    expect(body.canSaveData).toBe(false);
    expect(body.existingVolumes).toHaveLength(3);
    // never reached SSH / connection info on this early-return branch
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });

  it("returns canSaveData:false when the pod has no ssh_info", async () => {
    const res = await GET(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.canSaveData).toBe(false);
    expect(body.dataSizeGb).toBeNull();
    expect(body.remainingStorageSlots).toBe(MAX_SLOTS);
  });

  it("returns 500 when getPoolSubscriptions throws", async () => {
    mockGetPoolSubscriptions.mockRejectedValueOnce(new Error("HAI down"));
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(500);
  });
});

// MAX_STORAGE_VOLUMES is 3 in the route; no existing storage → 3 free slots.
const MAX_SLOTS = 3;
