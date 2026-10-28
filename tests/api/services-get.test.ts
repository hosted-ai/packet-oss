/**
 * PA-227 — GET /api/services regression tests.
 *
 * Bug: Finance Manager hitting GET /api/services?instanceId=i-... got a 500
 * ("Cannot read properties of null (reading 'map')") instead of the standard
 * 403 permission error. Two distinct holes were involved:
 *
 *   1. The GET handler had no permission gate. Finance Manager (whose role
 *      excludes gpu.access) passed through getAuthenticatedCustomer and into
 *      the HAI call.
 *   2. The HAI 2.2 branch did `services.map(...)` without a null guard, and
 *      getExposedServices() could resolve to null when HAI returned a null
 *      body — producing the runtime TypeError instead of any clean response.
 *
 * These tests pin both holes shut.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockAuditCreate } = vi.hoisted(() => ({
  mockAuditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamAuditLog: { create: mockAuditCreate },
  },
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: vi.fn(),
}));

vi.mock("@/lib/hostedai", () => ({
  getExposedServices: vi.fn(),
  exposeService: vi.fn(),
  updateExposedService: vi.fn(),
  deleteExposedService: vi.fn(),
  getConnectionInfo: vi.fn(),
}));

vi.mock("@/lib/hostedai/client", () => ({
  clearCache: vi.fn(),
}));

// Mock the customer-auth + account-resolver path used by PUT.
vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: vi.fn(),
}));

vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: vi.fn(),
}));

vi.mock("@/lib/auth/membership", () => ({
  resolveMembership: vi.fn(),
}));

import { GET, PUT } from "@/app/api/services/route";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getExposedServices, updateExposedService } from "@/lib/hostedai";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { resolveOperatingContext } from "@/lib/auth/account-resolver";
import { resolveMembership } from "@/lib/auth/membership";
import type { AuthenticatedCustomer } from "@/lib/auth/helpers";
import type { PacketRole, Permission } from "@/lib/auth/role-permissions";

function makeAuth(role: PacketRole, isOwner = false): AuthenticatedCustomer {
  const grants: Record<PacketRole, ReadonlySet<Permission>> = {
    teamAdmin: new Set([
      "gpu.provision",
      "gpu.terminate",
      "gpu.access",
      "billing.view",
      "billing.manage",
      "team.invite",
      "team.manage",
      "api_keys.create",
      "api_keys.revoke",
      "ssh_keys.manage",
    ]),
    member: new Set([
      "gpu.provision",
      "gpu.terminate",
      "gpu.access",
      "api_keys.create",
      "api_keys.revoke",
      "ssh_keys.manage",
    ]),
    readOnlyMember: new Set(["gpu.access", "ssh_keys.manage"]),
    financeManager: new Set(["billing.view", "billing.manage"]),
  };
  const can = (perm: Permission) => isOwner || grants[role].has(perm);
  return {
    payload: { customerId: "cus_test", email: "fm@example.com" } as never,
    customer: { id: "cus_test", email: "fm@example.com" } as never,
    teamId: "team_1",
    allTeamIds: ["team_1"],
    stripe: {} as never,
    accountId: "cus_test",
    membership: {
      membershipId: "tm_1",
      userId: "user_1",
      accountId: "cus_test",
      role,
      isOwner,
      revokedAt: null,
      isImplicit: false,
    } as never,
    can: can as never,
  };
}

function makeReq(instanceId = "i-abc123"): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/services?instanceId=${instanceId}`,
    { method: "GET", headers: { authorization: "Bearer test-token" } },
  );
}

describe("GET /api/services — PA-227", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditCreate.mockResolvedValue({});
  });

  it("returns 403 with the standard permission shape for Finance Manager (not 500)", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(
      makeAuth("financeManager"),
    );

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      error: "You do not have permission to perform this action.",
      permission: "gpu.access",
      role: "financeManager",
      isOwner: false,
    });
    expect(getExposedServices).not.toHaveBeenCalled();
  });

  it("returns 200 with an empty list when the instance has no services", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("member"));
    // The lib boundary normalizes a null body and the platform's empty
    // envelope alike — pinned in tests/lib/hostedai/services.test.ts.
    vi.mocked(getExposedServices).mockResolvedValue([]);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ services: [] });
  });

  it("returns 200 with services for Read-only Member (regression — has gpu.access)", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(
      makeAuth("readOnlyMember"),
    );
    vi.mocked(getExposedServices).mockResolvedValue([
      {
        id: 1,
        service_name: "ollama",
        ip: "10.0.0.1",
        internal_port: 11434,
        external_port: 31000,
        protocol: "TCP",
        type: "http",
        status: "active",
      } as never,
    ]);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.services).toHaveLength(1);
    expect(body.services[0].service_name).toBe("ollama");
  });

  it("returns 200 with services for Team Admin (regression)", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(
      makeAuth("teamAdmin", true),
    );
    vi.mocked(getExposedServices).mockResolvedValue([] as never);

    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(getExposedServices).toHaveBeenCalledWith("i-abc123");
  });
});

describe("PUT /api/services — PA-227 follow-up (gate parity with POST/DELETE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditCreate.mockResolvedValue({});
    vi.mocked(verifyCustomerToken).mockReturnValue({
      customerId: "cus_test",
      email: "fm@example.com",
    } as never);
    vi.mocked(resolveOperatingContext).mockResolvedValue({
      accountId: "cus_test",
      customer: { id: "cus_test", email: "fm@example.com" },
      allCustomerIds: ["cus_test"],
      allTeamIds: ["team_1"],
    } as never);
  });

  function putReq(body: Record<string, unknown> = { id: 1, service_name: "renamed" }): NextRequest {
    return new NextRequest("http://localhost:3000/api/services", {
      method: "PUT",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("returns 403 for Finance Manager (gpu.provision required)", async () => {
    vi.mocked(resolveMembership).mockResolvedValue({
      userId: "user_1",
      role: "financeManager",
      isOwner: false,
      revokedAt: null,
    } as never);

    const res = await PUT(putReq());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      permission: "gpu.provision",
      role: "financeManager",
    });
    expect(updateExposedService).not.toHaveBeenCalled();
  });

  it("returns 403 for Read-only Member (no provision rights)", async () => {
    vi.mocked(resolveMembership).mockResolvedValue({
      userId: "user_1",
      role: "readOnlyMember",
      isOwner: false,
      revokedAt: null,
    } as never);

    const res = await PUT(putReq());
    expect(res.status).toBe(403);
    expect(updateExposedService).not.toHaveBeenCalled();
  });

  it("allows Team Member through and forwards to HAI", async () => {
    vi.mocked(resolveMembership).mockResolvedValue({
      userId: "user_1",
      role: "member",
      isOwner: false,
      revokedAt: null,
    } as never);
    vi.mocked(updateExposedService).mockResolvedValue({ id: 1, service_name: "renamed" } as never);

    const res = await PUT(putReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.service.service_name).toBe("renamed");
    expect(updateExposedService).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, service_name: "renamed" }),
    );
  });
});
