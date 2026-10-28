// Tests for src/app/api/account/activity/route.ts.
//
// GET returns recent activity events for the operating account. The `limit`
// query param defaults to 50.
//
// Pinned contracts:
//   * auth-failure NextResponse returned verbatim
//   * GET forwards (accountId, limit) to getActivityEvents and returns { events }
//   * the JWT customer is never the scope
//   * limit defaults to 50 when absent
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockGetAuthenticatedCustomer, mockGetActivityEvents } = vi.hoisted(() => ({
  mockGetAuthenticatedCustomer: vi.fn(),
  mockGetActivityEvents: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
  getAuthenticatedCustomer: mockGetAuthenticatedCustomer,
}));
vi.mock("@/lib/activity", () => ({ getActivityEvents: mockGetActivityEvents }));

import { GET } from "@/app/api/account/activity/route";

const AUTH = {
  payload: { customerId: "cus_jwt", email: "a@example.com" },
  accountId: "cus_operating",
};

function makeRequest({ auth = "Bearer t", query }: { auth?: string | null; query?: string } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const url = "http://localhost/api/account/activity" + (query ?? "");
  return new NextRequest(url, { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedCustomer.mockResolvedValue(AUTH);
  mockGetActivityEvents.mockResolvedValue([]);
});

describe("GET /api/account/activity", () => {
  it("returns the auth-failure NextResponse verbatim", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockGetAuthenticatedCustomer.mockResolvedValue(unauthorized);
    const res = await GET(makeRequest({ auth: null }));
    expect(res).toBe(unauthorized);
    expect(mockGetActivityEvents).not.toHaveBeenCalled();
  });

  it("returns events for the operating account with the default limit of 50", async () => {
    mockGetActivityEvents.mockResolvedValue([{ id: "e1", type: "login" }]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events).toEqual([{ id: "e1", type: "login" }]);
    expect(mockGetActivityEvents).toHaveBeenCalledWith("cus_operating", 50);
  });

  it("never scopes to the JWT customer", async () => {
    await GET(makeRequest());
    expect(mockGetActivityEvents).not.toHaveBeenCalledWith("cus_jwt", expect.anything());
  });

  it("honors an explicit limit query param", async () => {
    const res = await GET(makeRequest({ query: "?limit=10" }));
    expect(res.status).toBe(200);
    expect(mockGetActivityEvents).toHaveBeenCalledWith("cus_operating", 10);
  });

  it("returns 500 when the lookup throws", async () => {
    mockGetActivityEvents.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
