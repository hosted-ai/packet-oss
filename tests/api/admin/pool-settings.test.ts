// Tests for src/app/api/admin/pool-settings/route.ts (GET, PUT, POST).
//
// PA-287 — admin pool-settings coverage. Admin-cookie gated.
//   GET  — returns defaults (creating them if missing), all overrides, and a
//          merged availablePools list (HostedAI getAllPools + GPUaaS admin
//          clusters/pools). Both pool sources are wrapped in try/catch so a
//          failure there does not fail the request.
//   PUT  — validates + upserts the default settings, logs the activity.
//   POST — creates a new per-pool override; requires a numeric gpuaasPoolId,
//          409s if one already exists, validates optional fields, logs activity.
//
// Mocked at the @/lib/prisma + @/lib/admin + @/lib/hostedai + @/lib/gpuaas-admin
// + @/lib/admin-activity boundary. verifySessionToken is sync.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockDefaultsFindUnique,
  mockDefaultsCreate,
  mockDefaultsUpsert,
  mockOverrideFindMany,
  mockOverrideFindUnique,
  mockOverrideCreate,
  mockGetAllPools,
  mockListClusters,
  mockListPools,
  mockLogSettingsUpdated,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockDefaultsFindUnique: vi.fn(),
  mockDefaultsCreate: vi.fn(),
  mockDefaultsUpsert: vi.fn(),
  mockOverrideFindMany: vi.fn(),
  mockOverrideFindUnique: vi.fn(),
  mockOverrideCreate: vi.fn(),
  mockGetAllPools: vi.fn(),
  mockListClusters: vi.fn(),
  mockListPools: vi.fn(),
  mockLogSettingsUpdated: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    poolSettingsDefaults: {
      findUnique: mockDefaultsFindUnique,
      create: mockDefaultsCreate,
      upsert: mockDefaultsUpsert,
    },
    poolSettingsOverride: {
      findMany: mockOverrideFindMany,
      findUnique: mockOverrideFindUnique,
      create: mockOverrideCreate,
    },
  },
}));
vi.mock("@/lib/hostedai", () => ({ getAllPools: mockGetAllPools }));
vi.mock("@/lib/gpuaas-admin", () => ({
  gpuaasAdmin: { listClusters: mockListClusters, listPools: mockListPools },
}));
vi.mock("@/lib/admin-activity", () => ({ logSettingsUpdated: mockLogSettingsUpdated }));

import { GET, PUT, POST } from "@/app/api/admin/pool-settings/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/pool-settings", init);
}

function defaults(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    timeQuantumSec: 90,
    overcommitRatio: 1,
    securityMode: "low",
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    updatedBy: ADMIN_EMAIL,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockDefaultsFindUnique.mockResolvedValue(defaults());
  mockDefaultsCreate.mockResolvedValue(defaults());
  mockDefaultsUpsert.mockResolvedValue(defaults({ timeQuantumSec: 120 }));
  mockOverrideFindMany.mockResolvedValue([]);
  mockOverrideFindUnique.mockResolvedValue(null);
  mockOverrideCreate.mockResolvedValue({
    id: "ovr-1",
    gpuaasPoolId: 42,
    poolName: "Pool A",
    timeQuantumSec: null,
    overcommitRatio: null,
    securityMode: null,
    notes: null,
    node: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    createdBy: ADMIN_EMAIL,
  });
  mockGetAllPools.mockResolvedValue([]);
  mockListClusters.mockResolvedValue([]);
  mockListPools.mockResolvedValue([]);
  mockLogSettingsUpdated.mockResolvedValue(undefined);
});

describe("GET /api/admin/pool-settings — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockDefaultsFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/pool-settings", () => {
  it("returns defaults, overrides and an availablePools list", async () => {
    mockGetAllPools.mockResolvedValue([
      { id: "42", name: "Pool A", region_id: 1, gpu_model: "H100" },
    ]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.defaults.timeQuantumSec).toBe(90);
    expect(body.data.availablePools).toEqual([
      { id: 42, name: "Pool A", regionId: 1, gpuModel: "H100", totalGpus: undefined, hasOverride: false },
    ]);
  });

  it("creates the default row when none exists", async () => {
    mockDefaultsFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect(mockDefaultsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "default", timeQuantumSec: 90 }),
      })
    );
  });

  it("marks a pool with a matching override as hasOverride", async () => {
    mockOverrideFindMany.mockResolvedValue([{ id: "o1", gpuaasPoolId: 42, node: null }]);
    mockGetAllPools.mockResolvedValue([{ id: "42", name: "Pool A", region_id: 1 }]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.data.availablePools[0].hasOverride).toBe(true);
  });

  it("merges GPUaaS clusters/pools not already seen from HostedAI", async () => {
    mockGetAllPools.mockResolvedValue([]);
    mockListClusters.mockResolvedValue([{ id: "c1", status: "GPUAAS_ACTIVE", region_id: 2 }]);
    mockListPools.mockResolvedValue([{ id: 99, name: "Pool B", total_gpus: 8 }]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.data.availablePools).toEqual([
      expect.objectContaining({ id: 99, name: "Pool B", regionId: 2, totalGpus: 8 }),
    ]);
  });

  it("skips non-active GPUaaS clusters", async () => {
    mockListClusters.mockResolvedValue([{ id: "c1", status: "GPUAAS_PENDING", region_id: 2 }]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.data.availablePools).toEqual([]);
    expect(mockListPools).not.toHaveBeenCalled();
  });

  it("still succeeds when the HostedAI pool fetch throws", async () => {
    mockGetAllPools.mockRejectedValue(new Error("hai down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("returns 500 when the defaults query throws", async () => {
    mockDefaultsFindUnique.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch pool settings");
  });
});

describe("PUT /api/admin/pool-settings — defaults", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await PUT(makeReq("PUT", { body: { timeQuantumSec: 120 }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockDefaultsUpsert).not.toHaveBeenCalled();
  });

  it("upserts validated defaults and logs the activity", async () => {
    const res = await PUT(
      makeReq("PUT", { body: { timeQuantumSec: 120, overcommitRatio: 2, securityMode: "high" } })
    );
    expect(res.status).toBe(200);
    const upsertArg = mockDefaultsUpsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ id: "default" });
    expect(upsertArg.update).toMatchObject({
      timeQuantumSec: 120,
      overcommitRatio: 2,
      securityMode: "high",
      updatedBy: ADMIN_EMAIL,
    });
    expect(mockLogSettingsUpdated).toHaveBeenCalledWith(ADMIN_EMAIL, "pool-settings-defaults");
  });

  it("rejects an out-of-range time quantum with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { timeQuantumSec: 5 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Time quantum");
    expect(mockDefaultsUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-integer overcommit ratio with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { overcommitRatio: 1.5 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Overcommit ratio");
  });

  it("rejects an invalid security mode with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { securityMode: "paranoid" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Security mode");
  });

  it("returns 500 when the upsert throws", async () => {
    mockDefaultsUpsert.mockRejectedValue(new Error("db down"));
    const res = await PUT(makeReq("PUT", { body: { timeQuantumSec: 120 } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update pool settings");
  });
});

describe("POST /api/admin/pool-settings — create override", () => {
  it("401 without the admin_session cookie", async () => {
    const res = await POST(makeReq("POST", { body: { gpuaasPoolId: 42 }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockOverrideCreate).not.toHaveBeenCalled();
  });

  it("requires a numeric gpuaasPoolId (400)", async () => {
    const res = await POST(makeReq("POST", { body: { gpuaasPoolId: "42" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pool ID is required");
    expect(mockOverrideCreate).not.toHaveBeenCalled();
  });

  it("409s when an override already exists for the pool", async () => {
    mockOverrideFindUnique.mockResolvedValue({ id: "existing", gpuaasPoolId: 42 });
    const res = await POST(makeReq("POST", { body: { gpuaasPoolId: 42 } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already exists");
    expect(mockOverrideCreate).not.toHaveBeenCalled();
  });

  it("creates the override and logs the activity", async () => {
    const res = await POST(
      makeReq("POST", { body: { gpuaasPoolId: 42, poolName: "Pool A", maintenance: true } })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const createArg = mockOverrideCreate.mock.calls[0][0];
    expect(createArg.data.gpuaasPoolId).toBe(42);
    expect(createArg.data.maintenance).toBe(true);
    expect(createArg.data.createdBy).toBe(ADMIN_EMAIL);
    expect(mockLogSettingsUpdated).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "pool-settings-override-create"
    );
  });

  it("rejects an invalid security mode on create (400)", async () => {
    const res = await POST(
      makeReq("POST", { body: { gpuaasPoolId: 42, securityMode: "paranoid" } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Security mode");
    expect(mockOverrideCreate).not.toHaveBeenCalled();
  });

  it("returns 500 when the create throws", async () => {
    mockOverrideCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(makeReq("POST", { body: { gpuaasPoolId: 42 } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create pool override");
  });
});
