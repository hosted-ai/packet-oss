// Contract tests (PA-261, Part A) — customer-authed account/support endpoints.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import * as s from "./schemas";

const {
  mockVerifyCustomerToken,
  mockGetActivityEvents,
  mockRevokeSessionByToken,
  mockRevokeAllSessionsForCustomer,
  mockDecodeRefreshCustomerId,
  mockBuildClearedSessionCookie,
  mockBuildSessionCookie,
  mockValidateAndRotateSession,
  mockAuthCustomerVerify,
  mockGenerateCustomerToken,
  mockBudgetFindUnique,
  mockBudgetUpsert,
  mockSettingsFindUnique,
  mockSettingsUpsert,
  mockValidateVoucher,
  mockProcessVoucherRedemption,
  mockGatePermission,
  mockRequirePermission,
  mockGetStripe,
  mockStripeCustomersRetrieve,
  mockGetAuthenticatedCustomer,
  mockLookupPacketUserIdByEmail,
  mockGetTicketsByCustomer,
  mockGetTicketArticles,
  mockIsTicketClosed,
  mockResolveOperatingContext,
  mockPodSnapshotFindMany,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGetActivityEvents: vi.fn(),
  mockRevokeSessionByToken: vi.fn(),
  mockRevokeAllSessionsForCustomer: vi.fn(),
  mockDecodeRefreshCustomerId: vi.fn(),
  mockBuildClearedSessionCookie: vi.fn(),
  mockBuildSessionCookie: vi.fn(),
  mockValidateAndRotateSession: vi.fn(),
  mockAuthCustomerVerify: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockBudgetFindUnique: vi.fn(),
  mockBudgetUpsert: vi.fn(),
  mockSettingsFindUnique: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockValidateVoucher: vi.fn(),
  mockProcessVoucherRedemption: vi.fn(),
  mockGatePermission: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockGetStripe: vi.fn(),
  mockStripeCustomersRetrieve: vi.fn(),
  mockGetAuthenticatedCustomer: vi.fn(),
  mockLookupPacketUserIdByEmail: vi.fn(),
  mockGetTicketsByCustomer: vi.fn(),
  mockGetTicketArticles: vi.fn(),
  mockIsTicketClosed: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockPodSnapshotFindMany: vi.fn(),
}));

import { authContext } from "../fixtures/customer";

const SESSION_COOKIE_NAME = "packet_session";

// account/activity and instances/snapshots authenticate via @/lib/customer-auth;
// the rest go through getAuthenticatedCustomer, mocked further down.
vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/activity", () => ({ getActivityEvents: mockGetActivityEvents }));

// account/logout + account/session use the newer session system.
vi.mock("@/lib/auth/customer-session", () => ({
  revokeSessionByToken: mockRevokeSessionByToken,
  revokeAllSessionsForCustomer: mockRevokeAllSessionsForCustomer,
  decodeRefreshCustomerId: mockDecodeRefreshCustomerId,
  buildClearedSessionCookie: mockBuildClearedSessionCookie,
  buildSessionCookie: mockBuildSessionCookie,
  validateAndRotateSession: mockValidateAndRotateSession,
  SESSION_COOKIE_NAME,
}));
vi.mock("@/lib/auth/session-core", () => ({ ACCESS_TOKEN_HOURS: 12 }));
vi.mock("@/lib/auth/customer", () => ({
  verifyCustomerToken: mockAuthCustomerVerify,
  generateCustomerToken: mockGenerateCustomerToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetSettings: { findUnique: mockBudgetFindUnique, upsert: mockBudgetUpsert },
    customerSettings: { findUnique: mockSettingsFindUnique, upsert: mockSettingsUpsert },
    podSnapshot: { findMany: mockPodSnapshotFindMany },
  },
}));
vi.mock("@/lib/voucher", () => ({
  validateVoucher: mockValidateVoucher,
  processVoucherRedemption: mockProcessVoucherRedemption,
}));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: mockGatePermission }));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/zammad", () => ({
  lookupPacketUserIdByEmail: mockLookupPacketUserIdByEmail,
  getTicketsByCustomer: mockGetTicketsByCustomer,
  getTicketArticles: mockGetTicketArticles,
  isTicketClosed: mockIsTicketClosed,
}));

const CUSTOMER_PAYLOAD = { customerId: "cus_contract", email: "contract@example.com" };

function authedReq(url: string, { method = "GET", body }: { method?: string; body?: unknown } = {}) {
  const headers = new Headers({ authorization: "Bearer test-token" });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(CUSTOMER_PAYLOAD);
  mockAuthCustomerVerify.mockReturnValue(CUSTOMER_PAYLOAD);
  mockGenerateCustomerToken.mockReturnValue("fresh-access-token");
  mockGetActivityEvents.mockResolvedValue([{ id: "e1", type: "login" }]);
  mockBuildSessionCookie.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "rolled", httpOnly: true, path: "/", maxAge: 1000 });
  mockBuildClearedSessionCookie.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "", httpOnly: true, path: "/", maxAge: 0 });
  mockValidateAndRotateSession.mockResolvedValue({
    customerId: "cus_contract",
    email: "contract@example.com",
    userId: "user_1",
    activeAccountId: null,
  });
  mockRevokeSessionByToken.mockResolvedValue(undefined);
  mockRevokeAllSessionsForCustomer.mockResolvedValue(1);
  mockBudgetFindUnique.mockResolvedValue(null);
  mockBudgetUpsert.mockResolvedValue({
    monthlyLimitCents: 50000,
    dailyLimitCents: null,
    alertAt50Percent: true,
    alertAt80Percent: true,
    alertAt100Percent: true,
    autoShutdownEnabled: false,
    autoShutdownThreshold: 100,
  });
  mockSettingsFindUnique.mockResolvedValue({});
  mockSettingsUpsert.mockResolvedValue({});
  mockValidateVoucher.mockResolvedValue({ valid: true, voucher: { code: "SAVE10", creditCents: 1000 } });
  mockGatePermission.mockResolvedValue(null);
  mockRequirePermission.mockReturnValue(null);
  mockStripeCustomersRetrieve.mockResolvedValue({ id: "cus_contract", email: "contract@example.com" });
  mockGetStripe.mockResolvedValue({ customers: { retrieve: mockStripeCustomersRetrieve } });
  mockProcessVoucherRedemption.mockResolvedValue({ success: true, creditCents: 5000 });
  mockGetAuthenticatedCustomer.mockResolvedValue(
    authContext({
      email: CUSTOMER_PAYLOAD.email,
      jwtCustomerId: CUSTOMER_PAYLOAD.customerId,
      customer: { name: "Contract Tester" },
    }),
  );
  mockLookupPacketUserIdByEmail.mockResolvedValue(null);
  mockGetTicketsByCustomer.mockResolvedValue([]);
  mockGetTicketArticles.mockResolvedValue([]);
  mockIsTicketClosed.mockResolvedValue(false);
  mockResolveOperatingContext.mockResolvedValue({
    customer: { id: "cus_contract", email: "contract@example.com" },
    accountId: "cus_contract",
    allTeamIds: [],
  });
  mockPodSnapshotFindMany.mockResolvedValue([]);
});

describe("GET /api/account/activity", () => {
  it("matches the contract schema", async () => {
    const { GET } = await import("@/app/api/account/activity/route");
    const res = await GET(authedReq("http://localhost:3000/api/account/activity"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.AccountActivityResponse.parse(body)).not.toThrow();
  });
});

describe("POST /api/account/logout", () => {
  it("matches the contract schema", async () => {
    const { POST } = await import("@/app/api/account/logout/route");
    const res = await POST(authedReq("http://localhost:3000/api/account/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.OkResponse.parse(body)).not.toThrow();
  });
});

describe("POST /api/account/session", () => {
  it("matches the contract schema", async () => {
    const { POST } = await import("@/app/api/account/session/route");
    const headers = new Headers({ cookie: `${SESSION_COOKIE_NAME}=live-refresh` });
    const res = await POST(
      new NextRequest("http://localhost:3000/api/account/session", { method: "POST", headers }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.SessionTokenResponse.parse(body)).not.toThrow();
  });
});

describe("GET /api/account/budget", () => {
  it("matches the contract schema", async () => {
    const { GET } = await import("@/app/api/account/budget/route");
    const res = await GET(authedReq("http://localhost:3000/api/account/budget"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.BudgetSettingsResponse.parse(body)).not.toThrow();
  });
});

describe("PUT /api/account/budget", () => {
  it("matches the contract schema", async () => {
    const { PUT } = await import("@/app/api/account/budget/route");
    const res = await PUT(
      authedReq("http://localhost:3000/api/account/budget", { method: "PUT", body: { monthlyLimitCents: 50000 } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.BudgetUpdateResponse.parse(body)).not.toThrow();
  });
});

describe("POST /api/account/voucher/validate", () => {
  it("matches the contract schema", async () => {
    const { POST } = await import("@/app/api/account/voucher/validate/route");
    const res = await POST(
      authedReq("http://localhost:3000/api/account/voucher/validate", { method: "POST", body: { code: "SAVE10" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.AccountVoucherValidateResponse.parse(body)).not.toThrow();
  });
});

describe("POST /api/account/voucher/redeem", () => {
  it("matches the contract schema", async () => {
    const { POST } = await import("@/app/api/account/voucher/redeem/route");
    const res = await POST(
      authedReq("http://localhost:3000/api/account/voucher/redeem", { method: "POST", body: { code: "SAVE10" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.VoucherRedeemResponse.parse(body)).not.toThrow();
  });
});

describe("GET /api/support/unread", () => {
  it("matches the contract schema", async () => {
    const { GET } = await import("@/app/api/support/unread/route");
    const res = await GET(authedReq("http://localhost:3000/api/support/unread"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.SupportUnreadResponse.parse(body)).not.toThrow();
  });
});

describe("GET /api/instances/snapshots", () => {
  it("matches the contract schema", async () => {
    mockPodSnapshotFindMany.mockResolvedValue([
      {
        id: "snap_1",
        displayName: "my snap",
        notes: "note",
        snapshotType: "full",
        poolId: "pool_1",
        poolName: "Pool One",
        vgpus: 2,
        persistentVolumeId: 42,
        persistentVolumeName: "vol-a",
        persistentVolumeSize: 100,
        hfItemId: null,
        hfItemName: null,
        hfItemType: null,
        deployScript: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    const { GET } = await import("@/app/api/instances/snapshots/route");
    const res = await GET(authedReq("http://localhost:3000/api/instances/snapshots"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => s.SnapshotsListResponse.parse(body)).not.toThrow();
  });
});
