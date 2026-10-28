// Tests for src/app/api/admin/gpu-waitlist/route.ts (GET, DELETE).
//
// PA-287 — admin GPU-waitlist coverage. Admin-cookie gated. GET lists waitlist
// entries (createdAt desc). DELETE reads { id } from the body, 400s on a missing
// id, otherwise deletes the row and returns { success:true }.
//
// Mocked at the @/lib/prisma + @/lib/admin boundary. verifySessionToken is sync.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockDelete } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuWaitlist: { findMany: mockFindMany, delete: mockDelete },
  },
}));

import { GET, DELETE } from "@/app/api/admin/gpu-waitlist/route";

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
  return new NextRequest("http://localhost/api/admin/gpu-waitlist", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([
    { id: "w1", email: "a@x.com", createdAt: new Date("2026-06-01T00:00:00Z") },
  ]);
  mockDelete.mockResolvedValue({ id: "w1" });
});

describe("GET /api/admin/gpu-waitlist — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/gpu-waitlist", () => {
  it("returns waitlist entries ordered by createdAt desc", async () => {
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe("w1");
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
  });

  it("returns an empty array when there are no entries", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries).toEqual([]);
  });

  it("returns 500 when the query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to load waitlist");
  });
});

describe("DELETE /api/admin/gpu-waitlist — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await DELETE(makeReq("DELETE", { body: { id: "w1" }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await DELETE(makeReq("DELETE", { body: { id: "w1" } }));
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/gpu-waitlist", () => {
  it("returns 400 when no id is supplied", async () => {
    const res = await DELETE(makeReq("DELETE", { body: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing id");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the entry by id and returns success", async () => {
    const res = await DELETE(makeReq("DELETE", { body: { id: "w1" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "w1" } });
  });

  it("returns 500 when the delete throws", async () => {
    mockDelete.mockRejectedValue(new Error("constraint"));
    const res = await DELETE(makeReq("DELETE", { body: { id: "w1" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to delete entry");
  });
});
