// billing.view gates this route, and the wallet it reads is the operating
// account's — kept distinct from the JWT customer here so a swap back fails.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockAuditCreate } = vi.hoisted(() => ({ mockAuditCreate: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { teamAuditLog: { create: mockAuditCreate } },
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: vi.fn(),
}));

vi.mock("@/lib/wallet", () => ({
  getWalletTransactions: vi.fn(),
  formatCentsForUser: vi.fn((c: number) => `$${(c / 100).toFixed(2)}`),
}));

import { GET } from "@/app/api/billing/history/route";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { getWalletTransactions } from "@/lib/wallet";
import type { AuthenticatedCustomer } from "@/lib/auth/helpers";
import type { PacketRole, Permission } from "@/lib/auth/role-permissions";

const JWT_CUSTOMER = "cus_jwt";
const OPERATING_ACCOUNT = "cus_operating";

function makeAuth(role: PacketRole, isOwner = false): AuthenticatedCustomer {
  const grants: Record<PacketRole, ReadonlySet<Permission>> = {
    teamAdmin: new Set<Permission>(["billing.view", "billing.manage", "gpu.access"]),
    member: new Set<Permission>(["gpu.access", "gpu.provision", "gpu.terminate"]),
    readOnlyMember: new Set<Permission>(["gpu.access", "ssh_keys.manage"]),
    financeManager: new Set<Permission>(["billing.view", "billing.manage"]),
  };
  const can = (perm: Permission) => isOwner || grants[role].has(perm);
  return {
    payload: { customerId: JWT_CUSTOMER, email: "u@example.com" } as never,
    customer: { id: OPERATING_ACCOUNT, email: "u@example.com" } as never,
    teamId: "team_1",
    allTeamIds: ["team_1"],
    stripe: {} as never,
    accountId: OPERATING_ACCOUNT,
    hourlyCustomerId: null,
    membership: {
      membershipId: "tm_1",
      userId: "user_1",
      accountId: OPERATING_ACCOUNT,
      role,
      isOwner,
      revokedAt: null,
      isImplicit: false,
    } as never,
    can: can as never,
  };
}

function makeReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/billing/history", {
    method: "GET",
    headers: { authorization: "Bearer test-token" },
  });
}

describe("GET /api/billing/history — billing.view gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditCreate.mockResolvedValue({});
    vi.mocked(getWalletTransactions).mockResolvedValue([
      { id: "txn_1", amount: 5000, description: "GPU usage", created: 1000, metadata: {} },
      { id: "txn_2", amount: -2000, description: "Top up", created: 2000, metadata: {} },
    ] as never);
  });

  it("denies Team Member with 403 and never reads the wallet", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("member"));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(getWalletTransactions).not.toHaveBeenCalled();
  });

  it("denies Read-only Member with 403 and never reads the wallet", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("readOnlyMember"));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(getWalletTransactions).not.toHaveBeenCalled();
  });

  it("allows Finance Manager (billing.view) and returns aggregates from the operating wallet", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("financeManager"));
    const res = await GET(makeReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(getWalletTransactions).toHaveBeenCalledWith(OPERATING_ACCOUNT);
    expect(body.allTimeStats.transactionCount).toBe(2);
    expect(body.allTimeStats.totalSpent).toBe(50); // 5000c debit
    expect(body.allTimeStats.totalCredits).toBe(20); // 2000c credit
  });

  it("allows Team Admin / Owner", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("teamAdmin", true));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(getWalletTransactions).toHaveBeenCalledWith(OPERATING_ACCOUNT);
  });

  it("reads the operating account's wallet, never the JWT customer's", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(makeAuth("teamAdmin", true));
    await GET(makeReq());
    expect(getWalletTransactions).toHaveBeenCalledWith(OPERATING_ACCOUNT);
    expect(getWalletTransactions).not.toHaveBeenCalledWith(JWT_CUSTOMER);
  });

  it("propagates the auth error (401/403/404) when getAuthenticatedCustomer rejects", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(getWalletTransactions).not.toHaveBeenCalled();
  });

  it("refuses an account the session has no access to, with no wallet read", async () => {
    vi.mocked(getAuthenticatedCustomer).mockResolvedValue(
      NextResponse.json({ error: "You do not have access to this account." }, { status: 403 }) as never,
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(getWalletTransactions).not.toHaveBeenCalled();
  });
});
