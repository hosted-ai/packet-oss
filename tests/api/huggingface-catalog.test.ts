// Tests for src/app/api/huggingface/catalog/route.ts (GET).
//
// What this protects:
//   * Bearer-token gating (401 missing / 401 invalid token).
//   * resolveOperatingContext 404 + gatePermission denial pass-through.
//   * ?id= single-item lookup (200 + 404 not-found).
//   * type=popular returns models only; type=rtx enriches with real HF memory
//     and filters out > 96GB; ?search= path; 500 error mapping.
//
// Boundary mocks: customer-auth, auth/gate, auth/account-resolver,
// huggingface-catalog, gpu-specs, hostedai, hf-mem. The route is real.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  gatePermission: vi.fn(),
  resolveOperatingContext: vi.fn(),
  getCatalogItem: vi.fn(),
  searchCatalog: vi.fn(),
  getCatalogByType: vi.fn(),
  getAllCatalogItems: vi.fn(),
  getRtxOptimizedModels: vi.fn(),
  getAllPools: vi.fn(),
  getCompatibilityMessage: vi.fn(),
  getPoolVRAM: vi.fn(),
  getModelMemory: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({ verifyCustomerToken: m.verifyCustomerToken }));
vi.mock("@/lib/auth/gate", () => ({ gatePermission: m.gatePermission }));
vi.mock("@/lib/auth/account-resolver", () => ({ resolveOperatingContext: m.resolveOperatingContext }));
vi.mock("@/lib/huggingface-catalog", () => ({
  HF_CATALOG: {
    popular: [
      { id: "p/model-1", type: "model", vramGb: 10, name: "M1" },
      { id: "p/docker-1", type: "docker", vramGb: 0, name: "D1" },
    ],
  },
  getAllCatalogItems: m.getAllCatalogItems,
  getCatalogByType: m.getCatalogByType,
  getCatalogItem: m.getCatalogItem,
  searchCatalog: m.searchCatalog,
  getRtxOptimizedModels: m.getRtxOptimizedModels,
}));
vi.mock("@/lib/gpu-specs", () => ({
  getPoolVRAM: m.getPoolVRAM,
  getCompatibilityMessage: m.getCompatibilityMessage,
}));
vi.mock("@/lib/hostedai", () => ({ getAllPools: m.getAllPools }));
vi.mock("@/lib/hf-mem", () => ({ getModelMemory: m.getModelMemory }));

import { GET } from "@/app/api/huggingface/catalog/route";

function req(query = "", { auth = true }: { auth?: boolean } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", "Bearer good-token");
  return new NextRequest(`http://localhost/api/huggingface/catalog${query}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.verifyCustomerToken.mockReturnValue({ email: "u@e.com", customerId: "cus_1", activeAccountId: null });
  m.resolveOperatingContext.mockResolvedValue({ accountId: "cus_1", customer: { email: "u@e.com" } });
  m.gatePermission.mockResolvedValue(null); // not denied
});

describe("auth gating", () => {
  it("401 when no Authorization header", async () => {
    const res = await GET(req("", { auth: false }));
    expect(res.status).toBe(401);
  });

  it("401 when the token is invalid", async () => {
    m.verifyCustomerToken.mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid or expired token");
  });

  it("404 when the operating context cannot be resolved", async () => {
    m.resolveOperatingContext.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("returns the gate denial response when permission is denied", async () => {
    const denial = NextResponse_json({ error: "Forbidden" }, 403);
    m.gatePermission.mockResolvedValue(denial);
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("?id= single item", () => {
  it("returns the item when found", async () => {
    m.getCatalogItem.mockReturnValue({ id: "x/y", vramGb: 0, name: "XY" });
    const res = await GET(req("?id=x/y"));
    expect(res.status).toBe(200);
    expect((await res.json()).item.id).toBe("x/y");
  });

  it("404 when the item is not in the catalog", async () => {
    m.getCatalogItem.mockReturnValue(undefined);
    const res = await GET(req("?id=missing"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Catalog item not found");
  });

  it("adds compatibility info when checkCompatibility=true and vram>0", async () => {
    m.getCatalogItem.mockReturnValue({ id: "x/y", vramGb: 40, name: "XY" });
    m.getAllPools.mockResolvedValue([{ id: "p1", name: "H100" }]);
    m.getCompatibilityMessage.mockReturnValue({ status: "compatible", message: "ok", minGpusNeeded: 1 });
    const res = await GET(req("?id=x/y&checkCompatibility=true"));
    const body = await res.json();
    expect(body.item.compatibility.status).toBe("compatible");
  });
});

describe("type listing", () => {
  it("type=popular returns models only (filters out docker)", async () => {
    const res = await GET(req("?type=popular"));
    const body = await res.json();
    expect(body.type).toBe("popular");
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["p/model-1"]);
    expect(body.total).toBe(1);
  });

  it("type=model delegates to getCatalogByType", async () => {
    m.getCatalogByType.mockReturnValue([{ id: "m/a", type: "model", vramGb: 0 }]);
    const res = await GET(req("?type=model"));
    expect(m.getCatalogByType).toHaveBeenCalledWith("model");
    expect((await res.json()).items).toHaveLength(1);
  });

  it("type=rtx enriches with real HF memory and filters out models > 96GB", async () => {
    m.getRtxOptimizedModels.mockReturnValue([
      { id: "rtx/small", type: "model", vramGb: 50, name: "small" },
      { id: "rtx/huge", type: "model", vramGb: 50, name: "huge" },
    ]);
    // small -> real 40GB (kept); huge -> real 120GB (filtered out, > 96)
    m.getModelMemory.mockImplementation(async (id: string) =>
      id === "rtx/small" ? { estimatedVramGb: 40 } : { estimatedVramGb: 120 }
    );
    const res = await GET(req("?type=rtx"));
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("rtx/small");
    expect(ids).not.toContain("rtx/huge");
  });
});

describe("?search=", () => {
  it("returns search results", async () => {
    m.searchCatalog.mockReturnValue([{ id: "s/1", vramGb: 0 }]);
    const res = await GET(req("?search=llama"));
    expect(m.searchCatalog).toHaveBeenCalledWith("llama");
    expect((await res.json()).items).toHaveLength(1);
  });
});

describe("error mapping", () => {
  it("500 when the handler throws unexpectedly", async () => {
    m.getCatalogByType.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await GET(req("?type=model"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get catalog");
  });
});

// Helper to construct a NextResponse-like denial without importing next/server twice
import { NextResponse } from "next/server";
function NextResponse_json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}
