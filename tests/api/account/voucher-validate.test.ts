// Tests for src/app/api/account/voucher/validate/route.ts (PA-291).
//
// Validation is read-only (no wallet mutation) and is NOT permission-gated —
// only Bearer auth is required. The handler forwards the optional
// topupAmountCents so the voucher lib can compute the would-be credit.
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Validation targets the operating context's wallet, so the preview matches
//     what the redeem and top-up paths will actually credit
//   * zod validation: empty code -> 400; non-positive/non-int topup -> 400
//   * valid voucher -> 200 with the voucher payload
//   * invalid voucher -> 400 with the lib's error
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  authContext,
  OPERATING_ACCOUNT_ID,
  OPERATING_HOURLY_ID,
} from "../../fixtures/customer";

const { mockGetAuthenticatedCustomer, mockValidateVoucher } = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockValidateVoucher: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/voucher", () => ({ validateVoucher: mockValidateVoucher }));

import { POST } from "@/app/api/account/voucher/validate/route";

function makeRequest(
  body: unknown,
  { auth = "Bearer good-token" }: { auth?: string | null } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/voucher/validate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(
    authContext({ hourlyCustomerId: OPERATING_HOURLY_ID }),
  );
  mockValidateVoucher.mockResolvedValue({
    valid: true,
    voucher: { code: "SAVE10", creditCents: 1000 },
  });
});

describe("POST /api/account/voucher/validate", () => {
  it("returns the auth helper's 401 verbatim", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeRequest({ code: "SAVE10" }, { auth: null }));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockValidateVoucher).not.toHaveBeenCalled();
  });

  it("falls back to the operating account when the context has no hourly wallet", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      authContext({ hourlyCustomerId: null }),
    );
    await POST(makeRequest({ code: "SAVE10" }));
    expect(mockValidateVoucher).toHaveBeenCalledWith(
      "SAVE10",
      OPERATING_ACCOUNT_ID,
      undefined,
    );
  });

  it("rejects an empty code with 400", async () => {
    const res = await POST(makeRequest({ code: "" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Voucher code is required");
    expect(mockValidateVoucher).not.toHaveBeenCalled();
  });

  it("rejects a negative topup amount", async () => {
    const res = await POST(
      makeRequest({ code: "SAVE10", topupAmountCents: -100 }),
    );
    expect(res.status).toBe(400);
    expect(mockValidateVoucher).not.toHaveBeenCalled();
  });

  it("rejects a non-integer topup amount", async () => {
    const res = await POST(
      makeRequest({ code: "SAVE10", topupAmountCents: 12.5 }),
    );
    expect(res.status).toBe(400);
  });

  it("validates a voucher with no topup amount", async () => {
    const res = await POST(makeRequest({ code: "SAVE10" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.voucher).toEqual({ code: "SAVE10", creditCents: 1000 });
    expect(mockValidateVoucher).toHaveBeenCalledWith(
      "SAVE10",
      OPERATING_HOURLY_ID,
      undefined,
    );
  });

  it("forwards a positive topup amount to the voucher lib", async () => {
    await POST(makeRequest({ code: "SAVE10", topupAmountCents: 10000 }));
    expect(mockValidateVoucher).toHaveBeenCalledWith("SAVE10", OPERATING_HOURLY_ID, 10000);
  });

  it("returns 400 with the lib error when the voucher is invalid", async () => {
    mockValidateVoucher.mockResolvedValue({
      valid: false,
      error: "Voucher expired",
    });

    const res = await POST(makeRequest({ code: "OLD" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: "Voucher expired" });
  });

  it("returns 500 when validation throws", async () => {
    mockValidateVoucher.mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest({ code: "SAVE10" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to validate voucher");
  });
});
