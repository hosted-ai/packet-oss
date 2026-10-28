// Tests for src/app/api/instances/shared-volumes/route.ts (PA-287).
//
// GET / POST / DELETE persistent storage volumes via the HAI client.
//   * GET  — read; every active role may list (no gate), but resolves the
//            operating team (PA-175) and normalizes HAI's uppercase statuses.
//   * POST — create; gated on storage.manage (PA-202), validates body.
//   * DELETE — gated on storage.manage; verifies team ownership, blocks
//            attached volumes, cascades to referencing snapshots (with a
//            confirmation gate), then re-reads to confirm HAI actually removed
//            it (HAI can 200 without deleting).
//
// What we pin:
//   * Bearer auth on each verb (missing/invalid -> 401).
//   * 404 when operating context can't be resolved; 400 when no team.
//   * gate denial short-circuits before HAI/prisma mutation (POST + DELETE).
//   * POST validation -> 400 with no HAI call.
//   * DELETE: ownership 404 (no-leak), attached-volume 400, confirmation 409,
//            HAI-didn't-actually-delete 409, happy-path cascade.
//   * error mapping -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetSharedVolumes,
  mockCreateSharedVolume,
  mockDeleteSharedVolume,
  mockSnapshotFindMany,
  mockSnapshotDeleteMany,
  mockGetStoragePricePerGBHourCents,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetSharedVolumes: vi.fn(),
  mockCreateSharedVolume: vi.fn(),
  mockDeleteSharedVolume: vi.fn(),
  mockSnapshotFindMany: vi.fn(),
  mockSnapshotDeleteMany: vi.fn(),
  mockGetStoragePricePerGBHourCents: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  getSharedVolumes: mockGetSharedVolumes,
  createSharedVolume: mockCreateSharedVolume,
  deleteSharedVolume: mockDeleteSharedVolume,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podSnapshot: {
      findMany: mockSnapshotFindMany,
      deleteMany: mockSnapshotDeleteMany,
    },
  },
}));
vi.mock("@/lib/pricing", () => ({
  getStoragePricePerGBHourCents: mockGetStoragePricePerGBHourCents,
}));

import { GET, POST, DELETE } from "@/app/api/instances/shared-volumes/route";

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

function req(
  method: "GET" | "POST" | "DELETE",
  { authorized = true, body }: { authorized?: boolean; body?: unknown } = {},
) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer valid.jwt.token");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/instances/shared-volumes", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetSharedVolumes.mockResolvedValue([]);
  mockSnapshotFindMany.mockResolvedValue([]);
  mockGetStoragePricePerGBHourCents.mockReturnValue(0);
});

describe("GET /api/instances/shared-volumes", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(req("GET", { authorized: false }));
    expect(res.status).toBe(401);
    expect(mockGetSharedVolumes).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(req("GET"));
    expect(res.status).toBe(404);
    expect(mockGetSharedVolumes).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await GET(req("GET"));
    expect(res.status).toBe(400);
    expect(mockGetSharedVolumes).not.toHaveBeenCalled();
  });

  it("lists the team's volumes and normalizes HAI statuses", async () => {
    mockGetStoragePricePerGBHourCents.mockReturnValue(10); // 10 cents/GB/hr
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, name: "a", size_in_gb: 100, region_id: 2, status: "IN_USE", mount_point: "/mnt", cost: "1.50" },
      { id: 2, name: "b", size_in_gb: 50, region_id: 2, status: "AVAILABLE", mount_point: null, cost: null },
    ]);
    const res = await GET(req("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetSharedVolumes).toHaveBeenCalledWith("team_1");
    expect(body.volumes[0].status).toBe("attached");
    // cost is derived from size_in_gb * configured rate, NOT the upstream
    // volume.cost field above (100GB * 10c/GB/hr / 100 = $10/hr) — see PA-345.
    expect(body.volumes[0].cost).toBe(10);
    expect(body.volumes[0].displaySize).toBe("100GB");
    expect(body.volumes[1].status).toBe("available");
    expect(body.volumes[1].cost).toBe(5);
  });

  it("PA-345: computes cost from the configured storage rate even when HAI's own volume.cost is 0/null", async () => {
    // Reproduces the bug: upstream HAI /shared-volumes returns no usable
    // per-volume cost, but a non-zero storage rate IS configured in Admin ->
    // Products. The widget must not read $0.00/hr in this case.
    mockGetStoragePricePerGBHourCents.mockReturnValue(9); // 9 cents/GB/hr
    mockGetSharedVolumes.mockResolvedValue([
      { id: 1, name: "a", size_in_gb: 21, region_id: 2, status: "IN_USE", mount_point: "/mnt", cost: "0" },
      { id: 2, name: "b", size_in_gb: 10, region_id: 2, status: "IN_USE", mount_point: "/mnt2", cost: null },
    ]);
    const res = await GET(req("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.volumes[0].cost).toBeCloseTo(1.89, 6); // 21GB * $0.09/GB/hr
    expect(body.volumes[1].cost).toBeCloseTo(0.9, 6); // 10GB * $0.09/GB/hr
  });

  it("does NOT gate the read (every active role may list)", async () => {
    await GET(req("GET"));
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("returns 500 when the HAI list throws", async () => {
    mockGetSharedVolumes.mockRejectedValue(new Error("HAI down"));
    const res = await GET(req("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/instances/shared-volumes", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(req("POST", { authorized: false, body: {} }));
    expect(res.status).toBe(401);
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(req("POST", { body: { name: "v", region_id: 2, storage_block_id: "sb" } }));
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
  });

  it("gate denial short-circuits before create", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await POST(req("POST", { body: { name: "v", region_id: 2, storage_block_id: "sb" } }));
    expect(res.status).toBe(403);
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
  });

  it("passes storage.manage and ctx.customer.email to the gate", async () => {
    mockCreateSharedVolume.mockResolvedValue({ id: 7, name: "v" });
    await POST(req("POST", { body: { name: "v", region_id: 2, storage_block_id: "sb" } }));
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("storage.manage");
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.accountId).toBe("cus_op");
  });

  it("rejects a missing required field -> 400 with no HAI call", async () => {
    const res = await POST(req("POST", { body: { name: "v", region_id: 2 } }));
    expect(res.status).toBe(400);
    expect(mockCreateSharedVolume).not.toHaveBeenCalled();
  });

  it("creates the volume with coerced region_id and returns it", async () => {
    mockCreateSharedVolume.mockResolvedValue({ id: 7, name: "v" });
    const res = await POST(
      req("POST", { body: { name: "v", region_id: "2", storage_block_id: "sb-9" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.volume).toEqual({ id: 7, name: "v" });
    expect(mockCreateSharedVolume).toHaveBeenCalledWith({
      team_id: "team_1",
      region_id: 2,
      name: "v",
      storage_block_id: "sb-9",
    });
  });

  it("returns 500 with the HAI error message when create throws", async () => {
    mockCreateSharedVolume.mockRejectedValue(new Error("quota exceeded"));
    const res = await POST(
      req("POST", { body: { name: "v", region_id: 2, storage_block_id: "sb" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("quota exceeded");
  });
});

describe("DELETE /api/instances/shared-volumes", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(req("DELETE", { authorized: false, body: { volume_id: 1 } }));
    expect(res.status).toBe(401);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("rejects a missing volume_id -> 400", async () => {
    const res = await DELETE(req("DELETE", { body: {} }));
    expect(res.status).toBe(400);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("gate denial short-circuits before HAI/prisma", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    expect(res.status).toBe(403);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockGetSharedVolumes).not.toHaveBeenCalled();
  });

  it("returns 404 (no-leak) when the volume isn't in this team", async () => {
    mockGetSharedVolumes.mockResolvedValue([{ id: 2, name: "other", status: "AVAILABLE" }]);
    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    expect(res.status).toBe(404);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("blocks deleting an attached volume -> 400", async () => {
    mockGetSharedVolumes.mockResolvedValue([{ id: 1, name: "v", status: "IN_USE" }]);
    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    expect(res.status).toBe(400);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("dryRun returns affected snapshots without deleting anything", async () => {
    mockGetSharedVolumes.mockResolvedValue([{ id: 1, name: "v", status: "AVAILABLE" }]);
    mockSnapshotFindMany.mockResolvedValue([{ id: "snap_1", displayName: "snap one" }]);
    const res = await DELETE(req("DELETE", { body: { volume_id: 1, dryRun: true } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.affectedSnapshots).toEqual([{ id: "snap_1", name: "snap one" }]);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockSnapshotDeleteMany).not.toHaveBeenCalled();
  });

  it("requires confirmation (409) when snapshots reference the volume", async () => {
    mockGetSharedVolumes.mockResolvedValue([{ id: 1, name: "v", status: "AVAILABLE" }]);
    mockSnapshotFindMany.mockResolvedValue([{ id: "snap_1", displayName: "snap one" }]);
    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.requiresConfirmation).toBe(true);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockSnapshotDeleteMany).not.toHaveBeenCalled();
  });

  it("cascades snapshot deletes and removes the volume on confirmed delete", async () => {
    mockGetSharedVolumes
      .mockResolvedValueOnce([{ id: 1, name: "v", status: "AVAILABLE" }]) // ownership lookup
      .mockResolvedValueOnce([]); // post-delete verification: gone
    mockSnapshotFindMany.mockResolvedValue([{ id: "snap_1", displayName: "snap one" }]);
    mockSnapshotDeleteMany.mockResolvedValue({ count: 1 });
    mockDeleteSharedVolume.mockResolvedValue({});

    const res = await DELETE(
      req("DELETE", { body: { volume_id: 1, deleteSnapshots: true } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.snapshotsDeleted).toBe(1);
    expect(mockSnapshotDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["snap_1"] } },
    });
    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(1);
  });

  it("deletes cleanly when there are no referencing snapshots", async () => {
    mockGetSharedVolumes
      .mockResolvedValueOnce([{ id: 1, name: "v", status: "AVAILABLE" }])
      .mockResolvedValueOnce([]);
    mockSnapshotFindMany.mockResolvedValue([]);
    mockDeleteSharedVolume.mockResolvedValue({});

    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.snapshotsDeleted).toBe(0);
    expect(mockSnapshotDeleteMany).not.toHaveBeenCalled();
    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(1);
  });

  it("returns 409 when HAI 200s but the volume still exists afterward", async () => {
    mockGetSharedVolumes
      .mockResolvedValueOnce([{ id: 1, name: "v", status: "AVAILABLE" }])
      .mockResolvedValueOnce([{ id: 1, name: "v", status: "IN_USE" }]); // still there
    mockSnapshotFindMany.mockResolvedValue([]);
    mockDeleteSharedVolume.mockResolvedValue({});

    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    expect(res.status).toBe(409);
  });

  it("returns 500 with the HAI error message when delete throws", async () => {
    mockGetSharedVolumes.mockResolvedValue([{ id: 1, name: "v", status: "AVAILABLE" }]);
    mockSnapshotFindMany.mockResolvedValue([]);
    mockDeleteSharedVolume.mockRejectedValue(new Error("HAI boom"));
    const res = await DELETE(req("DELETE", { body: { volume_id: 1 } }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("HAI boom");
  });
});
