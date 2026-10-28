// GET and DELETE /api/apps scope InstalledApp rows to the operating account,
// which is the id apps/install writes and apps/status reads.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGatePermission,
  mockInstalledAppFindMany,
  mockInstalledAppDeleteMany,
  mockGpuAppFindMany,
  mockGetAppsScenarioId,
  mockGetScenarioCompatibleServices,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGatePermission: vi.fn(),
  mockInstalledAppFindMany: vi.fn(),
  mockInstalledAppDeleteMany: vi.fn(),
  mockGpuAppFindMany: vi.fn(),
  mockGetAppsScenarioId: vi.fn(),
  mockGetScenarioCompatibleServices: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ verifyCustomerToken: mockVerifyCustomerToken }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/scenarios", () => ({ getAppsScenarioId: mockGetAppsScenarioId }));
vi.mock("@/lib/hostedai", () => ({
  getScenarioCompatibleServices: mockGetScenarioCompatibleServices,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    installedApp: {
      findMany: mockInstalledAppFindMany,
      deleteMany: mockInstalledAppDeleteMany,
    },
    gpuApp: { findMany: mockGpuAppFindMany },
  },
}));

import { GET, DELETE } from "@/app/api/apps/route";

const JWT_CUSTOMER = "cus_jwt";
const OPERATING_ACCOUNT = "cus_operating";
const SUBSCRIPTION_ID = "i-abc";

function makeRequest(path: string, method: "GET" | "DELETE" = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { authorization: "Bearer t" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockResolvedValue({
    customerId: JWT_CUSTOMER,
    email: "alice@example.com",
  });
  mockResolveOperatingContext.mockResolvedValue({
    accountId: OPERATING_ACCOUNT,
    customer: { id: OPERATING_ACCOUNT, email: "owner@example.com" },
    teamId: null,
    allTeamIds: [],
  });
  mockGatePermission.mockResolvedValue(null);
  mockInstalledAppFindMany.mockResolvedValue([]);
  mockInstalledAppDeleteMany.mockResolvedValue({ count: 1 });
  mockGpuAppFindMany.mockResolvedValue([]);
});

describe("GET /api/apps — installation lookup scope", () => {
  it("reads installations for the operating account, not the JWT customer", async () => {
    const res = await GET(makeRequest(`/api/apps?subscriptionId=${SUBSCRIPTION_ID}`));
    expect(res.status).toBe(200);
    expect(mockInstalledAppFindMany).toHaveBeenCalledTimes(1);
    expect(mockInstalledAppFindMany.mock.calls[0][0].where).toMatchObject({
      subscriptionId: SUBSCRIPTION_ID,
      stripeCustomerId: OPERATING_ACCOUNT,
    });
  });

  it("returns 401 without a token and never touches the database", async () => {
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/apps?subscriptionId=${SUBSCRIPTION_ID}`),
    );
    expect(res.status).toBe(401);
    expect(mockInstalledAppFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the session resolves to no account", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await GET(makeRequest(`/api/apps?subscriptionId=${SUBSCRIPTION_ID}`));
    expect(res.status).toBe(404);
    expect(mockInstalledAppFindMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/apps — uninstall scope", () => {
  const path = `/api/apps?subscriptionId=${SUBSCRIPTION_ID}&appSlug=jupyter`;

  it("deletes the operating account's installation, not the JWT customer's", async () => {
    const res = await DELETE(makeRequest(path, "DELETE"));
    expect(res.status).toBe(200);
    expect(mockInstalledAppDeleteMany).toHaveBeenCalledWith({
      where: {
        subscriptionId: SUBSCRIPTION_ID,
        stripeCustomerId: OPERATING_ACCOUNT,
        app: { slug: "jupyter" },
      },
    });
  });

  it("returns 404 when no row matches, leaving other accounts untouched", async () => {
    mockInstalledAppDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(makeRequest(path, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("returns the gate denial without deleting anything", async () => {
    const { NextResponse } = await import("next/server");
    mockGatePermission.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 403 }),
    );
    const res = await DELETE(makeRequest(path, "DELETE"));
    expect(res.status).toBe(403);
    expect(mockInstalledAppDeleteMany).not.toHaveBeenCalled();
  });
});
