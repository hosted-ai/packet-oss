// Tests for src/app/api/admin/pool-settings/[id]/route.ts (GET, PUT, DELETE).
//
// PA-287 — admin per-override pool-settings coverage. Admin-cookie gated. Each
// handler awaits the Next-16 params Promise for the override id, looks the row
// up, and 404s if absent. GET returns the override; PUT validates + patches only
// the supplied fields (stamping updatedBy) and logs the activity; DELETE removes
// the row and logs the activity.
//
// Mocked at the @/lib/prisma + @/lib/admin + @/lib/admin-activity boundary.
// verifySessionToken is sync; logSettingsUpdated is awaited so must resolve.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockFindUnique,
  mockUpdate,
  mockDelete,
  mockLogSettingsUpdated,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockLogSettingsUpdated: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    poolSettingsOverride: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));
vi.mock("@/lib/admin-activity", () => ({ logSettingsUpdated: mockLogSettingsUpdated }));

import { GET, PUT, DELETE } from "@/app/api/admin/pool-settings/[id]/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";
const OVERRIDE_ID = "ovr-1";

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
  return new NextRequest(`http://localhost/api/admin/pool-settings/${OVERRIDE_ID}`, init);
}

function ctx(id = OVERRIDE_ID) {
  return { params: Promise.resolve({ id }) };
}

const EXISTING = {
  id: OVERRIDE_ID,
  gpuaasPoolId: 42,
  poolName: "Pool A",
  timeQuantumSec: 90,
  overcommitRatio: 2,
  securityMode: "low",
  notes: null,
  node: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-02T00:00:00Z"),
  createdBy: ADMIN_EMAIL,
  updatedBy: ADMIN_EMAIL,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindUnique.mockResolvedValue(EXISTING);
  mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...EXISTING,
    ...data,
  }));
  mockDelete.mockResolvedValue(EXISTING);
  mockLogSettingsUpdated.mockResolvedValue(undefined);
});

describe("GET /api/admin/pool-settings/[id]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns the override for an existing id", async () => {
    const res = await GET(makeReq("GET"), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(OVERRIDE_ID);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OVERRIDE_ID } })
    );
  });

  it("returns 404 when the override does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), ctx("ghost"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Override not found");
  });

  it("returns 500 when the lookup throws", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch pool override");
  });
});

describe("PUT /api/admin/pool-settings/[id]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await PUT(makeReq("PUT", { body: { notes: "x" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the override does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { body: { notes: "x" } }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("patches only supplied fields, stamps updatedBy and logs the activity", async () => {
    const res = await PUT(
      makeReq("PUT", { body: { timeQuantumSec: 120, notes: "hi" } }),
      ctx()
    );
    expect(res.status).toBe(200);
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: OVERRIDE_ID });
    expect(updateArg.data.timeQuantumSec).toBe(120);
    expect(updateArg.data.notes).toBe("hi");
    expect(updateArg.data.updatedBy).toBe(ADMIN_EMAIL);
    // securityMode was not supplied → must not be in the patch.
    expect(updateArg.data).not.toHaveProperty("securityMode");
    expect(mockLogSettingsUpdated).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "pool-settings-override-update"
    );
  });

  it("rejects an out-of-range time quantum with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { timeQuantumSec: 999 } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Time quantum");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid security mode with 400", async () => {
    const res = await PUT(makeReq("PUT", { body: { securityMode: "paranoid" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Security mode");
  });

  it("allows null to clear an optional override field", async () => {
    const res = await PUT(makeReq("PUT", { body: { timeQuantumSec: null } }), ctx());
    expect(res.status).toBe(200);
    expect(mockUpdate.mock.calls[0][0].data.timeQuantumSec).toBeNull();
  });

  it("returns 500 when the update throws", async () => {
    mockUpdate.mockRejectedValue(new Error("db down"));
    const res = await PUT(makeReq("PUT", { body: { notes: "x" } }), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update pool override");
  });
});

describe("DELETE /api/admin/pool-settings/[id]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await DELETE(makeReq("DELETE", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the override does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the override and logs the activity", async () => {
    const res = await DELETE(makeReq("DELETE"), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: OVERRIDE_ID } });
    expect(mockLogSettingsUpdated).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "pool-settings-override-delete"
    );
  });

  it("returns 500 when the delete throws", async () => {
    mockDelete.mockRejectedValue(new Error("db down"));
    const res = await DELETE(makeReq("DELETE"), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to delete pool override");
  });
});
