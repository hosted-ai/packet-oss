// An hourly deploy is gated, charged and refunded on the wallet that entitled
// the product, which a monthly-billing operating account does not hold.
//
// Mock scaffolding copied from instances-internal-zero-billing.test.ts.

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
  mockSSHKeyFindMany,
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
  mockSSHKeyFindMany: vi.fn(),
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
    sSHKey: { findMany: mockSSHKeyFindMany },
  },
}));
vi.mock("@/lib/internal-accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/internal-accounts")>();
  return {
    ...actual,
    getInternalExclusions: vi.fn().mockResolvedValue({ domains: [], emails: [] }),
  };
});

import { POST } from "@/app/api/instances/route";

const EMAIL = "customer@example.com";
const OPERATING = "cus_monthly_artefact";
const HOURLY = "cus_hourly";

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

// A session pinned to a monthly billing artefact: the operating account holds
// no wallet, while another customer on the same email does.
const MONTHLY_ARTEFACT_CTX = {
  accountId: OPERATING,
  customer: { id: OPERATING, email: EMAIL, name: "Cust", metadata: { hostedai_team_id: "team-1", billing_type: "monthly" } },
  teamId: "team-1",
  allTeamIds: ["team-1"],
  allCustomerIds: [OPERATING, HOURLY],
  monthlyCustomerIds: [OPERATING],
  hourlyCustomerId: HOURLY,
};

function body(extra: Record<string, unknown> = {}) {
  return { name: "my-pod", product_id: "prod-1", region_id: 5, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue({ customerId: HOURLY, email: EMAIL, userId: "u1" });
  mockGetStripe.mockResolvedValue(STRIPE);
  STRIPE.customers.update.mockResolvedValue({});
  STRIPE.customers.retrieve.mockResolvedValue({ id: OPERATING, metadata: {} });
  mockGatePermission.mockResolvedValue(null);
  mockIsRegionInMaintenance.mockResolvedValue({ inMaintenance: false });
  mockResolveOperatingContext.mockResolvedValue(MONTHLY_ARTEFACT_CTX);
  mockGpuProductFindUnique.mockResolvedValue(PRODUCT);
  mockGetTeamWorkspaces.mockResolvedValue([{ id: "ws-1", name: "ws" }]);
  mockGetServiceProvisioningInfo.mockResolvedValue({
    instance_type_details: { default: { id: "it-1" } },
    image_details: { default: { hash: "img-1" } },
    storage_block_details: { default: { id: "sb-1" } },
  });
  mockGetServiceCompatibleGPUPools.mockResolvedValue([{ id: 7, name: "p", available_vgpus: 4 }]);
  // Only the hourly customer is funded.
  mockGetWalletBalance.mockImplementation(async (id: string) => ({
    availableBalance: id === HOURLY ? 50_000 : 0,
  }));
  mockDeductUsage.mockResolvedValue({ success: true });
  mockCreateInstance.mockResolvedValue("inst-9");
  mockPodMetadataCreate.mockResolvedValue({});
  mockWalletTransactionCreate.mockResolvedValue({});
  mockSSHKeyFindMany.mockResolvedValue([]);
  mockMonitorDeployStatus.mockResolvedValue({ ready: false });
});

describe("POST /api/instances — an hourly deploy bills the hourly wallet", () => {
  it("gates and charges the hourly customer when the operating account is a monthly artefact", async () => {
    const res = await POST(makeReq(body()));

    expect(res.status).toBe(200);
    expect(mockGetWalletBalance).toHaveBeenCalledWith(HOURLY);
    expect(mockDeductUsage).toHaveBeenCalledWith(
      HOURLY,
      expect.any(Number),
      expect.any(String),
      200,
      expect.stringContaining(`predeploy_${HOURLY}_`),
    );
  });

  it("stamps the pod and the ledger row with the wallet that paid", async () => {
    await POST(makeReq(body()));

    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe(HOURLY);
    expect(mockWalletTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "gpu_deploy", stripeCustomerId: HOURLY }) }),
    );
    expect(mockMonitorDeployStatus).toHaveBeenCalledWith(expect.objectContaining({ customerId: HOURLY }));
  });

  it("402s on the hourly wallet's balance, not the operating account's", async () => {
    mockGetWalletBalance.mockImplementation(async (id: string) => ({
      availableBalance: id === HOURLY ? 0 : 50_000,
    }));

    const res = await POST(makeReq(body()));

    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Insufficient wallet balance");
    expect(mockDeductUsage).not.toHaveBeenCalled();
  });

  it("refunds the charged wallet when the HAI deploy fails", async () => {
    mockCreateInstance.mockRejectedValue(new Error("boom"));

    await POST(makeReq(body()));

    expect(mockRefundDeployment).toHaveBeenCalledWith(HOURLY, 100, expect.stringContaining("Refund"));
  });

  it("refunds the charged wallet when the deploy aborts before the HAI call", async () => {
    mockSSHKeyFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeReq(body({ ssh_key_ids: ["key-1"] })));

    expect(res.status).toBe(500);
    expect(mockCreateInstance).not.toHaveBeenCalled();
    expect(mockRefundDeployment).toHaveBeenCalledWith(HOURLY, 100, expect.stringContaining("aborted"));
  });

  it("bills the operating account when the context resolves no hourly customer", async () => {
    mockResolveOperatingContext.mockResolvedValue({ ...MONTHLY_ARTEFACT_CTX, hourlyCustomerId: null });
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 50_000 });

    const res = await POST(makeReq(body()));

    expect(res.status).toBe(200);
    expect(mockGetWalletBalance).toHaveBeenCalledWith(OPERATING);
    expect(mockDeductUsage.mock.calls[0][0]).toBe(OPERATING);
    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe(OPERATING);
  });

  it("deploys into the context's team when the operating account carries none", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...MONTHLY_ARTEFACT_CTX,
      customer: { ...MONTHLY_ARTEFACT_CTX.customer, metadata: { billing_type: "monthly" } },
    });

    const res = await POST(makeReq(body()));

    expect(res.status).toBe(200);
    expect(mockCreateInstance).toHaveBeenCalledWith(expect.objectContaining({ team_id: "team-1" }));
  });
});
