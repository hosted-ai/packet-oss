// Tests for src/app/api/admin/customers/[id]/details/route.ts (GET).
//
// PA-287 — admin customer-detail aggregation coverage. Admin-cookie gated.
// Awaits the Next-16 params Promise for the Stripe customer id, retrieves the
// customer (+ balance transactions, charges, invoices) from Stripe, optionally
// joins the hosted.ai team (metadata.hostedai_team_id), and enriches with
// voucher redemptions, referral role (referrer vs referred), activity events,
// and customer settings (bare-metal flag + suspension). totalSpent sums paid,
// non-refunded charges; walletBalance is the negated Stripe balance.
//
// Mocked at the @/lib/stripe + @/lib/prisma + @/lib/hostedai + @/lib/activity +
// @/lib/admin boundary. verifySessionToken is sync; getStripe is async and
// resolves a client whose methods are the mocks below.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockCustomerRetrieve,
  mockListBalanceTransactions,
  mockChargesList,
  mockInvoicesList,
  mockGetStripe,
  mockGetTeam,
  mockGetActivityEvents,
  mockVoucherRedemptionFindMany,
  mockReferralCodeFindFirst,
  mockReferralClaimFindFirst,
  mockCustomerSettingsFindUnique,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockCustomerRetrieve: vi.fn(),
  mockListBalanceTransactions: vi.fn(),
  mockChargesList: vi.fn(),
  mockInvoicesList: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetTeam: vi.fn(),
  mockGetActivityEvents: vi.fn(),
  mockVoucherRedemptionFindMany: vi.fn(),
  mockReferralCodeFindFirst: vi.fn(),
  mockReferralClaimFindFirst: vi.fn(),
  mockCustomerSettingsFindUnique: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({ getTeam: mockGetTeam }));
vi.mock("@/lib/activity", () => ({ getActivityEvents: mockGetActivityEvents }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voucherRedemption: { findMany: mockVoucherRedemptionFindMany },
    referralCode: { findFirst: mockReferralCodeFindFirst },
    referralClaim: { findFirst: mockReferralClaimFindFirst },
    customerSettings: { findUnique: mockCustomerSettingsFindUnique },
  },
}));

import { GET } from "@/app/api/admin/customers/[id]/details/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";
const CUSTOMER_ID = "cus_1";

function makeReq({ withSession = true }: { withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest(`http://localhost/api/admin/customers/${CUSTOMER_ID}/details`, {
    method: "GET",
    headers,
  });
}

function ctx(id = CUSTOMER_ID) {
  return { params: Promise.resolve({ id }) };
}

function baseCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    email: "ops@acme.com",
    name: "Acme Inc",
    phone: null,
    created: 1717200000,
    balance: -500, // negated → 500 credit
    metadata: { hostedai_team_id: "team-1", billing_type: "prepaid" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockCustomerRetrieve.mockResolvedValue(baseCustomer());
  mockListBalanceTransactions.mockResolvedValue({ data: [] });
  mockChargesList.mockResolvedValue({ data: [] });
  mockInvoicesList.mockResolvedValue({ data: [] });
  mockGetStripe.mockResolvedValue({
    customers: {
      retrieve: mockCustomerRetrieve,
      listBalanceTransactions: mockListBalanceTransactions,
    },
    charges: { list: mockChargesList },
    invoices: { list: mockInvoicesList },
  });
  mockGetTeam.mockResolvedValue({ id: "team-1", name: "Acme Team" });
  mockGetActivityEvents.mockResolvedValue([]);
  mockVoucherRedemptionFindMany.mockResolvedValue([]);
  mockReferralCodeFindFirst.mockResolvedValue(null);
  mockReferralClaimFindFirst.mockResolvedValue(null);
  mockCustomerSettingsFindUnique.mockResolvedValue(null);
});

describe("GET /api/admin/customers/[id]/details — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq({ withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/customers/[id]/details — not found", () => {
  it("returns 404 when the Stripe customer is deleted", async () => {
    mockCustomerRetrieve.mockResolvedValue({ id: CUSTOMER_ID, deleted: true });
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Customer not found");
  });
});

describe("GET /api/admin/customers/[id]/details — aggregation", () => {
  it("returns the core customer block with negated wallet balance", async () => {
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.customer.id).toBe(CUSTOMER_ID);
    expect(body.customer.email).toBe("ops@acme.com");
    expect(body.customer.billingType).toBe("prepaid");
    expect(body.customer.walletBalance).toBe(500);
    expect(mockCustomerRetrieve).toHaveBeenCalledWith(CUSTOMER_ID, {
      expand: ["subscriptions", "sources"],
    });
  });

  it("sums totalSpent over paid, non-refunded charges only", async () => {
    mockChargesList.mockResolvedValue({
      data: [
        { id: "ch1", amount: 1000, paid: true, refunded: false, status: "succeeded" },
        { id: "ch2", amount: 500, paid: true, refunded: true, status: "succeeded" }, // refunded → excluded
        { id: "ch3", amount: 250, paid: false, refunded: false, status: "failed" }, // unpaid → excluded
      ],
    });
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.customer.totalSpent).toBe(1000);
    expect(body.charges).toHaveLength(3);
  });

  it("joins the hosted.ai team when metadata.hostedai_team_id is present", async () => {
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(mockGetTeam).toHaveBeenCalledWith("team-1");
    expect(body.hostedaiTeam).toEqual({ id: "team-1", name: "Acme Team" });
  });

  it("returns a null team (without calling getTeam) when no team id is set", async () => {
    mockCustomerRetrieve.mockResolvedValue(
      baseCustomer({ metadata: { billing_type: "prepaid" } })
    );
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(mockGetTeam).not.toHaveBeenCalled();
    expect(body.hostedaiTeam).toBeNull();
  });

  it("swallows a getTeam failure and still returns 200 with a null team", async () => {
    mockGetTeam.mockRejectedValue(new Error("hai down"));
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.hostedaiTeam).toBeNull();
  });

  it("maps voucher redemptions through the joined voucher", async () => {
    mockVoucherRedemptionFindMany.mockResolvedValue([
      {
        id: "r1",
        creditCents: 1000,
        topupCents: 0,
        createdAt: new Date("2026-05-01T00:00:00Z"),
        voucher: { code: "WELCOME", name: "Welcome" },
      },
    ]);
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.voucherRedemptions).toEqual([
      expect.objectContaining({ id: "r1", voucherCode: "WELCOME", voucherName: "Welcome" }),
    ]);
  });
});

describe("GET /api/admin/customers/[id]/details — referral role", () => {
  it("reports a referrer role when the customer owns a referral code", async () => {
    mockReferralCodeFindFirst.mockResolvedValue({
      code: "REF123",
      createdAt: new Date("2026-04-01T00:00:00Z"),
      claims: [{ referrerCredited: true }, { referrerCredited: false }],
    });
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.referral).toEqual(
      expect.objectContaining({ code: "REF123", role: "referrer", totalClaims: 2, creditedClaims: 1 })
    );
  });

  it("reports a referred role when the customer was referred (and owns no code)", async () => {
    mockReferralClaimFindFirst.mockResolvedValue({
      status: "completed",
      refereeCredited: true,
      createdAt: new Date("2026-04-15T00:00:00Z"),
      referralCode: { code: "FRIEND" },
    });
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.referral).toEqual(
      expect.objectContaining({ code: "FRIEND", role: "referred", credited: true })
    );
  });

  it("reports a null referral when the customer has neither", async () => {
    const res = await GET(makeReq(), ctx());
    expect((await res.json()).referral).toBeNull();
  });
});

describe("GET /api/admin/customers/[id]/details — settings & suspension", () => {
  it("surfaces the bare-metal flag and suspension block from customer settings", async () => {
    mockCustomerSettingsFindUnique.mockResolvedValue({
      bareMetalEnabled: true,
      internalNotes: "KYC docs requested 2026-05-20",
      suspended: true,
      suspendedAt: new Date("2026-05-20T00:00:00Z"),
      suspendedReason: "abuse",
      suspendedBy: "admin@example.com",
    });
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.bareMetalEnabled).toBe(true);
    expect(body.internalNotes).toBe("KYC docs requested 2026-05-20"); // PA-359
    expect(body.suspension).toEqual(
      expect.objectContaining({ suspended: true, suspendedReason: "abuse" })
    );
  });

  it("defaults bare-metal to false, notes to null, and suspension to not-suspended when unset", async () => {
    const res = await GET(makeReq(), ctx());
    const body = await res.json();
    expect(body.bareMetalEnabled).toBe(false);
    expect(body.internalNotes).toBeNull(); // PA-359
    expect(body.suspension).toEqual({
      suspended: false,
      suspendedAt: null,
      suspendedReason: null,
      suspendedBy: null,
    });
  });
});

describe("GET /api/admin/customers/[id]/details — errors", () => {
  it("returns 500 when the Stripe retrieve throws", async () => {
    mockCustomerRetrieve.mockRejectedValue(new Error("stripe down"));
    const res = await GET(makeReq(), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get customer details");
  });
});
