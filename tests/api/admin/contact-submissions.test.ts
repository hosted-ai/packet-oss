// Tests for the GET handler in src/app/api/admin/contact-submissions/route.ts.
//
// PA-287: admin observability coverage. This route lists contact-form
// submissions (the OSS support inbox) with simple skip/take pagination.
// These tests pin: admin-cookie auth gating, the pagination math
// (skip = (page-1)*limit, clamped limit), the serialized row shape, an
// empty-DB envelope (no crash, zeroed totals/pages), and the 500 path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockCount } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contactSubmission: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

import { GET } from "@/app/api/admin/contact-submissions/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/contact-submissions${query ? `?${query}` : ""}`;
  return new NextRequest(url, { method: "GET", headers });
}

const SAMPLE_ROW = {
  id: "cs_1",
  name: "Test Requester",
  email: "requester@example.com",
  subject: "Help",
  message: "Please help",
  priority: "normal",
  stripeCustomerId: "cus_abc",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  // A field that must NOT leak into the serialized output:
  internalNote: "secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/admin/contact-submissions — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/contact-submissions — pagination & shape", () => {
  it("defaults to page 1, limit 50, skip 0", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50, orderBy: { createdAt: "desc" } })
    );
    const body = await res.json();
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it("computes skip from page and limit", async () => {
    await GET(makeRequest("page=3&limit=10"));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it("clamps limit to a maximum of 100", async () => {
    await GET(makeRequest("limit=9999"));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("clamps a non-positive page up to 1 (skip 0)", async () => {
    await GET(makeRequest("page=0"));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("serializes only the whitelisted fields and ISO-formats createdAt", async () => {
    mockFindMany.mockResolvedValue([SAMPLE_ROW]);
    mockCount.mockResolvedValue(1);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0]).toEqual({
      id: "cs_1",
      name: "Test Requester",
      email: "requester@example.com",
      subject: "Help",
      message: "Please help",
      priority: "normal",
      stripeCustomerId: "cus_abc",
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    // Internal fields must not be forwarded.
    expect(body.submissions[0]).not.toHaveProperty("internalNote");
  });

  it("computes totalPages from total and limit", async () => {
    mockCount.mockResolvedValue(105);
    const res = await GET(makeRequest("limit=50"));
    const body = await res.json();
    expect(body.pagination.total).toBe(105);
    expect(body.pagination.totalPages).toBe(3);
  });
});

describe("GET /api/admin/contact-submissions — empty & error", () => {
  it("returns an empty, zeroed envelope when there are no submissions", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.submissions).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
    expect(Number.isNaN(body.pagination.totalPages)).toBe(false);
  });

  it("returns 500 when prisma throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to load submissions");
  });
});
