// Tests for the GET handler in src/app/api/admin/customers/route.ts.
//
// PA-180: searching by a short numeric like "88" was matching hidden columns
// (Stripe customer id, hosted.ai team UUID) and returning rows the admin had
// no way to correlate with their query. These tests pin the search-shape
// rules: short / non-ID-looking queries must only match visible columns
// (email, name); cus_-prefixed queries may match the Stripe id; UUID-shaped
// queries may match the team id.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockCount, mockGetActivePodCountsByTeam } =
  vi.hoisted(() => ({
    mockVerifySessionToken: vi.fn(),
    mockFindMany: vi.fn(),
    mockCount: vi.fn(),
    mockGetActivePodCountsByTeam: vi.fn(),
  }));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
// PA-400: the route now overlays a live active-GPU count; keep this suite
// hermetic by stubbing it (an empty map = no live pods, snapshot fallback path
// untouched — these tests only assert the search WHERE clause).
vi.mock("@/lib/admin-cache", () => ({
  getActivePodCountsByTeam: mockGetActivePodCountsByTeam,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}));

import { GET } from "@/app/api/admin/customers/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(search: string) {
  const headers = new Headers();
  headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/customers?search=${encodeURIComponent(search)}`;
  return new NextRequest(url, { method: "GET", headers });
}

type WhereInput = {
  isDeleted?: boolean;
  OR?: Array<Record<string, { contains?: string }>>;
};

function getOrClause(): WhereInput["OR"] {
  // findMany is called first with { where, orderBy, skip, take }
  const call = mockFindMany.mock.calls[0]?.[0] as { where: WhereInput } | undefined;
  return call?.where?.OR;
}

function fieldsSearched(or: WhereInput["OR"]): string[] {
  if (!or) return [];
  return or.flatMap((clause) => Object.keys(clause));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockGetActivePodCountsByTeam.mockResolvedValue(new Map());
});

describe("GET /api/admin/customers — search column gating (PA-180)", () => {
  it("searching '88' does NOT match against Stripe id or team UUID", async () => {
    const res = await GET(makeRequest("88"));
    expect(res.status).toBe(200);

    const or = getOrClause();
    const fields = fieldsSearched(or);

    expect(fields).toContain("email");
    expect(fields).toContain("name");
    expect(fields).not.toContain("id");
    expect(fields).not.toContain("teamId");
  });

  it("searching a Stripe id prefix 'cus_' includes id column", async () => {
    const res = await GET(makeRequest("cus_TyTen"));
    expect(res.status).toBe(200);

    const fields = fieldsSearched(getOrClause());
    expect(fields).toContain("id");
    expect(fields).toContain("email");
    expect(fields).toContain("name");
  });

  it("searching a UUID-shaped query includes teamId column", async () => {
    const res = await GET(makeRequest("8088c55a-1833-4e05-82b0-94499abc450e"));
    expect(res.status).toBe(200);

    const fields = fieldsSearched(getOrClause());
    expect(fields).toContain("teamId");
    expect(fields).toContain("email");
    expect(fields).toContain("name");
  });

  it("searching a long hex-only fragment includes teamId column", async () => {
    // First 8 chars of a UUID — long enough and only hex → likely a team id
    const res = await GET(makeRequest("8088c55a"));
    expect(res.status).toBe(200);

    const fields = fieldsSearched(getOrClause());
    expect(fields).toContain("teamId");
  });

  it("searching a normal email fragment does NOT match id or teamId", async () => {
    const res = await GET(makeRequest("hosted.ai"));
    expect(res.status).toBe(200);

    const fields = fieldsSearched(getOrClause());
    expect(fields).toContain("email");
    expect(fields).not.toContain("id");
    expect(fields).not.toContain("teamId");
  });

  it("empty search omits the OR clause entirely", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(200);

    const or = getOrClause();
    expect(or).toBeUndefined();
  });
});
