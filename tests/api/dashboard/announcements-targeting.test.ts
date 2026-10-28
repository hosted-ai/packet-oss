// Tests for src/app/api/dashboard/announcements/route.ts.
//
// The end-user fetch splits stored rows into an "all customers" bucket and a
// pool-targeted one. Both splits are positive equality tests, so this suite
// protects the property that every stored value lands in exactly one of them:
//   * A non-canonical target ("All", "ALL", "all customers") reaches everyone
//     rather than nobody.
//   * A row that carries pool ids stays restricted to matching pools even when
//     its target string is unrecognised.
//   * A non-canonical displayType is served as "banner", which the dashboard
//     renders, rather than as a value it filters out.
//
// Mocked at the @/lib/prisma and @/lib/hostedai boundaries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAuthenticatedCustomer, mockFindMany, mockGetPoolSubscriptions } = vi.hoisted(
  () => ({
    mockGetAuthenticatedCustomer: vi.fn(),
    mockFindMany: vi.fn(),
    mockGetPoolSubscriptions: vi.fn(),
  })
);

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { dashboardAnnouncement: { findMany: mockFindMany } },
}));
vi.mock("@/lib/hostedai", () => ({ getPoolSubscriptions: mockGetPoolSubscriptions }));

import { GET } from "@/app/api/dashboard/announcements/route";

const TEAM_ID = "team-1";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1",
    title: "Heads up",
    message: "Body",
    displayType: "banner",
    dismissible: true,
    targetType: "all",
    targetPoolIds: null,
    ...overrides,
  };
}

function makeReq() {
  return new NextRequest("http://localhost/api/dashboard/announcements", {
    headers: { authorization: "Bearer token" },
  });
}

async function fetchIds() {
  const res = await GET(makeReq());
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.announcements as Array<{ id: string }>).map((a) => a.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue({ teamId: TEAM_ID });
  mockFindMany.mockResolvedValue([]);
  mockGetPoolSubscriptions.mockResolvedValue([]);
});

describe("targetType canonicalisation", () => {
  it.each(["All", "ALL", "all customers", "everyone", " all ", ""])(
    "serves a row targeted %j to an end user",
    async (targetType) => {
      mockFindMany.mockResolvedValue([row({ targetType })]);
      expect(await fetchIds()).toEqual(["a1"]);
    }
  );

  it("still serves canonical all-customer rows", async () => {
    mockFindMany.mockResolvedValue([row()]);
    expect(await fetchIds()).toEqual(["a1"]);
  });
});

describe("pool targeting stays restricted", () => {
  it("withholds a pool-targeted row from a customer in no matching pool", async () => {
    mockFindMany.mockResolvedValue([row({ targetType: "pools", targetPoolIds: "[7]" })]);
    mockGetPoolSubscriptions.mockResolvedValue([{ pool_id: 9 }]);
    expect(await fetchIds()).toEqual([]);
  });

  it("serves a pool-targeted row to a customer in a matching pool", async () => {
    mockFindMany.mockResolvedValue([row({ targetType: "pools", targetPoolIds: "[7]" })]);
    mockGetPoolSubscriptions.mockResolvedValue([{ pool_id: 7 }]);
    expect(await fetchIds()).toEqual(["a1"]);
  });

  it("keeps an unrecognised target restricted when it carries pool ids", async () => {
    mockFindMany.mockResolvedValue([row({ targetType: "specific", targetPoolIds: "[7]" })]);
    mockGetPoolSubscriptions.mockResolvedValue([{ pool_id: 9 }]);
    expect(await fetchIds()).toEqual([]);
  });

  it("treats an unparseable pool list as no pools rather than as everyone", async () => {
    mockFindMany.mockResolvedValue([row({ targetType: "pools", targetPoolIds: "not json" })]);
    mockGetPoolSubscriptions.mockResolvedValue([{ pool_id: 7 }]);
    expect(await fetchIds()).toEqual([]);
  });
});

describe("displayType canonicalisation", () => {
  it.each([
    ["Banner", "banner"],
    ["MODAL", "modal"],
    ["Both", "both"],
    ["popup", "banner"],
    ["", "banner"],
  ])("serves %j as %j", async (stored, served) => {
    mockFindMany.mockResolvedValue([row({ displayType: stored })]);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.announcements[0].displayType).toBe(served);
  });
});
