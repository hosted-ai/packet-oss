// Tests for src/app/api/instances/connection-info/route.ts (PA-287 / PA-202).
//
// GET returns SSH connection details for the team's pods. This is the
// sensitive route: it hands back SSH commands + passwords, so it MUST gate on
// gpu.access via requirePermission (PA-202). A Finance Manager (no gpu.access)
// must be denied a 403 BEFORE any HAI/credential call.
//
// Auth is getAuthenticatedCustomer (NextResponse passthrough on failure). We
// run the REAL requirePermission (driven by auth.can) — mirroring
// services-get.test.ts — and mock only prisma.teamAuditLog.create (the
// fire-and-forget audit write) plus the HAI/prisma data boundaries.
//
// What we pin (SSH-leak coverage called out explicitly):
//   * Auth NextResponse passthrough -> no HAI call, no SSH details.
//   * Finance Manager -> 403 (no gpu.access); getConnectionInfo /
//     getInstanceCredentials NEVER called -> no SSH-credential leak.
//   * Read-only Member (has gpu.access) is allowed through.
//   * No team -> 400.
//   * instanceId branch: forwards to getInstanceCredentials and returns
//     instanceCredentials; getInstanceCredentials throw -> 500.
//   * all-teams branch: merges + dedupes connection info across teams.
//   * Top-level throw -> 500.
//
// We avoid the fetchInternalIP sshpass spawn by returning non-running pods
// (enrichment is skipped) and creds without a full ip/port/username triple.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedCustomer } from "@/lib/auth/helpers";
import type { PacketRole, Permission } from "@/lib/auth/role-permissions";

const {
  mockGetAuthenticatedCustomer,
  mockGetConnectionInfo,
  mockGetInstanceCredentials,
  mockGetTeamInstances,
  mockGetUnifiedInstanceDetail,
  mockPodMetaFindFirst,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetConnectionInfo: vi.fn(),
  mockGetInstanceCredentials: vi.fn(),
  mockGetTeamInstances: vi.fn(),
  mockGetUnifiedInstanceDetail: vi.fn(),
  mockPodMetaFindFirst: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/hostedai", () => ({
  getConnectionInfo: mockGetConnectionInfo,
  getInstanceCredentials: mockGetInstanceCredentials,
  getTeamInstances: mockGetTeamInstances,
  getUnifiedInstanceDetail: mockGetUnifiedInstanceDetail,
}));
vi.mock("@/lib/ssh-validation", () => ({ validateSSHParams: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: { findFirst: mockPodMetaFindFirst },
    teamAuditLog: { create: mockAuditCreate },
  },
}));

import { GET } from "@/app/api/instances/connection-info/route";

// Mirror of services-get.test.ts makeAuth: a real auth object whose `can`
// reflects the role's grants, so the REAL requirePermission gates correctly.
function makeAuth(role: PacketRole, isOwner = false): AuthenticatedCustomer {
  const grants: Record<PacketRole, ReadonlySet<Permission>> = {
    teamAdmin: new Set([
      "gpu.provision", "gpu.terminate", "gpu.access", "billing.view",
      "billing.manage", "team.invite", "team.manage", "api_keys.create",
      "api_keys.revoke", "ssh_keys.manage",
    ]),
    member: new Set([
      "gpu.provision", "gpu.terminate", "gpu.access", "api_keys.create",
      "api_keys.revoke", "ssh_keys.manage",
    ]),
    readOnlyMember: new Set(["gpu.access", "ssh_keys.manage"]),
    financeManager: new Set(["billing.view", "billing.manage"]),
  };
  const can = (perm: Permission) => isOwner || grants[role].has(perm);
  return {
    payload: { customerId: "cus_op", email: "a@example.com" } as never,
    customer: { id: "cus_op", email: "a@example.com" } as never,
    teamId: "team_1",
    allTeamIds: ["team_1"],
    stripe: {} as never,
    accountId: "cus_op",
    membership: {
      membershipId: "tm_1",
      userId: "user_1",
      accountId: "cus_op",
      role,
      isOwner,
      revokedAt: null,
      isImplicit: false,
    } as never,
    can: can as never,
  };
}

function makeRequest(query = "") {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  return new NextRequest(
    `http://localhost/api/instances/connection-info${query}`,
    { method: "GET", headers },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(makeAuth("member"));
  mockGetConnectionInfo.mockResolvedValue([]);
  mockGetInstanceCredentials.mockResolvedValue({});
  // PA-298: instanceId branch is ownership-scoped. Default to an instance the
  // caller's team (team_1) owns so the credential-path tests proceed; the
  // cross-team denial is covered in connection-info-idor.test.ts.
  mockGetUnifiedInstanceDetail.mockResolvedValue({ id: "i-xyz", team: { id: "team_1" } });
  mockPodMetaFindFirst.mockResolvedValue(null);
  mockAuditCreate.mockResolvedValue({}); // fire-and-forget audit write
});

describe("GET /api/instances/connection-info — auth + RBAC (SSH-leak guard)", () => {
  it("returns the helper's NextResponse verbatim when auth fails (no SSH details)", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauth);

    const res = await GET(makeRequest());
    expect(res).toBe(unauth);
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
  });

  it("denies a Finance Manager with 403 BEFORE any SSH-credential call (no leak)", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(makeAuth("financeManager"));

    const res = await GET(makeRequest("?instance_id=i-abc"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.permission).toBe("gpu.access");
    expect(body.role).toBe("financeManager");
    // The SSH/credential boundaries are never reached on denial.
    expect(mockGetInstanceCredentials).not.toHaveBeenCalled();
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });

  it("allows a Read-only Member through (has gpu.access)", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(makeAuth("readOnlyMember"));
    const res = await GET(makeRequest("?refresh=true"));
    expect(res.status).toBe(200);
    expect(mockGetConnectionInfo).toHaveBeenCalled();
  });

  it("returns 400 when the account has no teams", async () => {
    const auth = makeAuth("member");
    (auth as { allTeamIds: string[] }).allTeamIds = [];
    mockGetAuthenticatedCustomer.mockResolvedValue(auth);

    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(mockGetConnectionInfo).not.toHaveBeenCalled();
  });
});

describe("GET /api/instances/connection-info — instanceId branch", () => {
  it("forwards instance_id to getInstanceCredentials and returns instanceCredentials", async () => {
    // Creds without a full ip/port/username triple -> no fetchInternalIP spawn.
    mockGetInstanceCredentials.mockResolvedValue({ ip: "10.0.0.1" });

    const res = await GET(makeRequest("?instance_id=i-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetInstanceCredentials).toHaveBeenCalledWith("i-xyz");
    expect(body.instanceCredentials).toEqual({ ip: "10.0.0.1" });
    expect(body.connectionInfo).toHaveLength(1);
    expect(body.connectionInfo[0].pool_name).toBe("GPU Instance");
  });

  it("uses the podMetadata displayName as the pool name when present", async () => {
    mockGetInstanceCredentials.mockResolvedValue({});
    mockPodMetaFindFirst.mockResolvedValue({ displayName: "My Box" });

    const res = await GET(makeRequest("?instance_id=i-xyz"));
    const body = await res.json();
    expect(body.connectionInfo[0].pool_name).toBe("My Box");
  });

  it("returns 500 when getInstanceCredentials throws", async () => {
    mockGetInstanceCredentials.mockRejectedValue(new Error("HAI down"));
    const res = await GET(makeRequest("?instance_id=i-xyz"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Failed to get instance credentials");
  });
});

describe("GET /api/instances/connection-info — all-teams branch", () => {
  it("merges and dedupes connection info by subscription id", async () => {
    // Non-running pods -> the enrichment fetchInternalIP spawn is skipped.
    mockGetConnectionInfo.mockResolvedValue([
      { id: 1, pool_name: "A", region_id: 0, pods: [{ pod_name: "p1", pod_status: "stopped" }] },
      { id: 1, pool_name: "A-dup", region_id: 0, pods: [] }, // duplicate id 1
      { id: 2, pool_name: "B", region_id: 0, pods: [{ pod_name: "p2", pod_status: "stopped" }] },
    ]);

    // refresh=true bypasses the module-level in-memory cache (which a prior
    // test may have populated for the same team key).
    const res = await GET(makeRequest("?refresh=true"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockGetConnectionInfo).toHaveBeenCalledWith("team_1", undefined);
    const ids = body.connectionInfo.map((s: { id: number }) => s.id);
    expect(ids).toEqual([1, 2]); // dedupe kept first id-1, then id-2
  });

  it("returns 500 on an unexpected throw", async () => {
    mockGetAuthenticatedCustomer.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
