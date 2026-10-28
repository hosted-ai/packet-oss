// GET /api/instances/[id]/system-metrics — DB mode reads gpuHardwareMetrics behind a
// podMetadata ownership check; SSH mode fetches HAI creds and shells out via sshpass.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGetInstanceCredentials,
  mockGetUnifiedInstanceDetail,
  mockResolveOperatingContext,
  mockPodMetaFindFirst,
  mockHwMetricsFindFirst,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetInstanceCredentials: vi.fn(),
  mockGetUnifiedInstanceDetail: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockPodMetaFindFirst: vi.fn(),
  mockHwMetricsFindFirst: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/hostedai", () => ({
  getInstanceCredentials: mockGetInstanceCredentials,
  getUnifiedInstanceDetail: mockGetUnifiedInstanceDetail,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findFirst: mockPodMetaFindFirst },
    gpuHardwareMetrics: { findFirst: mockHwMetricsFindFirst },
  },
}));

import { GET } from "@/app/api/instances/[id]/system-metrics/route";

const TOKEN = "Bearer valid.jwt.token";
const JWT_CUSTOMER = "cus_jwt";
const OPERATING_ACCOUNT = "cus_operating";
const HOURLY_CUSTOMER = "cus_hourly";
const SIBLING_ACCOUNT = "cus_sibling";
const STRANGER_ACCOUNT = "cus_stranger";
const PAYLOAD = { customerId: JWT_CUSTOMER, email: "alice@example.com" };

// The caller operates an account whose JWT customer, wallet and sibling account are
// three distinct ids, so a route reading any of the wrong ones shows up as a failure.
const OPERATING_CONTEXT = {
  accountId: OPERATING_ACCOUNT,
  hourlyCustomerId: HOURLY_CUSTOMER,
  allCustomerIds: [JWT_CUSTOMER, OPERATING_ACCOUNT, HOURLY_CUSTOMER, SIBLING_ACCOUNT],
  allTeamIds: ["team-A"],
};

const POD_TABLE: Record<string, string> = {
  "sub-operating": OPERATING_ACCOUNT,
  "sub-hourly": HOURLY_CUSTOMER,
  "sub-sibling": SIBLING_ACCOUNT,
  "sub-stranger": STRANGER_ACCOUNT,
};

// Stands in for prisma's filter so a route that widens its id set reaches rows it
// should not, instead of the mock returning whatever the test handed it.
function fakePodLookup({ where }: { where: { subscriptionId: string; stripeCustomerId?: unknown } }) {
  const owner = POD_TABLE[where.subscriptionId];
  if (!owner) return Promise.resolve(null);
  const scope = where.stripeCustomerId;
  const allowed =
    typeof scope === "string"
      ? [scope]
      : ((scope as { in?: string[] } | undefined)?.in ?? []);
  return Promise.resolve(allowed.includes(owner) ? { subscriptionId: where.subscriptionId } : null);
}

function makeRequest(authorized = true, id = "sub-1") {
  const headers = new Headers();
  if (authorized) headers.set("authorization", TOKEN);
  return new NextRequest(`http://localhost/api/instances/${id}/system-metrics`, {
    method: "GET",
    headers,
  });
}

function call(id = "sub-1", authorized = true) {
  return GET(makeRequest(authorized, id), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockResolveOperatingContext.mockResolvedValue(OPERATING_CONTEXT);
  delete process.env.GPU_METRICS_SOURCE;
});

afterEach(() => {
  delete process.env.GPU_METRICS_SOURCE;
});

describe("GET /api/instances/[id]/system-metrics — auth", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await call("sub-1", false);
    expect(res.status).toBe(401);
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
    expect(mockPodMetaFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });
});

describe("GET /api/instances/[id]/system-metrics — DB mode ownership", () => {
  beforeEach(() => {
    process.env.GPU_METRICS_SOURCE = "db";
    mockPodMetaFindFirst.mockImplementation(fakePodLookup);
    mockHwMetricsFindFirst.mockResolvedValue(null);
  });

  it("reads a pod stamped with the operating account", async () => {
    const res = await call("sub-operating");
    expect(res.status).toBe(200);
  });

  it("reads a pod stamped with the context's hourly wallet", async () => {
    const res = await call("sub-hourly");
    expect(res.status).toBe(200);
  });

  it("does NOT read a pod owned by a sibling account of the same person", async () => {
    const res = await call("sub-sibling");
    expect(res.status).toBe(404);
    expect(mockHwMetricsFindFirst).not.toHaveBeenCalled();
  });

  it("does NOT read an unrelated account's pod", async () => {
    const res = await call("sub-stranger");
    expect(res.status).toBe(404);
    expect(mockHwMetricsFindFirst).not.toHaveBeenCalled();
  });

  it("never scopes the lookup to the JWT customer", async () => {
    await call("sub-operating");
    const scope = mockPodMetaFindFirst.mock.calls[0][0].where.stripeCustomerId;
    expect(scope).toEqual({ in: [OPERATING_ACCOUNT, HOURLY_CUSTOMER] });
  });

  it("returns 404 when the caller has no operating account", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    const res = await call("sub-operating");
    expect(res.status).toBe(404);
    expect(mockPodMetaFindFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/instances/[id]/system-metrics — DB mode payload", () => {
  beforeEach(() => {
    process.env.GPU_METRICS_SOURCE = "db";
    mockPodMetaFindFirst.mockImplementation(fakePodLookup);
  });

  it("returns the latest metrics row for an owned subscription", async () => {
    const ts = new Date("2026-06-11T00:00:00.000Z");
    mockHwMetricsFindFirst.mockResolvedValue({
      gpuUtilization: 55,
      memoryUsedMb: 4000,
      memoryTotalMb: 8000,
      memoryPercent: 50,
      temperature: 60,
      powerDraw: 120,
      powerLimit: 250,
      fanSpeed: 40,
      timestamp: ts,
    });

    const res = await call("sub-operating");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.subscriptionId).toBe("sub-operating");
    expect(body.metrics.gpu).toEqual({
      utilization: 55,
      memoryUsed: 4000,
      memoryTotal: 8000,
      memoryPercent: 50,
      temperature: 60,
      powerDraw: 120,
      powerLimit: 250,
      fanSpeed: 40,
    });
    expect(body.timestamp).toBe(ts.toISOString());
  });

  it("returns a gpu:null envelope when no recent metrics exist (no crash)", async () => {
    mockHwMetricsFindFirst.mockResolvedValue(null);

    const res = await call("sub-operating");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.gpu).toBeNull();
    expect(body.timestamp).toBeTypeOf("string");
  });
});

describe("GET /api/instances/[id]/system-metrics — SSH mode pre-spawn branches", () => {
  beforeEach(() => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({ team: { id: "team-A" } });
  });

  it("returns 404 when getInstanceCredentials throws (instance not running)", async () => {
    mockGetInstanceCredentials.mockRejectedValue(new Error("HAI 404"));
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns 400 when SSH credentials are incomplete (before any spawn)", async () => {
    mockGetInstanceCredentials.mockResolvedValue({
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      password: "",
    });
    const res = await call();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("SSH credentials not available");
  });
});

// Ownership comes from HAI's reported owning team, which the caller cannot spoof, and a
// denial 404s before any credential fetch so another team's live telemetry stays unreachable.
describe("GET /api/instances/[id]/system-metrics — SSH mode ownership", () => {
  beforeEach(() => {
    mockGetInstanceCredentials.mockResolvedValue({
      ip: "9.9.9.9",
      port: 22,
      username: "root",
      password: "s3cret",
    });
  });

  it("returns 404 and does NOT fetch credentials for another team's instance", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({ team: { id: "team-B" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
  });

  it("returns 404 when the instance has no owning team (unattributable)", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({ id: "sub-1" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
  });

  it("returns 404 when the instance cannot be resolved (HAI throws)", async () => {
    mockGetUnifiedInstanceDetail.mockRejectedValue(new Error("HAI 404"));
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller has no operating account", async () => {
    mockResolveOperatingContext.mockResolvedValue(null);
    mockGetUnifiedInstanceDetail.mockResolvedValue({ team: { id: "team-A" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
  });

  it("proceeds to the credential fetch for the caller's own instance", async () => {
    mockGetUnifiedInstanceDetail.mockResolvedValue({ team: { id: "team-A" } });
    mockGetInstanceCredentials.mockResolvedValue({
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      password: "",
    });
    const res = await call();
    expect(mockGetInstanceCredentials).toHaveBeenCalledWith("sub-1");
    expect(res.status).toBe(400);
  });
});
