// Tests for src/app/api/instances/metrics-history/route.ts (PA-287).
//
// GET returns time-series GPU metric history. Auth is the customer-bearer
// stack, and PA-175 scopes the prisma query to the OPERATING team
// (resolveOperatingContext.accountId) so an invited member sees the team's
// history, not their own empty one.
//
// What we pin:
//   * Bearer auth (missing/invalid -> 401), no ctx/DB call on the unauth path.
//   * resolveOperatingContext null -> 404 (no DB read).
//   * The prisma query is scoped to ctx.accountId (PA-175 no-leak) — a caller
//     cannot pull another account's history.
//   * Query params: hours clamps to the 168h ceiling and feeds the where range;
//     subscriptionId filter is forwarded.
//   * Happy path: groups points by subscription and computes summary stats
//     (avg/max). Interval aggregation buckets points.
//   * Empty history -> empty subscriptions array, totalDataPoints 0 (no crash).
//   * Thrown error -> 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifyCustomerToken, mockResolveOperatingContext, mockFindMany } =
  vi.hoisted(() => ({
    mockVerifyCustomerToken: vi.fn(),
    mockResolveOperatingContext: vi.fn(),
    mockFindMany: vi.fn(),
  }));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { gpuHardwareMetrics: { findMany: mockFindMany } },
}));

import { GET } from "@/app/api/instances/metrics-history/route";

const TOKEN = "Bearer valid.jwt.token";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com" };
const CTX = {
  customer: { id: "cus_op", email: "alice@example.com" },
  accountId: "cus_op",
  allTeamIds: ["team_1"],
  allCustomerIds: ["cus_op"],
};

function makeRequest(query = "", authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", TOKEN);
  return new NextRequest(
    `http://localhost/api/instances/metrics-history${query}`,
    { method: "GET", headers },
  );
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    subscriptionId: "sub-1",
    timestamp: new Date("2026-06-11T00:00:00.000Z"),
    gpuUtilization: 50,
    memoryPercent: 40,
    temperature: 60,
    powerDraw: 100,
    cpuPercent: 20,
    systemMemPercent: 30,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/instances/metrics-history — auth + scoping", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await GET(makeRequest("", false));
    expect(res.status).toBe(401);
    expect(mockResolveOperatingContext).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockResolveOperatingContext).not.toHaveBeenCalled();
  });

  it("returns 404 when operating context can't be resolved (no DB read)", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("PA-175: scopes the query to ctx.accountId, not the JWT customer id", async () => {
    await GET(makeRequest());
    const arg = mockFindMany.mock.calls[0][0];
    // accountId from the resolver, NOT payload.customerId — this is the no-leak.
    expect(arg.where.stripeCustomerId).toBe("cus_op");
    expect(arg.where.stripeCustomerId).not.toBe("cus_jwt");
  });
});

describe("GET /api/instances/metrics-history — query params", () => {
  it("clamps hours to the 168h ceiling", async () => {
    const res = await GET(makeRequest("?hours=999"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeRange.hours).toBe(168);
  });

  it("forwards the subscriptionId filter into the where clause", async () => {
    await GET(makeRequest("?subscriptionId=sub-42"));
    const arg = mockFindMany.mock.calls[0][0];
    expect(arg.where.subscriptionId).toBe("sub-42");
  });

  it("omits the subscriptionId filter when not provided", async () => {
    await GET(makeRequest());
    const arg = mockFindMany.mock.calls[0][0];
    expect(arg.where.subscriptionId).toBeUndefined();
  });
});

describe("GET /api/instances/metrics-history — shaping", () => {
  it("groups by subscription and computes summary stats", async () => {
    mockFindMany.mockResolvedValue([
      row({ gpuUtilization: 40, temperature: 50, powerDraw: 80 }),
      row({ gpuUtilization: 60, temperature: 70, powerDraw: 120 }),
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalDataPoints).toBe(2);
    expect(body.subscriptions).toHaveLength(1);
    const s = body.subscriptions[0];
    expect(s.subscriptionId).toBe("sub-1");
    expect(s.summary.dataPoints).toBe(2);
    expect(s.summary.avgGpuUtilization).toBe(50);
    expect(s.summary.maxTemperature).toBe(70);
    expect(s.summary.avgPowerDraw).toBe(100);
    expect(s.data).toHaveLength(2);
  });

  it("aggregates into buckets when interval is provided", async () => {
    // Two points 1 minute apart, bucketed at 60-minute interval -> 1 bucket.
    mockFindMany.mockResolvedValue([
      row({ timestamp: new Date("2026-06-11T00:00:00.000Z"), gpuUtilization: 40 }),
      row({ timestamp: new Date("2026-06-11T00:01:00.000Z"), gpuUtilization: 60 }),
    ]);

    const res = await GET(makeRequest("?interval=60"));
    const body = await res.json();
    const s = body.subscriptions[0];
    expect(s.data).toHaveLength(1);
    expect(s.data[0].gpuUtilization).toBe(50); // averaged within the bucket
  });

  it("handles null cpu/system metrics in the summary", async () => {
    mockFindMany.mockResolvedValue([
      row({ cpuPercent: null, systemMemPercent: null }),
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    const s = body.subscriptions[0];
    expect(s.summary.avgCpuPercent).toBeNull();
    expect(s.summary.avgSystemMemPercent).toBeNull();
  });

  it("returns an empty envelope when there is no history (no crash)", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscriptions).toEqual([]);
    expect(body.totalDataPoints).toBe(0);
  });

  it("returns 500 when the DB read throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
