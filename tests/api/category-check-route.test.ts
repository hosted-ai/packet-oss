// GET /api/instances/category-check returns checkFailed only for transient HAI failures
// (timeout / network / 5xx); genuine-empty, a stale scenario 404 and a missing scenarioId do not.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetAuthenticatedCustomer,
  mockGetScenarioCompatibleServices,
  mockGetServiceCompatibleRegions,
  mockGetMaintenanceMap,
  mockGpuCategoryFindUnique,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetScenarioCompatibleServices: vi.fn(),
  mockGetServiceCompatibleRegions: vi.fn(),
  mockGetMaintenanceMap: vi.fn(),
  mockGpuCategoryFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  getScenarioCompatibleServices: mockGetScenarioCompatibleServices,
  getServiceCompatibleRegions: mockGetServiceCompatibleRegions,
}));
vi.mock("@/lib/maintenance/regions", () => ({ getMaintenanceMap: mockGetMaintenanceMap }));
vi.mock("@/lib/prisma", () => ({
  prisma: { gpuCategory: { findUnique: mockGpuCategoryFindUnique } },
}));

import { GET } from "@/app/api/instances/category-check/route";

function makeRequest(categoryId = "cat-b200") {
  return new NextRequest(
    `http://localhost/api/instances/category-check?categoryId=${categoryId}`,
    { headers: { authorization: "Bearer valid-token" } },
  );
}

describe("GET /api/instances/category-check — checkFailed (PA-407)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedCustomer.mockResolvedValue({
      payload: { customerId: "cus_jwt", email: "alice@example.com" },
      accountId: "cus_operating",
      hourlyCustomerId: "cus_hourly",
      teamId: "team-operating",
      allTeamIds: ["team-operating"],
    });
    mockGpuCategoryFindUnique.mockResolvedValue({ scenarioId: "scen-b200", name: "NVIDIA B200" });
    mockGetServiceCompatibleRegions.mockResolvedValue([]);
    mockGetMaintenanceMap.mockResolvedValue(new Map());
  });

  it("flags checkFailed on a HAI timeout (retry-worthy, not empty inventory)", async () => {
    mockGetScenarioCompatibleServices.mockRejectedValue(
      new Error("TIMEOUT: Request to /service/i/scenario-compatible-services timed out after 45000ms"),
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkFailed).toBe(true);
    expect(body.compatibleServiceIds).toEqual([]);
  });

  it("flags checkFailed on a generic HAI/network error", async () => {
    mockGetScenarioCompatibleServices.mockRejectedValue(new Error("fetch failed"));
    const body = await (await GET(makeRequest())).json();
    expect(body.checkFailed).toBe(true);
  });

  it("does NOT flag checkFailed when HAI returns genuine zero inventory", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue({ services: [], has_more_batches: false, next_offset: 0 });
    const body = await (await GET(makeRequest())).json();
    expect(body.checkFailed).toBe(false);
    expect(body.compatibleServiceIds).toEqual([]);
  });

  it("does NOT flag checkFailed on success with compatible services", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue([{ id: "svc-1" }, { id: "svc-2" }]);
    const body = await (await GET(makeRequest())).json();
    expect(body.checkFailed).toBe(false);
    expect([...body.compatibleServiceIds].sort()).toEqual(["svc-1", "svc-2"]);
  });

  it("does NOT flag checkFailed on a stale-scenario 404 (config issue, retry won't help)", async () => {
    mockGetScenarioCompatibleServices.mockRejectedValue(
      new Error("Hosted.ai API error (404): scenario not found"),
    );
    const body = await (await GET(makeRequest())).json();
    expect(body.checkFailed).toBe(false);
  });

  it("checks compatibility against the operating account's team, not the JWT customer's", async () => {
    mockGetScenarioCompatibleServices.mockResolvedValue([{ id: "svc-1" }]);
    await GET(makeRequest());
    expect(mockGetScenarioCompatibleServices).toHaveBeenCalledWith("scen-b200", "team-operating");
  });
});
