// Tests for src/app/api/account/wallet-topup/route.ts (PA-287).
//
// Wallet top-up is billing-critical: it creates the Stripe Checkout session a
// customer pays into. A wrong amount, an un-gated charge, or a voucher that
// validates against the wrong amount is a money bug, so the contract is pinned
// tightly here.
//
// Pinned contracts (POST):
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Every Stripe id — checkout customer, metadata, voucher, return token —
//     is the operating context's wallet, never the JWT customer
//   * Amount must be one of the fixed TOP_UP_AMOUNTS — anything else -> 400
//     with NO Stripe checkout call (non-numeric, off-list, etc.)
//   * Deleted Stripe customer -> 404
//   * billing.manage denial short-circuits BEFORE checkout create
//   * billing_type must be free / free_trial / hourly, else 400
//   * Voucher path: invalid voucher -> 400 with its error and no checkout;
//     valid voucher is validated against the TOP-UP amount and surfaced in the
//     response + the checkout description/metadata
//   * Happy path creates a one-time-payment checkout session with the exact
//     amountCents + wallet_topup metadata, returns the session url
//   * Stripe / unexpected throw -> 500
//
// Pinned contracts (GET): returns the fixed TOP_UP_AMOUNTS catalog.
//
// Dependencies are mocked at the import boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  authContext,
  JWT_CUSTOMER_ID,
  OPERATING_ACCOUNT_ID,
  OPERATING_HOURLY_ID,
} from "../../fixtures/customer";

const {
  mockGetAuthenticatedCustomer,
  mockGenerateCustomerToken,
  mockValidateVoucher,
  mockRequirePermission,
  mockCustomersRetrieve,
  mockCheckoutCreate,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockValidateVoucher: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockCheckoutCreate: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
}));
vi.mock("@/lib/voucher", () => ({ validateVoucher: mockValidateVoucher }));
vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));

import { POST, GET } from "@/app/api/account/wallet-topup/route";

const EMAIL = "topup@example.com";

function makeRequest(
  body: unknown,
  { auth = "Bearer good-token" }: { auth?: string | null } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/wallet-topup", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateCustomerToken.mockReturnValue("return-token");
  mockRequirePermission.mockReturnValue(null); // allowed by default
  mockCustomersRetrieve.mockResolvedValue({
    id: OPERATING_HOURLY_ID,
    email: EMAIL,
    metadata: { billing_type: "hourly" },
  });
  mockCheckoutCreate.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
  mockGetAuthenticatedCustomer.mockResolvedValue(
    authContext({
      email: EMAIL,
      hourlyCustomerId: OPERATING_HOURLY_ID,
      stripe: {
        customers: { retrieve: mockCustomersRetrieve },
        checkout: { sessions: { create: mockCheckoutCreate } },
      },
    }),
  );
});

describe("POST /api/account/wallet-topup — auth", () => {
  it("returns the auth helper's 401 verbatim and never reaches checkout", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest({ amount: "5000" }, { auth: null }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/wallet-topup — amount validation", () => {
  it("rejects an off-list amount with 400 and never touches Stripe checkout", async () => {
    const res = await POST(makeRequest({ amount: "3000" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid amount");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount with 400 and no checkout call", async () => {
    const res = await POST(makeRequest({ amount: "abc" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid amount");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing amount with 400 and no checkout call", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it.each([2500, 5000, 10000, 25000, 50000])(
    "accepts the on-list amount %d",
    async (amount) => {
      const res = await POST(makeRequest({ amount: String(amount) }));
      expect(res.status).toBe(200);
      expect(mockCheckoutCreate).toHaveBeenCalledTimes(1);
      expect(mockCheckoutCreate.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(amount);
    },
  );
});

describe("POST /api/account/wallet-topup — customer + gate", () => {
  it("returns 404 when the Stripe customer is deleted", async () => {
    mockCustomersRetrieve.mockResolvedValue({ id: OPERATING_HOURLY_ID, deleted: true });

    const res = await POST(makeRequest({ amount: "5000" }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Customer not found");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("returns the gate denial unchanged when billing.manage is denied — before any checkout", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(makeRequest({ amount: "5000" }));

    expect(res.status).toBe(403);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: OPERATING_ACCOUNT_ID }),
      "billing.manage",
      expect.anything(),
    );
  });

  it("rejects a customer whose billing_type is not free / free_trial / hourly", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: OPERATING_HOURLY_ID,
      email: EMAIL,
      metadata: { billing_type: "monthly" },
    });

    const res = await POST(makeRequest({ amount: "5000" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("hourly billing");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it.each(["free", "free_trial", "hourly"])(
    "allows billing_type %s",
    async (bt) => {
      mockCustomersRetrieve.mockResolvedValue({
        id: OPERATING_HOURLY_ID,
        email: EMAIL,
        metadata: { billing_type: bt },
      });
      const res = await POST(makeRequest({ amount: "5000" }));
      expect(res.status).toBe(200);
    },
  );
});

describe("POST /api/account/wallet-topup — voucher path", () => {
  it("validates the voucher against the chosen top-up amount", async () => {
    mockValidateVoucher.mockResolvedValue({
      valid: true,
      voucher: { code: "BONUS50", creditCents: 5000 },
    });

    await POST(makeRequest({ amount: "10000", voucherCode: "  bonus50  " }));

    // Code is trimmed; the voucher is validated against the actual top-up cents.
    expect(mockValidateVoucher).toHaveBeenCalledWith("bonus50", OPERATING_HOURLY_ID, 10000);
  });

  it("returns 400 with the voucher error and no checkout when the voucher is invalid", async () => {
    mockValidateVoucher.mockResolvedValue({
      valid: false,
      error: "This voucher has expired",
    });

    const res = await POST(
      makeRequest({ amount: "5000", voucherCode: "EXPIRED" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("This voucher has expired");
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it("surfaces the applied voucher in the response and threads the code into metadata", async () => {
    mockValidateVoucher.mockResolvedValue({
      valid: true,
      voucher: { code: "BONUS50", creditCents: 5000 },
    });

    const res = await POST(
      makeRequest({ amount: "10000", voucherCode: "BONUS50" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voucherApplied).toEqual({ code: "BONUS50", creditCents: 5000 });

    const checkoutArg = mockCheckoutCreate.mock.calls[0][0];
    expect(checkoutArg.metadata.voucher_code).toBe("BONUS50");
    expect(checkoutArg.payment_intent_data.metadata.voucher_code).toBe("BONUS50");
    expect(checkoutArg.line_items[0].price_data.product_data.description).toContain("bonus");
  });

  it("skips voucher validation when no code is provided", async () => {
    const res = await POST(makeRequest({ amount: "5000" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockValidateVoucher).not.toHaveBeenCalled();
    expect(body.voucherApplied).toBeNull();
  });

  it("skips voucher validation for a whitespace-only code", async () => {
    const res = await POST(makeRequest({ amount: "5000", voucherCode: "   " }));
    expect(res.status).toBe(200);
    expect(mockValidateVoucher).not.toHaveBeenCalled();
    expect((await res.json()).voucherApplied).toBeNull();
  });
});

describe("POST /api/account/wallet-topup — happy path + errors", () => {
  it("creates a one-time-payment checkout for the exact amount with wallet_topup metadata", async () => {
    const res = await POST(makeRequest({ amount: "25000" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");

    const arg = mockCheckoutCreate.mock.calls[0][0];
    expect(arg.mode).toBe("payment");
    expect(arg.customer).toBe(OPERATING_HOURLY_ID);
    expect(arg.line_items[0].price_data.unit_amount).toBe(25000);
    expect(arg.line_items[0].price_data.currency).toBe("usd");
    expect(arg.metadata).toMatchObject({
      type: "wallet_topup",
      customer_id: OPERATING_HOURLY_ID,
    });
    expect(arg.payment_intent_data.metadata).toMatchObject({
      type: "wallet_topup",
      customer_id: OPERATING_HOURLY_ID,
    });
  });

  it("mints a 2h return token that keeps the session on the operating account", async () => {
    await POST(makeRequest({ amount: "5000" }));

    // The options overload, not the bare number: a number drops activeAccountId
    // and userId, landing the returning session back on the JWT customer.
    expect(mockGenerateCustomerToken).toHaveBeenCalledWith(EMAIL, JWT_CUSTOMER_ID, {
      userId: "user_1",
      activeAccountId: OPERATING_ACCOUNT_ID,
      expiresInHours: 2,
    });
    const arg = mockCheckoutCreate.mock.calls[0][0];
    expect(arg.success_url).toContain("token=return-token");
    expect(arg.cancel_url).toContain("token=return-token");
  });

  it("falls back to the operating account when the context has no hourly wallet", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      authContext({
        email: EMAIL,
        hourlyCustomerId: null,
        stripe: {
          customers: { retrieve: mockCustomersRetrieve },
          checkout: { sessions: { create: mockCheckoutCreate } },
        },
      }),
    );

    await POST(makeRequest({ amount: "5000" }));

    expect(mockCustomersRetrieve).toHaveBeenCalledWith(OPERATING_ACCOUNT_ID);
    expect(mockCheckoutCreate.mock.calls[0][0].customer).toBe(OPERATING_ACCOUNT_ID);
  });

  it("returns 500 when Stripe checkout creation throws", async () => {
    mockCheckoutCreate.mockRejectedValue(new Error("stripe down"));

    const res = await POST(makeRequest({ amount: "5000" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to create checkout session");
  });

  it("returns 500 when the Stripe customer lookup throws", async () => {
    mockCustomersRetrieve.mockRejectedValue(new Error("stripe boom"));
    const res = await POST(makeRequest({ amount: "5000" }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/account/wallet-topup", () => {
  it("returns the fixed top-up amount catalog", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.amounts).toEqual([
      { value: 2500, label: "$25" },
      { value: 5000, label: "$50" },
      { value: 10000, label: "$100" },
      { value: 25000, label: "$250" },
      { value: 50000, label: "$500" },
    ]);
  });
});
