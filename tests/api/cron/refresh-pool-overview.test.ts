// Tests for src/app/api/cron/refresh-pool-overview/route.ts.
//
// Every-2-minutes cron that recomputes the pool overview disk cache. The
// load-bearing contract is the stale-cache guard: when a GPUaaS API call
// actually errors, computed data is unreliable, and blindly writing it would
// clobber good cache with a partial result. The guard must NOT trip on a
// legitimate pod-count drop (e.g. a real team deletion) just because it's a
// big percentage of a small pool — that was PA-633. We pin:
//   * Auth gating
//   * Normal path: compute (seeded with existing cache) → write → summary
//   * Guard: hadApiFailures keeps the existing cache (no write)
//   * PA-633 regression: a legitimate large drop with no API failures writes through
//   * No existing cache to preserve → always writes, even if hadApiFailures
//   * Compute failure → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockComputePoolOverview,
  mockWritePoolOverviewCache,
  mockReadPoolOverviewCache,
} = vi.hoisted(() => ({
  mockComputePoolOverview: vi.fn(),
  mockWritePoolOverviewCache: vi.fn(),
  mockReadPoolOverviewCache: vi.fn(),
}));

vi.mock("@/lib/pool-overview", () => ({
  computePoolOverview: mockComputePoolOverview,
  writePoolOverviewCache: mockWritePoolOverviewCache,
  readPoolOverviewCache: mockReadPoolOverviewCache,
}));

import { GET } from "@/app/api/cron/refresh-pool-overview/route";

const SECRET = "cron-pool-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/refresh-pool-overview", {
    method: "GET",
    headers,
  });
}

function overview(activePods: number, poolCount = 2, hadApiFailures = false) {
  return {
    pools: Array.from({ length: poolCount }, (_, i) => ({ id: `pool-${i}` })),
    summary: { activePods },
    hadApiFailures,
  };
}

describe("GET /api/cron/refresh-pool-overview", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockReadPoolOverviewCache.mockReturnValue(null);
    mockComputePoolOverview.mockResolvedValue(overview(10));
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without computing", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockComputePoolOverview).not.toHaveBeenCalled();
    expect(mockWritePoolOverviewCache).not.toHaveBeenCalled();
  });

  it("computes (seeded with existing cache) and writes on the normal path", async () => {
    const existing = overview(9);
    mockReadPoolOverviewCache.mockReturnValue(existing);
    const fresh = overview(10, 3);
    mockComputePoolOverview.mockResolvedValue(fresh);

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockComputePoolOverview).toHaveBeenCalledWith(existing);
    expect(mockWritePoolOverviewCache).toHaveBeenCalledWith(fresh);
    expect(body.ok).toBe(true);
    expect(body.pools).toBe(3);
    expect(body.activePods).toBe(10);
    expect(body.keptExistingCache).toBeUndefined();
  });

  it("keeps the existing cache when a GPUaaS API call errored this run", async () => {
    mockReadPoolOverviewCache.mockReturnValue(overview(100));
    mockComputePoolOverview.mockResolvedValue(overview(40, 2, true)); // errored, count unreliable

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockWritePoolOverviewCache).not.toHaveBeenCalled();
    expect(body.keptExistingCache).toBe(true);
    expect(body.existingActivePods).toBe(100);
  });

  it("PA-633: writes through a legitimate large drop with no API failures (a real deletion, not an outage)", async () => {
    mockReadPoolOverviewCache.mockReturnValue(overview(100));
    const fresh = overview(0); // a real 100% drop, e.g. the pool's only team was deleted
    mockComputePoolOverview.mockResolvedValue(fresh);

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockWritePoolOverviewCache).toHaveBeenCalledWith(fresh);
    expect(body.keptExistingCache).toBeUndefined();
    expect(body.activePods).toBe(0);
  });

  it("writes through even with API failures when there is no existing cache to preserve", async () => {
    mockReadPoolOverviewCache.mockReturnValue(null);
    const fresh = overview(0, 2, true);
    mockComputePoolOverview.mockResolvedValue(fresh);

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockWritePoolOverviewCache).toHaveBeenCalledWith(fresh);
    expect(body.ok).toBe(true);
  });

  it("returns 500 when computePoolOverview throws", async () => {
    mockComputePoolOverview.mockRejectedValue(new Error("GPUaaS unreachable"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Cron failed");
    expect(body.message).toBe("GPUaaS unreachable");
    expect(mockWritePoolOverviewCache).not.toHaveBeenCalled();
  });
});
