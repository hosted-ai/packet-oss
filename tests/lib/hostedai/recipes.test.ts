// Deepening tests for src/lib/hostedai/recipes.ts — exercises the REAL recipe
// listing / service-creation / policy logic. The heavy TUS upload + tar.gz
// compression path (execSync/fs) is intentionally left to integration coverage;
// here we drive the parts whose external boundary is `hostedaiRequest` and the
// `./default-policies` dynamic import.
//
// Boundary mocks: ./client (hostedaiRequest), ./default-policies, and
// @/lib/gpuaas-admin/client. The module under test is imported for real.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  hostedaiRequest: vi.fn(),
  getDefaultPolicies: vi.fn(),
  getAdminCredentials: vi.fn(),
}));

vi.mock("@/lib/hostedai/client", () => ({ hostedaiRequest: h.hostedaiRequest }));
vi.mock("@/lib/hostedai/default-policies", () => ({ getDefaultPolicies: h.getDefaultPolicies }));
vi.mock("@/lib/gpuaas-admin/client", () => ({ getAdminCredentials: h.getAdminCredentials }));

import {
  listRecipes,
  findRecipeByName,
  createAppService,
  addServiceToDefaultPolicy,
  removeServiceFromDefaultPolicy,
  deleteAppService,
} from "@/lib/hostedai/recipes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listRecipes", () => {
  it("GETs /service/recipes and returns the array", async () => {
    const recipes = [{ id: 1, name: "comfyui", version: "latest", description: "", category: "gpuaas" }];
    h.hostedaiRequest.mockResolvedValue(recipes);
    const result = await listRecipes();
    expect(result).toEqual(recipes);
    expect(h.hostedaiRequest).toHaveBeenCalledWith("GET", "/service/recipes");
  });
});

describe("findRecipeByName", () => {
  it("returns the matching recipe id", async () => {
    h.hostedaiRequest.mockResolvedValue([
      { id: 5, name: "vllm" },
      { id: 9, name: "comfyui" },
    ]);
    expect(await findRecipeByName("comfyui")).toBe(9);
  });

  it("returns null when no recipe matches", async () => {
    h.hostedaiRequest.mockResolvedValue([{ id: 5, name: "vllm" }]);
    expect(await findRecipeByName("missing")).toBeNull();
  });

  it("returns null (and logs) when the listing call throws", async () => {
    h.hostedaiRequest.mockRejectedValue(new Error("HAI down"));
    expect(await findRecipeByName("comfyui")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("createAppService", () => {
  const opts = {
    slug: "comfyui",
    name: "ComfyUI",
    recipeId: 42,
    ports: [{ service_name: "ui", port: 8188, protocol: "http", service_type: "web" }],
    scenarioId: "scn-1",
    execTiming: "on_first_boot" as const,
  };

  it("creates the service with the packet-app-<slug> name and recipe-backed payload", async () => {
    // findServiceByName GET -> no existing service
    h.hostedaiRequest.mockResolvedValueOnce([]);
    // POST /service -> created
    h.hostedaiRequest.mockResolvedValueOnce({ id: "svc-new", name: "packet-app-comfyui" });

    const result = await createAppService(opts);
    expect(result).toEqual({ id: "svc-new", name: "packet-app-comfyui" });

    const postCall = h.hostedaiRequest.mock.calls.find((c) => c[0] === "POST" && c[1] === "/service");
    expect(postCall).toBeDefined();
    const payload = postCall![2] as Record<string, unknown>;
    expect(payload.name).toBe("packet-app-comfyui");
    expect(payload.recipe_id).toBe(42);
    expect(payload.service_type).toBe("pod_accelerator");
    expect(payload.recipe_exec_timing_type).toBe("on_first_boot");
    expect(payload.scenarios).toEqual(["scn-1"]);
    expect(payload.service_exposure).toEqual(opts.ports);
  });

  it("deletes an orphaned same-name service before recreating", async () => {
    // findServiceByName -> existing
    h.hostedaiRequest.mockResolvedValueOnce([{ id: "orphan-1", name: "packet-app-comfyui" }]);
    // DELETE orphan
    h.hostedaiRequest.mockResolvedValueOnce(undefined);
    // POST /service -> created
    h.hostedaiRequest.mockResolvedValueOnce({ id: "svc-2", name: "packet-app-comfyui" });

    await createAppService(opts);
    expect(h.hostedaiRequest).toHaveBeenCalledWith("DELETE", "/service/orphan-1");
  });

  it("throws a clear error when the orphaned service can't be deleted", async () => {
    h.hostedaiRequest.mockResolvedValueOnce([{ id: "orphan-2", name: "packet-app-comfyui" }]);
    h.hostedaiRequest.mockRejectedValueOnce(new Error("has active instances"));
    await expect(createAppService(opts)).rejects.toThrow(/already exists.*could not be removed/);
  });

  it("treats a findServiceByName failure as 'no orphan' and proceeds", async () => {
    // findServiceByName swallows its own error and returns null
    h.hostedaiRequest.mockRejectedValueOnce(new Error("lookup failed"));
    h.hostedaiRequest.mockResolvedValueOnce({ id: "svc-3", name: "packet-app-comfyui" });
    const result = await createAppService(opts);
    expect(result.id).toBe("svc-3");
  });

  it("matches the {items:[...]} envelope shape from findServiceByName", async () => {
    h.hostedaiRequest.mockResolvedValueOnce({ items: [{ id: "orphan-3", name: "packet-app-comfyui" }] });
    h.hostedaiRequest.mockResolvedValueOnce(undefined); // delete
    h.hostedaiRequest.mockResolvedValueOnce({ id: "svc-4", name: "packet-app-comfyui" });
    await createAppService(opts);
    expect(h.hostedaiRequest).toHaveBeenCalledWith("DELETE", "/service/orphan-3");
  });
});

describe("addServiceToDefaultPolicy", () => {
  it("posts the service id against the default service policy", async () => {
    h.getDefaultPolicies.mockResolvedValue({ service: "policy-svc-1" });
    h.hostedaiRequest.mockResolvedValue(undefined);
    await addServiceToDefaultPolicy("svc-9");
    expect(h.hostedaiRequest).toHaveBeenCalledWith("POST", "/policy/service/add-object", {
      policy_id: "policy-svc-1",
      object_id: "svc-9",
    });
  });
});

describe("removeServiceFromDefaultPolicy", () => {
  it("posts the remove-object call", async () => {
    h.getDefaultPolicies.mockResolvedValue({ service: "policy-svc-1" });
    h.hostedaiRequest.mockResolvedValue(undefined);
    await removeServiceFromDefaultPolicy("svc-9");
    expect(h.hostedaiRequest).toHaveBeenCalledWith("POST", "/policy/service/remove-object", {
      policy_id: "policy-svc-1",
      object_id: "svc-9",
    });
  });

  it("swallows removal errors (non-fatal during teardown)", async () => {
    h.getDefaultPolicies.mockResolvedValue({ service: "policy-svc-1" });
    h.hostedaiRequest.mockRejectedValue(new Error("not in policy"));
    await expect(removeServiceFromDefaultPolicy("svc-9")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("deleteAppService", () => {
  it("issues a DELETE for the service id", async () => {
    h.hostedaiRequest.mockResolvedValue(undefined);
    await deleteAppService("svc-del");
    expect(h.hostedaiRequest).toHaveBeenCalledWith("DELETE", "/service/svc-del");
  });
});
