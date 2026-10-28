// Tests for src/app/api/instances/launch-options/route.ts — the product list
// the launch modal renders.
//
// PA-342: this route entitles a monthly product ONLY if the customer's active
// Stripe subscription carries the product's current stripePriceId. But
// /api/account/verify (which decides whether to SHOW the "Deploy GPU" button)
// matches by price ID OR product ID. So when a sub's price ID has drifted from
// the product's current stripePriceId (price/product recreated after the
// customer subscribed) but the product ID still matches, the card offers Deploy
// while this route returns zero products → "No GPUs Available".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockResolveOperatingContext,
  mockGetStripe,
  mockSubscriptionsList,
  mockGetWalletBalance,
  mockGetSharedVolumes,
  mockGpuCategoryFindMany,
  mockGpuProductFindMany,
  mockSSHKeyFindMany,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockResolveOperatingContext: vi.fn(),
  mockGetStripe: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockGetSharedVolumes: vi.fn(),
  mockGpuCategoryFindMany: vi.fn(),
  mockGpuProductFindMany: vi.fn(),
  mockSSHKeyFindMany: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
}));
vi.mock("@/lib/auth/account-resolver", () => ({
  resolveOperatingContext: mockResolveOperatingContext,
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/wallet", () => ({ getWalletBalance: mockGetWalletBalance }));
vi.mock("@/lib/hostedai", () => ({ getSharedVolumes: mockGetSharedVolumes }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuCategory: { findMany: mockGpuCategoryFindMany },
    gpuProduct: { findMany: mockGpuProductFindMany },
    sSHKey: { findMany: mockSSHKeyFindMany },
  },
}));

import { GET } from "@/app/api/instances/launch-options/route";

const TOKEN = "Bearer valid.jwt.token";

// The monthly product as it exists in the DB *today*: its price was rotated, so
// stripePriceId is the NEW price. Its stripeProductId is unchanged.
const PRICE_CURRENT = "price_NEW_after_rotation";
const PRODUCT_ID = "prod_RTX6000";

const RTX6000_MONTHLY = {
  id: "gpuprod_rtx6000_monthly",
  name: "RTX6000 Dynamic Monthly",
  description: "RTX 6000 Pro",
  pricePerHourCents: 0,
  pricePerMonthCents: 200000,
  billingType: "monthly",
  stripeProductId: PRODUCT_ID,
  stripePriceId: PRICE_CURRENT,
  serviceId: "svc_rtx",
  displayOrder: 1,
  active: true,
  featured: false,
  badgeText: null,
  vramGb: 48,
  cudaCores: null,
  gpuFamily: "blackwell",
  categories: [],
};

const CTX = {
  customer: {
    id: "cus_op",
    email: "jason@example.com",
    metadata: { hostedai_team_id: "team_1", billing_type: "monthly" },
  },
  accountId: "cus_op",
  teamId: "team_1",
  monthlyCustomerIds: [] as string[],
};

function makeRequest(authorized = true) {
  const headers = new Headers();
  if (authorized) headers.set("authorization", TOKEN);
  return new NextRequest("http://localhost/api/instances/launch-options", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue({
    customerId: "cus_jwt",
    email: "jason@example.com",
  });
  mockResolveOperatingContext.mockResolvedValue(CTX);
  mockGetStripe.mockResolvedValue({
    subscriptions: { list: mockSubscriptionsList },
  });
  mockGetWalletBalance.mockResolvedValue({ availableBalance: 0 });
  mockGetSharedVolumes.mockResolvedValue([]);
  mockGpuCategoryFindMany.mockResolvedValue([]);
  mockGpuProductFindMany.mockResolvedValue([RTX6000_MONTHLY]);
  mockSSHKeyFindMany.mockResolvedValue([]);
});

describe("GET /api/instances/launch-options — PA-342 price-ID drift", () => {
  it("entitles a monthly product when the sub's price drifted but the product ID still matches", async () => {
    // The active subscription carries the OLD price ID (pre-rotation), but its
    // price still belongs to the same product. account/verify matches this via
    // product ID and shows "Deploy GPU" — so launch-options must agree.
    mockSubscriptionsList.mockResolvedValue({
      data: [
        {
          id: "sub_jason",
          items: {
            data: [
              {
                price: {
                  id: "price_OLD_before_rotation",
                  product: PRODUCT_ID,
                },
              },
            ],
          },
        },
      ],
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    const ids = (body.products as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(RTX6000_MONTHLY.id);
  });

  it("entitles via a sub on an unstamped same-email customer (allCustomerIds fallback)", async () => {
    // An unstamped monthly customer (no billing_type metadata) never reaches
    // monthlyCustomerIds, but its active sub must still entitle — otherwise
    // the sub card offers a deploy the modal rejects with "No GPUs Available".
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      monthlyCustomerIds: [],
      allCustomerIds: ["cus_op", "cus_orphan_monthly"],
    });
    mockSubscriptionsList.mockImplementation(async ({ customer }: { customer: string }) => ({
      data:
        customer === "cus_orphan_monthly"
          ? [
              {
                id: "sub_orphan",
                items: {
                  data: [{ price: { id: PRICE_CURRENT, product: PRODUCT_ID } }],
                },
              },
            ]
          : [],
    }));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.products as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(RTX6000_MONTHLY.id);
  });

  it("still entitles a monthly product the normal way (price ID matches)", async () => {
    // Regression guard: the happy path must keep working after the fix.
    mockSubscriptionsList.mockResolvedValue({
      data: [
        {
          id: "sub_jason",
          items: {
            data: [{ price: { id: PRICE_CURRENT, product: PRODUCT_ID } }],
          },
        },
      ],
    });

    const res = await GET(makeRequest());
    const body = await res.json();
    const ids = (body.products as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(RTX6000_MONTHLY.id);
  });
});

type WhereClause = { OR?: WhereClause[] } & Record<string, unknown>;

// Evaluates the route's own `where` against a fixture row, so these tests
// exercise the emitted filter rather than asserting on its literal shape.
function matchesWhere(row: Record<string, unknown>, where: WhereClause): boolean {
  if (Array.isArray(where.OR)) return where.OR.some((c) => matchesWhere(row, c));
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

const WITHDRAWN_MONTHLY = { ...RTX6000_MONTHLY, active: false };

const WITHDRAWN_HOURLY = {
  ...RTX6000_MONTHLY,
  id: "gpuprod_rtx6000_hourly",
  name: "RTX6000 Hourly",
  billingType: "hourly",
  pricePerHourCents: 250,
  pricePerMonthCents: null,
  stripePriceId: "price_hourly_withdrawn",
  stripeProductId: "prod_hourly_withdrawn",
  active: false,
};

async function productIdsFor(catalogue: Array<Record<string, unknown>>) {
  mockGpuProductFindMany.mockImplementation(async ({ where }: { where: WhereClause }) =>
    catalogue.filter((p) => matchesWhere(p, where))
  );
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.products as Array<{ id: string }>).map((p) => p.id);
}

function activeSubOn(priceId: string, productId: string) {
  mockSubscriptionsList.mockResolvedValue({
    data: [{ id: "sub_x", items: { data: [{ price: { id: priceId, product: productId } }] } }],
  });
}

describe("GET /api/instances/launch-options — a withdrawn monthly product stays deployable", () => {
  it("offers an inactive monthly product to a customer holding a matching subscription", async () => {
    activeSubOn(PRICE_CURRENT, PRODUCT_ID);
    expect(await productIdsFor([WITHDRAWN_MONTHLY])).toContain(WITHDRAWN_MONTHLY.id);
  });

  it("does not offer that same inactive monthly product without a subscription", async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    expect(await productIdsFor([WITHDRAWN_MONTHLY])).toEqual([]);
  });

  it("never offers an inactive hourly product, wallet or not", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...CTX,
      hourlyCustomerId: "cus_op",
      customer: { ...CTX.customer, metadata: { hostedai_team_id: "team_1", billing_type: "hourly" } },
    });
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    expect(await productIdsFor([WITHDRAWN_HOURLY])).toEqual([]);
  });

});

const H100_HOURLY = {
  ...RTX6000_MONTHLY,
  id: "gpuprod_h100_hourly",
  name: "H100 Hourly",
  billingType: "hourly",
  pricePerHourCents: 350,
  pricePerMonthCents: null,
  stripePriceId: "price_h100_hourly",
  stripeProductId: "prod_h100_hourly",
};

// A session pinned to a monthly billing artefact: the operating account is
// stamped monthly and holds no wallet, while the email's hourly account does.
const MONTHLY_ARTEFACT_CTX = {
  ...CTX,
  accountId: "cus_monthly_artefact",
  customer: {
    id: "cus_monthly_artefact",
    email: "jason@example.com",
    metadata: { hostedai_team_id: "team_1", billing_type: "monthly" },
  },
  teamId: "team_1",
  allTeamIds: ["team_1"],
  allCustomerIds: ["cus_monthly_artefact", "cus_hourly"],
  monthlyCustomerIds: ["cus_monthly_artefact"],
  hourlyCustomerId: "cus_hourly",
};

describe("GET /api/instances/launch-options — hourly entitlement spans the context", () => {
  beforeEach(() => {
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockGpuProductFindMany.mockResolvedValue([H100_HOURLY]);
    mockGetWalletBalance.mockImplementation(async (id: string) => ({
      availableBalance: id === "cus_hourly" ? 5000 : 0,
    }));
  });

  it("offers hourly products when the hourly wallet lives on another account of the email", async () => {
    mockResolveOperatingContext.mockResolvedValue(MONTHLY_ARTEFACT_CTX);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.products as Array<{ id: string }>).map((p) => p.id)).toContain(H100_HOURLY.id);
  });

  it("quotes the hourly account's wallet, not the monthly artefact's empty one", async () => {
    mockResolveOperatingContext.mockResolvedValue(MONTHLY_ARTEFACT_CTX);

    const body = await (await GET(makeRequest())).json();
    expect(mockGetWalletBalance).toHaveBeenCalledWith("cus_hourly");
    expect(body.walletBalanceCents).toBe(5000);
  });

  it("offers no hourly product when the email has no hourly wallet at all", async () => {
    mockResolveOperatingContext.mockResolvedValue({ ...MONTHLY_ARTEFACT_CTX, hourlyCustomerId: null });

    const body = await (await GET(makeRequest())).json();
    expect(body.products).toEqual([]);
  });

  it("falls back to the context's team when the operating account carries none", async () => {
    mockResolveOperatingContext.mockResolvedValue({
      ...MONTHLY_ARTEFACT_CTX,
      customer: {
        ...MONTHLY_ARTEFACT_CTX.customer,
        metadata: { billing_type: "monthly", primary_stripe_customer_id: "cus_hourly" },
      },
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).teamId).toBe("team_1");
  });
});
