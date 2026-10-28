// Tests for src/app/api/instances/pool-subscription/[id]/stop/route.ts (POST).
//
// Auth stack: getAuthenticatedCustomer + requirePermission (gpu.terminate —
// note stop uses terminate, not provision) + ownership over getUnifiedInstances.
//
// What we pin:
//   * auth-failure NextResponse returned verbatim.
//   * 400 when no team.
//   * RBAC: gpu.terminate denial short-circuits before ownership + stop.
//   * ownership 404 → no stopInstance.
//   * happy path calls stopInstance once.
//   * stopInstance throws → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockStopInstance,
  mockGetUnifiedInstances,
  mockLogGPUStopped,
  mockPodFindFirst,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockStopInstance: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockLogGPUStopped: vi.fn(),
  mockPodFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/hostedai", () => ({
  stopInstance: mockStopInstance,
  getUnifiedInstances: mockGetUnifiedInstances,
}));
vi.mock("@/lib/activity", () => ({ logGPUStopped: mockLogGPUStopped }));
vi.mock("@/lib/prisma", () => ({
  prisma: { podMetadata: { findFirst: mockPodFindFirst } },
}));

import { POST } from "@/app/api/instances/pool-subscription/[id]/stop/route";

const ID = "i-abc";
const AUTH = {
  payload: { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" },
  allTeamIds: ["team_1"],
  accountId: "cus_operating",
};

function makeRequest() {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new Request(`http://localhost/api/instances/pool-subscription/${ID}/stop`, {
    method: "POST",
    headers,
  }) as any;
}

const params = Promise.resolve({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(AUTH);
  mockRequirePermission.mockReturnValue(null);
  mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: ID }] });
  mockStopInstance.mockResolvedValue({});
  mockLogGPUStopped.mockResolvedValue(undefined);
  mockPodFindFirst.mockResolvedValue(null);
});

describe("POST /api/instances/pool-subscription/[id]/stop", () => {
  it("returns the auth-failure NextResponse verbatim", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(unauthorized);
    expect(mockStopInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, allTeamIds: [] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect(mockStopInstance).not.toHaveBeenCalled();
  });

  it("RBAC: gpu.terminate denial short-circuits before ownership + stop", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denied);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(denied);
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
    expect(mockStopInstance).not.toHaveBeenCalled();
    expect(mockRequirePermission.mock.calls[0][1]).toBe("gpu.terminate");
  });

  it("ownership: returns 404 when the instance belongs to no team", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "other" }] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockStopInstance).not.toHaveBeenCalled();
  });

  it("happy path: calls stopInstance once and returns the stop envelope", async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockStopInstance).toHaveBeenCalledTimes(1);
    expect(mockStopInstance).toHaveBeenCalledWith(ID);
    expect(body).toMatchObject({ success: true, instance_id: ID });
  });

  it("returns 500 when stopInstance throws", async () => {
    mockStopInstance.mockRejectedValue(new Error("HAI down"));
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(500);
  });
});
