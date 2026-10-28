// Tests for the GET handler in src/app/api/admin/activity/route.ts.
//
// PA-287: admin observability coverage. This route merges admin and customer
// activity feeds into one list, filtered by source/type/search/customerId,
// sorted by created desc, and trimmed to a clamped limit. These tests pin:
// admin-cookie auth gating, source gating (all/admin/customer), the search OR
// shape per feed, the limit clamp + take forwarding, the merge/sort/trim
// behaviour, metadata JSON parsing (and the customerId extraction from admin
// metadata), the empty envelope, and the 500 path.
//
// PA-229: customer actors resolve cus_... ids to emails via CustomerCache
// (batched, with fallback to the raw id when no cached email exists).
//
// The search filters must stay free of Prisma's `mode` argument: it is
// PostgreSQL-only and fails query validation against this MySQL schema.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockAdminFindMany,
  mockCustomerFindMany,
  mockCustomerCacheFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockAdminFindMany: vi.fn(),
  mockCustomerFindMany: vi.fn(),
  mockCustomerCacheFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminActivityEvent: { findMany: mockAdminFindMany },
    activityEvent: { findMany: mockCustomerFindMany },
    customerCache: { findMany: mockCustomerCacheFindMany },
  },
}));

import { GET } from "@/app/api/admin/activity/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/activity${query ? `?${query}` : ""}`;
  return new NextRequest(url, { method: "GET", headers });
}

function adminEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1",
    type: "settings_updated",
    adminEmail: "admin@example.com",
    description: "Updated pricing",
    metadata: null,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    ...over,
  };
}

function customerEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    type: "instance_started",
    customerId: "cus_123",
    description: "Started an instance",
    metadata: null,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockAdminFindMany.mockResolvedValue([]);
  mockCustomerFindMany.mockResolvedValue([]);
  mockCustomerCacheFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/activity — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockAdminFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockAdminFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/activity — source gating", () => {
  it("queries both feeds by default (source=all)", async () => {
    await GET(makeRequest());
    expect(mockAdminFindMany).toHaveBeenCalledTimes(1);
    expect(mockCustomerFindMany).toHaveBeenCalledTimes(1);
  });

  it("queries only the admin feed when source=admin", async () => {
    await GET(makeRequest("source=admin"));
    expect(mockAdminFindMany).toHaveBeenCalledTimes(1);
    expect(mockCustomerFindMany).not.toHaveBeenCalled();
  });

  it("queries only the customer feed when source=customer", async () => {
    await GET(makeRequest("source=customer"));
    expect(mockCustomerFindMany).toHaveBeenCalledTimes(1);
    expect(mockAdminFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/activity — filters & limit", () => {
  it("defaults the limit (take) to 200 and orders desc", async () => {
    await GET(makeRequest());
    expect(mockAdminFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, orderBy: { createdAt: "desc" } })
    );
  });

  it("clamps the limit to a maximum of 500", async () => {
    await GET(makeRequest("limit=99999"));
    expect(mockAdminFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });

  it("forwards a type filter to both feeds", async () => {
    await GET(makeRequest("type=login"));
    expect(mockAdminFindMany.mock.calls[0][0].where).toMatchObject({ type: "login" });
    expect(mockCustomerFindMany.mock.calls[0][0].where).toMatchObject({ type: "login" });
  });

  it("forwards a customerId filter to the customer feed only", async () => {
    await GET(makeRequest("customerId=cus_999"));
    expect(mockCustomerFindMany.mock.calls[0][0].where).toMatchObject({
      customerId: "cus_999",
    });
    // Admin events have no customerId column — must not be filtered by it.
    expect(mockAdminFindMany.mock.calls[0][0].where).not.toHaveProperty("customerId");
  });

  it("builds the admin search OR over description/adminEmail/type", async () => {
    await GET(makeRequest("source=admin&search=pricing"));
    expect(mockAdminFindMany.mock.calls[0][0].where.OR).toEqual([
      { description: { contains: "pricing" } },
      { adminEmail: { contains: "pricing" } },
      { type: { contains: "pricing" } },
    ]);
  });

  it("builds the customer search OR over description/customerId/type", async () => {
    await GET(makeRequest("source=customer&search=foo"));
    expect(mockCustomerFindMany.mock.calls[0][0].where.OR).toEqual([
      { description: { contains: "foo" } },
      { customerId: { contains: "foo" } },
      { type: { contains: "foo" } },
    ]);
  });

  // The datasource is MySQL, where Prisma rejects `mode` outright (it is a
  // PostgreSQL-only filter) and the handler's catch turns that into a 500.
  it("sends no PostgreSQL-only query mode on any search filter", async () => {
    await GET(makeRequest("search=admin"));
    const filters = [
      ...mockAdminFindMany.mock.calls[0][0].where.OR,
      ...mockCustomerFindMany.mock.calls[0][0].where.OR,
    ];
    expect(filters).toHaveLength(6);
    for (const filter of filters) {
      for (const condition of Object.values(filter)) {
        expect(condition).not.toHaveProperty("mode");
      }
    }
  });
});

describe("GET /api/admin/activity — merge, shape, sort, trim", () => {
  it("merges both feeds and sorts by created desc (newest first)", async () => {
    mockAdminFindMany.mockResolvedValue([adminEvent()]); // 2026-01-03
    mockCustomerFindMany.mockResolvedValue([customerEvent()]); // 2026-01-02

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.activities.map((a: { id: string }) => a.id)).toEqual(["a1", "c1"]);
    expect(body.activities[0].source).toBe("admin");
    expect(body.activities[1].source).toBe("customer");
    // created is unix seconds.
    expect(body.activities[0].created).toBe(
      Math.floor(new Date("2026-01-03T00:00:00.000Z").getTime() / 1000)
    );
  });

  it("parses admin metadata JSON and lifts customerId out of it", async () => {
    mockAdminFindMany.mockResolvedValue([
      adminEvent({ metadata: JSON.stringify({ customerId: "cus_777", note: "x" }) }),
    ]);
    const body = await (await GET(makeRequest("source=admin"))).json();
    expect(body.activities[0].customerId).toBe("cus_777");
    expect(body.activities[0].metadata).toEqual({ customerId: "cus_777", note: "x" });
  });

  // PA-229: the customer actor must resolve to the customer's email via
  // CustomerCache, not surface the raw cus_... id.
  it("resolves the customer actor to the cached email", async () => {
    mockCustomerFindMany.mockResolvedValue([customerEvent({ customerId: "cus_42" })]);
    mockCustomerCacheFindMany.mockResolvedValue([
      { id: "cus_42", email: "customer@example.com" },
    ]);
    const body = await (await GET(makeRequest("source=customer"))).json();
    expect(body.activities[0].actor).toBe("customer@example.com");
    // customerId stays the raw id so filtering/links keep working.
    expect(body.activities[0].customerId).toBe("cus_42");
  });

  it("batch-resolves distinct customer ids in one CustomerCache query", async () => {
    mockCustomerFindMany.mockResolvedValue([
      customerEvent({ id: "c1", customerId: "cus_1" }),
      customerEvent({ id: "c2", customerId: "cus_1" }),
      customerEvent({ id: "c3", customerId: "cus_2" }),
    ]);
    await GET(makeRequest("source=customer"));
    expect(mockCustomerCacheFindMany).toHaveBeenCalledTimes(1);
    expect(mockCustomerCacheFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ["cus_1", "cus_2"] },
    });
  });

  it("falls back to the customerId when the cache has no email", async () => {
    mockCustomerFindMany.mockResolvedValue([
      customerEvent({ id: "c1", customerId: "cus_gone" }),
      customerEvent({ id: "c2", customerId: "cus_null" }),
    ]);
    // cus_gone: no cache row at all; cus_null: cached row with a null email.
    mockCustomerCacheFindMany.mockResolvedValue([{ id: "cus_null", email: null }]);
    const body = await (await GET(makeRequest("source=customer"))).json();
    expect(body.activities.map((a: { actor: string }) => a.actor)).toEqual([
      "cus_gone",
      "cus_null",
    ]);
  });

  it("skips the CustomerCache lookup when there are no customer events", async () => {
    const res = await GET(makeRequest("source=customer"));
    expect(res.status).toBe(200);
    expect(mockCustomerCacheFindMany).not.toHaveBeenCalled();
  });

  it("trims the merged result down to the limit", async () => {
    mockAdminFindMany.mockResolvedValue([
      adminEvent({ id: "a1", createdAt: new Date("2026-01-05T00:00:00.000Z") }),
      adminEvent({ id: "a2", createdAt: new Date("2026-01-04T00:00:00.000Z") }),
    ]);
    mockCustomerFindMany.mockResolvedValue([
      customerEvent({ id: "c1", createdAt: new Date("2026-01-03T00:00:00.000Z") }),
    ]);
    const body = await (await GET(makeRequest("limit=2"))).json();
    expect(body.activities).toHaveLength(2);
    // Newest two survive the trim.
    expect(body.activities.map((a: { id: string }) => a.id)).toEqual(["a1", "a2"]);
  });
});

describe("GET /api/admin/activity — empty & error", () => {
  it("returns an empty activities list when both feeds are empty", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.activities).toEqual([]);
  });

  it("returns 500 when a feed query throws", async () => {
    mockAdminFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch activities");
  });
});
