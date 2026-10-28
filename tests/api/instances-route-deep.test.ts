// Deep tests for src/app/api/instances/route.ts — the unified instances
// list (GET) and create (POST) endpoints. COMPLEMENTARY to
// tests/api/instances/route.test.ts (which covers /api/instances/[id]); this
// file is a NEW file targeting the big list/create route (~1081 lines, ~16%).
//
// PA-320 coverage deepening. We don't chase every line — we hit the
// meaningful branches a shallow test misses:
//   GET  — auth (401), no-team (400), the unified→PoolSubscription shaping
//          (status lowercasing, vgpu backfill from detail), metadata merge,
//          HF deployment merge, list-error 500.
//   POST — auth (401), no-team (400), gate denial verbatim, name validation,
//          "no product" 400, region-required 400, region-maintenance 503,
//          insufficient-wallet 402, deploy-failure refund + 503 mapping,
//          and the provisioning happy path returning deploy_status.
//
// Boundaries mocked at the module edge (vi.hoisted + vi.mock); the dynamic
// `await import("@/lib/hostedai")` inside the create handler resolves to the
// same mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGetStripe,
  mockResolveAllTeamsForEmail,
  mockResolveOperatingContext,
  mockCreateInstance,
  mockGetUnifiedInstances,
  mockGetUnifiedInstanceDetail,
  mockGetServiceProvisioningInfo,
  mockGetServiceCompatibleGPUPools,
  mockGetTeamWorkspaces,
  mockLogGPULaunched,
  mockGetFirstGpuLaunch,
  mockSendOnboardingEvent,
  mockSendGpuLaunchedEmail,
  mockGenerateCustomerToken,
  mockGetWalletBalance,
  mockDeductUsage,
  mockRefundDeployment,
  mockMonitorDeployStatus,
  mockCacheCustomer,
  mockInstallMetricsCollector,
  mockGatePermission,
  mockIsRegionInMaintenance,
  mockGetMaintenanceMap,
  mockRunStartupScript,
  mockGpuProductFindUnique,
  mockPodMetadataFindMany,
  mockPodMetadataCreate,
  mockHfDeploymentFindMany,
  mockBareMetalOrderFindMany,
  mockWalletTransactionCreate,
  mockSshKeyFindMany,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockResolveAllTeamsForEmail: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockGetUnifiedInstances: vi.fn(),
  mockGetUnifiedInstanceDetail: vi.fn(),
  mockGetServiceProvisioningInfo: vi.fn(),
  mockGetServiceCompatibleGPUPools: vi.fn(),
  mockGetTeamWorkspaces: vi.fn(),
  mockLogGPULaunched: vi.fn(),
  mockGetFirstGpuLaunch: vi.fn(),
  mockSendOnboardingEvent: vi.fn(),
  mockSendGpuLaunchedEmail: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockDeductUsage: vi.fn(),
  mockRefundDeployment: vi.fn(),
  mockMonitorDeployStatus: vi.fn(),
  mockCacheCustomer: vi.fn(),
  mockInstallMetricsCollector: vi.fn(),
  mockGatePermission: vi.fn(),
  mockIsRegionInMaintenance: vi.fn(),
  mockGetMaintenanceMap: vi.fn(),
  mockRunStartupScript: vi.fn(),
  mockGpuProductFindUnique: vi.fn(),
  mockPodMetadataFindMany: vi.fn(),
  mockPodMetadataCreate: vi.fn(),
  mockHfDeploymentFindMany: vi.fn(),
  mockBareMetalOrderFindMany: vi.fn(),
  mockWalletTransactionCreate: vi.fn(),
  mockSshKeyFindMany: vi.fn(),
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
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/customer-resolver", () => ({ resolveAllTeamsForEmail: mockResolveAllTeamsForEmail }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: mockResolveOperatingContext }));
vi.mock("@/lib/hostedai", () => ({
  createInstance: mockCreateInstance,
  getUnifiedInstances: mockGetUnifiedInstances,
  getUnifiedInstanceDetail: mockGetUnifiedInstanceDetail,
  getServiceProvisioningInfo: mockGetServiceProvisioningInfo,
  getServiceCompatibleGPUPools: mockGetServiceCompatibleGPUPools,
  getTeamWorkspaces: mockGetTeamWorkspaces,
  createSharedVolume: vi.fn(),
  getSharedVolumes: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({
  logGPULaunched: mockLogGPULaunched,
  getFirstGpuLaunch: mockGetFirstGpuLaunch,
}));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: mockSendOnboardingEvent }));
vi.mock("@/lib/email", () => ({ sendGpuLaunchedEmail: mockSendGpuLaunchedEmail }));
vi.mock("@/lib/wallet", () => ({
  getWalletBalance: mockGetWalletBalance,
  deductUsage: mockDeductUsage,
  refundDeployment: mockRefundDeployment,
}));
vi.mock("@/lib/deploy-monitor", () => ({ monitorDeployStatus: mockMonitorDeployStatus }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: mockCacheCustomer }));
vi.mock("@/lib/metrics-collector", () => ({ installMetricsCollector: mockInstallMetricsCollector }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/maintenance/regions", () => ({
  isRegionInMaintenance: mockIsRegionInMaintenance,
  getMaintenanceMap: mockGetMaintenanceMap,
  DEFAULT_MAINTENANCE_MESSAGE: "Under maintenance",
}));
vi.mock("@/lib/startup-script-runner", () => ({ runStartupScript: mockRunStartupScript }));
vi.mock("@/lib/startup-scripts", () => ({ WORKSPACE_SETUP_SCRIPT: "# setup" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findUnique: mockGpuProductFindUnique },
    podMetadata: { findMany: mockPodMetadataFindMany, create: mockPodMetadataCreate, delete: vi.fn() },
    huggingFaceDeployment: { findMany: mockHfDeploymentFindMany },
    bareMetalOrder: { findMany: mockBareMetalOrderFindMany },
    walletTransaction: { create: mockWalletTransactionCreate },
    sSHKey: { findMany: mockSshKeyFindMany },
  },
}));

import { GET, POST } from "@/app/api/instances/route";

const PAYLOAD = { customerId: "cus_1", email: "a@x.com", userId: "u1" };

function makeReq(method: "GET" | "POST", { authorized = true, body }: { authorized?: boolean; body?: unknown } = {}) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer t");
  const init: { method: string; headers: Headers; body?: string } = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  return new NextRequest("http://localhost/api/instances", init);
}

const STRIPE = {
  customers: { update: vi.fn(), retrieve: vi.fn(), list: vi.fn() },
  subscriptions: { list: vi.fn(), retrieve: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockGetStripe.mockResolvedValue(STRIPE);
  STRIPE.customers.update.mockResolvedValue({});
  STRIPE.customers.retrieve.mockResolvedValue({ id: "cus_1", metadata: {} });
  mockCacheCustomer.mockResolvedValue(undefined);
  mockGetMaintenanceMap.mockResolvedValue(new Map());
  mockIsRegionInMaintenance.mockResolvedValue({ inMaintenance: false });
  mockGatePermission.mockResolvedValue(null);
});

// ── GET — list ────────────────────────────────────────────────────────────
describe("GET /api/instances — auth & team gating", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeReq("GET", { authorized: false }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the operating context has no teams", async () => {
    mockResolveOperatingContext.mockResolvedValue({ customer: { id: "cus_1" }, teamId: null, allTeamIds: [] });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No team associated with this account");
  });
});

// PA-422: a failed HAI fetch must never surface as a false-empty dashboard.
describe("GET /api/instances — upstream failure (PA-422)", () => {
  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue({
      customer: { id: "cus_1", metadata: {} },
      teamId: "team-1",
      allTeamIds: ["team-1"],
    });
    mockPodMetadataFindMany.mockResolvedValue([]);
    mockHfDeploymentFindMany.mockResolvedValue([]);
  });

  it("returns 503 (not an empty list) when the fetch keeps failing after a retry", async () => {
    mockGetUnifiedInstances.mockRejectedValue(new Error("items: null"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("instances_unavailable");
    // one initial attempt + one retry for the single team
    expect(mockGetUnifiedInstances).toHaveBeenCalledTimes(2);
  });

  it("recovers on the retry and returns 200 (no false 503)", async () => {
    mockGetUnifiedInstances
      .mockRejectedValueOnce(new Error("items: null"))
      .mockResolvedValueOnce({
        items: [{ id: "inst-1", name: "pod-one", status: "Running" }],
      });
    mockGetUnifiedInstanceDetail.mockResolvedValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).poolSubscriptions).toHaveLength(1);
  });
});

describe("GET /api/instances — shaping", () => {
  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue({
      customer: { id: "cus_1", metadata: { hostedai_team_id: "team-1" } },
      teamId: "team-1",
      allTeamIds: ["team-1"],
    });
    mockGetUnifiedInstances.mockResolvedValue({
      items: [
        {
          id: "inst-1",
          name: "pod-one",
          status: "Running",
          pod_info: { vgpu_count: 1 },
          instance_type: { cpu_cores: 8, ram_mb: 32000 },
        },
      ],
    });
    mockGetUnifiedInstanceDetail.mockResolvedValue(null);
    mockPodMetadataFindMany.mockResolvedValue([]);
    mockHfDeploymentFindMany.mockResolvedValue([]);
  });

  it("maps a unified instance to a poolSubscription with lowercased status", async () => {
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.poolSubscriptions).toHaveLength(1);
    const sub = body.poolSubscriptions[0];
    expect(sub.id).toBe("inst-1");
    expect(sub.pool_name).toBe("pod-one");
    expect(sub.status).toBe("running");
    expect(body.instances).toEqual([]);
  });

  it("backfills the real vgpu_count from the detail endpoint (PA-183)", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({
      pod_info: { vgpu_count: 4 },
      shared_volumes: [],
    });
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.poolSubscriptions[0].per_pod_info.vgpu_count).toBe(4);
    expect(body.poolSubscriptions[0].pods[0].gpu_count).toBe(4);
  });

  it("merges hourlyRate metadata indexed by instance id", async () => {
    mockPodMetadataFindMany.mockResolvedValue([
      {
        instanceId: "inst-1",
        subscriptionId: "instance-inst-1",
        displayName: "Pretty",
        notes: null,
        hourlyRateCents: 250,
        billingType: "hourly",
        startupScriptStatus: null,
        deployStatus: "running",
        deployStatusReason: null,
      },
    ]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.podMetadata["inst-1"].displayName).toBe("Pretty");
    expect(body.podMetadata["inst-1"].hourlyRate).toBe(2.5);
  });

  it("merges HuggingFace deployments keyed by subscriptionId", async () => {
    mockHfDeploymentFindMany.mockResolvedValue([
      {
        id: "dep-1",
        subscriptionId: "inst-1",
        hfItemId: "x/y",
        hfItemName: "Y",
        status: "running",
        errorMessage: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        netdata: false,
        netdataPort: null,
        openWebUI: false,
        webUiPort: null,
      },
    ]);
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.hfDeployments["inst-1"].id).toBe("dep-1");
    expect(body.hfDeployments["inst-1"].createdAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("tolerates a per-team unified fetch failure (returns the other teams' rows)", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      customer: { id: "cus_1", metadata: {} },
      teamId: "team-1",
      allTeamIds: ["team-1", "team-2"],
    });
    // team-2 is persistently down — it fails the initial call AND the PA-422
    // retry; team-1's rows must still come through (graceful multi-account
    // degradation, not a whole-request 503).
    mockGetUnifiedInstances.mockImplementation((teamId: string) =>
      teamId === "team-1"
        ? Promise.resolve({ items: [{ id: "inst-1", name: "a", status: "Running", pod_info: {} }] })
        : Promise.reject(new Error("team-2 down")),
    );
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.poolSubscriptions).toHaveLength(1);
  });

  it("returns 500 when context resolution throws", async () => {
    mockResolveOperatingContext.mockRejectedValue(new Error("resolver down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to list instances");
  });
});

// ── POST — create ───────────────────────────────────────────────────────────
describe("POST /api/instances — auth, team & gate", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeReq("POST", { authorized: false, body: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the operating context cannot resolve a team", async () => {
    mockResolveOperatingContext.mockResolvedValue({ customer: { id: "cus_1", metadata: {} }, teamId: null });
    const res = await POST(makeReq("POST", { body: { name: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No team associated with this account");
  });

  it("returns the gpu.provision gate denial verbatim", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: "cus_1",
      teamId: "team-1",
      customer: { id: "cus_1", email: "a@x.com", metadata: { hostedai_team_id: "team-1" } },
    });
    const denial = NextResponse.json({ error: "denied" }, { status: 403 });
    mockGatePermission.mockResolvedValue(denial);
    const res = await POST(makeReq("POST", { body: { name: "x" } }));
    expect(res).toBe(denial);
    const call = mockGatePermission.mock.calls[0][0];
    expect(call.permission).toBe("gpu.provision");
    expect(call.customerEmail).toBe("a@x.com");
  });
});

describe("POST /api/instances — validation & no-product path", () => {
  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: "cus_1",
      teamId: "team-1",
      customer: { id: "cus_1", email: "a@x.com", metadata: { hostedai_team_id: "team-1" } },
    });
  });

  it("returns 400 when the instance name is missing", async () => {
    const res = await POST(makeReq("POST", { body: { product_id: "p" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Instance name is required");
  });

  it("returns 400 when no product with a linked service is supplied", async () => {
    const res = await POST(makeReq("POST", { body: { name: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("GPU product with a linked HAI service is required");
  });

  it("returns 400 when the product exists but has no serviceId (falls through to no-product)", async () => {
    mockGpuProductFindUnique.mockResolvedValue({ id: "p", serviceId: null });
    const res = await POST(makeReq("POST", { body: { name: "x", product_id: "p" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("linked HAI service is required");
  });
});

describe("POST /api/instances — unified create handler", () => {
  const PRODUCT = {
    id: "prod-1",
    name: "A100",
    serviceId: "svc-1",
    pricePerHourCents: 200,
    billingType: "hourly",
    stripePriceId: null,
  };

  beforeEach(() => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: "cus_1",
      teamId: "team-1",
      customer: { id: "cus_1", email: "a@x.com", name: "Alice", metadata: { hostedai_team_id: "team-1" } },
    });
    mockGpuProductFindUnique.mockResolvedValue(PRODUCT);
    mockGetTeamWorkspaces.mockResolvedValue([{ id: "ws-1", name: "ws" }]);
    mockGetServiceProvisioningInfo.mockResolvedValue({
      instance_type_details: { default: { id: "it-1" } },
      image_details: { default: { hash: "img-1" } },
      storage_block_details: { default: { id: "sb-1" } },
    });
    mockGetServiceCompatibleGPUPools.mockResolvedValue([{ id: 7, name: "p", available_vgpus: 4 }]);
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 100000 });
    mockDeductUsage.mockResolvedValue({ success: true });
    mockCreateInstance.mockResolvedValue("inst-9");
    mockPodMetadataCreate.mockResolvedValue({});
    mockWalletTransactionCreate.mockResolvedValue({});
    mockMonitorDeployStatus.mockResolvedValue({ ready: false });
    mockInstallMetricsCollector.mockResolvedValue(undefined);
    mockRunStartupScript.mockResolvedValue(undefined);
  });

  function createBody(extra: Record<string, unknown> = {}) {
    return { name: "my-pod", product_id: "prod-1", region_id: 5, ...extra };
  }

  it("returns 400 when no region is supplied", async () => {
    const res = await POST(makeReq("POST", { body: { name: "x", product_id: "prod-1" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Region is required");
  });

  it("returns 503 when the region is under maintenance", async () => {
    mockIsRegionInMaintenance.mockResolvedValue({ inMaintenance: true, message: "down for Ariel" });
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.maintenanceMessage).toBe("down for Ariel");
  });

  it("returns 429 when a deploy lock is held within the last 60s", async () => {
    const now = Math.floor(Date.now() / 1000);
    mockResolveOperatingContext.mockResolvedValue({
      accountId: "cus_1",
      teamId: "team-1",
      customer: {
        id: "cus_1", email: "a@x.com", name: "Alice",
        metadata: { hostedai_team_id: "team-1", deploy_lock: String(now) },
      },
    });
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Another GPU deployment is in progress");
  });

  it("returns 400 when locked instance config cannot be resolved", async () => {
    mockGetServiceProvisioningInfo.mockResolvedValue({});
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Could not resolve instance configuration");
  });

  it("returns 402 when wallet balance is below the hourly pre-charge", async () => {
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 1 });
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Insufficient wallet balance");
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("refunds the pre-charge and maps an insufficient-resources deploy failure to 503", async () => {
    mockCreateInstance.mockRejectedValue(new Error("Insufficient resources 10189007"));
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("No GPUs currently available");
    expect(mockRefundDeployment).toHaveBeenCalledTimes(1);
    // 200c/hr * 0.5h = 100c pre-charge refunded.
    expect(mockRefundDeployment).toHaveBeenCalledWith("cus_1", 100, expect.stringContaining("Refund"));
  });

  it("deploys, pre-charges, persists metadata and returns provisioning status", async () => {
    const res = await POST(makeReq("POST", { body: createBody() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.instance_id).toBe("inst-9");
    expect(body.deploy_status).toBe("provisioning");
    expect(mockDeductUsage).toHaveBeenCalledTimes(1);
    expect(mockCreateInstance).toHaveBeenCalledTimes(1);
    expect(mockPodMetadataCreate).toHaveBeenCalledTimes(1);
    const metaData = mockPodMetadataCreate.mock.calls[0][0].data;
    expect(metaData).toMatchObject({
      instanceId: "inst-9",
      stripeCustomerId: "cus_1",
      billingType: "hourly",
      deployStatus: "provisioning",
    });
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });
});
