// Tests for src/app/api/instances/pool-subscription/[id]/add-storage/route.ts.
//
// What this protects:
//   * A shared volume mounted on another instance is offered for attach, and the
//     POST accepts it. A customer with two instances in one region could not mount
//     their volume on the second because both paths demanded status AVAILABLE.
//   * A volume already on THIS instance is still refused, by identity rather than
//     by status.
//   * An upstream failure is reported as a failure instead of rendering as an
//     empty region.
//
// Boundary mocks: customer-auth, auth/gate, auth/account-resolver, hostedai.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  gatePermission: vi.fn(),
  resolveOperatingContext: vi.fn(),
  getUnifiedInstanceDetail: vi.fn(),
  getSharedVolumes: vi.fn(),
  getSharedStorageBlocks: vi.fn(),
  createSharedVolume: vi.fn(),
  podVolumeAction: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: m.verifyCustomerToken }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: m.gatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: m.resolveOperatingContext }));
vi.mock("@/lib/hostedai", () => ({
  getUnifiedInstanceDetail: m.getUnifiedInstanceDetail,
  getSharedVolumes: m.getSharedVolumes,
  getSharedStorageBlocks: m.getSharedStorageBlocks,
  createSharedVolume: m.createSharedVolume,
  podVolumeAction: m.podVolumeAction,
}));

import { GET, POST } from "@/app/api/instances/pool-subscription/[id]/add-storage/route";

const INSTANCE = "i-gpu01";
const context = { params: Promise.resolve({ id: INSTANCE }) };

function getReq() {
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${INSTANCE}/add-storage`, {
    headers: new Headers({ authorization: "Bearer good-token" }),
  });
}

function postReq(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${INSTANCE}/add-storage`, {
    method: "POST",
    headers: new Headers({ authorization: "Bearer good-token", "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

// The reported shape: gpu01 has nothing attached; gpu02 holds the two volumes.
const VOLUME_ON_OTHER_INSTANCE = {
  id: 721,
  name: "gpu02-storage-1",
  size_in_gb: 100,
  mount_point: "/mnt/shared",
  region_id: 83,
  status: "IN_USE",
  cost: "0",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.verifyCustomerToken.mockReturnValue({ email: "u@e.com", customerId: "cus_1", activeAccountId: null });
  m.resolveOperatingContext.mockResolvedValue({
    accountId: "cus_1",
    teamId: "team-1",
    customer: { email: "u@e.com", metadata: { hostedai_team_id: "team-1" } },
  });
  m.gatePermission.mockResolvedValue(null);
  m.getUnifiedInstanceDetail.mockResolvedValue({
    id: INSTANCE,
    name: "gpu01",
    team: { id: "team-1" },
    region: { id: 83, has_shared_storage_support: true },
    shared_volumes: [],
  });
  m.getSharedVolumes.mockResolvedValue([VOLUME_ON_OTHER_INSTANCE]);
  m.getSharedStorageBlocks.mockResolvedValue([]);
  m.podVolumeAction.mockResolvedValue({});
});

describe("add-storage GET", () => {
  it("offers a volume that is mounted on another instance", async () => {
    const body = await (await GET(getReq(), context)).json();

    expect(body.availableVolumes).toHaveLength(1);
    expect(body.availableVolumes[0]).toMatchObject({ id: 721, status: "IN_USE" });
    expect(body.loadFailed).toBe(false);
  });

  it("excludes a volume already attached to this instance", async () => {
    m.getUnifiedInstanceDetail.mockResolvedValue({
      id: INSTANCE,
      name: "gpu01",
      team: { id: "team-1" },
      region: { id: 83, has_shared_storage_support: true },
      shared_volumes: [{ id: 721, name: "gpu02-storage-1", mount_point: "/mnt/shared", size_in_gb: 100 }],
    });

    const body = await (await GET(getReq(), context)).json();

    expect(body.availableVolumes).toHaveLength(0);
  });

  it("excludes a volume in a different region", async () => {
    m.getSharedVolumes.mockResolvedValue([{ ...VOLUME_ON_OTHER_INSTANCE, region_id: 84 }]);

    const body = await (await GET(getReq(), context)).json();

    expect(body.availableVolumes).toHaveLength(0);
  });

  it("still excludes a volume that is genuinely unusable", async () => {
    m.getSharedVolumes.mockResolvedValue([{ ...VOLUME_ON_OTHER_INSTANCE, status: "ERROR" }]);

    const body = await (await GET(getReq(), context)).json();

    expect(body.availableVolumes).toHaveLength(0);
  });

  it("reports an upstream failure rather than an empty region", async () => {
    m.getSharedStorageBlocks.mockRejectedValue(new Error("platform 500"));

    const body = await (await GET(getReq(), context)).json();

    expect(body.loadFailed).toBe(true);
    expect(body.storageBlocks).toEqual([]);
  });

  it("keeps serving volumes when only the block lookup fails", async () => {
    m.getSharedStorageBlocks.mockRejectedValue(new Error("platform 500"));

    const body = await (await GET(getReq(), context)).json();

    expect(body.availableVolumes).toHaveLength(1);
  });
});

describe("add-storage POST", () => {
  it("attaches a volume that is mounted on another instance", async () => {
    const res = await POST(postReq({ volume_id: 721 }), context);

    expect(res.status).toBe(200);
    expect(m.podVolumeAction).toHaveBeenCalledWith(INSTANCE, "attach_volume", [721]);
  });

  it("refuses a volume already attached to this instance", async () => {
    m.getUnifiedInstanceDetail.mockResolvedValue({
      id: INSTANCE,
      name: "gpu01",
      team: { id: "team-1" },
      region: { id: 83, has_shared_storage_support: true },
      shared_volumes: [{ id: 721 }],
    });

    const res = await POST(postReq({ volume_id: 721 }), context);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already attached/i);
    expect(m.podVolumeAction).not.toHaveBeenCalled();
  });

  it("refuses a volume in a bad state", async () => {
    m.getSharedVolumes.mockResolvedValue([{ ...VOLUME_ON_OTHER_INSTANCE, status: "ERROR" }]);

    const res = await POST(postReq({ volume_id: 721 }), context);

    expect(res.status).toBe(400);
    expect(m.podVolumeAction).not.toHaveBeenCalled();
  });

  it("refuses a volume belonging to another team", async () => {
    m.getSharedVolumes.mockResolvedValue([]);

    const res = await POST(postReq({ volume_id: 999 }), context);

    expect(res.status).toBe(404);
    expect(m.podVolumeAction).not.toHaveBeenCalled();
  });

  it("refuses a volume from a different region", async () => {
    m.getSharedVolumes.mockResolvedValue([{ ...VOLUME_ON_OTHER_INSTANCE, region_id: 84 }]);

    const res = await POST(postReq({ volume_id: 721 }), context);

    expect(res.status).toBe(400);
    expect(m.podVolumeAction).not.toHaveBeenCalled();
  });
});
