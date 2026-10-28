// Tests for src/app/api/account/settings/route.ts (PA-291).
//
// Customer settings is the session-timeout store. GET lazily creates a default
// row; PUT clamps the timeout to 1-24 hours and upserts.
//
// Pinned contracts:
//   * Auth delegated to getAuthenticatedCustomer (its 401 returned verbatim)
//   * Rows are keyed on the OPERATING account, never the JWT customer
//   * GET returns the existing row, or creates one with the 1h default
//   * PUT validates sessionTimeoutHours type + 1..24 range
//   * PUT upserts and echoes the stored value
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { authContext, OPERATING_ACCOUNT_ID } from "../../fixtures/customer";

const {
  mockGetAuthenticatedCustomer,
  mockFindUnique,
  mockCreate,
  mockUpsert,
} = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerSettings: {
      findUnique: mockFindUnique,
      create: mockCreate,
      upsert: mockUpsert,
    },
  },
}));

import { GET, PUT } from "@/app/api/account/settings/route";

function makeRequest(
  method: "GET" | "PUT",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("Authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/settings", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(authContext());
});

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

describe("GET /api/account/settings", () => {
  it("returns the auth helper's 401 verbatim", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized());
    const res = await GET(makeRequest("GET", { auth: null }));
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns the existing settings row", async () => {
    mockFindUnique.mockResolvedValue({ sessionTimeoutHours: 8 });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, settings: { sessionTimeoutHours: 8 } });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("lazily creates a default 1h row when none exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ sessionTimeoutHours: 1 });

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settings.sessionTimeoutHours).toBe(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { stripeCustomerId: OPERATING_ACCOUNT_ID, sessionTimeoutHours: 1 },
    });
  });

  it("returns 500 when the read fails", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/account/settings", () => {
  it("returns the auth helper's 401 verbatim", async () => {
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized());
    const res = await PUT(makeRequest("PUT", { auth: null, body: {} }));
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric sessionTimeoutHours", async () => {
    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: "8" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("between 1 and 24");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a value below the 1h floor", async () => {
    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: 0 } }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a value above the 24h ceiling", async () => {
    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: 25 } }),
    );
    expect(res.status).toBe(400);
  });

  it("upserts a valid timeout and echoes the stored value", async () => {
    mockUpsert.mockResolvedValue({ sessionTimeoutHours: 12 });

    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: 12 } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, settings: { sessionTimeoutHours: 12 } });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { stripeCustomerId: OPERATING_ACCOUNT_ID },
      update: { sessionTimeoutHours: 12 },
      create: { stripeCustomerId: OPERATING_ACCOUNT_ID, sessionTimeoutHours: 12 },
    });
  });

  it("accepts the 24h boundary value", async () => {
    mockUpsert.mockResolvedValue({ sessionTimeoutHours: 24 });
    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: 24 } }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 500 when the upsert fails", async () => {
    mockUpsert.mockRejectedValue(new Error("db down"));
    const res = await PUT(
      makeRequest("PUT", { body: { sessionTimeoutHours: 5 } }),
    );
    expect(res.status).toBe(500);
  });
});
