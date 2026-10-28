/**
 * Tests for GET /api/admin/pods/history (src/app/api/admin/pods/history/route.ts).
 *
 * PA-287 — admin GPU-fleet coverage. Admin-cookie gated. Reads
 * gpuHardwareMetrics from Prisma filtered by time range + optional
 * subscriptionId/poolId, then buckets the points by interval and computes
 * per-subscription and overall summaries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: { gpuHardwareMetrics: { findMany: mockFindMany } },
}));

import { GET } from "@/app/api/admin/pods/history/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest(`http://localhost/api/admin/pods/history${query}`, {
    method: "GET",
    headers,
  });
}

function metric(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: "sub-1",
    poolId: 3,
    poolName: "pool-a",
    gpuUtilization: 50,
    memoryPercent: 40,
    temperature: 60,
    powerDraw: 200,
    timestamp: new Date("2026-06-12T00:00:00Z"),
    ...overrides,
  };
}

/** Returns the where clause passed to findMany. */
function whereClause(): Record<string, unknown> {
  return (mockFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> })?.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/pods/history — auth gating", () => {
  it("returns 401 when admin_session cookie is absent", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/pods/history — query filtering", () => {
  it("filters by timestamp gte using the default 24h window only", async () => {
    await GET(makeRequest());
    const where = whereClause();
    expect(where.timestamp).toHaveProperty("gte");
    expect(where.timestamp.gte).toBeInstanceOf(Date);
    expect(where).not.toHaveProperty("subscriptionId");
    expect(where).not.toHaveProperty("poolId");
  });

  it("forwards subscriptionId and parsed poolId to the where clause", async () => {
    await GET(makeRequest("?subscriptionId=sub-9&poolId=42"));
    const where = whereClause();
    expect(where.subscriptionId).toBe("sub-9");
    expect(where.poolId).toBe(42);
  });

  it("honours a custom hours window (earlier start time than default)", async () => {
    const before = Date.now() - 24 * 60 * 60 * 1000;
    await GET(makeRequest("?hours=1"));
    const where = whereClause();
    // a 1h window starts much later than the 24h default would
    expect((where.timestamp.gte as Date).getTime()).toBeGreaterThan(before);
  });
});

describe("GET /api/admin/pods/history — empty data", () => {
  it("returns a sane empty envelope when no metrics match", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual([]);
    expect(body.summary.totalMetrics).toBe(0);
    expect(body.summary.uniqueSubscriptions).toBe(0);
    expect(body.summary.timeRange).toHaveProperty("start");
    expect(body.summary.timeRange).toHaveProperty("end");
  });
});

describe("GET /api/admin/pods/history — aggregation", () => {
  it("buckets points and computes per-subscription + overall summaries", async () => {
    mockFindMany.mockResolvedValue([
      metric({ gpuUtilization: 40, timestamp: new Date("2026-06-12T00:00:00Z") }),
      metric({ gpuUtilization: 60, timestamp: new Date("2026-06-12T00:01:00Z") }),
    ]);
    const res = await GET(makeRequest("?interval=5"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.history).toHaveLength(1);
    const entry = body.history[0];
    expect(entry.subscriptionId).toBe("sub-1");
    expect(entry.poolId).toBe(3);
    expect(entry.poolName).toBe("pool-a");
    // both points land in one 5-minute bucket -> averaged to 50
    expect(entry.dataPoints).toHaveLength(1);
    expect(entry.dataPoints[0].gpuUtilization).toBe(50);
    expect(entry.summary.avgUtilization).toBe(50);
    expect(entry.summary.maxUtilization).toBe(60);
    expect(entry.summary.totalDataPoints).toBe(2);

    expect(body.summary.totalMetrics).toBe(2);
    expect(body.summary.uniqueSubscriptions).toBe(1);
    expect(body.summary.avgUtilization).toBe(50);
  });

  it("separates metrics across distinct subscriptions", async () => {
    mockFindMany.mockResolvedValue([
      metric({ subscriptionId: "sub-1" }),
      metric({ subscriptionId: "sub-2" }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.history).toHaveLength(2);
    expect(body.summary.uniqueSubscriptions).toBe(2);
  });
});

describe("GET /api/admin/pods/history — errors", () => {
  it("returns 500 when the query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db error"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("db error");
  });
});
