// Tests for src/app/api/instances/pool-subscription/[id]/start/route.ts (POST).
//
// Auth stack: getAuthenticatedCustomer (returns NextResponse on failure) +
// requirePermission (synchronous; gpu.provision; returns 403 NextResponse or
// null) + ownership check over getUnifiedInstances across allTeamIds.
//
// What we pin:
//   * auth failure NextResponse is returned verbatim (the 401/403 passthrough).
//   * 400 when the account has no team.
//   * RBAC: requirePermission("gpu.provision") denial short-circuits BEFORE
//     ownership lookup and startInstance.
//   * ownership: instance not in any team's unified instances → 404, no start.
//   * happy path calls startInstance once with the id; correct response shape.
//   * startInstance throws → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockStartInstance,
  mockGetInstanceCredentials,
  mockGetUnifiedInstances,
  mockLogGPUStarted,
  mockInstalledAppDeleteMany,
  mockPodFindFirst,
  mockInjectServerKeyIntoPod,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockStartInstance: vi.fn(),
  mockGetInstanceCredentials: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockLogGPUStarted: vi.fn(),
  mockInstalledAppDeleteMany: vi.fn(),
  mockPodFindFirst: vi.fn(),
  mockInjectServerKeyIntoPod: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/hostedai", () => ({
  startInstance: mockStartInstance,
  getInstanceCredentials: mockGetInstanceCredentials,
  getUnifiedInstances: mockGetUnifiedInstances,
}));
vi.mock("@/lib/activity", () => ({ logGPUStarted: mockLogGPUStarted }));
vi.mock("@/lib/ssh-keys", () => ({ injectServerKeyIntoPod: mockInjectServerKeyIntoPod }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    installedApp: { deleteMany: mockInstalledAppDeleteMany },
    podMetadata: { findFirst: mockPodFindFirst },
  },
}));

import { POST } from "@/app/api/instances/pool-subscription/[id]/start/route";

const ID = "i-abc";

const AUTH = {
  payload: { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" },
  allTeamIds: ["team_1"],
  accountId: "cus_operating",
};

function makeRequest() {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new Request(`http://localhost/api/instances/pool-subscription/${ID}/start`, {
    method: "POST",
    headers,
  }) as any;
}

const params = Promise.resolve({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(AUTH);
  mockRequirePermission.mockReturnValue(null); // allow by default
  mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: ID }] });
  mockStartInstance.mockResolvedValue({});
  mockGetInstanceCredentials.mockResolvedValue({});
  mockInjectServerKeyIntoPod.mockResolvedValue({ success: true });
  mockLogGPUStarted.mockResolvedValue(undefined);
  mockInstalledAppDeleteMany.mockResolvedValue({ count: 0 });
  mockPodFindFirst.mockResolvedValue(null);
});

describe("POST /api/instances/pool-subscription/[id]/start", () => {
  it("returns the auth-failure NextResponse verbatim (401 passthrough)", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(unauthorized);
    expect(mockStartInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, allTeamIds: [] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect(mockRequirePermission).not.toHaveBeenCalled();
    expect(mockStartInstance).not.toHaveBeenCalled();
  });

  it("RBAC: gpu.provision denial short-circuits before ownership + start", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denied);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(denied);
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
    expect(mockStartInstance).not.toHaveBeenCalled();
    // permission requested is gpu.provision
    expect(mockRequirePermission.mock.calls[0][1]).toBe("gpu.provision");
  });

  it("ownership: returns 404 when the instance is in no team's instances", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "other" }] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockStartInstance).not.toHaveBeenCalled();
  });

  it("happy path: calls startInstance once and returns the start envelope", async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockStartInstance).toHaveBeenCalledTimes(1);
    expect(mockStartInstance).toHaveBeenCalledWith(ID);
    expect(body).toMatchObject({ success: true, instance_id: ID });
  });

  // InstalledApp rows are written with the operating account, so a cleanup
  // scoped to the JWT customer silently clears nothing for a team session.
  it("clears installed apps for the operating account, not the JWT customer", async () => {
    await POST(makeRequest(), { params });
    expect(mockInstalledAppDeleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: ID, stripeCustomerId: "cus_operating" },
    });
  });

  it("returns 500 when startInstance throws", async () => {
    mockStartInstance.mockRejectedValue(new Error("HAI down"));
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(500);
  });
});
