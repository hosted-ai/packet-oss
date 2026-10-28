// Tests for src/app/api/admin/customers/[id]/route.ts.
//
// This route holds the highest-blast-radius admin actions in the codebase:
//   * login-as → mints a token that lets the admin act as the customer
//   * cancel-subscription → revokes recurring billing
//   * DELETE → cancels subs + terminates hosted.ai team + deletes Stripe customer
//
// What we pin:
//   * Auth gating: every action requires a valid admin session cookie.
//   * The deleted-customer guard fires before any destructive Stripe call.
//   * login-as: returns a dashboard URL containing the bypass token AND
//     records an admin_activity audit row.
//   * cancel: cancels exactly one subscription, attempts team suspend, logs activity.
//   * DELETE: in the correct order — subs canceled → team terminated → Stripe deleted.
//   * DELETE: continues even if team termination throws (already in the field — pin it).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetStripe,
  mockGenerateAdminBypassToken,
  mockLogAdminActivity,
  mockTerminateTeam,
  mockSuspendTeam,
  mockEnsureRoles,
  mockEnsureDefaultPolicies,
  mockCreateOneTimeLogin,
  mockCreateTeam,
  mockSyncTeamsToDefaultPolicy,
  mockUnsuspendTeam,
  mockSendEmail,
  mockLoadTemplate,
  mockCacheCustomer,
  mockMarkCustomerCacheDeleted,
  mockCustomersRetrieve,
  mockCustomersDel,
  mockCustomersList,
  mockSubscriptionsList,
  mockSubscriptionsCancel,
  mockSetSuspension,
  mockGenerateCustomerToken,
  mockCustomerSettingsFindUnique,
  mockCustomerSettingsUpsert,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGenerateAdminBypassToken: vi.fn(),
  mockLogAdminActivity: vi.fn(),
  mockTerminateTeam: vi.fn(),
  mockSuspendTeam: vi.fn(),
  mockEnsureRoles: vi.fn(),
  mockEnsureDefaultPolicies: vi.fn(),
  mockCreateOneTimeLogin: vi.fn(),
  mockCreateTeam: vi.fn(),
  mockSyncTeamsToDefaultPolicy: vi.fn(),
  mockUnsuspendTeam: vi.fn(),
  mockSendEmail: vi.fn(),
  mockLoadTemplate: vi.fn(),
  mockCacheCustomer: vi.fn().mockResolvedValue(undefined),
  mockMarkCustomerCacheDeleted: vi.fn().mockResolvedValue(undefined),
  mockCustomersRetrieve: vi.fn(),
  mockCustomersDel: vi.fn(),
  mockCustomersList: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsCancel: vi.fn(),
  mockSetSuspension: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockCustomerSettingsFindUnique: vi.fn(),
  mockCustomerSettingsUpsert: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({
  createOneTimeLogin: mockCreateOneTimeLogin,
  createTeam: mockCreateTeam,
  suspendTeam: mockSuspendTeam,
  unsuspendTeam: mockUnsuspendTeam,
  terminateTeam: mockTerminateTeam,
  syncTeamsToDefaultPolicy: mockSyncTeamsToDefaultPolicy,
  ensureDefaultPolicies: mockEnsureDefaultPolicies,
  ensureRoles: mockEnsureRoles,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/email/utils", () => ({
  emailLayout: ({ body }: { body: string }) => body,
  emailButton: () => "",
  emailGreeting: () => "",
  emailText: () => "",
  emailMuted: () => "",
  emailSignoff: () => "",
  escapeHtml: (s: string) => s,
  plainTextFooter: () => "",
}));
vi.mock("@/lib/email/template-loader", () => ({
  loadTemplate: mockLoadTemplate,
}));
vi.mock("@/lib/customer-auth", () => ({
  generateAdminBypassToken: mockGenerateAdminBypassToken,
  generateCustomerToken: mockGenerateCustomerToken,
}));
vi.mock("@/lib/admin-activity", () => ({
  logAdminActivity: mockLogAdminActivity,
}));
vi.mock("@/lib/customer-cache", () => ({
  cacheCustomer: mockCacheCustomer,
  markCustomerCacheDeleted: mockMarkCustomerCacheDeleted,
}));
vi.mock("@/lib/branding", () => ({
  getBrandName: () => "Packet",
  getDashboardUrl: () => "http://localhost:3000",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerSettings: {
      findUnique: mockCustomerSettingsFindUnique,
      upsert: mockCustomerSettingsUpsert,
    },
  },
}));
vi.mock("@/lib/customer-suspension", () => ({
  setSuspension: mockSetSuspension,
}));

import { POST, DELETE } from "@/app/api/admin/customers/[id]/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";
const ADMIN_EMAIL = "admin@example.com";
const CUSTOMER_ID = "cus_target";
const CUSTOMER_EMAIL = "target@example.com";

function makeRequest({
  method,
  body,
  withSession = true,
}: {
  method: "POST" | "DELETE";
  body?: unknown;
  withSession?: boolean;
}) {
  const headers = new Headers();
  if (withSession) {
    headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(
    `http://localhost/api/admin/customers/${CUSTOMER_ID}`,
    init,
  );
}

const params = Promise.resolve({ id: CUSTOMER_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockGetStripe.mockResolvedValue({
    customers: {
      retrieve: mockCustomersRetrieve,
      del: mockCustomersDel,
      list: mockCustomersList,
    },
    subscriptions: {
      list: mockSubscriptionsList,
      cancel: mockSubscriptionsCancel,
    },
  });
  mockCustomersRetrieve.mockResolvedValue({
    id: CUSTOMER_ID,
    email: CUSTOMER_EMAIL,
    name: "Target User",
    metadata: { hostedai_team_id: "team_target" },
  });
  mockSubscriptionsList.mockResolvedValue({ data: [] });
  mockLogAdminActivity.mockResolvedValue(undefined);
});

describe("POST /api/admin/customers/[id] — auth gating", () => {
  it("returns 401 without an admin_session cookie", async () => {
    const res = await POST(
      makeRequest({ method: "POST", body: { action: "login-as" }, withSession: false }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "login-as" } }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });

  it("returns 404 when the customer is already deleted on Stripe", async () => {
    mockCustomersRetrieve.mockResolvedValue({ id: CUSTOMER_ID, deleted: true });

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "login-as" } }),
      { params },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 on an unknown action (default branch)", async () => {
    const res = await POST(
      makeRequest({ method: "POST", body: { action: "nuke-from-orbit" } }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid action");
  });
});

describe("POST /api/admin/customers/[id] — login-as", () => {
  it("returns a dashboard URL containing the bypass token", async () => {
    mockGenerateAdminBypassToken.mockReturnValue("BYPASS_TOKEN_123");

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "login-as" } }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.url).toContain("BYPASS_TOKEN_123");
    expect(body.url).toContain("/dashboard?token=");
    expect(mockGenerateAdminBypassToken).toHaveBeenCalledWith(
      CUSTOMER_EMAIL,
      CUSTOMER_ID,
      ADMIN_EMAIL, // acting admin recorded for attribution
    );
  });

  it("returns 400 when the customer has no email (no identity to impersonate)", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: CUSTOMER_ID,
      email: null,
      metadata: {},
    });

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "login-as" } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockGenerateAdminBypassToken).not.toHaveBeenCalled();
  });

  it("records an admin activity audit row tagged action=login-as", async () => {
    mockGenerateAdminBypassToken.mockReturnValue("T");

    await POST(
      makeRequest({ method: "POST", body: { action: "login-as" } }),
      { params },
    );

    expect(mockLogAdminActivity).toHaveBeenCalledTimes(1);
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "customer_viewed",
      expect.stringContaining("Login as"),
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        customerEmail: CUSTOMER_EMAIL,
        action: "login-as",
      }),
    );
  });
});

describe("POST /api/admin/customers/[id] — cancel subscription", () => {
  it("returns 400 when the customer has no active subscription", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "cancel" } }),
      { params },
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("No active subscription");
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("cancels the first active subscription and suspends the hosted.ai team", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: "sub_active_1" }],
    });
    mockSubscriptionsCancel.mockResolvedValue({});
    mockSuspendTeam.mockResolvedValue({});

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "cancel" } }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_active_1");
    expect(mockSuspendTeam).toHaveBeenCalledWith("team_target");
  });

  it("succeeds even when hosted.ai suspendTeam throws (best-effort)", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: "sub_active_2" }],
    });
    mockSubscriptionsCancel.mockResolvedValue({});
    mockSuspendTeam.mockRejectedValue(new Error("HAI 500"));

    const res = await POST(
      makeRequest({ method: "POST", body: { action: "cancel" } }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(mockSubscriptionsCancel).toHaveBeenCalledTimes(1);
  });

  it("audits the cancellation", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [{ id: "sub_1" }] });
    mockSubscriptionsCancel.mockResolvedValue({});

    await POST(
      makeRequest({ method: "POST", body: { action: "cancel" } }),
      { params },
    );

    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "customer_viewed",
      expect.stringContaining("Canceled subscription"),
      expect.objectContaining({ action: "cancel-subscription" }),
    );
  });
});

describe("DELETE /api/admin/customers/[id]", () => {
  it("returns 401 without an admin_session cookie", async () => {
    const res = await DELETE(
      makeRequest({ method: "DELETE", withSession: false }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(mockCustomersDel).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });
    expect(res.status).toBe(401);
    expect(mockCustomersDel).not.toHaveBeenCalled();
  });

  it("returns 404 when the customer is already deleted", async () => {
    mockCustomersRetrieve.mockResolvedValue({ id: CUSTOMER_ID, deleted: true });

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });
    expect(res.status).toBe(404);
    expect(mockCustomersDel).not.toHaveBeenCalled();
  });

  it("deletes in the correct order: cancel subs → terminate team → del Stripe customer", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: "sub_1" }, { id: "sub_2" }],
    });
    mockSubscriptionsCancel.mockResolvedValue({});
    mockTerminateTeam.mockResolvedValue({});
    mockCustomersDel.mockResolvedValue({});

    const callOrder: string[] = [];
    mockSubscriptionsCancel.mockImplementation(async () => {
      callOrder.push("cancel-sub");
    });
    mockTerminateTeam.mockImplementation(async () => {
      callOrder.push("terminate-team");
    });
    mockCustomersDel.mockImplementation(async () => {
      callOrder.push("del-customer");
    });

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(res.status).toBe(200);
    expect(callOrder).toEqual([
      "cancel-sub",
      "cancel-sub",
      "terminate-team",
      "del-customer",
    ]);
  });

  it("continues to delete the Stripe customer even if hosted.ai team termination fails", async () => {
    // Documented behavior at route.ts:705 — "Continue with deletion even if
    // team termination fails". This test pins that intentional fall-through
    // so a refactor doesn't accidentally fail-closed and leave orphan Stripe
    // customers.
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockTerminateTeam.mockRejectedValue(new Error("HAI 500"));
    mockCustomersDel.mockResolvedValue({});

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(res.status).toBe(200);
    expect(mockCustomersDel).toHaveBeenCalledTimes(1);
  });

  it("audits the deletion with the customer's email and team id", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockTerminateTeam.mockResolvedValue({});
    mockCustomersDel.mockResolvedValue({});

    await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "customer_viewed",
      expect.stringContaining("Deleted customer"),
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        customerEmail: CUSTOMER_EMAIL,
        teamId: "team_target",
        action: "delete-customer",
      }),
    );
  });

  it("returns 500 with the underlying error message when Stripe deletion fails", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockTerminateTeam.mockResolvedValue({});
    mockCustomersDel.mockRejectedValue(new Error("Stripe API blew up"));

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Stripe API blew up");
  });

  it("returns 409 with an actionable message when Stripe rejects deletion for a positive cash balance", async () => {
    // PA-363 — bare-metal customers can carry a Stripe cash balance from
    // bank-transfer-funded invoices (see src/lib/baremetal/invoice.ts) even
    // when the app's own wallet ("balance") reads $0. Stripe refuses to
    // delete a customer in that state; surface a controlled 409 instead of
    // passing the raw Stripe message through as a 500.
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockTerminateTeam.mockResolvedValue({});
    mockCustomersDel.mockRejectedValue(
      new Error(
        "You cannot delete a customer with a positive cash balance. Customer has balances in the following currencies: usd.",
      ),
    );

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Resolve the balance in the Stripe Dashboard");
    expect(body.error).not.toContain("positive cash balance");
  });

  it("skips terminateTeam when the customer has no hosted.ai team_id", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: CUSTOMER_ID,
      email: CUSTOMER_EMAIL,
      metadata: {}, // no hostedai_team_id
    });
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockCustomersDel.mockResolvedValue({});

    const res = await DELETE(makeRequest({ method: "DELETE" }), { params });

    expect(res.status).toBe(200);
    expect(mockTerminateTeam).not.toHaveBeenCalled();
    expect(mockCustomersDel).toHaveBeenCalledTimes(1);
  });
});
