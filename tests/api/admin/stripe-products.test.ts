// Tests for src/app/api/admin/stripe-products/route.ts — lists active Stripe
// products with their recurring prices for the admin catalog (PA-287).
//
// GET gates on the admin_session cookie, then calls stripe.products.list and,
// per product, stripe.prices.list (active recurring). Products with no
// recurring price are dropped (mapped to null then filtered). These tests pin:
// auth gating, the map-to-response shape, empty list, the no-recurring-price
// drop, and Stripe-throws → 500.
//
// getStripe() is mocked at the @/lib/stripe boundary to return a fake Stripe
// client; verifySessionToken is synchronous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockGetStripe, mockProductsList, mockPricesList } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetStripe: vi.fn(),
  mockProductsList: vi.fn(),
  mockPricesList: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));

import { GET } from "@/app/api/admin/stripe-products/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeGet(withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/stripe-products", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockGetStripe.mockResolvedValue({
    products: { list: mockProductsList },
    prices: { list: mockPricesList },
  });
  mockProductsList.mockResolvedValue({ data: [] });
  mockPricesList.mockResolvedValue({ data: [] });
});

describe("GET /api/admin/stripe-products — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeGet(false));
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/stripe-products — mapping", () => {
  it("maps products with recurring prices to the response shape", async () => {
    mockProductsList.mockResolvedValue({
      data: [{ id: "prod_1", name: "Pro", description: "Pro plan" }],
    });
    mockPricesList.mockResolvedValue({
      data: [
        {
          id: "price_1",
          unit_amount: 5000,
          currency: "usd",
          recurring: { interval: "month", interval_count: 1 },
        },
      ],
    });

    const res = await GET(makeGet());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockProductsList).toHaveBeenCalledWith({ active: true, limit: 100 });
    expect(mockPricesList).toHaveBeenCalledWith(
      expect.objectContaining({ product: "prod_1", active: true, type: "recurring" }),
    );
    expect(data.data).toEqual([
      {
        id: "prod_1",
        name: "Pro",
        description: "Pro plan",
        prices: [
          { id: "price_1", unitAmount: 5000, currency: "usd", interval: "month", intervalCount: 1 },
        ],
      },
    ]);
  });

  it("defaults interval/intervalCount when recurring is absent on a price", async () => {
    mockProductsList.mockResolvedValue({ data: [{ id: "prod_1", name: "Pro", description: null }] });
    mockPricesList.mockResolvedValue({
      data: [{ id: "price_1", unit_amount: 100, currency: "usd", recurring: null }],
    });
    const res = await GET(makeGet());
    const data = await res.json();
    expect(data.data[0].prices[0].interval).toBe("month");
    expect(data.data[0].prices[0].intervalCount).toBe(1);
  });

  it("drops products that have no recurring prices", async () => {
    mockProductsList.mockResolvedValue({
      data: [
        { id: "prod_1", name: "HasPrice", description: null },
        { id: "prod_2", name: "NoPrice", description: null },
      ],
    });
    mockPricesList.mockImplementation(async ({ product }: { product: string }) =>
      product === "prod_1"
        ? { data: [{ id: "price_1", unit_amount: 100, currency: "usd", recurring: { interval: "year", interval_count: 1 } }] }
        : { data: [] },
    );

    const res = await GET(makeGet());
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("prod_1");
  });

  it("returns an empty array when there are no products", async () => {
    const res = await GET(makeGet());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data).toEqual([]);
  });

  it("returns 500 when Stripe throws", async () => {
    mockProductsList.mockRejectedValue(new Error("stripe down"));
    const res = await GET(makeGet());
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toBe("Failed to fetch Stripe products");
  });
});
