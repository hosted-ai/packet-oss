// Tests for account grouping in src/app/api/admin/customers/route.ts.
//
// A monthly purchase mints a second Stripe customer on the same email and team.
// Rendered per record, the account showed twice: a phantom $0.00 wallet (the
// money lives on the primary) and its one running pod counted once per record.
// These pin the collapsed row, the search widening, sorting and paging.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockCount, mockGetActivePodCountsByTeam } =
  vi.hoisted(() => ({
    mockVerifySessionToken: vi.fn(),
    mockFindMany: vi.fn(),
    mockCount: vi.fn(),
    mockGetActivePodCountsByTeam: vi.fn(),
  }));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/admin-cache", () => ({
  getActivePodCountsByTeam: mockGetActivePodCountsByTeam,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { customerCache: { findMany: mockFindMany, count: mockCount } },
}));

import { GET } from "@/app/api/admin/customers/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";
const TEAM = "9fe78b7a-acb5-4328-be2c-7f99c8f822cc";

function makeRequest(query = "") {
  const headers = new Headers();
  headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest(`http://localhost/api/admin/customers?${query}`, {
    method: "GET",
    headers,
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    email: "a@x.com",
    name: "Cust A",
    stripeCreatedAt: new Date("2026-06-01T00:00:00Z"),
    teamId: "team-1",
    productId: null,
    billingType: "hourly",
    balanceCents: 0,
    activePods: 0,
    ...overrides,
  };
}

// The production shape: an hourly primary holding the wallet, plus a monthly
// sub-customer minted by a later purchase on the same email and team.
const PRIMARY = row({
  id: "cus_V7iVAY2H1ikRFg",
  email: "quickclip@ltdhonkoma.com",
  name: "quickclip",
  teamId: TEAM,
  billingType: "hourly",
  balanceCents: -2500,
  stripeCreatedAt: new Date("2026-08-23T04:32:20Z"),
});

const MONTHLY = row({
  id: "cus_VFwsLMgzuRwjNm",
  email: "quickclip@ltdhonkoma.com",
  name: "UPSIDER MEMBER",
  teamId: TEAM,
  billingType: "monthly",
  balanceCents: 0,
  productId: "cmlm805b3000eastorc8terwh",
  stripeCreatedAt: new Date("2026-09-14T03:55:08Z"),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockGetActivePodCountsByTeam.mockResolvedValue(new Map());
});

describe("GET /api/admin/customers — one row per account", () => {
  it("collapses a monthly sub-customer into the primary's row", async () => {
    mockFindMany.mockResolvedValue([PRIMARY, MONTHLY]);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([[TEAM, 1]]));

    const body = await (await GET(makeRequest())).json();

    expect(body.customers).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.customers[0].id).toBe("cus_V7iVAY2H1ikRFg");
    expect(body.customers[0].walletBalance).toBe(2500);
    expect(body.customers[0].activeGPUs).toBe(1);
  });

  it("carries the plan from whichever record holds it", async () => {
    mockFindMany.mockResolvedValue([PRIMARY, MONTHLY]);

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].productId).toBe("cmlm805b3000eastorc8terwh");
  });

  it("keeps every constituent Stripe id on the grouped row", async () => {
    mockFindMany.mockResolvedValue([PRIMARY, MONTHLY]);

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].customerIds).toEqual([
      "cus_V7iVAY2H1ikRFg",
      "cus_VFwsLMgzuRwjNm",
    ]);
  });

  it("counts a team once when several records of the account carry it", async () => {
    mockFindMany.mockResolvedValue([PRIMARY, MONTHLY]);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([[TEAM, 3]]));

    const body = await (await GET(makeRequest())).json();
    expect(body.customers[0].activeGPUs).toBe(3);
  });

  it("totals the distinct teams of an account that spans several", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "cus_a", email: "multi@x.com", teamId: "team-a" }),
      row({ id: "cus_b", email: "multi@x.com", teamId: "team-b", billingType: "monthly" }),
    ]);
    mockGetActivePodCountsByTeam.mockResolvedValue(
      new Map([["team-a", 2], ["team-b", 5]]),
    );

    const body = await (await GET(makeRequest())).json();
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].activeGPUs).toBe(7);
  });

  it("keeps an email-less record as its own account", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "cus_x", email: null, teamId: null }),
      row({ id: "cus_y", email: null, teamId: null }),
    ]);

    const body = await (await GET(makeRequest())).json();
    expect(body.total).toBe(2);
    expect(body.customers.every((c: { activeGPUs: number }) => c.activeGPUs === 0)).toBe(true);
  });
});

describe("GET /api/admin/customers — search over grouped rows", () => {
  it("widens a sub-customer hit back to the whole account", async () => {
    mockFindMany
      .mockResolvedValueOnce([MONTHLY])
      .mockResolvedValueOnce([PRIMARY, MONTHLY]);
    mockGetActivePodCountsByTeam.mockResolvedValue(new Map([[TEAM, 1]]));

    const body = await (await GET(makeRequest("search=UPSIDER+MEMBER"))).json();

    expect(mockFindMany.mock.calls[1][0].where.OR).toEqual([
      { email: { in: ["quickclip@ltdhonkoma.com"] } },
      { id: { in: [] } },
    ]);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].id).toBe("cus_V7iVAY2H1ikRFg");
    expect(body.customers[0].walletBalance).toBe(2500);
    expect(body.customers[0].activeGPUs).toBe(1);
  });

  it("does not re-query when the search matches nothing", async () => {
    mockFindMany.mockResolvedValue([]);

    const body = await (await GET(makeRequest("search=nobody"))).json();
    expect(body.total).toBe(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/admin/customers — sorting and paging over grouped rows", () => {
  const ACCOUNTS = [
    row({ id: "cus_1", email: "c@x.com", name: "Cee", balanceCents: -100, teamId: "t1" }),
    row({ id: "cus_2", email: "a@x.com", name: "Ay", balanceCents: -300, teamId: "t2" }),
    row({ id: "cus_3", email: "b@x.com", name: "Bee", balanceCents: 0, teamId: "t3" }),
  ];

  it("sorts by wallet balance in the direction asked for", async () => {
    mockFindMany.mockResolvedValue(ACCOUNTS);

    const asc = await (await GET(makeRequest("sortBy=walletBalance&sortDir=asc"))).json();
    expect(asc.customers.map((c: { walletBalance: number }) => c.walletBalance)).toEqual([0, 100, 300]);

    const desc = await (await GET(makeRequest("sortBy=walletBalance&sortDir=desc"))).json();
    expect(desc.customers.map((c: { walletBalance: number }) => c.walletBalance)).toEqual([300, 100, 0]);
  });

  it("sorts by every text field", async () => {
    mockFindMany.mockResolvedValue(ACCOUNTS);

    for (const [field, expected] of [
      ["email", ["a@x.com", "b@x.com", "c@x.com"]],
      ["name", ["Ay", "Bee", "Cee"]],
      ["teamId", ["t1", "t2", "t3"]],
    ] as const) {
      const body = await (await GET(makeRequest(`sortBy=${field}&sortDir=asc`))).json();
      expect(body.customers.map((c: Record<string, string>) => c[field])).toEqual(expected);
    }
  });

  it("breaks a tie on created DESC then id, so pages do not overlap", async () => {
    const tied = [1, 2, 3, 4].map((n) =>
      row({
        id: `cus_${n}`,
        email: `t${n}@x.com`,
        balanceCents: 0,
        stripeCreatedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    );
    mockFindMany.mockResolvedValue(tied);

    const first = await (
      await GET(makeRequest("sortBy=walletBalance&sortDir=asc&limit=2&page=1"))
    ).json();
    const second = await (
      await GET(makeRequest("sortBy=walletBalance&sortDir=asc&limit=2&page=2"))
    ).json();

    expect(first.customers.map((c: { id: string }) => c.id)).toEqual(["cus_1", "cus_2"]);
    expect(second.customers.map((c: { id: string }) => c.id)).toEqual(["cus_3", "cus_4"]);
    expect(first.total).toBe(4);
    expect(first.totalPages).toBe(2);
  });

  it("counts accounts, not Stripe records, in the total", async () => {
    mockFindMany.mockResolvedValue([PRIMARY, MONTHLY, ...ACCOUNTS]);

    const body = await (await GET(makeRequest("limit=2"))).json();
    expect(body.total).toBe(4);
    expect(body.totalPages).toBe(2);
    expect(body.customers).toHaveLength(2);
  });
});
