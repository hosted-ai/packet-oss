// Tests for src/app/api/account/voucher/redeem/route.ts (PA-291).
//
// Voucher redemption credits the customer wallet, so the auth + permission
// contract is load-bearing: a missing/invalid token, or a member without
// billing.manage, must never be able to mint credit.
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Credit lands on the operating context's wallet, never the JWT customer
//   * zod validation of the voucher code (empty/too-long -> 400)
//   * billing.manage denial short-circuits redemption
//   * processVoucherRedemption failure -> 400 with its error; success -> creditCents
//   * Unexpected throw -> 500
//
// Dependencies are mocked at the import boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  authContext,
  OPERATING_ACCOUNT_ID,
  OPERATING_HOURLY_ID,
} from "../../fixtures/customer";

const {
  mockGetAuthenticatedCustomer,
  mockProcessVoucherRedemption,
  mockRequirePermission,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockProcessVoucherRedemption: vi.fn(),
  mockRequirePermission: vi.fn(),
}));

vi.mock("@/lib/voucher", () => ({
  processVoucherRedemption: mockProcessVoucherRedemption,
}));
vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));

import { POST } from "@/app/api/account/voucher/redeem/route";

const EMAIL = "redeemer@example.com";

function makeRequest(
  body: unknown,
  { auth = "Bearer good-token" }: { auth?: string | null } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/voucher/redeem", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockReturnValue(null); // allowed by default
  mockGetAuthenticatedCustomer.mockResolvedValue(
    authContext({ email: EMAIL, hourlyCustomerId: OPERATING_HOURLY_ID }),
  );
  mockProcessVoucherRedemption.mockResolvedValue({
    success: true,
    creditCents: 5000,
  });
});

describe("POST /api/account/voucher/redeem", () => {
  it("returns the auth helper's 401 verbatim", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest({ code: "SAVE10" }, { auth: null }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockProcessVoucherRedemption).not.toHaveBeenCalled();
  });

  it("rejects an empty voucher code with 400 and the zod message", async () => {
    const res = await POST(makeRequest({ code: "" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Voucher code is required");
    expect(mockProcessVoucherRedemption).not.toHaveBeenCalled();
  });

  it("rejects a voucher code longer than 50 characters", async () => {
    const res = await POST(makeRequest({ code: "X".repeat(51) }));
    expect(res.status).toBe(400);
    expect(mockProcessVoucherRedemption).not.toHaveBeenCalled();
  });

  it("returns the gate denial unchanged when billing.manage is denied", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );

    const res = await POST(makeRequest({ code: "SAVE10" }));

    expect(res.status).toBe(403);
    expect(mockProcessVoucherRedemption).not.toHaveBeenCalled();
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: OPERATING_ACCOUNT_ID }),
      "billing.manage",
      expect.anything(),
    );
  });

  it("falls back to the operating account when the context has no hourly wallet", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      authContext({ email: EMAIL, hourlyCustomerId: null }),
    );

    await POST(makeRequest({ code: "SAVE10" }));

    expect(mockProcessVoucherRedemption).toHaveBeenCalledWith(
      "SAVE10",
      OPERATING_ACCOUNT_ID,
      EMAIL,
      0,
    );
  });

  it("redeems a valid voucher and returns the credited amount", async () => {
    const res = await POST(makeRequest({ code: "save10" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, creditCents: 5000 });
    // Code is trimmed by zod but passed through as-is; redemption is wallet-only (0 payment).
    expect(mockProcessVoucherRedemption).toHaveBeenCalledWith(
      "save10",
      OPERATING_HOURLY_ID,
      EMAIL,
      0,
    );
  });

  it("returns 400 with the redemption error when the voucher is rejected", async () => {
    mockProcessVoucherRedemption.mockResolvedValue({
      success: false,
      error: "Voucher already redeemed",
    });

    const res = await POST(makeRequest({ code: "USED" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: "Voucher already redeemed" });
  });

  it("returns 500 when redemption throws unexpectedly", async () => {
    mockProcessVoucherRedemption.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest({ code: "SAVE10" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to redeem voucher" });
  });
});
