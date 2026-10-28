// Tests for src/app/api/account/check-ready/route.ts (PA-287).
//
// GET polls Stripe for whether a checkout session's customer is fully
// provisioned (has a hosted.ai team). It is NOT a bearer route — it's keyed on
// the Stripe checkout `session_id` query param.
//
// Pinned contracts:
//   * missing session_id -> 400
//   * session not found / no email / no customer / no team -> { ready: false }
//   * deleted customer -> { ready: false }
//   * existing-monthly path: follow primary_stripe_customer_id to the team
//   * ready path -> { ready: true } with a signed auto-login dashboardUrl
//   * any throw is swallowed -> { ready: false } (never 500)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetStripe,
  mockGenerateCustomerToken,
  mockSessionsRetrieve,
  mockCustomersRetrieve,
} = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockGenerateCustomerToken: vi.fn(),
  mockSessionsRetrieve: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/customer-auth", () => ({
  generateCustomerToken: mockGenerateCustomerToken,
  // PA-380: emailed sign-in links now mint via createLoginLink. Delegate to the
  // same spy so existing email/customerId + token assertions still hold.
  createLoginLink: vi.fn(async (o: { email: string; customerId: string }) =>
    mockGenerateCustomerToken(o.email, o.customerId),
  ),
}));

import { GET } from "@/app/api/account/check-ready/route";

function makeRequest(sessionId?: string | null) {
  const url =
    sessionId === undefined
      ? "http://localhost/api/account/check-ready"
      : `http://localhost/api/account/check-ready?session_id=${encodeURIComponent(
          sessionId ?? "",
        )}`;
  return new NextRequest(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  mockGetStripe.mockResolvedValue({
    checkout: { sessions: { retrieve: mockSessionsRetrieve } },
    customers: { retrieve: mockCustomersRetrieve },
  });
  mockGenerateCustomerToken.mockReturnValue("signed-token");
});

describe("GET /api/account/check-ready", () => {
  it("returns 400 when session_id is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("session_id is required");
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns 400 when session_id is empty", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns { ready: false } when the session has no customer_email", async () => {
    mockSessionsRetrieve.mockResolvedValue({ customer_email: null, customer: "cus_1" });
    const res = await GET(makeRequest("cs_test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: false });
  });

  it("returns { ready: false } when the session has no customer id", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "u@example.com",
      customer: null,
    });
    const res = await GET(makeRequest("cs_test"));
    expect(await res.json()).toEqual({ ready: false });
  });

  it("returns { ready: false } when the Stripe customer is deleted", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "u@example.com",
      customer: "cus_1",
    });
    mockCustomersRetrieve.mockResolvedValue({ deleted: true });
    const res = await GET(makeRequest("cs_test"));
    expect(await res.json()).toEqual({ ready: false });
  });

  it("returns { ready: false } when the customer has no hosted.ai team", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "u@example.com",
      customer: "cus_1",
    });
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_1",
      metadata: {},
    });
    const res = await GET(makeRequest("cs_test"));
    expect(await res.json()).toEqual({ ready: false });
  });

  it("returns ready:true with a signed dashboardUrl when the customer owns a team", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "User@Example.com",
      customer: "cus_1",
      amount_total: 5000,
    });
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_1",
      name: "Test User",
      metadata: { hostedai_team_id: "team_1" },
    });

    const res = await GET(makeRequest("cs_test"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.customerId).toBe("cus_1");
    expect(body.email).toBe("User@Example.com");
    expect(body.name).toBe("Test User");
    expect(body.amountCents).toBe(5000);
    // Token is minted with the lower-cased email + the resolved customer id.
    expect(mockGenerateCustomerToken).toHaveBeenCalledWith("user@example.com", "cus_1");
    expect(body.dashboardUrl).toBe(
      "https://app.example.com/dashboard?token=signed-token",
    );
  });

  it("follows primary_stripe_customer_id for the existing-monthly path", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "u@example.com",
      customer: "cus_monthly",
      amount_total: 0,
    });
    mockCustomersRetrieve.mockImplementation((id: string) => {
      if (id === "cus_monthly") {
        return Promise.resolve({
          id: "cus_monthly",
          name: "Monthly",
          metadata: { primary_stripe_customer_id: "cus_primary" },
        });
      }
      return Promise.resolve({
        id: "cus_primary",
        name: "Primary",
        metadata: { hostedai_team_id: "team_primary" },
      });
    });

    const res = await GET(makeRequest("cs_test"));
    const body = await res.json();

    expect(body.ready).toBe(true);
    // Resolves to the PRIMARY customer that owns the team.
    expect(body.customerId).toBe("cus_primary");
    expect(body.name).toBe("Primary");
    expect(mockGenerateCustomerToken).toHaveBeenCalledWith("u@example.com", "cus_primary");
  });

  it("returns { ready: false } when the primary link points at a deleted customer", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      customer_email: "u@example.com",
      customer: "cus_monthly",
    });
    mockCustomersRetrieve.mockImplementation((id: string) => {
      if (id === "cus_monthly") {
        return Promise.resolve({
          id: "cus_monthly",
          metadata: { primary_stripe_customer_id: "cus_primary" },
        });
      }
      return Promise.resolve({ deleted: true });
    });

    const res = await GET(makeRequest("cs_test"));
    expect(await res.json()).toEqual({ ready: false });
  });

  it("swallows a Stripe throw and returns { ready: false } (never 500)", async () => {
    mockSessionsRetrieve.mockRejectedValue(new Error("stripe down"));
    const res = await GET(makeRequest("cs_test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: false });
  });
});
