// Tests for src/app/api/admin/announcements/route.ts.
//
// GET lists dashboard announcements; POST multiplexes create/update/delete via
// an `action` field. What this suite protects:
//   * Admin gating on GET and POST.
//   * create requires title + message (400 otherwise) and stamps createdBy /
//     updatedBy from the session.
//   * update / delete require an id (400 otherwise); update only writes the
//     fields actually supplied.
//   * create and update both refuse a non-member displayType / targetType.
//   * An unknown action is a 400; a thrown Prisma error is a 500 that does not
//     leak internals.
//
// Mocked at the @/lib/prisma boundary (same pattern as customers-search.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockCreate, mockUpdate, mockDelete } =
  vi.hoisted(() => ({
    mockVerifySessionToken: vi.fn(),
    mockFindMany: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
  }));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dashboardAnnouncement: {
      findMany: mockFindMany,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

import { GET, POST } from "@/app/api/admin/announcements/route";

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
  return new NextRequest("http://localhost/api/admin/announcements", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindMany.mockResolvedValue([]);
  mockCreate.mockResolvedValue({ id: "a1" });
  mockUpdate.mockResolvedValue({ id: "a1" });
  mockDelete.mockResolvedValue(undefined);
});

describe("auth gating", () => {
  it("GET returns 401 without a session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("POST returns 401 when the session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq("POST", { body: { action: "create" } }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/announcements", () => {
  it("returns announcements newest-first", async () => {
    mockFindMany.mockResolvedValue([{ id: "a1" }]);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: "a1" }]);
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
  });

  it("returns 500 when the query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});

describe("POST — create", () => {
  it("creates an announcement and stamps createdBy/updatedBy", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "create", title: "Hi", message: "Body" } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Hi",
        message: "Body",
        displayType: "banner",
        targetType: "all",
        createdBy: ADMIN_EMAIL,
        updatedBy: ADMIN_EMAIL,
      }),
    });
  });

  it("returns 400 when title or message is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "create", title: "Only title" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Title and message are required");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("converts supplied date strings into Date objects", async () => {
    await POST(
      makeReq("POST", {
        body: { action: "create", title: "t", message: "m", startsAt: "2026-01-01T00:00:00Z" },
      })
    );
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.startsAt).toBeInstanceOf(Date);
    expect(data.expiresAt).toBeNull();
  });
});

describe("POST — update", () => {
  it("updates only the supplied fields plus updatedBy", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "update", id: "a1", title: "New title" } })
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { updatedBy: ADMIN_EMAIL, title: "New title" },
    });
  });

  it("returns 400 when id is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "update", title: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Announcement ID is required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST — display/target validation", () => {
  it("rejects a non-member targetType on update", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "update", id: "a1", targetType: "all customers" } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("targetType must be one of: all, pools");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-member displayType on update", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "update", id: "a1", displayType: "popup" } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("displayType must be one of: banner, modal, both");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-member targetType on create", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "create", title: "t", message: "m", targetType: "ALL" } })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("accepts the canonical values on update", async () => {
    const res = await POST(
      makeReq("POST", {
        body: { action: "update", id: "a1", targetType: "pools", displayType: "modal" },
      })
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { updatedBy: ADMIN_EMAIL, displayType: "modal", targetType: "pools" },
    });
  });
});

describe("POST — delete", () => {
  it("deletes by id", async () => {
    const res = await POST(makeReq("POST", { body: { action: "delete", id: "a1" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  it("returns 400 when id is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "delete" } }));
    expect(res.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("POST — misc", () => {
  it("returns 400 for an unknown action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "frobnicate" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
  });

  it("returns 500 when the mutation throws", async () => {
    mockCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(
      makeReq("POST", { body: { action: "create", title: "t", message: "m" } })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});
