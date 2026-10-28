// Tests for src/app/api/admin/customers/export/route.ts (GET).
//
// PA-287 — admin customer CSV export coverage. Admin-cookie gated. Reads
// customerCache (filtered by an optional ?search across email/name/id), counts
// active pods per customer via podMetadata.groupBy, then emits a text/csv body
// with a fixed header and one comma-joined row per customer. Wallet credit is
// the negated balanceCents formatted as "$x.xx"; the signup column is the
// stripeCreatedAt date (YYYY-MM-DD). Fields containing comma/quote/newline are
// CSV-escaped (wrapped in quotes, inner quotes doubled).
//
// Mocked at the @/lib/prisma + @/lib/admin boundary. verifySessionToken is sync.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockGroupBy } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
  mockGroupBy: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: { findMany: mockFindMany },
    podMetadata: { groupBy: mockGroupBy },
  },
}));

import { GET } from "@/app/api/admin/customers/export/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";
const HEADER = "Name,Email,Team ID,Plan,Billing Type,Credits,Active GPUs,Signed Up";

function makeReq(
  { search, withSession = true }: { search?: string; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const qs = search !== undefined ? `?search=${encodeURIComponent(search)}` : "";
  return new NextRequest(`http://localhost/api/admin/customers/export${qs}`, {
    method: "GET",
    headers,
  });
}

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    name: "Acme Inc",
    email: "ops@acme.com",
    teamId: "team-1",
    productId: "prod-pro",
    billingType: "prepaid",
    balanceCents: -500, // negated → $5.00 credit
    stripeCreatedAt: new Date("2026-05-01T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([customer()]);
  mockGroupBy.mockResolvedValue([{ stripeCustomerId: "cus_1", _count: { id: 2 } }]);
});

describe("GET /api/admin/customers/export — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq({ withSession: false }));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/customers/export — CSV response", () => {
  it("sets the text/csv content-type and a dated attachment filename", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"$/
    );
  });

  it("emits the fixed header row", async () => {
    const res = await GET(makeReq());
    const text = await res.text();
    expect(text.split("\n")[0]).toBe(HEADER);
  });

  it("formats a customer row: negated balance as credit, pod count, date", async () => {
    const res = await GET(makeReq());
    const text = await res.text();
    const row = text.split("\n")[1];
    expect(row).toBe("Acme Inc,ops@acme.com,team-1,prod-pro,prepaid,$5.00,2,2026-05-01");
  });

  it("renders zero active GPUs when the customer has no pod metadata", async () => {
    mockGroupBy.mockResolvedValue([]);
    const res = await GET(makeReq());
    const row = (await res.text()).split("\n")[1];
    expect(row).toContain(",0,");
  });

  it("emits only the header when there are no customers", async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(makeReq());
    const text = await res.text();
    expect(text).toBe(HEADER);
  });
});

describe("GET /api/admin/customers/export — CSV escaping", () => {
  it("quotes and doubles inner quotes for fields with commas/quotes", async () => {
    mockFindMany.mockResolvedValue([
      customer({ name: 'Acme, "The" Co', email: "ops@acme.com" }),
    ]);
    const res = await GET(makeReq());
    const row = (await res.text()).split("\n")[1];
    expect(row.startsWith('"Acme, ""The"" Co",ops@acme.com,')).toBe(true);
  });

  it("renders empty strings for null name/email/team/plan/billing", async () => {
    mockFindMany.mockResolvedValue([
      customer({
        name: null,
        email: null,
        teamId: null,
        productId: null,
        billingType: null,
        balanceCents: 0,
      }),
    ]);
    mockGroupBy.mockResolvedValue([]);
    const res = await GET(makeReq());
    const row = (await res.text()).split("\n")[1];
    expect(row).toBe(",,,,,$0.00,0,2026-05-01");
  });
});

describe("GET /api/admin/customers/export — search filter", () => {
  it("adds an OR filter across email/name/id when a search term is supplied", async () => {
    await GET(makeReq({ search: "acme" }));
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.isDeleted).toBe(false);
    const fields = where.OR.flatMap((c: Record<string, unknown>) => Object.keys(c));
    expect(fields).toEqual(["email", "name", "id"]);
  });

  it("omits the OR filter when no search term is supplied", async () => {
    await GET(makeReq());
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe("GET /api/admin/customers/export — errors", () => {
  it("returns 500 when the customer query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to export customers");
  });
});
