// Tests for src/app/api/instances/snapshots/[id]/route.ts (PA-287).
//
// GET / PATCH / DELETE a single PodSnapshot. All three share resolveAndGate:
// resolveOperatingContext (PA-175) then gatePermission "snapshots.manage"
// (PA-202). Ownership is enforced by `findFirst({ id, stripeCustomerId:
// accountId })` — a snapshot belonging to another account returns 404 with no
// mutation (no-leak). DELETE additionally cleans up an auto-created HAI volume.
//
// What we pin:
//   * Bearer auth on each verb (missing/invalid -> 401).
//   * 404 when operating context can't be resolved (resolveAndGate denial).
//   * gate denial short-circuits before prisma read/write/HAI.
//   * ownership 404: another account's snapshot -> 404, no update/delete/HAI.
//   * happy paths: correct shape, scoped query, single mutation.
//   * PATCH validation -> 400 with no DB write.
//   * DELETE auto-created-volume cleanup (and tolerance of HAI failure).
//   * unexpected throw -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockFindFirst,
  mockUpdate,
  mockDelete,
  mockDeleteSharedVolume,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteSharedVolume: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  deleteSharedVolume: mockDeleteSharedVolume,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podSnapshot: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

import { GET, PATCH, DELETE } from "@/app/api/instances/snapshots/[id]/route";

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

const params = Promise.resolve({ id: "snap_1" });

function req(
  method: "GET" | "PATCH" | "DELETE",
  { authorized = true, body }: { authorized?: boolean; body?: unknown } = {},
) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer valid.jwt.token");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/instances/snapshots/snap_1", init);
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap_1",
    displayName: "my snap",
    notes: "note",
    snapshotType: "full",
    poolId: "pool_1",
    poolName: "Pool One",
    regionId: "2",
    vgpus: 2,
    instanceTypeId: "it_1",
    imageUuid: null,
    persistentVolumeId: 42,
    persistentVolumeName: "vol-a",
    persistentVolumeSize: 100,
    hfItemId: null,
    hfItemName: null,
    hfItemType: null,
    deployScript: null,
    autoCreatedVolume: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockDeleteSharedVolume.mockResolvedValue({});
});

describe("GET /api/instances/snapshots/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(req("GET", { authorized: false }), { params });
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns the gate denial verbatim and never reads", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await GET(req("GET"), { params });
    expect(res).toBe(denied);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("scopes findFirst to the operating account (ownership)", async () => {
    mockFindFirst.mockResolvedValue(snapshotRow());
    await GET(req("GET"), { params });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "snap_1", stripeCustomerId: "cus_op" },
    });
  });

  it("returns 404 (no-leak) for a snapshot owned by another account", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Snapshot not found");
  });

  it("returns the snapshot with storage + hf shape on success", async () => {
    mockFindFirst.mockResolvedValue(
      snapshotRow({ hfItemId: "hf_1", hfItemName: "llama", hfItemType: "model", deployScript: "vllm" }),
    );
    const res = await GET(req("GET"), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.snapshot.id).toBe("snap_1");
    expect(body.snapshot.hasStorage).toBe(true);
    expect(body.snapshot.storage).toEqual({ id: 42, name: "vol-a", sizeGb: 100 });
    expect(body.snapshot.hfModel.id).toBe("hf_1");
  });

  it("returns 500 when the read throws", async () => {
    mockFindFirst.mockRejectedValue(new Error("db down"));
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/instances/snapshots/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await PATCH(req("PATCH", { authorized: false, body: { notes: "x" } }), { params });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns the gate denial before any DB access", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await PATCH(req("PATCH", { body: { notes: "x" } }), { params });
    expect(res.status).toBe(403);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an over-long displayName -> 400 with no write", async () => {
    const res = await PATCH(
      req("PATCH", { body: { displayName: "x".repeat(101) } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects notes over the 500-char cap -> 400", async () => {
    const res = await PATCH(
      req("PATCH", { body: { notes: "x".repeat(501) } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 (no-leak) when the snapshot belongs to another account", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await PATCH(req("PATCH", { body: { notes: "x" } }), { params });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates only the provided fields and echoes the result", async () => {
    mockFindFirst.mockResolvedValue(snapshotRow());
    mockUpdate.mockResolvedValue({
      id: "snap_1",
      displayName: "renamed",
      notes: "note",
      updatedAt: new Date("2026-01-03T00:00:00Z"),
    });

    const res = await PATCH(req("PATCH", { body: { displayName: "renamed" } }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.snapshot.displayName).toBe("renamed");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "snap_1" },
      data: { displayName: "renamed" },
    });
  });

  it("returns 500 when the update throws", async () => {
    mockFindFirst.mockResolvedValue(snapshotRow());
    mockUpdate.mockRejectedValue(new Error("db down"));
    const res = await PATCH(req("PATCH", { body: { notes: "x" } }), { params });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/instances/snapshots/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(req("DELETE", { authorized: false }), { params });
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns the gate denial before any DB access", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await DELETE(req("DELETE"), { params });
    expect(res.status).toBe(403);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("returns 404 (no-leak) for another account's snapshot, no delete", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await DELETE(req("DELETE"), { params });
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("deletes the snapshot and reports user storage remaining", async () => {
    // user-created volume (not auto-created) stays behind
    mockFindFirst.mockResolvedValue(
      snapshotRow({ persistentVolumeId: 42, autoCreatedVolume: false }),
    );
    mockDelete.mockResolvedValue({});

    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "snap_1" } });
    // user storage is NOT auto-deleted
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(body.volumeDeleted).toBe(false);
    expect(body.storageRemaining).toBe(true);
  });

  it("auto-deletes the HAI volume when the snapshot owns one", async () => {
    mockFindFirst.mockResolvedValue(
      snapshotRow({ persistentVolumeId: 99, autoCreatedVolume: true }),
    );
    mockDelete.mockResolvedValue({});

    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(99);
    expect(body.volumeDeleted).toBe(true);
    expect(body.storageRemaining).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "snap_1" } });
  });

  it("still deletes the snapshot when auto-volume cleanup fails (and surfaces the error)", async () => {
    mockFindFirst.mockResolvedValue(
      snapshotRow({ persistentVolumeId: 99, autoCreatedVolume: true }),
    );
    mockDeleteSharedVolume.mockRejectedValue(new Error("HAI volume busy"));
    mockDelete.mockResolvedValue({});

    const res = await DELETE(req("DELETE"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(body.volumeDeleted).toBe(false);
    expect(body.volumeDeleteError).toBe("HAI volume busy");
  });

  it("returns 500 when the snapshot delete throws", async () => {
    mockFindFirst.mockResolvedValue(snapshotRow({ autoCreatedVolume: false }));
    mockDelete.mockRejectedValue(new Error("db down"));
    const res = await DELETE(req("DELETE"), { params });
    expect(res.status).toBe(500);
  });
});
