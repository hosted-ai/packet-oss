// Tests for the GET handler in src/app/api/admin/uptime/route.ts.
//
// PA-287: admin observability coverage. This route reconstructs per-pod
// uptime from PodUptimeDay heartbeat rows, joins display/pool metadata
// (PodMetadata + a raw GpuHardwareMetrics latest-pool-name query + the
// pool-overview cache), computes lifetime/30d/7d/1d uptime percentages, and
// rolls up active-pod averages. These tests pin: admin-cookie auth gating,
// the empty envelope (zeroed summary, not NaN), the uptime arithmetic for a
// full day (heartbeats/expected-minutes capped at 100), active-pod detection
// from the cache, the active-first sort, average roll-ups over active pods
// only, and the 500 path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockUptimeFindMany,
  mockPodMetaFindMany,
  mockQueryRaw,
  mockReadPoolOverviewCache,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockUptimeFindMany: vi.fn(),
  mockPodMetaFindMany: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podUptimeDay: { findMany: mockUptimeFindMany },
    podMetadata: { findMany: mockPodMetaFindMany },
    $queryRaw: mockQueryRaw,
  },
}));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: mockReadPoolOverviewCache,
}));

import { GET } from "@/app/api/admin/uptime/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/uptime", {
    method: "GET",
    headers,
  });
}


/** A full, completed (not-today) day with a known heartbeat/expected ratio. */
function fullDay(subscriptionId: string, heartbeats: number) {
  // first→last span = 600 minutes; expected = min(1440, 600) = 600.
  const firstSeen = new Date("2026-01-01T00:00:00.000Z");
  const lastSeen = new Date("2026-01-01T10:00:00.000Z"); // 600 min later
  return {
    subscriptionId,
    date: "2026-01-01",
    heartbeats,
    firstSeen,
    lastSeen,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockUptimeFindMany.mockResolvedValue([]);
  mockPodMetaFindMany.mockResolvedValue([]);
  mockQueryRaw.mockResolvedValue([]);
  mockReadPoolOverviewCache.mockReturnValue(null);
});

describe("GET /api/admin/uptime — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockUptimeFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockUptimeFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/uptime — empty data", () => {
  it("returns a zeroed summary and empty pods (no NaN) when there are no records", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pods).toEqual([]);
    expect(body.summary).toEqual({
      totalPods: 0,
      activePods: 0,
      terminatedPods: 0,
      avgUptime1d: 0,
      avgUptime7d: 0,
      avgUptime30d: 0,
    });
    // Averages must be 0, never NaN, with no active pods to divide by.
    expect(Number.isNaN(body.summary.avgUptime1d)).toBe(false);
  });
});

describe("GET /api/admin/uptime — uptime computation", () => {
  it("computes a full-day uptime ratio capped sensibly", async () => {
    // 600 heartbeats over 600 expected minutes = 100%.
    mockUptimeFindMany.mockResolvedValue([fullDay("sub-a", 600)]);
    const body = await (await GET(makeRequest())).json();
    const pod = body.pods.find((p: { subscriptionId: string }) => p.subscriptionId === "sub-a");
    expect(pod.uptime.lifetime).toBe(100);
    expect(pod.totalDays).toBe(1);
    expect(pod.daily[0].uptimePercent).toBe(100);
    expect(pod.daily[0].heartbeats).toBe(600);
  });

  it("computes a partial-day ratio (300/600 = 50%)", async () => {
    mockUptimeFindMany.mockResolvedValue([fullDay("sub-b", 300)]);
    const body = await (await GET(makeRequest())).json();
    const pod = body.pods.find((p: { subscriptionId: string }) => p.subscriptionId === "sub-b");
    expect(pod.uptime.lifetime).toBe(50);
    expect(pod.daily[0].uptimePercent).toBe(50);
  });

  it("caps uptime at 100% when heartbeats exceed expected minutes", async () => {
    mockUptimeFindMany.mockResolvedValue([fullDay("sub-c", 5000)]);
    const body = await (await GET(makeRequest())).json();
    const pod = body.pods.find((p: { subscriptionId: string }) => p.subscriptionId === "sub-c");
    expect(pod.uptime.lifetime).toBe(100);
    expect(pod.daily[0].uptimePercent).toBe(100);
  });
});

describe("GET /api/admin/uptime — active detection, metadata, sort", () => {
  it("marks a pod active from the pool-overview cache and surfaces metadata", async () => {
    mockUptimeFindMany.mockResolvedValue([fullDay("sub-a", 600)]);
    mockPodMetaFindMany.mockResolvedValue([
      {
        subscriptionId: "sub-a",
        displayName: "My Pod",
        poolId: 1,
        stripeCustomerId: "cus_a",
        createdAt: new Date("2025-12-01T00:00:00.000Z"),
      },
    ]);
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [
        {
          name: "Pool One",
          pods: [
            {
              subscriptionId: "sub-a",
              podName: "podA",
              status: "running",
              customerEmail: "a@example.com",
            },
          ],
        },
      ],
    });

    const body = await (await GET(makeRequest())).json();
    const pod = body.pods.find((p: { subscriptionId: string }) => p.subscriptionId === "sub-a");
    expect(pod.isActive).toBe(true);
    expect(pod.displayName).toBe("My Pod");
    expect(pod.poolName).toBe("Pool One");
    expect(pod.stripeCustomerId).toBe("cus_a");
    expect(body.summary.activePods).toBe(1);
    expect(body.summary.terminatedPods).toBe(0);
  });

  it("includes an active pod from the cache even with no uptime records yet", async () => {
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [
        {
          name: "Pool X",
          pods: [
            {
              subscriptionId: "sub-new",
              podName: "fresh",
              status: "subscribed",
              customerEmail: null,
            },
          ],
        },
      ],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.pods).toHaveLength(1);
    expect(body.pods[0].subscriptionId).toBe("sub-new");
    expect(body.pods[0].isActive).toBe(true);
    expect(body.pods[0].totalDays).toBe(0);
    // No heartbeat data → 0% uptime, not NaN.
    expect(body.pods[0].uptime.lifetime).toBe(0);
  });

  it("sorts active pods ahead of terminated ones", async () => {
    mockUptimeFindMany.mockResolvedValue([
      fullDay("sub-dead", 600),
      fullDay("sub-live", 600),
    ]);
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [
        {
          name: "Pool",
          pods: [
            { subscriptionId: "sub-live", podName: "live", status: "active", customerEmail: null },
          ],
        },
      ],
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.pods[0].subscriptionId).toBe("sub-live");
    expect(body.pods[0].isActive).toBe(true);
    expect(body.pods[1].isActive).toBe(false);
  });

  it("averages 1d/7d/30d uptime over active pods only", async () => {
    // Two pods at 100%, one active one not. Avg over active = 100.
    mockUptimeFindMany.mockResolvedValue([
      fullDay("sub-live", 600),
      fullDay("sub-dead", 300),
    ]);
    mockReadPoolOverviewCache.mockReturnValue({
      pools: [
        {
          name: "Pool",
          pods: [
            { subscriptionId: "sub-live", podName: "live", status: "running", customerEmail: null },
          ],
        },
      ],
    });
    const body = await (await GET(makeRequest())).json();
    // lifetime is not in the 30/7/1d windows (2026-01-01 is older), so the
    // windowed averages are 0 — but importantly numeric, not NaN.
    expect(typeof body.summary.avgUptime30d).toBe("number");
    expect(Number.isNaN(body.summary.avgUptime30d)).toBe(false);
    expect(body.summary.activePods).toBe(1);
  });

  it("falls back to the raw-query pool name when not in the cache", async () => {
    mockUptimeFindMany.mockResolvedValue([fullDay("sub-q", 600)]);
    mockQueryRaw.mockResolvedValue([
      { subscriptionId: "sub-q", poolName: "RawPool" },
    ]);
    const body = await (await GET(makeRequest())).json();
    const pod = body.pods.find((p: { subscriptionId: string }) => p.subscriptionId === "sub-q");
    expect(pod.poolName).toBe("RawPool");
    expect(pod.isActive).toBe(false);
  });
});

describe("GET /api/admin/uptime — error handling", () => {
  it("returns 500 with the error message when a query throws", async () => {
    mockUptimeFindMany.mockRejectedValue(new Error("db exploded"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db exploded");
  });
});
