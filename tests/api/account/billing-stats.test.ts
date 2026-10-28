// Tests for src/app/api/account/billing-stats/route.ts (PA-287).
//
// GET aggregates the current-month hosted.ai billing summary into the shape the
// dashboard renders. Auth uses getAuthenticatedCustomer (returns a NextResponse
// on failure) + requirePermission("billing.view"). The route must never NaN:
// every numeric field defaults to 0, and a hosted.ai failure degrades to zeros
// rather than 500.
//
// Pinned contracts:
//   * Auth NextResponse passthrough (401/403/404 from getAuthenticatedCustomer)
//   * PA-202 gate: billing.view denial returned verbatim, no HAI call
//   * No teamId -> zeroed summary, billing API not called
//   * Aggregation: pool_hours + instance hours, total_cost, storage rows summed
//   * Empty / missing summary fields -> zeros, not NaN
//   * total_hours preferred over the pool+instance fallback when present
//   * hosted.ai throw -> zeros (still 200), stoppedInstanceRatePercent surfaced
//   * Top-level (outer) throw -> 500
//
// Dependencies are mocked at the import boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockGetTeamBillingSummaryV2,
  mockFormatBillingDatetime,
  mockGetStoppedInstanceRatePercent,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockGetTeamBillingSummaryV2: vi.fn(),
  mockFormatBillingDatetime: vi.fn(),
  mockGetStoppedInstanceRatePercent: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({
  requirePermission: mockRequirePermission,
}));
vi.mock("@/lib/hostedai", () => ({
  getTeamBillingSummaryV2: mockGetTeamBillingSummaryV2,
  formatBillingDatetime: mockFormatBillingDatetime,
}));
vi.mock("@/lib/pricing", () => ({
  getStoppedInstanceRatePercent: mockGetStoppedInstanceRatePercent,
}));

import { GET } from "@/app/api/account/billing-stats/route";

const AUTH = {
  payload: { customerId: "cus_jwt", email: "stats@example.com" },
  customer: { id: "cus_op", email: "stats@example.com" },
  teamId: "team_1",
  allTeamIds: ["team_1"],
  accountId: "cus_op",
};

function makeRequest() {
  return new NextRequest("http://localhost/api/account/billing-stats", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(AUTH);
  mockRequirePermission.mockReturnValue(null); // allowed by default
  mockFormatBillingDatetime.mockImplementation((d: Date) => d.toISOString());
  mockGetStoppedInstanceRatePercent.mockReturnValue(50);
  mockGetTeamBillingSummaryV2.mockResolvedValue({
    total_cost: 12.5,
    total_hours: 30,
    gpuaas_summary: [{ pool_hours: 10 }, { pool_hours: 5 }],
    instance_billing_summary: [{ hours: 8 }],
    shared_storage_billing_summary: [
      { storage_name: "vol-a", cost: 2, hours: 4 },
    ],
  });
});

describe("GET /api/account/billing-stats — auth + gate", () => {
  it("returns the auth NextResponse verbatim when getAuthenticatedCustomer fails (401)", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);

    const res = await GET(makeRequest());

    expect(res).toBe(unauthorized);
    expect(mockRequirePermission).not.toHaveBeenCalled();
    expect(mockGetTeamBillingSummaryV2).not.toHaveBeenCalled();
  });

  it("returns the gate denial verbatim when billing.view is denied", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denied);

    const res = await GET(makeRequest());

    expect(res).toBe(denied);
    expect(mockGetTeamBillingSummaryV2).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(AUTH, "billing.view", expect.anything());
  });

  it("returns a zeroed summary and skips the billing API when there is no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, teamId: undefined });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      totalCost: 0,
      gpuHours: 0,
      periodStart: null,
      periodEnd: null,
    });
    expect(mockGetTeamBillingSummaryV2).not.toHaveBeenCalled();
  });
});

describe("GET /api/account/billing-stats — aggregation", () => {
  it("sums pool + instance hours, total cost, and storage rows", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalCost).toBe(12.5);
    // total_hours present -> used directly (30), not the pool+instance fallback.
    expect(body.gpuHours).toBe(30);
    expect(body.storageCost).toBe(2);
    expect(body.storageHours).toBe(4);
    expect(body.storageVolumes).toEqual([{ name: "vol-a", hours: 4, cost: 2 }]);
    expect(body.stoppedInstanceRatePercent).toBe(50);
    expect(typeof body.periodStart).toBe("string");
    expect(typeof body.periodEnd).toBe("string");
  });

  it("falls back to pool+instance hours when total_hours is absent", async () => {
    mockGetTeamBillingSummaryV2.mockResolvedValue({
      total_cost: 1,
      gpuaas_summary: [{ pool_hours: 10 }, { pool_hours: 5 }],
      instance_billing_summary: [{ hours: 8 }],
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    // 15 pool + 8 instance = 23.
    expect(body.gpuHours).toBe(23);
  });

  it("uses top-level pool_hours / instance_hours when the summary arrays are empty", async () => {
    mockGetTeamBillingSummaryV2.mockResolvedValue({
      total_cost: 1,
      pool_hours: 7,
      instance_hours: 3,
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.gpuHours).toBe(10);
  });

  it("queries the billing summary for the resolved teamId", async () => {
    await GET(makeRequest());
    expect(mockGetTeamBillingSummaryV2).toHaveBeenCalledTimes(1);
    expect(mockGetTeamBillingSummaryV2.mock.calls[0][0]).toBe("team_1");
  });
});

describe("GET /api/account/billing-stats — empty + error handling", () => {
  it("zeros every numeric field (never NaN) for an empty summary", async () => {
    mockGetTeamBillingSummaryV2.mockResolvedValue({});

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    for (const key of ["totalCost", "gpuHours", "storageCost", "storageHours"]) {
      expect(body[key]).toBe(0);
      expect(Number.isNaN(body[key])).toBe(false);
    }
    expect(body.storageVolumes).toEqual([]);
  });

  it("coerces non-numeric summary values to 0 rather than NaN", async () => {
    mockGetTeamBillingSummaryV2.mockResolvedValue({
      total_cost: "not-a-number",
      total_hours: null,
      gpuaas_summary: [{ pool_hours: "x" }],
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.totalCost).toBe(0);
    expect(body.gpuHours).toBe(0);
    expect(Number.isNaN(body.gpuHours)).toBe(false);
  });

  it("degrades to zeros (still 200) when the billing summary API throws", async () => {
    mockGetTeamBillingSummaryV2.mockRejectedValue(new Error("HAI 503"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalCost).toBe(0);
    expect(body.gpuHours).toBe(0);
    expect(body.stoppedInstanceRatePercent).toBe(50);
  });

  it("returns 500 when an outer dependency throws (rate-percent lookup)", async () => {
    mockGetStoppedInstanceRatePercent.mockImplementation(() => {
      throw new Error("config boom");
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to get billing stats");
  });
});
