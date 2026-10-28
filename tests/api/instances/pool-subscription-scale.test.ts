// Tests for src/app/api/instances/pool-subscription/[id]/scale/route.ts (POST).
//
// Auth stack: bearer (verifyCustomerToken) + resolveOperatingContext +
// gatePermission (gpu.provision). Then validation: vgpus >= 1, vgpus <= 1
// (multi-GPU rejected), pool_id required. Mutation: scalePoolSubscription.
//
// What we pin:
//   * missing/invalid token → 401.
//   * 404 when ctx unresolved; 400 when no team.
//   * PA-175: gatePermission gets ctx.customer.email + gpu.provision.
//   * RBAC: denial short-circuits before validation + scalePoolSubscription.
//   * validation: vgpus < 1 → 400; vgpus > 1 → 400; missing pool_id → 400 —
//     and NO scalePoolSubscription call on any invalid input.
//   * happy path calls scalePoolSubscription with the right args.
//   * HAI throw → 500.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockScalePoolSubscription,
  mockGetPoolSubscriptions,
  mockLogGPUScaled,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockScalePoolSubscription: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockLogGPUScaled: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/hostedai", () => ({
  scalePoolSubscription: mockScalePoolSubscription,
  getPoolSubscriptions: mockGetPoolSubscriptions,
}));
vi.mock("@/lib/activity", () => ({ logGPUScaled: mockLogGPUScaled }));

import { POST } from "@/app/api/instances/pool-subscription/[id]/scale/route";

const SUB_ID = "555";
const PAYLOAD = { customerId: "cus_jwt", email: "alice@example.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team_1",
  customer: { id: "cus_op", email: "alice@example.com", metadata: { hostedai_team_id: "team_1" } },
};

function makeRequest({ auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${SUB_ID}/scale`, init);
}

const params = Promise.resolve({ id: SUB_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null);
  mockGetPoolSubscriptions.mockResolvedValue([
    { id: SUB_ID, pool_id: 7, pool_name: "Pool A", per_pod_info: { vgpu_count: 1 } },
  ]);
  mockScalePoolSubscription.mockResolvedValue({ subscription_id: "new-sub" });
  mockLogGPUScaled.mockResolvedValue(undefined);
});

const VALID_BODY = { vgpus: 1, pool_id: 7 };

describe("POST /api/instances/pool-subscription/[id]/scale", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest({ auth: null, body: VALID_BODY }), { params });
    expect(res.status).toBe(401);
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the operating context can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(400);
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("PA-175: passes ctx.customer.email + gpu.provision to gatePermission", async () => {
    await POST(makeRequest({ body: VALID_BODY }), { params });
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.permission).toBe("gpu.provision");
    expect(call.accountId).toBe("cus_op");
  });

  it("RBAC: gate denial short-circuits before validation + scale", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    // even with an invalid body, the gate denial wins because it runs first
    const res = await POST(makeRequest({ body: { vgpus: 5 } }), { params });
    expect(res).toBe(denied);
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 when vgpus < 1 (no scale call)", async () => {
    const res = await POST(makeRequest({ body: { vgpus: 0, pool_id: 7 } }), { params });
    expect(res.status).toBe(400);
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 for multi-GPU scaling (vgpus > 1)", async () => {
    const res = await POST(makeRequest({ body: { vgpus: 2, pool_id: 7 } }), { params });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("Multi-GPU");
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 when pool_id is missing", async () => {
    const res = await POST(makeRequest({ body: { vgpus: 1 } }), { params });
    expect(res.status).toBe(400);
    expect(mockScalePoolSubscription).not.toHaveBeenCalled();
  });

  it("happy path: calls scalePoolSubscription with the right args", async () => {
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, subscription_id: "new-sub" });
    expect(mockScalePoolSubscription).toHaveBeenCalledTimes(1);
    const arg = mockScalePoolSubscription.mock.calls[0][0];
    expect(arg).toMatchObject({ subscriptionId: SUB_ID, poolId: 7, teamId: "team_1", vgpus: 1 });
  });

  it("returns 500 when scalePoolSubscription throws", async () => {
    mockScalePoolSubscription.mockRejectedValue(new Error("HAI down"));
    const res = await POST(makeRequest({ body: VALID_BODY }), { params });
    expect(res.status).toBe(500);
  });
});
