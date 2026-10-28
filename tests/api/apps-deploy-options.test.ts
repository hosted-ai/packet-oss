// Tests for GET /api/apps/deploy-options (src/app/api/apps/deploy-options/route.ts).
//
// This route decides what the Apps marketplace deploy modal can offer. Its
// availability verdict comes from the platform's scenario compatibility list,
// and the regression these pin is what an EMPTY answer means: the platform
// answers this scenario 200 with `services: null`, and taking that literally
// marks every GPU unavailable, leaving the customer nothing to deploy on.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockGpuProductFindMany,
  mockGetGpuScenarioId,
  mockGetScenarioCompatibleServices,
  mockGetServiceCompatibleRegions,
  mockGetWalletBalance,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockGpuProductFindMany: vi.fn(),
  mockGetGpuScenarioId: vi.fn(),
  mockGetScenarioCompatibleServices: vi.fn(),
  mockGetServiceCompatibleRegions: vi.fn(),
  mockGetWalletBalance: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: mockResolveOperatingContext }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/prisma", () => ({ prisma: { gpuProduct: { findMany: mockGpuProductFindMany } } }));
vi.mock("@/lib/scenarios", () => ({ getGpuScenarioId: mockGetGpuScenarioId }));
vi.mock("@/lib/hostedai", () => ({
  getScenarioCompatibleServices: mockGetScenarioCompatibleServices,
  getServiceCompatibleRegions: mockGetServiceCompatibleRegions,
}));
vi.mock("@/lib/wallet", () => ({ getWalletBalance: mockGetWalletBalance }));

import { GET } from "@/app/api/apps/deploy-options/route";

const PAYLOAD = { customerId: "cus_jwt", email: "a@x.com", userId: "u1" };
const CTX = {
  accountId: "cus_op",
  teamId: "team-1",
  customer: { id: "cus_op", email: "a@x.com", metadata: { hostedai_team_id: "team-1" } },
};
const PRODUCT = {
  id: "prod1",
  name: "NVIDIA A100",
  pricePerHourCents: 200,
  vramGb: 80,
  cudaCores: null,
  serviceId: "svc-1",
};
const REGIONS = [{ id: 6, region_name: "ind-k8s-2" }];

function makeReq(authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", "Bearer t");
  return new NextRequest("http://localhost/api/apps/deploy-options", { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockResolvedValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue({ ...CTX });
  mockGatePermission.mockResolvedValue(null); // allow
  mockGpuProductFindMany.mockResolvedValue([PRODUCT]);
  mockGetGpuScenarioId.mockResolvedValue("scenario-1");
  mockGetServiceCompatibleRegions.mockResolvedValue(REGIONS);
  mockGetWalletBalance.mockResolvedValue({ availableBalance: 6544 });
});

describe("GET /api/apps/deploy-options — availability", () => {
  it("still offers the product when the scenario answers with no services", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue({
      services: null,
      has_more_batches: false,
      next_offset: 3,
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const { products } = await res.json();

    // The region lookup is what actually qualifies a product; an empty
    // compatibility set skips it entirely and the modal renders nothing.
    expect(mockGetServiceCompatibleRegions).toHaveBeenCalledWith("svc-1", "team-1");
    expect(products[0].available).toBe(true);
    expect(products[0].regions).toEqual(REGIONS);
  });

  it("still offers the product when the scenario check throws", async () => {
    mockGetScenarioCompatibleServices.mockRejectedValue(new Error("platform down"));

    const res = await GET(makeReq());
    const { products } = await res.json();
    expect(products[0].available).toBe(true);
  });

  it("keeps a named answer authoritative and excludes services it omits", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue({ services: [{ id: "svc-other" }] });

    const res = await GET(makeReq());
    const { products } = await res.json();
    expect(mockGetServiceCompatibleRegions).not.toHaveBeenCalled();
    expect(products[0].available).toBe(false);
    expect(products[0].regions).toEqual([]);
  });

  it("marks a product unavailable when the platform reports no regions for it", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue({ services: [{ id: "svc-1" }] });
    mockGetServiceCompatibleRegions.mockResolvedValue([]);

    const res = await GET(makeReq());
    const { products } = await res.json();
    expect(products[0].available).toBe(false);
  });
});

// The quote has to name the wallet the deploy will charge, or a funded session
// reads $0.00 and never reaches the deploy.
describe("GET /api/apps/deploy-options — quotes the hourly wallet", () => {
  it("reads the hourly customer's balance when the operating account is a monthly artefact", async () => {
    mockResolveOperatingContext.mockResolvedValue({ ...CTX, hourlyCustomerId: "cus_hourly" });
    mockGetScenarioCompatibleServices.mockResolvedValue({ services: [{ id: "svc-1" }] });
    mockGetWalletBalance.mockImplementation(async (id: string) => ({
      availableBalance: id === "cus_hourly" ? 6544 : 0,
    }));

    const res = await GET(makeReq());
    const { walletBalanceCents } = await res.json();

    expect(mockGetWalletBalance).toHaveBeenCalledWith("cus_hourly");
    expect(walletBalanceCents).toBe(6544);
  });

  it("falls back to the operating account when the context resolves no hourly customer", async () => {
    mockResolveOperatingContext.mockResolvedValue({ ...CTX, hourlyCustomerId: null });
    mockGetScenarioCompatibleServices.mockResolvedValue({ services: [{ id: "svc-1" }] });

    await GET(makeReq());

    expect(mockGetWalletBalance).toHaveBeenCalledWith("cus_op");
  });
});
