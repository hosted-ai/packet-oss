// Tests for src/app/api/account/tos-accept/route.ts (PA-291).
//
// Records a customer's acceptance of the active TOS version. Unlike the other
// account endpoints, the token arrives in the JSON BODY (not the header) — this
// is the post-login acceptance flow before a session is fully established.
//
// Pinned contracts:
//   * Missing token -> 400; invalid token -> 401
//   * TOS_VERSION unconfigured -> 400 (fail closed, don't record an empty version)
//   * Unresolvable email -> 404
//   * Upsert keyed on (primaryCustomer.id, tosVersion); update is a no-op so a
//     double-click is idempotent
//   * IP / user-agent captured from headers
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveAllTeamsForEmail,
  mockGetSetting,
  mockTosUpsert,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveAllTeamsForEmail: vi.fn(),
  mockGetSetting: vi.fn(),
  mockTosUpsert: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/customer-resolver", () => ({
  resolveAllTeamsForEmail: mockResolveAllTeamsForEmail,
}));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));
vi.mock("@/lib/prisma", () => ({
  prisma: { tosAcceptance: { upsert: mockTosUpsert } },
}));

import { POST } from "@/app/api/account/tos-accept/route";

const PAYLOAD = { customerId: "cus_tos", email: "tos@example.com" };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/account/tos-accept", {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", ...headers }),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockGetSetting.mockResolvedValue("2.0");
  mockResolveAllTeamsForEmail.mockResolvedValue({
    primaryCustomer: { id: "cus_primary" },
  });
  mockTosUpsert.mockResolvedValue({});
});

describe("POST /api/account/tos-accept", () => {
  it("returns 400 when no token is supplied in the body", async () => {
    const res = await POST(makeRequest({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Token is required");
    expect(mockVerifyCustomerToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await POST(makeRequest({ token: "bad" }));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid or expired token");
    expect(mockTosUpsert).not.toHaveBeenCalled();
  });

  it("fails closed with 400 when TOS_VERSION is not configured", async () => {
    mockGetSetting.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "good" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("TOS version not configured");
    expect(mockTosUpsert).not.toHaveBeenCalled();
  });

  it("returns 404 when the email resolves to no account", async () => {
    mockResolveAllTeamsForEmail.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "good" }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Account not found");
    expect(mockTosUpsert).not.toHaveBeenCalled();
  });

  it("records acceptance against the resolved primary customer + version", async () => {
    const res = await POST(makeRequest({ token: "good" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ accepted: true, version: "2.0" });
    expect(mockTosUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stripeCustomerId_tosVersion: {
            stripeCustomerId: "cus_primary",
            tosVersion: "2.0",
          },
        },
        update: {}, // no-op -> double-click safe
      }),
    );
  });

  it("captures the first x-forwarded-for IP and the user-agent", async () => {
    await POST(
      makeRequest(
        { token: "good" },
        {
          "x-forwarded-for": "203.0.113.7, 10.0.0.1",
          "user-agent": "Mozilla/5.0 Test",
        },
      ),
    );

    expect(mockTosUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ipAddress: "203.0.113.7",
          userAgent: "Mozilla/5.0 Test",
        }),
      }),
    );
  });

  it("falls back to a null IP/user-agent when no client headers are present", async () => {
    await POST(makeRequest({ token: "good" }));
    expect(mockTosUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ipAddress: null, userAgent: null }),
      }),
    );
  });

  it("returns 500 when the upsert fails", async () => {
    mockTosUpsert.mockRejectedValue(new Error("db down"));
    const res = await POST(makeRequest({ token: "good" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toContain("Failed to record TOS acceptance");
  });
});
