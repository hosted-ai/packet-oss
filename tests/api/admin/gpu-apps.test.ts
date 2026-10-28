// Tests for src/app/api/admin/gpu-apps/route.ts — admin GPU-app deploy
// configuration (PA-287 coverage campaign).
//
// GET lists apps (parsing the tags JSON, joining the linked product). POST
// dispatches on `action`: "update" (field-by-field patch, productId FK check,
// best-effort scenario re-assignment when serviceId changes), "setup"
// (recipe→service wizard), and "teardown" (delete service → unlink). All gate
// on the admin_session cookie. These tests pin: auth gating on both methods,
// the GET tags-parse shape, the update happy path + App/Product 404 + missing
// id, the setup 409-when-already-configured + happy wizard, teardown
// unlink-not-configured, and the unknown-action 400.
//
// Mocked at the @/lib boundary (customers-search.test.ts pattern). The route
// reaches HAI recipes / scenarios via dynamic import(); those are mocked so the
// wizard never touches the network. verifySessionToken is synchronous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockAppFindMany,
  mockAppFindUnique,
  mockAppUpdate,
  mockProductFindUnique,
  mockAssignAppService,
  mockUnassignAppService,
  mockGetAppsScenarioId,
  mockFindRecipeByName,
  mockUploadRecipe,
  mockCreateAppService,
  mockAddServiceToDefaultPolicy,
  mockRemoveServiceFromDefaultPolicy,
  mockDeleteAppService,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockAppFindMany: vi.fn(),
  mockAppFindUnique: vi.fn(),
  mockAppUpdate: vi.fn(),
  mockProductFindUnique: vi.fn(),
  mockAssignAppService: vi.fn(),
  mockUnassignAppService: vi.fn(),
  mockGetAppsScenarioId: vi.fn(),
  mockFindRecipeByName: vi.fn(),
  mockUploadRecipe: vi.fn(),
  mockCreateAppService: vi.fn(),
  mockAddServiceToDefaultPolicy: vi.fn(),
  mockRemoveServiceFromDefaultPolicy: vi.fn(),
  mockDeleteAppService: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    gpuApp: {
      findMany: mockAppFindMany,
      findUnique: mockAppFindUnique,
      update: mockAppUpdate,
    },
    gpuProduct: {
      findUnique: mockProductFindUnique,
    },
  },
}));
vi.mock("@/lib/scenarios", () => ({
  assignAppService: mockAssignAppService,
  unassignAppService: mockUnassignAppService,
  getAppsScenarioId: mockGetAppsScenarioId,
}));
vi.mock("@/lib/hostedai/recipes", () => ({
  findRecipeByName: mockFindRecipeByName,
  uploadRecipe: mockUploadRecipe,
  createAppService: mockCreateAppService,
  addServiceToDefaultPolicy: mockAddServiceToDefaultPolicy,
  removeServiceFromDefaultPolicy: mockRemoveServiceFromDefaultPolicy,
  deleteAppService: mockDeleteAppService,
}));

import { GET, POST } from "@/app/api/admin/gpu-apps/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeGet(withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/gpu-apps", {
    method: "GET",
    headers,
  });
}

function makePost(body: unknown, withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/admin/gpu-apps", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockAppFindMany.mockResolvedValue([]);
  mockAppFindUnique.mockResolvedValue(null);
  mockAppUpdate.mockResolvedValue({ id: "app-1", slug: "comfyui", tags: "[]" });
  mockProductFindUnique.mockResolvedValue({ id: "prod-1" });
  // Fire-and-forget scenario helpers must resolve, never return undefined.
  mockAssignAppService.mockResolvedValue(undefined);
  mockUnassignAppService.mockResolvedValue(undefined);
  mockGetAppsScenarioId.mockResolvedValue("apps-scenario-1");
  mockFindRecipeByName.mockResolvedValue(null);
  mockUploadRecipe.mockResolvedValue(42);
  mockCreateAppService.mockResolvedValue({ id: "svc-new", name: "ComfyUI" });
  mockAddServiceToDefaultPolicy.mockResolvedValue(undefined);
  mockRemoveServiceFromDefaultPolicy.mockResolvedValue(undefined);
  mockDeleteAppService.mockResolvedValue(undefined);
});

describe("GET /api/admin/gpu-apps — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeGet(false));
    expect(res.status).toBe(401);
    expect(mockAppFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(mockAppFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/gpu-apps — list shape", () => {
  it("parses the tags JSON on each app", async () => {
    mockAppFindMany.mockResolvedValue([
      { id: "app-1", slug: "comfyui", tags: '["image","ui"]', product: { id: "prod-1", name: "A100" } },
    ]);
    const res = await GET(makeGet());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.apps[0].tags).toEqual(["image", "ui"]);
    expect(data.apps[0].product.name).toBe("A100");
  });

  it("returns 500 when prisma throws", async () => {
    mockAppFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/gpu-apps — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makePost({ action: "update", id: "app-1" }, false));
    expect(res.status).toBe(401);
    expect(mockAppUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makePost({ action: "update", id: "app-1" }));
    expect(res.status).toBe(401);
    expect(mockAppUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/gpu-apps — update", () => {
  it("returns 400 when id is missing", async () => {
    const res = await POST(makePost({ action: "update" }));
    expect(res.status).toBe(400);
    expect(mockAppUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the app does not exist", async () => {
    mockAppFindUnique.mockResolvedValue(null);
    const res = await POST(makePost({ action: "update", id: "missing" }));
    expect(res.status).toBe(404);
    expect(mockAppUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when a supplied productId does not exist", async () => {
    mockAppFindUnique.mockResolvedValue({ id: "app-1", serviceId: null });
    mockProductFindUnique.mockResolvedValue(null);
    const res = await POST(makePost({ action: "update", id: "app-1", productId: "ghost" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("Product not found");
    expect(mockAppUpdate).not.toHaveBeenCalled();
  });

  it("updates only the explicitly-provided fields and parses tags in the response", async () => {
    mockAppFindUnique.mockResolvedValue({ id: "app-1", serviceId: null });
    mockAppUpdate.mockResolvedValue({
      id: "app-1",
      slug: "comfyui",
      deployable: true,
      tags: '["x"]',
      product: { id: "prod-1", name: "A100" },
    });

    const res = await POST(makePost({ action: "update", id: "app-1", deployable: true, name: "ComfyUI" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.app.tags).toEqual(["x"]);
    const updateArg = mockAppUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "app-1" });
    expect(updateArg.data).toMatchObject({ deployable: true, name: "ComfyUI" });
    // serviceId was not supplied, so it must not be in the patch.
    expect(updateArg.data).not.toHaveProperty("serviceId");
  });
});

describe("POST /api/admin/gpu-apps — setup wizard", () => {
  it("returns 404 when the app does not exist", async () => {
    mockAppFindUnique.mockResolvedValue(null);
    const res = await POST(makePost({ action: "setup", id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the app already has a service configured", async () => {
    mockAppFindUnique.mockResolvedValue({ id: "app-1", name: "ComfyUI", serviceId: "svc-existing" });
    const res = await POST(makePost({ action: "setup", id: "app-1" }));
    expect(res.status).toBe(409);
    expect(mockCreateAppService).not.toHaveBeenCalled();
  });

  it("uploads a recipe, creates the HAI service, and links the app", async () => {
    mockAppFindUnique.mockResolvedValue({
      id: "app-1",
      name: "ComfyUI",
      slug: "comfyui",
      serviceId: null,
      recipeSlug: null,
      defaultPort: 8188,
      webUiPort: null,
    });

    const res = await POST(makePost({ action: "setup", id: "app-1" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUploadRecipe).toHaveBeenCalledWith("comfyui");
    expect(mockCreateAppService).toHaveBeenCalledTimes(1);
    expect(mockAddServiceToDefaultPolicy).toHaveBeenCalledWith("svc-new");
    // The app is linked to the freshly-created service.
    expect(mockAppUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-1" },
        data: expect.objectContaining({ serviceId: "svc-new", deployable: true }),
      }),
    );
  });

  it("returns 500 when the wizard fails mid-flight", async () => {
    mockAppFindUnique.mockResolvedValue({
      id: "app-1",
      name: "ComfyUI",
      slug: "comfyui",
      serviceId: null,
      recipeSlug: null,
      defaultPort: 8188,
    });
    mockCreateAppService.mockRejectedValue(new Error("HAI unreachable"));
    const res = await POST(makePost({ action: "setup", id: "app-1" }));
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toBe("HAI unreachable");
  });
});

describe("POST /api/admin/gpu-apps — teardown", () => {
  it("returns 400 when the app has no configured service", async () => {
    mockAppFindUnique.mockResolvedValue({ id: "app-1", name: "ComfyUI", serviceId: null });
    const res = await POST(makePost({ action: "teardown", id: "app-1" }));
    expect(res.status).toBe(400);
    expect(mockDeleteAppService).not.toHaveBeenCalled();
  });

  it("deletes the HAI service and unlinks the app", async () => {
    mockAppFindUnique.mockResolvedValue({ id: "app-1", name: "ComfyUI", serviceId: "svc-1" });
    const res = await POST(makePost({ action: "teardown", id: "app-1" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockDeleteAppService).toHaveBeenCalledWith("svc-1");
    expect(mockAppUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serviceId: null, deployable: false }) }),
    );
  });
});

describe("POST /api/admin/gpu-apps — dispatch", () => {
  it("returns 400 for an unknown action", async () => {
    const res = await POST(makePost({ action: "frobnicate" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid action");
  });
});
