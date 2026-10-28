// Tests for src/app/api/admin/providers/gpu-types/route.ts (GET, POST, PUT, DELETE).
//
// PA-287 — admin allowed-GPU-types CRUD coverage. The catalogue of GPU types
// providers may submit nodes against, with default provider/customer rates and
// payout-model rules. matchPatterns is stored as a JSON string and parsed on
// the way out. Auth is the admin-cookie model (verifySessionToken). Every
// mutation also writes a providerAdminActivity audit row.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockFindMany,
  mockFindUnique,
  mockCreate,
  mockUpdate,
  mockDelete,
  mockActivityCreate,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockActivityCreate: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    allowedGpuType: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
    providerAdminActivity: { create: mockActivityCreate },
  },
}));

import { GET, POST, PUT, DELETE } from "@/app/api/admin/providers/gpu-types/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, query = "", withSession = true }: { body?: unknown; query?: string; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/providers/gpu-types${query}`, init);
}

const VALID_CREATE = {
  name: "NVIDIA H100",
  shortName: "H100",
  matchPatterns: ["H100", "h100-sxm"],
  defaultProviderRateCents: 200,
  defaultCustomerRateCents: 400,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindMany.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "gpu-1", matchPatterns: JSON.stringify(["H100"]) });
  mockUpdate.mockResolvedValue({ id: "gpu-1", matchPatterns: JSON.stringify(["H100"]) });
  mockDelete.mockResolvedValue({});
  mockActivityCreate.mockResolvedValue({});
});

describe("gpu-types — auth gating (all methods)", () => {
  it.each([
    ["GET", () => GET(makeReq("GET", { withSession: false }))],
    ["POST", () => POST(makeReq("POST", { body: VALID_CREATE, withSession: false }))],
    ["PUT", () => PUT(makeReq("PUT", { body: { id: "gpu-1" }, withSession: false }))],
    ["DELETE", () => DELETE(makeReq("DELETE", { query: "?id=gpu-1", withSession: false }))],
  ])("%s returns 401 without the admin_session cookie", async (_m, call) => {
    const res = await call();
    expect(res.status).toBe(401);
  });

  it.each([
    ["GET", () => GET(makeReq("GET"))],
    ["POST", () => POST(makeReq("POST", { body: VALID_CREATE }))],
    ["PUT", () => PUT(makeReq("PUT", { body: { id: "gpu-1" } }))],
    ["DELETE", () => DELETE(makeReq("DELETE", { query: "?id=gpu-1" }))],
  ])("%s returns 401 when verifySessionToken returns null", async (_m, call) => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await call();
    expect(res.status).toBe(401);
  });
});

describe("GET gpu-types", () => {
  it("returns an empty list without crashing", async () => {
    const body = await (await GET(makeReq("GET"))).json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { displayOrder: "asc" } });
  });

  it("parses each row's matchPatterns JSON string into an array", async () => {
    mockFindMany.mockResolvedValue([
      { id: "g1", name: "H100", matchPatterns: JSON.stringify(["H100", "h100"]) },
    ]);
    const body = await (await GET(makeReq("GET"))).json();
    expect(body.data[0].matchPatterns).toEqual(["H100", "h100"]);
  });

  it("maps a prisma failure to 500", async () => {
    mockFindMany.mockRejectedValue(new Error("db"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch GPU types");
  });
});

describe("POST gpu-types (create)", () => {
  it("400 when required fields are missing, and writes nothing", async () => {
    const res = await POST(makeReq("POST", { body: { name: "H100" } }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400 when matchPatterns is empty (min(1))", async () => {
    const res = await POST(makeReq("POST", { body: { ...VALID_CREATE, matchPatterns: [] } }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400 when a rate is not a positive integer", async () => {
    const res = await POST(
      makeReq("POST", { body: { ...VALID_CREATE, defaultProviderRateCents: -5 } })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400 when a GPU type with the same name already exists, without creating", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing", name: "NVIDIA H100" });
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("already exists");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a GPU type, serializing matchPatterns, applying defaults, and logging", async () => {
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.name).toBe("NVIDIA H100");
    expect(data.matchPatterns).toBe(JSON.stringify(["H100", "h100-sxm"]));
    // Schema defaults applied.
    expect(data.manufacturer).toBe("NVIDIA");
    expect(data.defaultTermsType).toBe("fixed");
    expect(data.payoutModelChoice).toBe("fixed_only");
    expect(data.acceptingSubmissions).toBe(true);
    expect(data.displayOrder).toBe(0);
    // Response echoes the parsed array, not the JSON string.
    expect(body.data.matchPatterns).toEqual(["H100", "h100-sxm"]);
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "create_gpu_type" }) })
    );
  });

  it("maps a prisma create failure to 500", async () => {
    mockCreate.mockRejectedValue(new Error("db"));
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to create GPU type");
  });
});

describe("PUT gpu-types (update)", () => {
  it("400 when no id is supplied, and writes nothing", async () => {
    const res = await PUT(makeReq("PUT", { body: { shortName: "X" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ID required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404 when the GPU type does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { body: { id: "missing", shortName: "X" } }));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates only the provided fields and serializes matchPatterns", async () => {
    mockFindUnique.mockResolvedValue({ id: "gpu-1", name: "H100" });
    mockUpdate.mockResolvedValue({
      id: "gpu-1",
      matchPatterns: JSON.stringify(["A100"]),
    });
    const res = await PUT(
      makeReq("PUT", { body: { id: "gpu-1", shortName: "A100", matchPatterns: ["A100"] } })
    );
    expect(res.status).toBe(200);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.shortName).toBe("A100");
    expect(data.matchPatterns).toBe(JSON.stringify(["A100"]));
    // Untouched fields are not in the update payload.
    expect(data.name).toBeUndefined();
    const body = await res.json();
    expect(body.data.matchPatterns).toEqual(["A100"]);
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "update_gpu_type" }) })
    );
  });

  it("maps a prisma update failure to 500", async () => {
    mockFindUnique.mockResolvedValue({ id: "gpu-1" });
    mockUpdate.mockRejectedValue(new Error("db"));
    const res = await PUT(makeReq("PUT", { body: { id: "gpu-1", shortName: "X" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update GPU type");
  });
});

describe("DELETE gpu-types", () => {
  it("400 when no id query param is supplied, and deletes nothing", async () => {
    const res = await DELETE(makeReq("DELETE"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ID required");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404 when the GPU type does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE", { query: "?id=missing" }));
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the GPU type and logs the activity", async () => {
    mockFindUnique.mockResolvedValue({ id: "gpu-1", name: "H100" });
    const res = await DELETE(makeReq("DELETE", { query: "?id=gpu-1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "gpu-1" } });
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "delete_gpu_type" }) })
    );
  });

  it("maps a prisma delete failure to 500", async () => {
    mockFindUnique.mockResolvedValue({ id: "gpu-1", name: "H100" });
    mockDelete.mockRejectedValue(new Error("db"));
    const res = await DELETE(makeReq("DELETE", { query: "?id=gpu-1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to delete GPU type");
  });
});
