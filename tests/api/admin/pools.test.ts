/**
 * Tests for GET /api/admin/pools (src/app/api/admin/pools/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. The route is admin-cookie gated, serves
 * the pool-overview file cache when present (no live recompute), falls back to
 * computePoolOverview() on a cache miss, and always attaches the maintenance
 * pool-id list read from Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockReadPoolOverviewCache,
  mockComputePoolOverview,
  mockPoolOverrideFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
  mockComputePoolOverview: vi.fn(),
  mockPoolOverrideFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/pool-overview", () => ({
  readPoolOverviewCache: mockReadPoolOverviewCache,
  computePoolOverview: mockComputePoolOverview,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    poolSettingsOverride: { findMany: mockPoolOverrideFindMany },
  },
}));

import { GET } from "@/app/api/admin/pools/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/pools", { method: "GET", headers });
}

const CACHE = {
  clusters: [],
  pools: [{ id: 1, name: "pool-a" }],
  summary: { totalPools: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockReadPoolOverviewCache.mockReturnValue(CACHE);
  mockComputePoolOverview.mockResolvedValue(CACHE);
  mockPoolOverrideFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/pools — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockReadPoolOverviewCache).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockReadPoolOverviewCache).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/pools — cache served", () => {
  it("serves cached data without recomputing on a cache hit", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(CACHE);
    expect(mockComputePoolOverview).not.toHaveBeenCalled();
  });

  it("includes maintenance pool ids from the DB", async () => {
    mockPoolOverrideFindMany.mockResolvedValue([
      { gpuaasPoolId: 11 },
      { gpuaasPoolId: 22 },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.maintenancePoolIds).toEqual([11, 22]);
    expect(mockPoolOverrideFindMany).toHaveBeenCalledWith({
      where: { maintenance: true },
      select: { gpuaasPoolId: true },
    });
  });

  it("returns an empty maintenance list when no overrides exist", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.maintenancePoolIds).toEqual([]);
  });
});

describe("GET /api/admin/pools — cache miss", () => {
  it("computes live when the cache is empty", async () => {
    mockReadPoolOverviewCache.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(CACHE);
    expect(mockComputePoolOverview).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when live computation throws", async () => {
    mockReadPoolOverviewCache.mockReturnValue(null);
    mockComputePoolOverview.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("boom");
  });
});
