// PA-644: internal/excluded accounts deploy with a $0.00 pre-charge.
//
// Deploy flow for an internal account: the wallet-balance gate and deductUsage
// are skipped entirely (no balance needed to deploy), a $0 gpu_deploy ledger
// row is still written for auditability, PodMetadata records prepaidAmountCents
// 0 (with the normal prepaidUntil cadence), and failure paths never "refund"
// money that was never charged.
//
// Mock scaffolding copied from instances-route-deep.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGetStripe,
  mockResolveOperatingContext,
  mockCreateInstance,
  mockGetServiceProvisioningInfo,
  mockGetServiceCompatibleGPUPools,
  mockGetTeamWorkspaces,
  mockGetWalletBalance,
  mockDeductUsage,
  mockRefundDeployment,
  mockMonitorDeployStatus,
  mockGatePermission,
  mockIsRegionInMaintenance,
  mockGpuProductFindUnique,
  mockPodMetadataCreate,
  mockWalletTransactionCreate,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockGetServiceProvisioningInfo: vi.fn(),
  mockGetServiceCompatibleGPUPools: vi.fn(),
  mockGetTeamWorkspaces: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockDeductUsage: vi.fn(),
  mockRefundDeployment: vi.fn(),
  mockMonitorDeployStatus: vi.fn(),
  mockGatePermission: vi.fn(),
  mockIsRegionInMaintenance: vi.fn(),
  mockGpuProductFindUnique: vi.fn(),
  mockPodMetadataCreate: vi.fn(),
  mockWalletTransactionCreate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
  generateCustomerToken: vi.fn(),
  createLoginLink: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/customer-resolver", () => ({ resolveAllTeamsForEmail: vi.fn() }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: mockResolveOperatingContext }));
vi.mock("@/lib/hostedai", () => ({
  createInstance: mockCreateInstance,
  getUnifiedInstances: vi.fn(),
  getUnifiedInstanceDetail: vi.fn(),
  getServiceProvisioningInfo: mockGetServiceProvisioningInfo,
  getServiceCompatibleGPUPools: mockGetServiceCompatibleGPUPools,
  getTeamWorkspaces: mockGetTeamWorkspaces,
  createSharedVolume: vi.fn(),
  getSharedVolumes: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({
  logGPULaunched: vi.fn(),
  getFirstGpuLaunch: vi.fn(),
}));
vi.mock("@/lib/email/onboarding-events", () => ({ sendOnboardingEvent: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendGpuLaunchedEmail: vi.fn() }));
vi.mock("@/lib/wallet", () => ({
  getWalletBalance: mockGetWalletBalance,
  deductUsage: mockDeductUsage,
  refundDeployment: mockRefundDeployment,
}));
vi.mock("@/lib/deploy-monitor", () => ({ monitorDeployStatus: mockMonitorDeployStatus }));
vi.mock("@/lib/customer-cache", () => ({ cacheCustomer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/metrics-collector", () => ({ installMetricsCollector: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/maintenance/regions", () => ({
  isRegionInMaintenance: mockIsRegionInMaintenance,
  getMaintenanceMap: vi.fn().mockResolvedValue(new Map()),
  DEFAULT_MAINTENANCE_MESSAGE: "Under maintenance",
}));
vi.mock("@/lib/startup-script-runner", () => ({ runStartupScript: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/startup-scripts", () => ({ WORKSPACE_SETUP_SCRIPT: "# setup" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findUnique: mockGpuProductFindUnique },
    podMetadata: { findMany: vi.fn().mockResolvedValue([]), create: mockPodMetadataCreate, delete: vi.fn() },
    huggingFaceDeployment: { findMany: vi.fn().mockResolvedValue([]) },
    bareMetalOrder: { findMany: vi.fn().mockResolvedValue([]) },
    walletTransaction: { create: mockWalletTransactionCreate },
    sSHKey: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Real predicate builder, pinned exclusion lists: @internal.test is internal.
vi.mock("@/lib/internal-accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/internal-accounts")>();
  return {
    ...actual,
    getInternalExclusions: vi.fn().mockResolvedValue({ domains: ["internal.test"], emails: [] }),
  };
});

import { POST } from "@/app/api/instances/route";

const INTERNAL_EMAIL = "dev@internal.test";

function makeReq(body: unknown) {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/instances", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const STRIPE = {
  customers: { update: vi.fn(), retrieve: vi.fn(), list: vi.fn() },
  subscriptions: { list: vi.fn(), retrieve: vi.fn() },
};

const PRODUCT = {
  id: "prod-1",
  name: "A100",
  serviceId: "svc-1",
  pricePerHourCents: 200,
  billingType: "hourly",
  stripePriceId: null,
};

function createBody(extra: Record<string, unknown> = {}) {
  return { name: "my-pod", product_id: "prod-1", region_id: 5, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue({ customerId: "cus_1", email: INTERNAL_EMAIL, userId: "u1" });
  mockGetStripe.mockResolvedValue(STRIPE);
  STRIPE.customers.update.mockResolvedValue({});
  STRIPE.customers.retrieve.mockResolvedValue({ id: "cus_1", metadata: {} });
  mockGatePermission.mockResolvedValue(null);
  mockIsRegionInMaintenance.mockResolvedValue({ inMaintenance: false });
  mockResolveOperatingContext.mockResolvedValue({
    accountId: "cus_1",
    teamId: "team-1",
    customer: { id: "cus_1", email: INTERNAL_EMAIL, name: "Dev", metadata: { hostedai_team_id: "team-1" } },
  });
  mockGpuProductFindUnique.mockResolvedValue(PRODUCT);
  mockGetTeamWorkspaces.mockResolvedValue([{ id: "ws-1", name: "ws" }]);
  mockGetServiceProvisioningInfo.mockResolvedValue({
    instance_type_details: { default: { id: "it-1" } },
    image_details: { default: { hash: "img-1" } },
    storage_block_details: { default: { id: "sb-1" } },
  });
  mockGetServiceCompatibleGPUPools.mockResolvedValue([{ id: 7, name: "p", available_vgpus: 4 }]);
  mockGetWalletBalance.mockResolvedValue({ availableBalance: 0 }); // empty wallet
  mockDeductUsage.mockResolvedValue({ success: true });
  mockCreateInstance.mockResolvedValue("inst-9");
  mockPodMetadataCreate.mockResolvedValue({});
  mockWalletTransactionCreate.mockResolvedValue({});
  mockMonitorDeployStatus.mockResolvedValue({ ready: false });
});

describe("POST /api/instances — internal account $0 pre-charge (PA-644)", () => {
  it("deploys with an empty wallet: no balance gate, no deduction, $0 gpu_deploy ledger row", async () => {
    const res = await POST(makeReq(createBody()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.instance_id).toBe("inst-9");

    // No money read or moved.
    expect(mockGetWalletBalance).not.toHaveBeenCalled();
    expect(mockDeductUsage).not.toHaveBeenCalled();

    // $0 ledger row keeps the deploy auditable.
    expect(mockWalletTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "gpu_deploy",
          stripeCustomerId: "cus_1",
          amountCents: 0,
          hourlyRateCents: 200,
          billingMinutes: 30,
        }),
      }),
    );

    // Metadata: nothing prepaid, but the normal hourly billing cadence stands.
    const metaData = mockPodMetadataCreate.mock.calls[0][0].data;
    expect(metaData.prepaidAmountCents).toBe(0);
    expect(metaData.prepaidUntil).toBeInstanceOf(Date);
    expect(metaData.billingType).toBe("hourly");
    expect(metaData.hourlyRateCents).toBe(200);

    // The deploy monitor must not think there is money to refund.
    expect(mockMonitorDeployStatus).toHaveBeenCalledWith(
      expect.objectContaining({ prechargedCents: 0 }),
    );
  });

  it("never refunds when the HAI deploy fails (nothing was charged)", async () => {
    mockCreateInstance.mockRejectedValue(new Error("Insufficient resources 10189007"));

    const res = await POST(makeReq(createBody()));
    expect(res.status).toBe(503);

    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("control: a regular account still hits the balance gate with an empty wallet", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      accountId: "cus_1",
      teamId: "team-1",
      customer: { id: "cus_1", email: "customer@example.com", name: "Reg", metadata: { hostedai_team_id: "team-1" } },
    });

    const res = await POST(makeReq(createBody()));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Insufficient wallet balance");
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  /* The dashboard deploy path had the same gap as the public API: it read the
     pool's free vGPUs, logged them, and charged anyway. */
  it("refuses a full pool before charging, and says so", async () => {
    mockGetServiceCompatibleGPUPools.mockResolvedValue([]);

    const res = await POST(makeReq(createBody()));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no free capacity/i);
    expect(mockDeductUsage).not.toHaveBeenCalled();
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("still deploys when the capacity lookup itself fails", async () => {
    mockGetServiceCompatibleGPUPools.mockRejectedValue(new Error("upstream timeout"));

    const res = await POST(makeReq(createBody()));

    expect(res.status).toBeLessThan(400);
    expect(mockCreateInstance).toHaveBeenCalled();
  });
});
