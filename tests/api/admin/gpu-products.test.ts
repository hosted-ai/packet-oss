// Tests for src/app/api/admin/gpu-products/route.ts — admin GPU-product /
// category catalog CRUD (PA-287 coverage campaign).
//
// The handlers gate on the admin_session cookie (verifySessionToken), then
// dispatch a POST `action` over a switch (create/update/delete + category
// CRUD). The create path validates the linked HAI service (uniqueness +
// type + locked instance config) before writing, and the catch maps Prisma
// unique / FK-constraint messages to 400s. These tests pin: auth gating on
// both methods, the GET list/JSON-parse shape, create field+service
// validation (no prisma.create on a 400), the happy create, update vs 404,
// delete, and the constraint→400 mappings.
//
// Everything is mocked at the @/lib boundary (same pattern as
// tests/api/admin/customers-search.test.ts). verifySessionToken is
// synchronous; prisma / HAI calls are async. The route reaches HAI and
// scenarios via dynamic import() — those modules are mocked too so the
// create/update paths never touch the network.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockProductFindMany,
  mockProductFindFirst,
  mockProductFindUnique,
  mockProductCreate,
  mockProductUpdate,
  mockProductDelete,
  mockCategoryFindMany,
  mockCategoryFindUnique,
  mockCategoryCreate,
  mockCategoryUpdate,
  mockCategoryDelete,
  mockHostedaiRequest,
  mockUpdateHAIService,
  mockGetHAIService,
  mockClearCache,
  mockSyncServiceScenarios,
  mockAssignGpuService,
  mockCreateCategoryScenario,
  mockSubscriptionsList,
  mockPricesList,
  mockSubHistoryFindMany,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockProductFindMany: vi.fn(),
  mockProductFindFirst: vi.fn(),
  mockProductFindUnique: vi.fn(),
  mockProductCreate: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockProductDelete: vi.fn(),
  mockCategoryFindMany: vi.fn(),
  mockCategoryFindUnique: vi.fn(),
  mockCategoryCreate: vi.fn(),
  mockCategoryUpdate: vi.fn(),
  mockCategoryDelete: vi.fn(),
  mockHostedaiRequest: vi.fn(),
  mockUpdateHAIService: vi.fn(),
  mockGetHAIService: vi.fn(),
  mockClearCache: vi.fn(),
  mockSyncServiceScenarios: vi.fn(),
  mockAssignGpuService: vi.fn(),
  mockCreateCategoryScenario: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockPricesList: vi.fn(),
  mockSubHistoryFindMany: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuProduct: {
      findMany: mockProductFindMany,
      findFirst: mockProductFindFirst,
      findUnique: mockProductFindUnique,
      create: mockProductCreate,
      update: mockProductUpdate,
      delete: mockProductDelete,
    },
    subscriptionHistory: {
      findMany: mockSubHistoryFindMany,
    },
    gpuCategory: {
      findMany: mockCategoryFindMany,
      findUnique: mockCategoryFindUnique,
      create: mockCategoryCreate,
      update: mockCategoryUpdate,
      delete: mockCategoryDelete,
    },
  },
}));
vi.mock("@/lib/hostedai", () => ({
  hostedaiRequest: mockHostedaiRequest,
  updateHAIService: mockUpdateHAIService,
  getHAIService: mockGetHAIService,
}));
vi.mock("@/lib/hostedai/client", () => ({ clearCache: mockClearCache }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    subscriptions: { list: mockSubscriptionsList },
    prices: { list: mockPricesList },
  }),
}));
vi.mock("@/lib/scenarios", () => ({
  syncServiceScenarios: mockSyncServiceScenarios,
  assignGpuService: mockAssignGpuService,
  createCategoryScenario: mockCreateCategoryScenario,
}));

import { GET, POST } from "@/app/api/admin/gpu-products/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

/** A HAI service that passes validateServiceForProduct(). */
const VALID_SERVICE = {
  id: "svc-1",
  name: "GPU Service",
  service_type: "pod_accelerator",
  is_enabled: true,
  instance_config: {
    default_instance_type_id: "it-1",
    default_storage_block_id: "sb-1",
    default_image_hash_id: "img-1",
    instance_type_locked: true,
    storage_block_locked: true,
    image_locked: true,
  },
};

function makeGet(withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/gpu-products", {
    method: "GET",
    headers,
  });
}

function makePost(body: unknown, withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/admin/gpu-products", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockProductFindMany.mockResolvedValue([]);
  mockSubscriptionsList.mockResolvedValue({ data: [] });
  mockPricesList.mockResolvedValue({ data: [] });
  mockSubHistoryFindMany.mockResolvedValue([]);
  mockProductFindFirst.mockResolvedValue(null);
  mockProductFindUnique.mockResolvedValue(null);
  mockProductCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "prod-1",
    ...data,
    poolIds: data.poolIds ?? "[]",
  }));
  mockProductUpdate.mockResolvedValue({
    id: "prod-1",
    poolIds: "[]",
    categories: [],
  });
  mockProductDelete.mockResolvedValue({ id: "prod-1" });
  mockCategoryFindMany.mockResolvedValue([]);
  mockCategoryFindUnique.mockResolvedValue(null);
  mockCategoryCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "cat-1",
    ...data,
  }));
  mockCategoryUpdate.mockResolvedValue({ id: "cat-1" });
  mockCategoryDelete.mockResolvedValue({ id: "cat-1" });
  mockHostedaiRequest.mockResolvedValue(VALID_SERVICE);
  mockUpdateHAIService.mockResolvedValue(undefined);
  mockGetHAIService.mockResolvedValue({ scenarios: [] });
  mockClearCache.mockReturnValue(undefined);
  mockSyncServiceScenarios.mockResolvedValue(undefined);
  mockAssignGpuService.mockResolvedValue(undefined);
  mockCreateCategoryScenario.mockResolvedValue("scenario-1");
});

describe("GET /api/admin/gpu-products — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeGet(false));
    expect(res.status).toBe(401);
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/gpu-products — list shape", () => {
  it("parses poolIds JSON and flattens categories to categoryIds", async () => {
    mockProductFindMany.mockResolvedValue([
      {
        id: "prod-1",
        name: "A100",
        poolIds: "[1,2,3]",
        categories: [{ id: "cat-1", name: "Training" }, { id: "cat-2", name: "Inference" }],
      },
    ]);
    mockCategoryFindMany.mockResolvedValue([{ id: "cat-1", name: "Training" }]);

    const res = await GET(makeGet());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data[0].poolIds).toEqual([1, 2, 3]);
    expect(data.data[0].categoryIds).toEqual(["cat-1", "cat-2"]);
    expect(data.categories).toEqual([{ id: "cat-1", name: "Training" }]);
  });

  it("returns 500 when prisma throws", async () => {
    mockProductFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/gpu-products — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makePost({ action: "create", name: "x" }, false));
    expect(res.status).toBe(401);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makePost({ action: "create", name: "x" }));
    expect(res.status).toBe(401);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/gpu-products — create validation", () => {
  it("returns 400 (and writes nothing) when name is missing", async () => {
    const res = await POST(makePost({ action: "create", pricePerHourCents: 100, serviceId: "svc-1" }));
    expect(res.status).toBe(400);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("returns 400 (and writes nothing) when pricePerHourCents is missing", async () => {
    const res = await POST(makePost({ action: "create", name: "A100", serviceId: "svc-1" }));
    expect(res.status).toBe(400);
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the HAI serviceId is missing", async () => {
    const res = await POST(makePost({ action: "create", name: "A100", pricePerHourCents: 100 }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("HAI Service is required");
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("rejects a service already linked to another product (uniqueness)", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "other", name: "Other Product" });
    const res = await POST(makePost({ action: "create", name: "A100", pricePerHourCents: 100, serviceId: "svc-1" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("already linked");
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("rejects a service that is not pod_accelerator", async () => {
    mockHostedaiRequest.mockResolvedValue({ ...VALID_SERVICE, service_type: "compute" });
    const res = await POST(makePost({ action: "create", name: "A100", pricePerHourCents: 100, serviceId: "svc-1" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("pod_accelerator");
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("rejects a service with unlocked instance config", async () => {
    mockHostedaiRequest.mockResolvedValue({
      ...VALID_SERVICE,
      instance_config: { ...VALID_SERVICE.instance_config, instance_type_locked: false },
    });
    const res = await POST(makePost({ action: "create", name: "A100", pricePerHourCents: 100, serviceId: "svc-1" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("unlocked");
    expect(mockProductCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/gpu-products — create happy path", () => {
  it("creates the product with the correct prisma.create args", async () => {
    const res = await POST(
      makePost({
        action: "create",
        name: "A100",
        pricePerHourCents: 250,
        serviceId: "svc-1",
        poolIds: [1, 2],
        featured: true,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockProductCreate).toHaveBeenCalledTimes(1);
    const createArg = mockProductCreate.mock.calls[0][0].data;
    expect(createArg.name).toBe("A100");
    expect(createArg.pricePerHourCents).toBe(250);
    // poolIds are serialised to a JSON string before persisting.
    expect(createArg.poolIds).toBe(JSON.stringify([1, 2]));
    expect(createArg.featured).toBe(true);
    expect(createArg.createdBy).toBe(ADMIN_EMAIL);
    // The response re-parses poolIds back to an array.
    expect(data.data.poolIds).toEqual([1, 2]);
  });
});

describe("POST /api/admin/gpu-products — update", () => {
  it("returns 400 when id is missing", async () => {
    const res = await POST(makePost({ action: "update", name: "rename" }));
    expect(res.status).toBe(400);
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the product does not exist", async () => {
    mockProductFindUnique.mockResolvedValue(null);
    const res = await POST(makePost({ action: "update", id: "missing", name: "rename" }));
    expect(res.status).toBe(404);
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("updates an existing product and stamps updatedBy", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "prod-1",
      serviceId: null,
      poolIds: "[]",
      categories: [],
    });
    mockProductUpdate.mockResolvedValue({
      id: "prod-1",
      name: "Renamed",
      poolIds: "[]",
      categories: [],
    });

    const res = await POST(makePost({ action: "update", id: "prod-1", name: "Renamed" }));
    expect(res.status).toBe(200);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockProductUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "prod-1" });
    expect(updateArg.data.name).toBe("Renamed");
    expect(updateArg.data.updatedBy).toBe(ADMIN_EMAIL);
  });
});

describe("POST /api/admin/gpu-products — stripePriceId uniqueness (PA-350)", () => {
  it("rejects creating an active product whose stripePriceId is already active on another product", async () => {
    mockProductFindFirst
      .mockResolvedValueOnce(null) // service uniqueness check passes
      .mockResolvedValueOnce({ id: "other", name: "OK monthly" }); // price uniqueness check fails

    const res = await POST(
      makePost({
        action: "create",
        name: "NVIDIA A100 Monthly",
        pricePerHourCents: 100,
        pricePerMonthCents: 11000,
        billingType: "monthly",
        serviceId: "svc-1",
        stripePriceId: "price_shared",
        active: true,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("OK monthly");
    expect(mockProductCreate).not.toHaveBeenCalled();
  });

  it("rejects updating a product's stripePriceId to one already active on another product", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "prod-1",
      serviceId: null,
      stripePriceId: "price_old",
      active: true,
      poolIds: "[]",
      categories: [],
    });
    mockProductFindFirst.mockResolvedValueOnce({ id: "other", name: "OK monthly" });

    const res = await POST(makePost({ action: "update", id: "prod-1", stripePriceId: "price_shared" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("OK monthly");
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("rejects activating a product whose existing stripePriceId is already active elsewhere", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "prod-1",
      serviceId: null,
      stripePriceId: "price_shared",
      active: false,
      poolIds: "[]",
      categories: [],
    });
    mockProductFindFirst.mockResolvedValueOnce({ id: "other", name: "OK monthly" });

    const res = await POST(makePost({ action: "update", id: "prod-1", active: true }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("OK monthly");
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("does not re-check stripePriceId uniqueness when neither it nor active is changing", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "prod-1",
      serviceId: null,
      stripePriceId: "price_shared",
      active: true,
      poolIds: "[]",
      categories: [],
    });

    const res = await POST(makePost({ action: "update", id: "prod-1", displayOrder: 2 }));

    expect(res.status).toBe(200);
    expect(mockProductFindFirst).not.toHaveBeenCalled();
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/gpu-products — delete", () => {
  it("returns 400 when id is missing", async () => {
    const res = await POST(makePost({ action: "delete" }));
    expect(res.status).toBe(400);
    expect(mockProductDelete).not.toHaveBeenCalled();
  });

  it("deletes the product by id", async () => {
    const res = await POST(makePost({ action: "delete", id: "prod-1" }));
    expect(res.status).toBe(200);
    expect(mockProductDelete).toHaveBeenCalledWith({ where: { id: "prod-1" } });
  });
});

describe("POST /api/admin/gpu-products — category CRUD", () => {
  it("returns 400 when creating a category with no name", async () => {
    const res = await POST(makePost({ action: "create-category" }));
    expect(res.status).toBe(400);
    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it("returns 502 when the HAI scenario for a new category cannot be created", async () => {
    mockCreateCategoryScenario.mockResolvedValue(null);
    const res = await POST(makePost({ action: "create-category", name: "Training" }));
    expect(res.status).toBe(502);
    expect(mockCategoryCreate).not.toHaveBeenCalled();
  });

  it("creates a category with an auto-generated slug + scenario", async () => {
    const res = await POST(makePost({ action: "create-category", name: "Large Models" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const createArg = mockCategoryCreate.mock.calls[0][0].data;
    expect(createArg.slug).toBe("large-models");
    expect(createArg.scenarioId).toBe("scenario-1");
  });

  it("returns 404 when updating a non-existent category", async () => {
    mockCategoryFindUnique.mockResolvedValue(null);
    const res = await POST(makePost({ action: "update-category", id: "missing", name: "x" }));
    expect(res.status).toBe(404);
    expect(mockCategoryUpdate).not.toHaveBeenCalled();
  });

  it("lists categories with product counts", async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: "cat-1", name: "T", _count: { products: 2 } }]);
    const res = await POST(makePost({ action: "list-categories" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data[0]._count.products).toBe(2);
  });
});

describe("POST /api/admin/gpu-products — dispatch + error mapping", () => {
  it("returns 400 for an unknown action", async () => {
    const res = await POST(makePost({ action: "frobnicate" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid action");
  });

  it("maps a Prisma unique-constraint error to a 400", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "prod-1",
      serviceId: null,
      poolIds: "[]",
      categories: [],
    });
    mockProductUpdate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`name`)"));
    const res = await POST(makePost({ action: "update", id: "prod-1", name: "dup" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("already exists");
  });

  it("maps a foreign-key-constraint error to a 400 on category delete", async () => {
    mockCategoryDelete.mockRejectedValue(new Error("Foreign key constraint failed"));
    const res = await POST(makePost({ action: "delete-category", id: "cat-1" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("Cannot delete category");
  });
});

// The defect this guards: withdrawing a monthly product from sale silently stripped
// redeploy from every live subscriber — 44 of 53 on 2026-09-05, all still paying.
describe("POST /api/admin/gpu-products — deactivating a monthly product", () => {
  const MONTHLY = {
    id: "prod-1",
    name: "8 x B200",
    billingType: "monthly",
    active: true,
    stripePriceId: "price_b200",
    stripeProductId: "prod_b200",
    pricePerMonthCents: 29900,
    serviceId: null,
    poolIds: "[]",
    categories: [],
  };

  // Stripe is asked per price, so a mock that answers only a price-filtered call is the
  // shape of the real API; an unfiltered scan gets nothing here, as it did in production.
  const subsForPrice = (byPrice: Record<string, { id: string }[]>) =>
    async (params: { price?: string }) => ({ data: params.price ? byPrice[params.price] ?? [] : [] });

  it("refuses, naming the count, when live subscriptions depend on the row", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubscriptionsList.mockImplementation(
      subsForPrice({ price_b200: [{ id: "sub_1" }, { id: "sub_2" }] })
    );

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.liveSubscribers).toBe(2);
    expect(body.error).toContain("8 x B200");
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  // The shipped guard scanned the platform's subscriptions unfiltered and matched
  // client-side, which reads 0 past one page. Every Stripe call now carries a price.
  it("never asks Stripe for an unfiltered page of subscriptions", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubscriptionsList.mockImplementation(subsForPrice({ price_b200: [{ id: "sub_1" }] }));

    await POST(makePost({ action: "update", id: "prod-1", active: false }));

    expect(mockSubscriptionsList).toHaveBeenCalled();
    for (const [params] of mockSubscriptionsList.mock.calls) {
      expect(params.price).toBeTruthy();
    }
  });

  it("counts a subscription once across the statuses that keep it live", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubscriptionsList.mockImplementation(subsForPrice({ price_b200: [{ id: "sub_1" }] }));

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect((await res.json()).liveSubscribers).toBe(1);
  });

  it("counts a past-due subscriber, who is still entitled", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubscriptionsList.mockImplementation(async (params: { status?: string }) => ({
      data: params.status === "past_due" ? [{ id: "sub_late" }] : [],
    }));

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).liveSubscribers).toBe(1);
  });

  it("sees a grandfathered subscription whose price no longer matches the row", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockPricesList.mockResolvedValue({ data: [{ id: "price_old" }] });
    mockSubscriptionsList.mockImplementation(subsForPrice({ price_old: [{ id: "sub_old" }] }));

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).liveSubscribers).toBe(1);
  });

  // The platform's own record is what measured the real incident, and it answers even
  // when the row's Stripe ids no longer resolve to anything the subscribers hold.
  it("refuses on open subscription history alone, counting distinct customers", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubHistoryFindMany.mockResolvedValue([
      { stripeCustomerId: "cus_a" },
      { stripeCustomerId: "cus_a" },
      { stripeCustomerId: "cus_b" },
    ]);

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).liveSubscribers).toBe(2);
    expect(mockSubHistoryFindMany).toHaveBeenCalledWith({
      where: { priceCents: 29900, endedAt: null },
      select: { stripeCustomerId: true },
    });
  });

  it("withdraws it anyway on an explicit force", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubscriptionsList.mockImplementation(subsForPrice({ price_b200: [{ id: "sub_1" }] }));
    mockProductUpdate.mockResolvedValue({ id: "prod-1", poolIds: "[]", categories: [] });

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false, force: true }));
    expect(res.status).toBe(200);
    expect(mockProductUpdate.mock.calls[0][0].data.active).toBe(false);
  });

  it("lets a monthly row with no subscribers be withdrawn", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockProductUpdate.mockResolvedValue({ id: "prod-1", poolIds: "[]", categories: [] });

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(200);
  });

  it("leaves hourly products alone — their entitlement is the wallet, not a row", async () => {
    mockProductFindUnique.mockResolvedValue({ ...MONTHLY, billingType: "hourly" });
    mockProductUpdate.mockResolvedValue({ id: "prod-1", poolIds: "[]", categories: [] });

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(200);
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
  });

  it("does not re-check when the row is already inactive", async () => {
    mockProductFindUnique.mockResolvedValue({ ...MONTHLY, active: false });
    mockProductUpdate.mockResolvedValue({ id: "prod-1", poolIds: "[]", categories: [] });

    const res = await POST(makePost({ action: "update", id: "prod-1", active: false }));
    expect(res.status).toBe(200);
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
  });

  it("refuses to delete a monthly row its subscribers are still paying for", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    mockSubHistoryFindMany.mockResolvedValue([{ stripeCustomerId: "cus_a" }]);

    const res = await POST(makePost({ action: "delete", id: "prod-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).liveSubscribers).toBe(1);
    expect(mockProductDelete).not.toHaveBeenCalled();
  });

  it("deletes a monthly row with no subscribers, and any hourly row", async () => {
    mockProductFindUnique.mockResolvedValue(MONTHLY);
    expect((await POST(makePost({ action: "delete", id: "prod-1" }))).status).toBe(200);

    mockProductFindUnique.mockResolvedValue({ ...MONTHLY, billingType: "hourly" });
    mockSubHistoryFindMany.mockResolvedValue([{ stripeCustomerId: "cus_a" }]);
    expect((await POST(makePost({ action: "delete", id: "prod-1" }))).status).toBe(200);
  });
});
