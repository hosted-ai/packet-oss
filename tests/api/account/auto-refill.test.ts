// Tests for src/app/api/account/auto-refill/route.ts (PA-195).
//
// Customer-set, opt-in auto-refill. Billing-critical: it controls whether (and
// how much) we charge a saved card automatically. Pinned contracts (POST):
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Settings land on the operating context's wallet, never the JWT customer
//   * enabled must be boolean -> 400
//   * deleted Stripe customer -> 404
//   * billing.manage gate denial short-circuits BEFORE any write
//   * enabling validates amount/threshold ranges + amount >= threshold -> 400
//   * enabling persists the three metadata keys and echoes the saved settings
//   * disabling sets auto_refill_enabled=false without requiring amount/threshold
//   * Stripe throw -> 500
//
// Dependencies mocked at the import boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  authContext,
  OPERATING_ACCOUNT_ID,
  OPERATING_HOURLY_ID,
} from "../../fixtures/customer";

const {
  mockGetAuthenticatedCustomer,
  mockRequirePermission,
  mockRetrieve,
  mockUpdate,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockRetrieve: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/auth/audit", () => ({ requirePermission: mockRequirePermission }));

import { POST } from "@/app/api/account/auto-refill/route";

function req(body: unknown, { auth = "Bearer good" }: { auth?: string | null } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/account/auto-refill", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockReturnValue(null); // allowed by default
  mockRetrieve.mockResolvedValue({
    id: OPERATING_HOURLY_ID,
    email: "ar@example.com",
    metadata: {},
    invoice_settings: { default_payment_method: "pm_1" },
  });
  // Echo the metadata we save so the route can build its response.
  mockUpdate.mockImplementation((id: string, params: { metadata: Record<string, string> }) => ({
    id,
    metadata: params.metadata,
    invoice_settings: { default_payment_method: "pm_1" },
  }));
  mockGetAuthenticatedCustomer.mockResolvedValue(
    authContext({
      hourlyCustomerId: OPERATING_HOURLY_ID,
      stripe: { customers: { retrieve: mockRetrieve, update: mockUpdate } },
    }),
  );
});

describe("POST /api/account/auto-refill", () => {
  it("returns the auth helper's 401 verbatim", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(req({ enabled: true }, { auth: null }));
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("writes to the context's hourly wallet, not the JWT customer", async () => {
    await POST(req({ enabled: true, amountCents: 10000, thresholdCents: 2500 }));
    expect(mockRetrieve).toHaveBeenCalledWith(OPERATING_HOURLY_ID);
    expect(mockUpdate.mock.calls[0][0]).toBe(OPERATING_HOURLY_ID);
  });

  it("falls back to the operating account when the context has no hourly wallet", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(
      authContext({
        hourlyCustomerId: null,
        stripe: { customers: { retrieve: mockRetrieve, update: mockUpdate } },
      }),
    );
    await POST(req({ enabled: true, amountCents: 10000, thresholdCents: 2500 }));
    expect(mockRetrieve).toHaveBeenCalledWith(OPERATING_ACCOUNT_ID);
  });

  it("400 when enabled is not a boolean", async () => {
    const res = await POST(req({ enabled: "yes", amountCents: 10000, thresholdCents: 2500 }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404 for a deleted customer", async () => {
    mockRetrieve.mockResolvedValue({ id: OPERATING_HOURLY_ID, deleted: true });
    const res = await POST(req({ enabled: true, amountCents: 10000, thresholdCents: 2500 }));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("short-circuits on a billing.manage denial BEFORE writing", async () => {
    mockRequirePermission.mockReturnValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const res = await POST(req({ enabled: true, amountCents: 10000, thresholdCents: 2500 }));
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an amount below the threshold", async () => {
    const res = await POST(req({ enabled: true, amountCents: 2000, thresholdCents: 5000 }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range amount", async () => {
    const res = await POST(req({ enabled: true, amountCents: 50, thresholdCents: 50 })); // < $10 min
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("enables and persists the customer's amount + threshold", async () => {
    const res = await POST(req({ enabled: true, amountCents: 50000, thresholdCents: 10000 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      OPERATING_HOURLY_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          auto_refill_enabled: "true",
          auto_refill_amount_cents: "50000",
          auto_refill_threshold_cents: "10000",
        }),
      }),
    );
    expect(body.autoRefill).toEqual({
      enabled: true,
      amountCents: 50000,
      thresholdCents: 10000,
      hasPaymentMethod: true,
    });
  });

  it("disables without requiring amount/threshold and preserves prior values", async () => {
    mockRetrieve.mockResolvedValue({
      id: OPERATING_HOURLY_ID,
      email: "ar@example.com",
      metadata: { auto_refill_enabled: "true", auto_refill_amount_cents: "50000", auto_refill_threshold_cents: "10000" },
      invoice_settings: { default_payment_method: "pm_1" },
    });
    const res = await POST(req({ enabled: false }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      OPERATING_HOURLY_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          auto_refill_enabled: "false",
          auto_refill_amount_cents: "50000", // preserved
        }),
      }),
    );
    expect(body.autoRefill.enabled).toBe(false);
  });

  it("500 when Stripe throws", async () => {
    mockUpdate.mockRejectedValue(new Error("stripe down"));
    const res = await POST(req({ enabled: true, amountCents: 10000, thresholdCents: 2500 }));
    expect(res.status).toBe(500);
  });
});
