// Tests for src/app/api/account/team-members/route.ts (PA-287).
//
// Legacy team-member management. GET lists, POST invites (team.invite gated),
// DELETE removes (team.manage gated). Both mutating verbs were a privilege-
// escalation hole pre-2026-05-19 (no role check); the gate is now mandatory.
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Every write — membership row, owner row, activity log, invite link — is
//     keyed on the OPERATING account, never the JWT customer
//   * POST gate denial (team.invite, 403) short-circuits before any DB write
//   * POST validates email presence + format, dedupes (409), requires teamId
//   * POST adds the member + sends the invite email
//   * DELETE gate denial (team.manage, 403) short-circuits before removal
//   * DELETE requires id; happy path removes scoped to caller's account
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { authContext, OPERATING_ACCOUNT_ID } from "../../fixtures/customer";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockSendEmail,
  mockGenerateCustomerToken,
  mockGetTeamMembers,
  mockAddTeamMember,
  mockRemoveTeamMember,
  mockIsTeamMember,
  mockEnsureOwnerRecord,
  mockGetBrandName,
  mockLoadTemplate,
  mockLogTeamMemberInvited,
  mockLogTeamMemberRemoved,
  mockFindFirstTeamMemberLegacy,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockGetTeamMembers: vi.fn(),
  mockAddTeamMember: vi.fn(),
  mockRemoveTeamMember: vi.fn(),
  mockIsTeamMember: vi.fn(),
  mockEnsureOwnerRecord: vi.fn(),
  mockGetBrandName: vi.fn(),
  mockLoadTemplate: vi.fn(),
  mockLogTeamMemberInvited: vi.fn(),
  mockLogTeamMemberRemoved: vi.fn(),
  mockFindFirstTeamMemberLegacy: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: vi.fn(),
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: Record<string, unknown>) =>
    mockGenerateCustomerToken(o),
  ),
}));
vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/email", () => ({
  sendEmail: mockSendEmail,
  escapeHtml: (s: string) => s,
}));
vi.mock("@/lib/team-members", () => ({
  getTeamMembers: mockGetTeamMembers,
  addTeamMember: mockAddTeamMember,
  removeTeamMember: mockRemoveTeamMember,
  isTeamMember: mockIsTeamMember,
  ensureOwnerRecord: mockEnsureOwnerRecord,
}));
vi.mock("@/lib/branding", () => ({ getBrandName: mockGetBrandName }));
vi.mock("@/lib/email/template-loader", () => ({ loadTemplate: mockLoadTemplate }));
vi.mock("@/lib/activity", () => ({
  logTeamMemberInvited: mockLogTeamMemberInvited,
  logTeamMemberRemoved: mockLogTeamMemberRemoved,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { teamMemberLegacy: { findFirst: mockFindFirstTeamMemberLegacy } },
}));

import { GET, POST, DELETE } from "@/app/api/account/team-members/route";

// The caller is an admin whose own email is not the account owner's, so the
// owner row must be written against the account's customer rather than them.
const CALLER_EMAIL = "admin@example.com";
const OWNER_EMAIL = "owner@example.com";

const ctx = () =>
  authContext({
    email: CALLER_EMAIL,
    customer: { email: OWNER_EMAIL, metadata: { hostedai_team_id: "team_1" } },
  });

function makeRequest(
  method: "GET" | "POST" | "DELETE",
  { body, query }: { body?: unknown; query?: string } = {},
) {
  const headers = new Headers();
  headers.set("authorization", "Bearer t");
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const url = "http://localhost/api/account/team-members" + (query ?? "");
  return new NextRequest(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(ctx());
  mockRequirePermission.mockReturnValue(null);
  mockEnsureOwnerRecord.mockResolvedValue(undefined);
  mockGetTeamMembers.mockResolvedValue([]);
  mockIsTeamMember.mockResolvedValue(false);
  mockAddTeamMember.mockResolvedValue({
    id: "member_1",
    email: "new@example.com",
    name: "New",
    role: "member",
    invitedAt: new Date("2026-01-01T00:00:00Z"),
    invitedBy: "owner@example.com",
  });
  mockRemoveTeamMember.mockResolvedValue(undefined);
  mockGenerateCustomerToken.mockReturnValue("invite_token");
  mockGetBrandName.mockReturnValue("Packet");
  mockLoadTemplate.mockResolvedValue({ subject: "s", html: "h", text: "t" });
  mockSendEmail.mockResolvedValue(undefined);
  mockLogTeamMemberInvited.mockResolvedValue(undefined);
  mockLogTeamMemberRemoved.mockResolvedValue(undefined);
  mockFindFirstTeamMemberLegacy.mockResolvedValue({ email: "removed@example.com" });
});

describe("GET /api/account/team-members", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
    expect(mockGetTeamMembers).not.toHaveBeenCalled();
  });

  it("lists members and ensures the owner record exists", async () => {
    mockGetTeamMembers.mockResolvedValue([
      {
        id: "member_1",
        email: "m@example.com",
        name: "M",
        role: "member",
        invitedAt: new Date("2026-01-01T00:00:00Z"),
        acceptedAt: null,
        invitedBy: "owner@example.com",
      },
    ]);
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.members[0].id).toBe("member_1");
    // The owner row carries the ACCOUNT's email, not the calling admin's.
    expect(mockEnsureOwnerRecord).toHaveBeenCalledWith(
      OWNER_EMAIL,
      OPERATING_ACCOUNT_ID,
      "Owner",
    );
    expect(mockGetTeamMembers).toHaveBeenCalledWith(OPERATING_ACCOUNT_ID);
  });

  it("returns 500 when the member lookup throws", async () => {
    mockGetTeamMembers.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/account/team-members", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest("POST", { body: { email: "x@y.z" } }));
    expect(res.status).toBe(401);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });

  it("returns the team.invite denial (403) before any DB write", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(makeRequest("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(403);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "team.invite",
      expect.anything(),
    );
  });

  it("rejects a missing email with 400", async () => {
    const res = await POST(makeRequest("POST", { body: {} }));
    expect(res.status).toBe(400);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });

  it("rejects a malformed email with 400", async () => {
    const res = await POST(makeRequest("POST", { body: { email: "not-an-email" } }));
    expect(res.status).toBe(400);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already a member", async () => {
    mockIsTeamMember.mockResolvedValue(true);
    const res = await POST(makeRequest("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(409);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });

  it("returns 400 when the account has no team", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue({
      ...ctx(),
      teamId: undefined,
    });
    const res = await POST(makeRequest("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(400);
    expect(mockAddTeamMember).not.toHaveBeenCalled();
  });

  it("normalizes the email, adds the member and sends the invite email", async () => {
    const res = await POST(
      makeRequest("POST", { body: { email: "  NEW@Example.com ", name: "New" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockAddTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        stripeCustomerId: OPERATING_ACCOUNT_ID,
        invitedBy: CALLER_EMAIL,
      }),
    );
    expect(mockSendEmail).toHaveBeenCalled();
  });

  it("mints the invite link against the same account the membership row landed on", async () => {
    await POST(makeRequest("POST", { body: { email: "new@example.com" } }));

    const membershipAccount =
      mockAddTeamMember.mock.calls[0][0].stripeCustomerId;
    expect(mockGenerateCustomerToken).toHaveBeenCalledWith({
      email: "new@example.com",
      customerId: membershipAccount,
      activeAccountId: membershipAccount,
    });
    expect(membershipAccount).toBe(OPERATING_ACCOUNT_ID);
    expect(mockLogTeamMemberInvited).toHaveBeenCalledWith(
      OPERATING_ACCOUNT_ID,
      "new@example.com",
    );
  });

  it("returns 500 when adding the member throws", async () => {
    mockAddTeamMember.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/account/team-members", () => {
  it("returns the auth NextResponse (401) verbatim when unauthenticated", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await DELETE(makeRequest("DELETE", { query: "?id=member_1" }));
    expect(res.status).toBe(401);
    expect(mockRemoveTeamMember).not.toHaveBeenCalled();
  });

  it("returns the team.manage denial (403) before removal", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await DELETE(makeRequest("DELETE", { query: "?id=member_1" }));
    expect(res.status).toBe(403);
    expect(mockRemoveTeamMember).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "team.manage",
      expect.anything(),
    );
  });

  it("requires a member id", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(400);
    expect(mockRemoveTeamMember).not.toHaveBeenCalled();
  });

  it("removes the member scoped to the caller's account", async () => {
    const res = await DELETE(makeRequest("DELETE", { query: "?id=member_1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockRemoveTeamMember).toHaveBeenCalledWith(
      "member_1",
      OPERATING_ACCOUNT_ID,
    );
    expect(mockFindFirstTeamMemberLegacy).toHaveBeenCalledWith({
      where: { id: "member_1", stripeCustomerId: OPERATING_ACCOUNT_ID },
      select: { email: true },
    });
    expect(mockLogTeamMemberRemoved).toHaveBeenCalledWith(
      OPERATING_ACCOUNT_ID,
      "removed@example.com",
    );
  });

  it("returns 500 when removal throws", async () => {
    mockRemoveTeamMember.mockRejectedValue(new Error("db down"));
    const res = await DELETE(makeRequest("DELETE", { query: "?id=member_1" }));
    expect(res.status).toBe(500);
  });
});
