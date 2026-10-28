// Tests for POST/GET /api/huggingface/deploy (src/app/api/huggingface/deploy/route.ts).
//
// PA-320 coverage deepening. The POST handler is the HF deploy orchestrator:
// auth gate (getAuthenticatedCustomer) → team check → huggingface.use
// permission gate → payload validation → product lookup → catalog/disk
// estimation → token validation → provisioning-info → storage capacity check
// → wallet balance → pre-charge → createInstance (refund on failure) →
// PodMetadata + HuggingFaceDeployment records → 200. We mock every lib
// boundary and assert the real branches + status codes the existing shallow
// test misses (401/400/402/404/500/503/200, refund-on-failure).
//
// Boundary mocks follow the admin/pods.test.ts pattern (vi.hoisted + vi.mock).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockCreateInstance,
  mockGetServiceProvisioningInfo,
  mockGetServiceCompatibleGPUPools,
  mockGetTeamWorkspaces,
  mockGetStorageBlocks,
  mockGetWalletBalance,
  mockDeductUsage,
  mockRefundDeployment,
  mockGetCatalogItem,
  mockValidateDeployParams,
  mockGetDefaultPort,
  mockGetModelInfo,
  mockEstimateDiskSizeFromModel,
  mockGpuProductFindUnique,
  mockPodMetadataCreate,
  mockHfDeploymentCreate,
  mockHfDeploymentFindMany,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockCreateInstance: vi.fn(),
  mockGetServiceProvisioningInfo: vi.fn(),
  mockGetServiceCompatibleGPUPools: vi.fn(),
  mockGetTeamWorkspaces: vi.fn(),
  mockGetStorageBlocks: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockDeductUsage: vi.fn(),
  mockRefundDeployment: vi.fn(),
  mockGetCatalogItem: vi.fn(),
  mockValidateDeployParams: vi.fn(),
  mockGetDefaultPort: vi.fn(),
  mockGetModelInfo: vi.fn(),
  mockEstimateDiskSizeFromModel: vi.fn(),
  mockGpuProductFindUnique: vi.fn(),
  mockPodMetadataCreate: vi.fn(),
  mockHfDeploymentCreate: vi.fn(),
  mockHfDeploymentFindMany: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: vi.fn() }));
vi.mock("@/lib/auth/helpers", () => ({ getAuthenticatedCustomer: mockGetAuthenticatedCustomer }));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: vi.fn() }));
vi.mock("@/lib/maintenance/regions", () => ({
  // Keep the real-ish class so `error instanceof RegionMaintenanceError` works.
  RegionMaintenanceError: class RegionMaintenanceError extends Error {},
}));
vi.mock("@/lib/hostedai", () => ({
  createInstance: mockCreateInstance,
  getServiceProvisioningInfo: mockGetServiceProvisioningInfo,
  getServiceCompatibleGPUPools: mockGetServiceCompatibleGPUPools,
  getTeamWorkspaces: mockGetTeamWorkspaces,
  getStorageBlocks: mockGetStorageBlocks,
}));
vi.mock("@/lib/wallet", () => ({
  getWalletBalance: mockGetWalletBalance,
  deductUsage: mockDeductUsage,
  refundDeployment: mockRefundDeployment,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: { findUnique: mockGpuProductFindUnique },
    podMetadata: { create: mockPodMetadataCreate },
    huggingFaceDeployment: { create: mockHfDeploymentCreate, findMany: mockHfDeploymentFindMany },
  },
}));
vi.mock("@/lib/huggingface-catalog", () => ({ getCatalogItem: mockGetCatalogItem }));
vi.mock("@/lib/huggingface-deploy-scripts", () => ({
  validateDeployParams: mockValidateDeployParams,
  getDefaultPort: mockGetDefaultPort,
}));
vi.mock("@/lib/huggingface-api", () => ({
  getModelInfo: mockGetModelInfo,
  estimateDiskSizeFromModel: mockEstimateDiskSizeFromModel,
  STANDARD_EPHEMERAL_STORAGE_GB: 150,
}));
vi.mock("@/lib/activity", () => ({ logActivity: mockLogActivity }));

import { POST, GET } from "@/app/api/huggingface/deploy/route";

const AUTH = {
  payload: { customerId: "cus_1", email: "a@x.com" },
  customer: { id: "cus_1", email: "a@x.com" },
  teamId: "team-1",
  accountId: "cus_1",
};

const VALID_BODY = {
  hfItemId: "meta-llama/Llama-3-8B",
  product_id: "prod-1",
  region_id: 5,
  gpuCount: 1,
};

function makeReq(body?: unknown) {
  const headers = new Headers({ authorization: "Bearer t", "content-type": "application/json" });
  return new NextRequest("http://localhost/api/huggingface/deploy", {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify(VALID_BODY),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH });
  mockRequirePermission.mockReturnValue(null); // allow by default
  mockGpuProductFindUnique.mockResolvedValue({
    id: "prod-1",
    active: true,
    serviceId: "svc-1",
    name: "A100",
    pricePerHourCents: 200,
  });
  mockGetCatalogItem.mockReturnValue(undefined); // HF-hub item path by default
  mockGetModelInfo.mockResolvedValue(null);
  mockEstimateDiskSizeFromModel.mockReturnValue(0);
  mockGetDefaultPort.mockReturnValue(8000);
  mockValidateDeployParams.mockReturnValue({ valid: true, errors: [] });
  mockGetServiceProvisioningInfo.mockResolvedValue({
    instance_type_details: { default: { id: "it-1" } },
    image_details: { default: { hash: "img-hash-1" } },
    storage_block_details: { default: { id: "sb-1" } },
    gpu_pool_details: { default: [{ id: 99 }] },
  });
  mockGetStorageBlocks.mockResolvedValue([{ id: "sb-1", size_gb: 500 }]);
  mockGetWalletBalance.mockResolvedValue({ availableBalance: 100000 });
  mockDeductUsage.mockResolvedValue({ success: true });
  mockGetServiceCompatibleGPUPools.mockResolvedValue([{ id: 42 }]);
  mockGetTeamWorkspaces.mockResolvedValue([{ id: "ws-1" }]);
  mockCreateInstance.mockResolvedValue("inst-1");
  mockPodMetadataCreate.mockResolvedValue({});
  mockHfDeploymentCreate.mockResolvedValue({
    id: "dep-1",
    hfItemName: "Llama-3-8B",
    status: "pending",
    servicePort: 8000,
    openWebUI: false,
    webUiPort: null,
    netdata: false,
    netdataPort: null,
  });
  mockRefundDeployment.mockResolvedValue(undefined);
});

describe("POST /api/huggingface/deploy — auth & permission gating", () => {
  it("returns the auth NextResponse verbatim when getAuthenticatedCustomer denies", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(denied);
    const res = await POST(makeReq());
    expect(res).toBe(denied);
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });

  it("returns 400 when the auth context has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...AUTH, teamId: undefined });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No team associated with this account");
  });

  it("returns the permission denial verbatim (huggingface.use gate)", async () => {
    const denial = NextResponse.json({ error: "denied" }, { status: 403 });
    mockRequirePermission.mockReturnValue(denial);
    const res = await POST(makeReq());
    expect(res).toBe(denial);
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "huggingface.use",
      expect.anything()
    );
    expect(mockGpuProductFindUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/huggingface/deploy — payload & product validation", () => {
  it("returns 400 when hfItemId is missing", async () => {
    const res = await POST(makeReq({ product_id: "p", region_id: 5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("hfItemId is required");
  });

  it("returns 400 when product_id is missing", async () => {
    const res = await POST(makeReq({ hfItemId: "x/y", region_id: 5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("product_id is required");
  });

  it("returns 400 when region_id is missing", async () => {
    const res = await POST(makeReq({ hfItemId: "x/y", product_id: "p" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("region_id is required");
  });

  it("returns 404 when the product is missing or inactive", async () => {
    mockGpuProductFindUnique.mockResolvedValue({ id: "p", active: false, serviceId: "s" });
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Product not found or inactive");
  });

  it("returns 400 when the product has no HAI service configured", async () => {
    mockGpuProductFindUnique.mockResolvedValue({ id: "p", active: true, serviceId: null });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Product has no HAI service configured");
  });
});

describe("POST /api/huggingface/deploy — token & deploy-param validation", () => {
  it("returns 400 with requiresToken when a gated catalog model has no token", async () => {
    mockGetCatalogItem.mockReturnValue({
      type: "model",
      name: "Gated",
      deployScript: "tgi",
      gated: true,
      diskSizeGb: 10,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.requiresToken).toBe(true);
    expect(body.error).toContain("requires a HuggingFace token");
  });

  it("returns 400 when an hfToken has the wrong prefix", async () => {
    const res = await POST(makeReq({ ...VALID_BODY, hfToken: "bad_token" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("start with 'hf_'");
  });

  it("returns 400 joining the deploy-param validation errors", async () => {
    mockValidateDeployParams.mockReturnValue({ valid: false, errors: ["bad port", "no model"] });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad port, no model");
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });
});

describe("POST /api/huggingface/deploy — provisioning & storage", () => {
  it("returns 500 when provisioning-info throws", async () => {
    mockGetServiceProvisioningInfo.mockRejectedValue(new Error("prov down"));
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Could not resolve GPU configuration");
  });

  it("returns 500 when locked instance type / image / storage are incomplete", async () => {
    mockGetServiceProvisioningInfo.mockResolvedValue({
      instance_type_details: { default: { id: "it-1" } },
      image_details: { default: {} }, // no hash
      storage_block_details: { default: { id: "sb-1" } },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("not fully configured");
  });

  it("returns 400 when the model disk footprint exceeds the pod's root storage", async () => {
    mockGetCatalogItem.mockReturnValue({
      type: "model",
      name: "Big",
      deployScript: "tgi",
      diskSizeGb: 600, // > 500 storage block
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("exceeds");
    expect(body.diskSizeGb).toBe(600);
    expect(body.limitGb).toBe(500);
  });
});

describe("POST /api/huggingface/deploy — wallet & charge", () => {
  it("returns 400 when the product has zero pricing", async () => {
    mockGpuProductFindUnique.mockResolvedValue({
      id: "prod-1", active: true, serviceId: "svc-1", name: "Free", pricePerHourCents: 0,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No valid pricing found for this product.");
  });

  it("returns 402 when the wallet balance is below the pre-charge", async () => {
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 1 });
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Insufficient balance");
    expect(mockDeductUsage).not.toHaveBeenCalled();
  });

  it("returns 402 when deductUsage reports failure", async () => {
    mockDeductUsage.mockResolvedValue({ success: false });
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain("Failed to process payment");
    expect(mockCreateInstance).not.toHaveBeenCalled();
  });
});

describe("POST /api/huggingface/deploy — deploy & refund", () => {
  it("refunds the pre-charge and surfaces an error when createInstance throws", async () => {
    mockCreateInstance.mockRejectedValue(new Error("HAI boom"));
    const res = await POST(makeReq());
    expect(mockRefundDeployment).toHaveBeenCalledTimes(1);
    // The 200-cent/hr * 0.5h = 100-cent pre-charge is refunded.
    expect(mockRefundDeployment).toHaveBeenCalledWith("cus_1", 100, expect.stringContaining("Refund"));
    expect(res.status).toBe(500);
  });

  it("maps a 'No GPUs currently available' deploy error to 503", async () => {
    mockCreateInstance.mockRejectedValue(new Error("No GPUs currently available"));
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("No GPUs currently available");
  });

  it("creates the instance + metadata + deployment and returns success on the happy path", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deployment.id).toBe("dep-1");
    expect(body.deployment.subscriptionId).toBe("inst-1");
    expect(mockCreateInstance).toHaveBeenCalledTimes(1);
    expect(mockPodMetadataCreate).toHaveBeenCalledTimes(1);
    expect(mockHfDeploymentCreate).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      "cus_1",
      "hf_deployment_started",
      expect.any(String),
      expect.objectContaining({ deploymentId: "dep-1", instanceId: "inst-1" })
    );
    expect(mockRefundDeployment).not.toHaveBeenCalled();
  });

  it("still returns 200 when PodMetadata creation throws (non-fatal)", async () => {
    mockPodMetadataCreate.mockRejectedValue(new Error("meta down"));
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockHfDeploymentCreate).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/huggingface/deploy — list deployments", () => {
  function getReq() {
    return new NextRequest("http://localhost/api/huggingface/deploy", {
      method: "GET",
      headers: new Headers({ authorization: "Bearer t" }),
    });
  }

  it("returns the auth response verbatim when unauthenticated", async () => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(denied);
    const res = await GET(getReq());
    expect(res).toBe(denied);
  });

  it("returns the customer's deployments shaped with ISO timestamps", async () => {
    mockHfDeploymentFindMany.mockResolvedValue([
      {
        id: "dep-1",
        subscriptionId: "inst-1",
        hfItemId: "x/y",
        hfItemName: "Y",
        hfItemType: "model",
        deployScript: "tgi",
        status: "running",
        servicePort: 8000,
        openWebUI: false,
        webUiPort: null,
        netdata: false,
        netdataPort: null,
        errorMessage: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-02T00:00:00Z"),
      },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deployments).toHaveLength(1);
    expect(body.deployments[0].createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(mockHfDeploymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_1" } })
    );
  });

  it("returns 500 when the deployment query throws", async () => {
    mockHfDeploymentFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get deployments");
  });
});

// A session operating a monthly billing artefact holds no wallet on the
// operating account; the hourly deploy is paid from the hourly customer.
describe("POST /api/huggingface/deploy — hourly wallet vs operating account", () => {
  const MONTHLY_AUTH = { ...AUTH, accountId: "cus_monthly", hourlyCustomerId: "cus_hourly" };

  beforeEach(() => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...MONTHLY_AUTH });
    mockGetWalletBalance.mockImplementation(async (id: string) => ({
      availableBalance: id === "cus_hourly" ? 100000 : 0,
    }));
  });

  it("gates and charges the hourly wallet, not the operating account", async () => {
    const res = await POST(makeReq());

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

  it("stamps the pod with the wallet that paid, and the deployment with the owner", async () => {
    await POST(makeReq());

    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_hourly");
    expect(mockHfDeploymentCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_monthly");
  });

  it("refunds the hourly wallet when the deploy fails", async () => {
    mockCreateInstance.mockRejectedValue(new Error("boom"));

    await POST(makeReq());

    expect(mockRefundDeployment).toHaveBeenCalledWith(
      "cus_hourly",
      expect.any(Number),
      expect.stringContaining("Refund"),
    );
  });

  it("falls back to the operating account when the context resolves no hourly customer", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({ ...MONTHLY_AUTH, hourlyCustomerId: null });
    mockGetWalletBalance.mockResolvedValue({ availableBalance: 100000 });

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(mockDeductUsage.mock.calls[0][0]).toBe("cus_monthly");
    expect(mockPodMetadataCreate.mock.calls[0][0].data.stripeCustomerId).toBe("cus_monthly");
  });
});
