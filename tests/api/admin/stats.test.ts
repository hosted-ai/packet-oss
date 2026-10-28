// Tests for the GET handler in src/app/api/admin/stats/route.ts.
//
// PA-287: admin observability coverage. This route reads the two most recent
// AdminStatsSnapshot rows, overlays a LIVE active-pod count from HAI's
// /instances/unified status_counts (active = running/active/pending/starting/
// restarting — "active" is the live-VM status per Confluence HP/600178689 §2,
// added in PA-134), and computes a day-over-day growth delta. These tests pin:
// admin-cookie auth gating, the zeroed envelope when no snapshot exists, the
// active-status filtering + summing, the snapshot fallback when the live
// summary call fails, the growth delta (vs previous snapshot's activeGPUs,
// not its live count), the null growth when only one snapshot exists, and the
// 500 path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockFindMany,
  mockGetGlobalInstanceSummary,
  mockCustomerLifecycleCount,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
  mockGetGlobalInstanceSummary: vi.fn(),
  mockCustomerLifecycleCount: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminStatsSnapshot: { findMany: mockFindMany },
    // Total Customers is now a live count from customer_lifecycle (same source
    // + non-internal filter as the marketing funnel's "Total Signups"), no
    // longer the snapshot's own totalCustomers column.
    customerLifecycle: { count: mockCustomerLifecycleCount },
  },
}));
vi.mock("@/lib/hostedai/instances", () => ({
  getGlobalInstanceSummary: mockGetGlobalInstanceSummary,
}));

import { GET } from "@/app/api/admin/stats/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/stats", {
    method: "GET",
    headers,
  });
}

function snapshot(overrides: Record<string, number> = {}) {
  return {
    totalCustomers: 100,
    activeGPUs: 20,
    mrrCents: 500000,
    newThisWeek: 7,
    revenueWeekCents: 120000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([snapshot()]);
  // Default live customer count; tests that assert on totalCustomers override it.
  mockCustomerLifecycleCount.mockResolvedValue(0);
  // Live summary: 12 running + 3 pending = 15 active; 9 stopped ignored.
  mockGetGlobalInstanceSummary.mockResolvedValue({
    statusCounts: [
      { status: "running", count: 12 },
      { status: "pending", count: 3 },
      { status: "stopped", count: 9 },
    ],
    totalItems: 24,
  });
});

describe("GET /api/admin/stats — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest({ withSession: false }));
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

describe("GET /api/admin/stats — no snapshot", () => {
  it("returns a zeroed envelope with null growth when no snapshot exists", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      totalCustomers: 0,
      activePods: 0,
      mrr: 0,
      newCustomersThisWeek: 0,
      revenueThisWeek: 0,
      growth: null,
    });
    // Live summary must not be consulted when there's no snapshot.
    expect(mockGetGlobalInstanceSummary).not.toHaveBeenCalled();
  });

  it("reads exactly the two most recent snapshots", async () => {
    await GET(makeRequest());
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { date: "desc" },
      take: 2,
    });
  });
});

describe("GET /api/admin/stats — live active-pod overlay", () => {
  it("sums only the active statuses from the live summary", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    // running(12) + pending(3) = 15; stopped(9) excluded.
    expect(body.activePods).toBe(15);
  });

  it("counts live VM instances reported as 'active' (PA-134)", async () => {
    // status_counts spans pods AND VMs; a live VM reports "active" (Confluence
    // HP/600178689 §2), the VM analog of a pod's "running". It must be summed,
    // else VM GPUs show on the user dashboard but not in this admin headline.
    mockGetGlobalInstanceSummary.mockResolvedValue({
      statusCounts: [
        { status: "running", count: 5 },
        { status: "active", count: 3 },
        { status: "stopped", count: 9 },
      ],
      totalItems: 17,
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.activePods).toBe(8); // running(5) + active(3); stopped excluded
  });

  it("matches active statuses case-insensitively", async () => {
    mockGetGlobalInstanceSummary.mockResolvedValue({
      statusCounts: [
        { status: "Running", count: 4 },
        { status: "STARTING", count: 1 },
        { status: "Restarting", count: 2 },
      ],
      totalItems: 7,
    });
    const body = await (await GET(makeRequest())).json();
    expect(body.activePods).toBe(7);
  });

  it("falls back to the snapshot activeGPUs when the live summary call fails", async () => {
    mockGetGlobalInstanceSummary.mockRejectedValue(new Error("HAI down"));
    const res = await GET(makeRequest());
    const body = await res.json();
    // Error is swallowed → still 200, activePods = snapshot.activeGPUs (20).
    expect(res.status).toBe(200);
    expect(body.activePods).toBe(20);
  });

  it("surfaces the live customer count plus the snapshot scalar fields", async () => {
    // totalCustomers is a live customerLifecycle count — set it distinct from
    // the snapshot's own totalCustomers (100) to prove the route reads the
    // live count, not the snapshot column. mrr / newThisWeek / revenueThisWeek
    // still come from the snapshot.
    mockCustomerLifecycleCount.mockResolvedValue(142);
    const body = await (await GET(makeRequest())).json();
    expect(body.totalCustomers).toBe(142);
    expect(body.mrr).toBe(500000);
    expect(body.newCustomersThisWeek).toBe(7);
    expect(body.revenueThisWeek).toBe(120000);
  });
});

describe("GET /api/admin/stats — growth delta", () => {
  it("returns null growth when only one snapshot exists", async () => {
    const body = await (await GET(makeRequest())).json();
    expect(body.growth).toBeNull();
  });

  it("computes growth against the previous snapshot", async () => {
    mockFindMany.mockResolvedValue([
      snapshot({
        totalCustomers: 110,
        activeGPUs: 25,
        mrrCents: 600000,
        newThisWeek: 9,
        revenueWeekCents: 150000,
      }),
      snapshot({
        totalCustomers: 100,
        activeGPUs: 20,
        mrrCents: 500000,
        newThisWeek: 5,
        revenueWeekCents: 120000,
      }),
    ]);
    // current.totalCustomers is the live count (110); previous.totalCustomers
    // is the older snapshot's 100 → growth.totalCustomers = 10.
    mockCustomerLifecycleCount.mockResolvedValue(110);

    const body = await (await GET(makeRequest())).json();
    // activePods comes from the LIVE summary (15), growth.activePods =
    // live(15) - previous.activeGPUs(20) = -5.
    expect(body.growth).toEqual({
      totalCustomers: 10,
      activePods: -5,
      mrr: 100000,
      newCustomersThisWeek: 4,
      revenueThisWeek: 30000,
    });
  });
});

describe("GET /api/admin/stats — error handling", () => {
  it("returns 500 when the snapshot query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch stats");
  });
});
