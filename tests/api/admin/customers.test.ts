// Tests for the GET list handler in src/app/api/admin/customers/route.ts,
// focused on the PA-400 live "Active GPUs" overlay.
//
// The column used to read CustomerCache.activePods (a 12h admin-stats snapshot).
// It now overlays a live per-team count from getActivePodCountsByTeam(); a team
// missing from a SUCCESSFUL fetch means 0 active, and the snapshot is used only
// when the live fetch fails. These tests pin that overlay in the default and
// activeGPUs-sort paths, plus the failure fallback and auth gating.

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
vi.mock("@/lib/admin-cache", () => ({
  getActivePodCountsByTeam: mockGetActivePodCountsByTeam,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { customerCache: { findMany: mockFindMany, count: mockCount } },
}));

import { GET } from "@/app/api/admin/customers/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest(`http://localhost/api/admin/customers?${query}`, {
    method: "GET",
    headers,
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    email: "a@x.com",
    name: "Cust A",
    stripeCreatedAt: new Date("2026-06-01T00:00:00Z"),
    teamId: "team-1",
    productId: null,
    billingType: "hourly",
    balanceCents: 0,
    activePods: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockGetActivePodCountsByTeam.mockResolvedValue(new Map());
});

describe("GET /api/admin/customers — auth", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/customers — live Active GPUs overlay (PA-400)", () => {
  it("returns the live per-team count, not the stale snapshot", async () => {
    mockFindMany.mockResolvedValue([row({ teamId: "team-1", activePods: 1 })]);
    mockCount.mockResolvedValue(1);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([["team-1", 3]]));

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].activeGPUs).toBe(3);
  });

  it("resolves a team missing from a successful fetch to 0 (not the stale snapshot)", async () => {
    // Live fetch is global, so a team with no returned instances has 0 active —
    // must NOT fall back to the 12h snapshot (which would show stale pods).
    mockFindMany.mockResolvedValue([row({ teamId: "team-2", activePods: 5 })]);
    mockCount.mockResolvedValue(1);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([["team-1", 3]]));

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].activeGPUs).toBe(0);
  });

  it("falls back to the snapshot when the live fetch fails (HAI down)", async () => {
    mockFindMany.mockResolvedValue([row({ teamId: "team-1", activePods: 7 })]);
    mockCount.mockResolvedValue(1);
    mockGetActivePodCountsByTeam.mockRejectedValue(new Error("HAI down"));

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].activeGPUs).toBe(7);
  });

  it("sorts by the live count in the activeGPUs-sort path", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "cus_1", email: "one@x.com", teamId: "team-1", activePods: 0 }),
      row({ id: "cus_2", email: "two@x.com", teamId: "team-2", activePods: 0 }),
    ]);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([["team-1", 1], ["team-2", 5]]));

    const body = await (await GET(makeRequest("sortBy=activeGPUs&sortDir=desc"))).json();
    expect(body.customers.map((c: { id: string; activeGPUs: number }) => [c.id, c.activeGPUs])).toEqual([
      ["cus_2", 5],
      ["cus_1", 1],
    ]);
  });
});

describe("GET /api/admin/customers — tie-break", () => {
  it("breaks a walletBalance tie on stripeCreatedAt DESC", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "cus_old", email: "old@x.com", stripeCreatedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "cus_new", email: "new@x.com", stripeCreatedAt: new Date("2026-07-01T00:00:00Z") }),
    ]);

    const body = await (await GET(makeRequest("sortBy=walletBalance&sortDir=asc"))).json();
    expect(body.customers.map((c: { id: string }) => c.id)).toEqual(["cus_new", "cus_old"]);
  });

  it("orders by signup date when sorting by created", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "cus_new", email: "new@x.com", stripeCreatedAt: new Date("2026-07-01T00:00:00Z") }),
      row({ id: "cus_old", email: "old@x.com", stripeCreatedAt: new Date("2026-01-01T00:00:00Z") }),
    ]);

    const body = await (await GET(makeRequest("sortBy=created&sortDir=asc"))).json();
    expect(body.customers.map((c: { id: string }) => c.id)).toEqual(["cus_old", "cus_new"]);
  });
});
