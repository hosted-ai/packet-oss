// Tests for the GET handler in src/app/api/admin/email-log/route.ts.
//
// PA-287: admin observability coverage. This route lists email delivery logs
// with pagination + optional search (to/subject contains) + status filter.
// These tests pin: admin-cookie auth gating, the where-clause shaping
// (search OR, status filter only for sent/failed), pagination math
// (skip/take, clamped limit, totalPages), an empty-DB envelope, and the
// 500 path.

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
    emailLog: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

import { GET } from "@/app/api/admin/email-log/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/email-log${query ? `?${query}` : ""}`;
  return new NextRequest(url, { method: "GET", headers });
}

/** The where passed to findMany (called first inside Promise.all). */
function findManyWhere(): Record<string, unknown> {
  return mockFindMany.mock.calls[0]?.[0]?.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("GET /api/admin/email-log — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
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

describe("GET /api/admin/email-log — filtering", () => {
  it("uses an empty where when no search/status supplied", async () => {
    await GET(makeRequest());
    expect(findManyWhere()).toEqual({});
  });

  it("builds an OR on to/subject for a search term", async () => {
    await GET(makeRequest("search=welcome"));
    expect(findManyWhere()).toEqual({
      OR: [
        { to: { contains: "welcome" } },
        { subject: { contains: "welcome" } },
      ],
    });
  });

  it("applies a status filter for 'sent'", async () => {
    await GET(makeRequest("status=sent"));
    expect(findManyWhere()).toEqual({ status: "sent" });
  });

  it("applies a status filter for 'failed'", async () => {
    await GET(makeRequest("status=failed"));
    expect(findManyWhere()).toEqual({ status: "failed" });
  });

  it("ignores an unrecognized status value", async () => {
    await GET(makeRequest("status=bogus"));
    expect(findManyWhere()).toEqual({});
  });

  it("combines search and status filters", async () => {
    await GET(makeRequest("search=abc&status=failed"));
    expect(findManyWhere()).toEqual({
      OR: [{ to: { contains: "abc" } }, { subject: { contains: "abc" } }],
      status: "failed",
    });
  });

  it("forwards the same where to both findMany and count", async () => {
    await GET(makeRequest("status=sent"));
    expect(mockCount).toHaveBeenCalledWith({ where: { status: "sent" } });
  });
});

describe("GET /api/admin/email-log — pagination", () => {
  it("defaults to page 1, limit 50, skip 0, ordered desc", async () => {
    await GET(makeRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50, orderBy: { createdAt: "desc" } })
    );
  });

  it("computes skip from page and limit", async () => {
    await GET(makeRequest("page=4&limit=25"));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 75, take: 25 })
    );
  });

  it("clamps limit to a maximum of 100", async () => {
    await GET(makeRequest("limit=5000"));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("clamps a non-positive limit up to 1", async () => {
    await GET(makeRequest("limit=0"));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it("returns logs and a computed pagination envelope", async () => {
    mockFindMany.mockResolvedValue([{ id: "e1", to: "a@b.c", subject: "Hi", status: "sent" }]);
    mockCount.mockResolvedValue(120);

    const res = await GET(makeRequest("page=2&limit=50"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 2, limit: 50, total: 120, totalPages: 3 });
  });
});

describe("GET /api/admin/email-log — empty & error", () => {
  it("returns an empty, zeroed envelope when there are no logs", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.logs).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
  });

  it("returns 500 when prisma throws", async () => {
    mockCount.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch email logs");
  });
});
