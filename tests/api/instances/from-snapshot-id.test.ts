// Tests for src/app/api/instances/from-snapshot/[id]/route.ts (PA-287).
//
// POST restores a saved snapshot into a BRAND NEW instance AND charges the
// wallet — the highest-risk handler in this batch. The money/provision order
// the route implements is:
//   1. verifyCustomerToken (401)
//   2. validate body (400)
//   3. findFirst snapshot scoped to payload.customerId (404 no-leak)
//   4. stripe customer -> teamId (400 if none)
//   5. gatePermission "gpu.provision" (403)
//   6. resolve product/serviceId/pricing + provisioning defaults (400s)
//   7. wallet balance check -> 402 if short, NO charge, NO provision
//   8. deductUsage PRE-charge -> 402 if deduct fails, NO provision
//   9. createInstance -> on throw, refundDeployment THEN rethrow (-> 500/503)
//  10. persist metadata / wallet txn / activity / email (fire-and-forget safe)
//
// What we pin (billing-critical paths called out explicitly):
//   * auth 401, validation 400, ownership 404 (no charge, no provision)
//   * gate 403 short-circuits before product/wallet/createInstance
//   * insufficient funds -> 402, createInstance NOT called, deductUsage NOT called
//   * deduct failure -> 402, createInstance NOT called
//   * happy path: deductUsage BEFORE createInstance, with correct args
//   * provision failure -> refundDeployment called with the pre-charged amount,
//     then the error is mapped (insufficient-resources -> 503, else 500)
//   * fire-and-forget side effects are mocked resolved (the .catch() gotcha)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGenerateCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockCreateInstance,
  mockGetServiceProvisioningInfo,
  mockGetServiceCompatibleGPUPools,
  mockGetTeamWorkspaces,
  mockGetSharedVolumes,
  mockGetProductByPoolId,
  mockGetWalletBalance,
  mockDeductUsage,
  mockRefundDeployment,
  mockLogGPULaunched,
  mockSendGpuLaunchedEmail,
  mockInstallMetricsCollector,
  mockRunStartupScript,
  mockSnapshotFindFirst,
  mockPodMetadataCreate,
  mockWalletTxnCreate,
  mockHfDeploymentCreate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGenerateCustomerToken: vi.fn(() => "dash-tok"),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockGetServiceProvisioningInfo: vi.fn(),
  mockGetServiceCompatibleGPUPools: vi.fn(),
  mockGetTeamWorkspaces: vi.fn(),
  mockGetSharedVolumes: vi.fn(),
  mockGetProductByPoolId: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockDeductUsage: vi.fn(),
  mockRefundDeployment: vi.fn(),
  mockLogGPULaunched: vi.fn(),
  mockSendGpuLaunchedEmail: vi.fn(),
  mockInstallMetricsCollector: vi.fn(),
  mockRunStartupScript: vi.fn(),
  mockSnapshotFindFirst: vi.fn(),
  mockPodMetadataCreate: vi.fn(),
  mockWalletTxnCreate: vi.fn(),
  mockHfDeploymentCreate: vi.fn(),
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
vi.mock("@/lib/hostedai", () => ({
  createInstance: mockCreateInstance,
  getServiceProvisioningInfo: mockGetServiceProvisioningInfo,
  getServiceCompatibleGPUPools: mockGetServiceCompatibleGPUPools,
  getTeamWorkspaces: mockGetTeamWorkspaces,
  getSharedVolumes: mockGetSharedVolumes,
}));
vi.mock("@/lib/activity", () => ({ logGPULaunched: mockLogGPULaunched }));
vi.mock("@/lib/wallet", () => ({
  getWalletBalance: mockGetWalletBalance,
  deductUsage: mockDeductUsage,
  refundDeployment: mockRefundDeployment,
}));
vi.mock("@/lib/products", () => ({ getProductByPoolId: mockGetProductByPoolId }));
vi.mock("@/lib/email", () => ({ sendGpuLaunchedEmail: mockSendGpuLaunchedEmail }));
vi.mock("@/lib/metrics-collector", () => ({ installMetricsCollector: mockInstallMetricsCollector }));
vi.mock("@/lib/startup-script-runner", () => ({ runStartupScript: mockRunStartupScript }));
vi.mock("@/lib/startup-scripts", () => ({ WORKSPACE_SETUP_SCRIPT: "#setup" }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podSnapshot: { findFirst: mockSnapshotFindFirst },
    podMetadata: { create: mockPodMetadataCreate },
    walletTransaction: { create: mockWalletTxnCreate },
    huggingFaceDeployment: { create: mockHfDeploymentCreate },
  },
}));

import { POST } from "@/app/api/instances/from-snapshot/[id]/route";

const PAYLOAD = {
  customerId: "cus_jwt",
  email: "alice@example.com",
  userId: "user_alice",
};

// Default ctx: JWT identity IS the operating account (owner acting on their
// own account) — accountId === PAYLOAD.customerId, matching the pre-PA-94
// assumption every existing test below was written against.
function ctx(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      id: "cus_jwt",
      email: "alice@example.com",
      name: "Alice",
      metadata: { hostedai_team_id: "team_1" },
    },
    accountId: "cus_jwt",
    teamId: "team_1",
    allTeamIds: ["team_1"],
    allCustomerIds: ["cus_jwt"],
    monthlyCustomerIds: [] as string[],
    ...overrides,
  };
}

const params = Promise.resolve({ id: "snap_1" });

function req({ authorized = true, body = {} as unknown } = {}) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer valid.jwt.token");
  return new NextRequest("http://localhost/api/instances/from-snapshot/snap_1", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "snap_1",
    displayName: "my snap",
    poolId: "pool_1",
    poolName: "Pool One",
    regionId: "2",
    vgpus: 1,
    instanceTypeId: "it_1",
    imageUuid: "11111111-1111-1111-1111-111111111111",
    persistentVolumeId: null,
    persistentVolumeName: null,
    hfItemId: null,
    hfItemName: null,
    hfItemType: null,
    deployScript: null,
    ...overrides,
  };
}

// hourly_rate_cents 200 -> 30min pre-charge = round(0.5 * 200) = 100 cents
const PRODUCT = {
  id: "prod_1",
  name: "A100",
  serviceId: "svc_1",
  hourly_rate_cents: 200,
};
const PREPAID_CENTS = 100;

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(ctx());
  mockGatePermission.mockResolvedValue(null);
  mockSnapshotFindFirst.mockResolvedValue(snapshotRow());
  mockGetProductByPoolId.mockResolvedValue(PRODUCT);
  mockGetTeamWorkspaces.mockResolvedValue([{ id: "ws_1", name: "ws" }]);
  mockGetServiceProvisioningInfo.mockResolvedValue({
    instance_type_details: { default: { id: "it_default" } },
    image_details: { default: { hash: "img_default" } },
    storage_block_details: { default: { id: "sb_default" } },
  });
  mockGetServiceCompatibleGPUPools.mockResolvedValue([
    { id: 5, name: "pool", available_vgpus: 4 },
  ]);
  mockGetWalletBalance.mockResolvedValue({ availableBalance: 10000 });
  mockDeductUsage.mockResolvedValue({ success: true, newBalance: 9900 });
  mockRefundDeployment.mockResolvedValue({ success: true });
  mockCreateInstance.mockResolvedValue({ id: "i-new" });
  // fire-and-forget side effects: MUST resolve (handlers call .catch on them)
  mockInstallMetricsCollector.mockResolvedValue(undefined);
  mockRunStartupScript.mockResolvedValue(undefined);
  mockPodMetadataCreate.mockResolvedValue({});
  mockWalletTxnCreate.mockResolvedValue({});
  mockHfDeploymentCreate.mockResolvedValue({});
  mockLogGPULaunched.mockResolvedValue(undefined);
  mockSendGpuLaunchedEmail.mockResolvedValue(undefined);
});

describe("POST /api/instances/from-snapshot/[id] — auth & validation", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(req({ authorized: false }), { params });
    expect(res.status).toBe(401);
    expect(mockSnapshotFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(401);
  });

  it("rejects invalid input (out-of-range vgpus) -> 400, no charge/provision", async () => {
    const res = await POST(req({ body: { vgpus: 99 } }), { params });
    expect(res.status).toBe(400);
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });
});

describe("POST /api/instances/from-snapshot/[id] — ownership & gate", () => {
  it("scopes the snapshot lookup to the JWT customer", async () => {
    await POST(req(), { params });
    expect(mockSnapshotFindFirst).toHaveBeenCalledWith({
      where: { id: "snap_1", stripeCustomerId: "cus_jwt" },
    });
  });

  it("returns 404 (no-leak) for another account's snapshot — no charge, no provision", async () => {
    mockSnapshotFindFirst.mockResolvedValue(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockResolveOperatingContext.mockResolvedValue(
      ctx({ customer: { id: "cus_jwt", email: "alice@example.com", metadata: {} }, teamId: null }),
    );
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect(mockGatePermission).not.toHaveBeenCalled();
    expect(mockDeductUsage).not.toHaveBeenCalled();
  });

  it("returns 404 when the operating account can't be resolved", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(mockSnapshotFindFirst).not.toHaveBeenCalled();
    expect(mockGatePermission).not.toHaveBeenCalled();
  });

  it("gate denial short-circuits before product/wallet/createInstance", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denied);
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(mockGetProductByPoolId).not.toHaveBeenCalled();
    expect(mockGetWalletBalance).not.toHaveBeenCalled();
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("passes gpu.provision and the Stripe customer email/id to the gate", async () => {
    await POST(req(), { params });
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("gpu.provision");
    expect(call.accountId).toBe("cus_jwt");
    expect(call.customerEmail).toBe("alice@example.com");
    expect(call.extra).toEqual({ snapshotId: "snap_1" });
  });
});

// PA-94: a team member's JWT identity (payload.customerId) is their OWN Stripe
// customer (or none at all) — distinct from the team account they're acting
// on (ctx.accountId, resolved via activeAccountId). Before the fix, this route
// used payload.customerId directly everywhere, so a team member always hit
// their own empty wallet instead of the team's.
describe("POST /api/instances/from-snapshot/[id] — team member acting on the team account (PA-94)", () => {
  const TEAM_CTX = ctx({
    customer: {
      id: "cus_owner",
      email: "owner@example.com",
      name: "Owner",
      metadata: { hostedai_team_id: "team_1" },
    },
    accountId: "cus_owner",
  });

  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue(TEAM_CTX);
  });

  it("scopes the snapshot lookup to the team account, not the member's own JWT customerId", async () => {
    await POST(req(), { params });
    expect(mockSnapshotFindFirst).toHaveBeenCalledWith({
      where: { id: "snap_1", stripeCustomerId: "cus_owner" },
    });
  });

  it("checks and charges the TEAM's wallet, not the member's own", async () => {
    await POST(req(), { params });
    expect(mockGetWalletBalance).toHaveBeenCalledWith("cus_owner");
    expect(mockDeductUsage).toHaveBeenCalledWith(
      "cus_owner",
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
      expect.any(String),
    );
  });

  it("gates gpu.provision against the team account, not the member's own", async () => {
    await POST(req(), { params });
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.accountId).toBe("cus_owner");
    expect(call.customerEmail).toBe("owner@example.com");
  });

  it("records the deployment/pod metadata under the team account", async () => {
    await POST(req(), { params });
    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_owner");
    expect(mockWalletTxnCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_owner");
  });
});

describe("POST /api/instances/from-snapshot/[id] — product/pricing guards", () => {
  it("returns 400 when no product/serviceId is linked to the pool", async () => {
    mockGetProductByPoolId.mockResolvedValue(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the product has zero hourly rate", async () => {
    mockGetProductByPoolId.mockResolvedValue({ ...PRODUCT, hourly_rate_cents: 0 });
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect(mockDeductUsage).not.toHaveBeenCalled();
  });

  it("returns 400 when provisioning config can't be resolved", async () => {
    // snapshot lacks instanceType/image AND provisioning-info returns nothing
    mockSnapshotFindFirst.mockResolvedValue(
      snapshotRow({ instanceTypeId: null, imageUuid: null }),
    );
    mockGetServiceProvisioningInfo.mockResolvedValue({});
    const res = await POST(req(), { params });
    expect(res.status).toBe(400);
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });
});

describe("POST /api/instances/from-snapshot/[id] — billing guards (CRITICAL)", () => {
  it("insufficient funds -> 402, NO charge and NO provision", async () => {
    mockGetWalletBalance.mockResolvedValue({ availableBalance: PREPAID_CENTS - 1 });
    const res = await POST(req(), { params });
    expect(res.status).toBe(402);
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("deduct failure -> 402 and NO provision", async () => {
    mockDeductUsage.mockResolvedValue({ success: false, error: "card declined" });
    const res = await POST(req(), { params });
    expect(res.status).toBe(402);
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("charges the wallet BEFORE provisioning, with the correct amount/args", async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);

    // ordering: deductUsage invoked before createInstance
    const deductOrder = mockDeductUsage.mock.invocationCallOrder[0];
    const createOrder = mockCreateInstance.mock.invocationCallOrder[0];
    expect(deductOrder).toBeLessThan(createOrder);

    // pre-charge args: customer, hours*gpu (0.5), description, rate, id
    const deductArgs = mockDeductUsage.mock.calls[0];
    expect(deductArgs[0]).toBe("cus_jwt");
    expect(deductArgs[1]).toBeCloseTo(0.5);
    expect(deductArgs[3]).toBe(200); // hourlyRateCents
    expect(mockCreateInstance).toHaveBeenCalledTimes(1);
  });

  it("happy path returns the new instance id and the restored summary", async () => {
    const res = await POST(req(), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.instance_id).toBe("i-new");
    expect(body.restored.snapshotId).toBe("snap_1");
    expect(body.restored.productName).toBe("A100");
    // wallet was charged exactly once, never refunded on the happy path
    expect(mockDeductUsage).toHaveBeenCalledTimes(1);
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("handles createInstance returning a bare string id", async () => {
    mockCreateInstance.mockResolvedValue("i-string");
    const res = await POST(req(), { params });
    const body = await res.json();
    expect(body.instance_id).toBe("i-string");
  });
});

describe("POST /api/instances/from-snapshot/[id] — provision failure / compensation (CRITICAL)", () => {
  it("REFUNDS the pre-charge when provisioning throws, then maps to 500", async () => {
    mockCreateInstance.mockRejectedValue(new Error("HAI exploded"));
    const res = await POST(req(), { params });

    expect(res.status).toBe(500);
    // refund issued for the same amount that was pre-charged
    expect(mockRefundDeployment).toHaveBeenCalledTimes(1);
    const refundArgs = mockRefundDeployment.mock.calls[0];
    expect(refundArgs[0]).toBe("cus_jwt");
    expect(refundArgs[1]).toBe(PREPAID_CENTS);
    // no pod metadata persisted for a failed provision
    expect(mockPodMetadataCreate).not.toHaveBeenCalled();
  });

  it("maps an insufficient-resources HAI error to 503 (and still refunds)", async () => {
    mockCreateInstance.mockRejectedValue(new Error("Insufficient resources in pool"));
    const res = await POST(req(), { params });
    expect(res.status).toBe(503);
    expect(mockRefundDeployment).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/instances/from-snapshot/[id] — persistence side effects", () => {
  it("persists pod metadata + wallet transaction and logs activity on success", async () => {
    await POST(req(), { params });
    expect(mockPodMetadataCreate).toHaveBeenCalledTimes(1);
    const meta = mockPodMetadataCreate.mock.calls[0][0].data;
    expect(meta.instanceId).toBe("i-new");
    expect(meta.prepaidAmountCents).toBe(PREPAID_CENTS);
    expect(meta.productId).toBe("prod_1");

    expect(mockWalletTxnCreate).toHaveBeenCalledTimes(1);
    expect(mockLogGPULaunched).toHaveBeenCalledTimes(1);
    // fire-and-forget collectors fired
    expect(mockInstallMetricsCollector).toHaveBeenCalledTimes(1);
    expect(mockRunStartupScript).toHaveBeenCalledTimes(1);
  });

  it("creates an HF deployment record when the snapshot carries one", async () => {
    mockSnapshotFindFirst.mockResolvedValue(
      snapshotRow({ hfItemId: "hf_1", hfItemName: "llama", hfItemType: "model", deployScript: "vllm" }),
    );
    await POST(req(), { params });
    expect(mockHfDeploymentCreate).toHaveBeenCalledTimes(1);
    const hf = mockHfDeploymentCreate.mock.calls[0][0].data;
    expect(hf.hfItemId).toBe("hf_1");
    expect(hf.subscriptionId).toBe("i-new");
  });

  it("attaches the saved persistent volume when attachStorage is true", async () => {
    mockSnapshotFindFirst.mockResolvedValue(
      snapshotRow({ persistentVolumeId: 77 }),
    );
    await POST(req({ body: { attachStorage: true } }), { params });
    const createArg = mockCreateInstance.mock.calls[0][0];
    expect(createArg.pod_opts.shared_volumes).toEqual([77]);
  });

  it("does not attach storage when attachStorage is false", async () => {
    mockSnapshotFindFirst.mockResolvedValue(snapshotRow({ persistentVolumeId: 77 }));
    await POST(req({ body: { attachStorage: false } }), { params });
    const createArg = mockCreateInstance.mock.calls[0][0];
    expect(createArg.pod_opts.shared_volumes).toEqual([]);
  });
});

// A session operating a monthly billing artefact holds no wallet on the
// operating account; the hourly deploy is paid from the hourly customer.
describe("POST /api/instances/from-snapshot/[id] — hourly wallet vs operating account", () => {
  const MONTHLY_CTX = ctx({
    customer: {
      id: "cus_monthly",
      email: "owner@example.com",
      name: "Owner",
      metadata: { hostedai_team_id: "team_1", billing_type: "monthly" },
    },
    accountId: "cus_monthly",
    hourlyCustomerId: "cus_hourly",
  });

  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue(MONTHLY_CTX);
    mockGetWalletBalance.mockImplementation(async (id: string) => ({
      availableBalance: id === "cus_hourly" ? 10000 : 0,
    }));
  });

  it("gates and charges the hourly wallet, not the operating account", async () => {
    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(mockGetWalletBalance).toHaveBeenCalledWith("cus_hourly");
    expect(mockDeductUsage).toHaveBeenCalledWith(
      "cus_hourly",
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
      expect.stringContaining("predeploy_cus_hourly_"),
    );
  });

  it("stamps the pod and the ledger row with the wallet that paid", async () => {
    await POST(req(), { params });

    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_hourly");
    expect(mockWalletTxnCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_hourly");
  });

  it("refunds the hourly wallet when the deploy fails", async () => {
    mockCreateInstance.mockRejectedValue(new Error("boom"));

    await POST(req(), { params });

    expect(mockRefundDeployment).toHaveBeenCalledWith(
      "cus_hourly",
      PREPAID_CENTS,
      expect.stringContaining("Refund"),
    );
  });

  it("still owns the snapshot lookup on the operating account", async () => {
    await POST(req(), { params });

    expect(mockSnapshotFindFirst).toHaveBeenCalledWith({
      where: { id: "snap_1", stripeCustomerId: "cus_monthly" },
    });
  });

  it("falls back to the operating account when the context resolves no hourly customer", async () => {
    mockResolveOperatingContext.mockResolvedValue(ctx({ accountId: "cus_jwt", hourlyCustomerId: null }));
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 10000 });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(mockDeductUsage.mock.calls[0][0]).toBe("cus_jwt");
    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_jwt");
  });
});
