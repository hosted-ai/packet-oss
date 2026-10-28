// Tests for src/app/api/instances/pool-subscription/[id]/route.ts — pod
// metadata read/update + pool-subscription / unified-instance termination.
//
// Auth stack: bearer token (verifyCustomerToken) + resolveOperatingContext
// (PA-175 operating account) + gatePermission on DELETE (gpu.terminate).
//
// What we pin:
//   * GET/PATCH/DELETE: missing/invalid token → 401 (no Prisma/HAI touched).
//   * GET reads metadata by subscriptionId vs instanceId (id-shape branch).
//   * PATCH type-validates displayName/notes → 400, and 404 when ctx is null.
//   * DELETE PA-175: resolveOperatingContext runs and gatePermission is
//     consulted BEFORE any HAI mutation; denial short-circuits (no unsubscribe).
//   * DELETE 400 when the operating account has no team.
//   * DELETE legacy happy path calls unsubscribeFromPool exactly once.
//   * HAI throw → 500, no partial leak.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGenerateCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGetStripe,
  mockUnsubscribeFromPool,
  mockGetPoolSubscriptions,
  mockDeleteInstance,
  mockGetUnifiedInstanceDetail,
  mockLogGPUTerminated,
  mockSendGpuTerminatedEmail,
  mockCacheCustomer,
  mockPodFindFirst,
  mockPodFindUnique,
  mockPodDelete,
  mockCacheFindUnique,
  mockCacheUpdate,
  mockPodUpsert,
  mockPodUpdate,
  mockWalletTxnCreate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGenerateCustomerToken: vi.fn(() => "dash.token"),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGetStripe: vi.fn(),
  mockUnsubscribeFromPool: vi.fn(),
  mockGetPoolSubscriptions: vi.fn(),
  mockDeleteInstance: vi.fn(),
  mockGetUnifiedInstanceDetail: vi.fn(),
  mockLogGPUTerminated: vi.fn(),
  mockSendGpuTerminatedEmail: vi.fn(),
  mockCacheCustomer: vi.fn(),
  mockPodFindFirst: vi.fn(),
  mockPodFindUnique: vi.fn(),
  mockPodDelete: vi.fn(),
  mockCacheFindUnique: vi.fn(),
  mockCacheUpdate: vi.fn(),
  mockPodUpsert: vi.fn(),
  mockPodUpdate: vi.fn(),
  mockWalletTxnCreate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: { email: string; customerId: string }) =>
    mockGenerateCustomerToken(o.email, o.customerId),
  ),
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({
  unsubscribeFromPool: mockUnsubscribeFromPool,
  getPoolSubscriptions: mockGetPoolSubscriptions,
  deleteInstance: mockDeleteInstance,
  getUnifiedInstanceDetail: mockGetUnifiedInstanceDetail,
}));
vi.mock("@/lib/activity", () => ({ logGPUTerminated: mockLogGPUTerminated }));
vi.mock("@/lib/email", () => ({ sendGpuTerminatedEmail: mockSendGpuTerminatedEmail }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: {
      findFirst: mockPodFindFirst,
      findUnique: mockPodFindUnique,
      delete: mockPodDelete,
      upsert: mockPodUpsert,
      update: mockPodUpdate,
    },
    customerCache: {
      findUnique: mockCacheFindUnique,
      update: mockCacheUpdate,
    },
    walletTransaction: {
      create: mockWalletTxnCreate,
    },
  },
}));

import { GET, PATCH, DELETE } from "@/app/api/instances/pool-subscription/[id]/route";

const SUB_ID = "12345";
const INSTANCE_ID = "i-abcdef01-2345-6789-abcd-ef0123456789";

const PAYLOAD = {
  customerId: "cus_jwt",
  email: "Alice@example.com",
  userId: "user_alice",
  activeAccountId: undefined,
};

const CTX = {
  accountId: "cus_op",
  teamId: "team_1",
  customer: {
    id: "cus_op",
    email: "alice@example.com",
    name: "Alice",
    metadata: { hostedai_team_id: "team_1" },
  },
};

function makeRequest(
  method: "GET" | "PATCH" | "DELETE",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/instances/pool-subscription/${SUB_ID}`, init);
}

const params = (id: string = SUB_ID) => Promise.resolve({ id });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGatePermission.mockResolvedValue(null); // allow by default
  mockGetStripe.mockResolvedValue({
    customers: { createBalanceTransaction: vi.fn().mockResolvedValue({}) },
  });
  // Fire-and-forget side effects must resolve, not return undefined.
  mockCacheCustomer.mockResolvedValue(undefined);
  mockLogGPUTerminated.mockResolvedValue(undefined);
  mockSendGpuTerminatedEmail.mockResolvedValue(undefined);
  mockGetPoolSubscriptions.mockResolvedValue([]);
  mockUnsubscribeFromPool.mockResolvedValue({});
  mockPodFindFirst.mockResolvedValue(null);
  mockPodFindUnique.mockResolvedValue(null);
  mockPodDelete.mockResolvedValue({});
  mockPodUpsert.mockResolvedValue({ displayName: null, notes: null });
  mockCacheFindUnique.mockResolvedValue(null);
  mockWalletTxnCreate.mockResolvedValue({});
});

describe("GET /api/instances/pool-subscription/[id]", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await GET(makeRequest("GET", { auth: null }), { params: params() });
    expect(res.status).toBe(401);
    expect(mockPodFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("GET"), { params: params() });
    expect(res.status).toBe(401);
  });

  it("reads metadata by subscriptionId for a numeric id", async () => {
    mockPodFindUnique.mockResolvedValue({ displayName: "My Pod", notes: "hi", instanceId: "i-x" });
    const res = await GET(makeRequest("GET"), { params: params(SUB_ID) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockPodFindUnique).toHaveBeenCalledWith({ where: { subscriptionId: SUB_ID } });
    expect(body.subscriptionId).toBe(SUB_ID);
    expect(body.displayName).toBe("My Pod");
  });

  it("reads metadata by instanceId for an i-uuid id", async () => {
    mockPodFindFirst.mockResolvedValue({ subscriptionId: SUB_ID, displayName: null, notes: null });
    const res = await GET(makeRequest("GET"), { params: params(INSTANCE_ID) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockPodFindFirst).toHaveBeenCalledWith({ where: { instanceId: INSTANCE_ID } });
    expect(body.instanceId).toBe(INSTANCE_ID);
    expect(body.subscriptionId).toBe(SUB_ID);
  });

  it("returns nulls when no metadata row exists", async () => {
    const res = await GET(makeRequest("GET"), { params: params(SUB_ID) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.displayName).toBeNull();
    expect(body.notes).toBeNull();
  });

  it("returns 500 when the metadata read throws", async () => {
    mockPodFindUnique.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"), { params: params(SUB_ID) });
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/instances/pool-subscription/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await PATCH(makeRequest("PATCH", { auth: null, body: {} }), { params: params() });
    expect(res.status).toBe(401);
    expect(mockPodUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-string displayName with 400", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { body: { displayName: 42 } }),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockPodUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-string notes with 400", async () => {
    const res = await PATCH(
      makeRequest("PATCH", { body: { notes: { x: 1 } } }),
      { params: params() },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the operating context can't be resolved (legacy id)", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest("PATCH", { body: { displayName: "x" } }),
      { params: params(SUB_ID) },
    );
    expect(res.status).toBe(404);
    expect(mockPodUpsert).not.toHaveBeenCalled();
  });

  it("PA-175: upsert create is scoped to the operating accountId", async () => {
    mockPodUpsert.mockResolvedValue({ displayName: "Renamed", notes: null });
    const res = await PATCH(
      makeRequest("PATCH", { body: { displayName: "Renamed" } }),
      { params: params(SUB_ID) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const call = mockPodUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ subscriptionId: SUB_ID });
    expect(call.create.stripeCustomerId).toBe("cus_op");
  });

  it("updates the existing row by id for an instance id", async () => {
    mockPodFindFirst.mockResolvedValue({ id: "row1" });
    mockPodUpdate.mockResolvedValue({ displayName: "New", notes: "n" });
    const res = await PATCH(
      makeRequest("PATCH", { body: { displayName: "New", notes: "n" } }),
      { params: params(INSTANCE_ID) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.instanceId).toBe(INSTANCE_ID);
    expect(mockPodUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row1" } }),
    );
    // No resolveOperatingContext / upsert needed on the instance-update path.
    expect(mockPodUpsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/instances/pool-subscription/[id]", () => {
  it("returns 401 with no token", async () => {
    const res = await DELETE(makeRequest("DELETE", { auth: null }), { params: params() });
    expect(res.status).toBe(401);
    expect(mockUnsubscribeFromPool).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params: params() });
    expect(res.status).toBe(401);
  });

  it("returns 404 when operating context can't be resolved (no leak)", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await DELETE(makeRequest("DELETE"), { params: params() });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockUnsubscribeFromPool).not.toHaveBeenCalled();
  });

  it("returns 400 when the operating account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      customer: { ...CTX.customer, metadata: {} },
      teamId: null,
    });
    const res = await DELETE(makeRequest("DELETE"), { params: params() });
    expect(res.status).toBe(400);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockUnsubscribeFromPool).not.toHaveBeenCalled();
  });

  it("PA-175: passes ctx.customer.email (not null) and gpu.terminate to gatePermission", async () => {
    await DELETE(makeRequest("DELETE"), { params: params() });
    expect(mockGatePermission).toHaveBeenCalledTimes(1);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.customerEmail).not.toBeNull();
    expect(call.accountId).toBe("cus_op");
    expect(call.permission).toBe("gpu.terminate");
  });

  it("RBAC: returns the gate denial verbatim and does NOT unsubscribe", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await DELETE(makeRequest("DELETE"), { params: params() });
    expect(res).toBe(denied);
    expect(mockUnsubscribeFromPool).not.toHaveBeenCalled();
    expect(mockDeleteInstance).not.toHaveBeenCalled();
  });

  it("legacy: calls unsubscribeFromPool exactly once on success", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: SUB_ID, pool_name: "Pool A", pool_id: 7 },
    ]);
    const res = await DELETE(makeRequest("DELETE"), { params: params(SUB_ID) });
    expect(res.status).toBe(200);
    expect(mockUnsubscribeFromPool).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeFromPool).toHaveBeenCalledWith(SUB_ID, "team_1", 7);
    expect(mockDeleteInstance).not.toHaveBeenCalled();
  });

  it("HAI 2.2: deletes the unified instance and skips legacy unsubscribe", async () => {
    mockDeleteInstance.mockResolvedValue({});
    const res = await DELETE(makeRequest("DELETE"), { params: params(INSTANCE_ID) });
    expect(res.status).toBe(200);
    expect(mockDeleteInstance).toHaveBeenCalledWith(INSTANCE_ID);
    expect(mockUnsubscribeFromPool).not.toHaveBeenCalled();
  });

  it("returns 500 when unsubscribeFromPool throws (no partial success)", async () => {
    mockUnsubscribeFromPool.mockRejectedValue(new Error("HAI 500"));
    const res = await DELETE(makeRequest("DELETE"), { params: params(SUB_ID) });
    expect(res.status).toBe(500);
  });

  // PA-37: the Stripe balance credit/charge on early termination must be
  // mirrored into WalletTransaction — that table is what node revenue
  // (investor stats/payouts) sums, so a Stripe-only adjustment left revenue
  // permanently overstated by every credited-back charge.
  describe("PA-37: billing reconciliation mirrors into WalletTransaction", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("legacy: early termination writes a negative refund row sized to the unused time", async () => {
      const prepaidUntil = new Date("2026-01-01T00:30:00.000Z");
      vi.setSystemTime(new Date("2026-01-01T00:20:00.000Z")); // 10 min unused of the 30-min period
      mockPodFindUnique.mockResolvedValue({
        displayName: null,
        prepaidUntil,
        hourlyRateCents: 1200,
        poolId: "7",
      });
      mockGetPoolSubscriptions.mockResolvedValue([{ id: SUB_ID, pool_name: "Pool A", pool_id: 7 }]);

      const res = await DELETE(makeRequest("DELETE"), { params: params(SUB_ID) });

      expect(res.status).toBe(200);
      expect(mockWalletTxnCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stripeCustomerId: "cus_op",
          teamId: "team_1",
          type: "refund",
          amountCents: -200, // 10/60 hr * 1200c
          subscriptionId: SUB_ID,
          poolId: 7,
          billingMinutes: 10,
        }),
      });
    });

    it("HAI 2.2 instance: post-prepaid final usage writes a positive gpu_usage row", async () => {
      const prepaidUntil = new Date("2026-01-01T00:30:00.000Z");
      vi.setSystemTime(new Date("2026-01-01T00:35:00.000Z")); // 5 min unbilled since prepaidUntil
      mockPodFindFirst.mockResolvedValue({
        displayName: null,
        prepaidUntil,
        hourlyRateCents: 600,
        poolId: "9",
      });
      mockDeleteInstance.mockResolvedValue({});

      const res = await DELETE(makeRequest("DELETE"), { params: params(INSTANCE_ID) });

      expect(res.status).toBe(200);
      expect(mockWalletTxnCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stripeCustomerId: "cus_op",
          teamId: "team_1",
          type: "gpu_usage",
          amountCents: 50, // 5/60 hr * 600c
          subscriptionId: INSTANCE_ID,
          poolId: 9,
          billingMinutes: 5,
        }),
      });
    });
  });
});
