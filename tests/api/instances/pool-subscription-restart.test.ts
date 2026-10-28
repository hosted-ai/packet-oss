// Tests for src/app/api/instances/pool-subscription/[id]/restart/route.ts (POST).
//
// Auth stack: getAuthenticatedCustomer + requirePermission (gpu.terminate —
// restart is treated as a lifecycle change) + ownership over getUnifiedInstances.
//
// What we pin:
//   * auth-failure NextResponse returned verbatim.
//   * 400 when no team.
//   * RBAC: gpu.terminate denial short-circuits before ownership + restart.
//   * ownership 404 → no restartInstance.
//   * happy path calls restartInstance once.
//   * restartInstance throws → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockRestartInstance,
  mockGetInstanceCredentials,
  mockGetUnifiedInstances,
  mockLogGPURestarted,
  mockInstalledAppDeleteMany,
  mockPodFindFirst,
  mockInjectServerKeyIntoPod,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockRestartInstance: vi.fn(),
  mockGetInstanceCredentials: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockLogGPURestarted: vi.fn(),
  mockInstalledAppDeleteMany: vi.fn(),
  mockPodFindFirst: vi.fn(),
  mockInjectServerKeyIntoPod: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/hostedai", () => ({
  restartInstance: mockRestartInstance,
  getInstanceCredentials: mockGetInstanceCredentials,
  getUnifiedInstances: mockGetUnifiedInstances,
}));
vi.mock("@/lib/activity", () => ({ logGPURestarted: mockLogGPURestarted }));
vi.mock("@/lib/ssh-keys", () => ({ injectServerKeyIntoPod: mockInjectServerKeyIntoPod }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    installedApp: { deleteMany: mockInstalledAppDeleteMany },
    podMetadata: { findFirst: mockPodFindFirst },
  },
}));

import { POST } from "@/app/api/instances/pool-subscription/[id]/restart/route";

const ID = "i-abc";
const AUTH = {
  payload: { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" },
  allTeamIds: ["team_1"],
  accountId: "cus_operating",
};

function makeRequest() {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new Request(`http://localhost/api/instances/pool-subscription/${ID}/restart`, {
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
  mockRestartInstance.mockResolvedValue({});
  mockGetInstanceCredentials.mockResolvedValue({});
  mockInjectServerKeyIntoPod.mockResolvedValue({ success: true });
  mockLogGPURestarted.mockResolvedValue(undefined);
  mockInstalledAppDeleteMany.mockResolvedValue({ count: 0 });
  mockPodFindFirst.mockResolvedValue(null);
});

describe("POST /api/instances/pool-subscription/[id]/restart", () => {
  it("returns the auth-failure NextResponse verbatim", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(unauthorized);
    expect(mockRestartInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, allTeamIds: [] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect(mockRestartInstance).not.toHaveBeenCalled();
  });

  it("RBAC: gpu.terminate denial short-circuits before ownership + restart", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denied);
    const res = await POST(makeRequest(), { params });
    expect(res).toBe(denied);
    expect(mockGetUnifiedInstances).not.toHaveBeenCalled();
    expect(mockRestartInstance).not.toHaveBeenCalled();
    expect(mockRequirePermission.mock.calls[0][1]).toBe("gpu.terminate");
  });

  it("ownership: returns 404 when the instance belongs to no team", async () => {
    mockGetUnifiedInstances.mockResolvedValue({ items: [{ id: "other" }] });
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockRestartInstance).not.toHaveBeenCalled();
  });

  it("happy path: calls restartInstance once and returns the restart envelope", async () => {
    const res = await POST(makeRequest(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockRestartInstance).toHaveBeenCalledTimes(1);
    expect(mockRestartInstance).toHaveBeenCalledWith(ID);
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

  it("returns 500 when restartInstance throws", async () => {
    mockRestartInstance.mockRejectedValue(new Error("HAI down"));
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(500);
  });
});
