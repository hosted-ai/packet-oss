// Tests for src/app/api/admin/banners/route.ts.
//
// GET lists campaign banners; POST multiplexes create/update/delete via an
// `action` field. What this suite protects:
//   * Admin gating on GET and POST.
//   * create requires `text` (400 otherwise), applies the colour defaults, and
//     stamps createdBy / updatedBy.
//   * update / delete require an id; update only writes the supplied fields.
//   * Unknown action → 400; thrown Prisma error → 500 with no leak.
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
    campaignBanner: {
      findMany: mockFindMany,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

import { GET, POST } from "@/app/api/admin/banners/route";

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
  return new NextRequest("http://localhost/api/admin/banners", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindMany.mockResolvedValue([]);
  mockCreate.mockResolvedValue({ id: "b1" });
  mockUpdate.mockResolvedValue({ id: "b1" });
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

describe("GET /api/admin/banners", () => {
  it("returns banners ordered by displayOrder then createdAt", async () => {
    mockFindMany.mockResolvedValue([{ id: "b1" }]);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: "b1" }]);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    });
  });

  it("returns 500 when the query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});

describe("POST — create", () => {
  it("creates a banner with colour defaults and stamps createdBy/updatedBy", async () => {
    const res = await POST(makeReq("POST", { body: { action: "create", text: "Sale!" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        text: "Sale!",
        backgroundColor: "#1a4fff",
        textColor: "#ffffff",
        displayOrder: 0,
        createdBy: ADMIN_EMAIL,
        updatedBy: ADMIN_EMAIL,
      }),
    });
  });

  it("returns 400 when text is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "create" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Banner text is required");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("honours supplied colours and link fields", async () => {
    await POST(
      makeReq("POST", {
        body: { action: "create", text: "t", backgroundColor: "#000", linkUrl: "https://x" },
      })
    );
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.backgroundColor).toBe("#000");
    expect(data.linkUrl).toBe("https://x");
  });
});

describe("POST — update", () => {
  it("updates only the supplied fields plus updatedBy", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "update", id: "b1", text: "New text" } })
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { updatedBy: ADMIN_EMAIL, text: "New text" },
    });
  });

  it("returns 400 when id is missing", async () => {
    const res = await POST(makeReq("POST", { body: { action: "update", text: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Banner ID is required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST — delete", () => {
  it("deletes by id", async () => {
    const res = await POST(makeReq("POST", { body: { action: "delete", id: "b1" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "b1" } });
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
    const res = await POST(makeReq("POST", { body: { action: "create", text: "t" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});
