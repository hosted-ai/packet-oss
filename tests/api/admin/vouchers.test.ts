// Tests for src/app/api/admin/vouchers/route.ts — the admin voucher CRUD endpoint.
//
// What this suite protects:
//   * Every method is admin-gated (401 with no cookie / invalid session).
//   * GET branches: ?id= returns a single voucher (404 when absent) vs the
//     list+stats shape.
//   * POST/PATCH run their zod schemas and surface firstZodError as a 400
//     WITHOUT calling the mutation fn.
//   * safeErrorMessage never leaks raw Prisma text — P2002 → friendly dup
//     message, generic P-codes → fallback, plain Errors pass through.
//
// Mocked at the lib module boundary (same pattern as customers-search.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetAllVouchers,
  mockGetVoucherWithRedemptions,
  mockGetVoucherStats,
  mockCreateVoucher,
  mockUpdateVoucher,
  mockDeleteVoucher,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetAllVouchers: vi.fn(),
  mockGetVoucherWithRedemptions: vi.fn(),
  mockGetVoucherStats: vi.fn(),
  mockCreateVoucher: vi.fn(),
  mockUpdateVoucher: vi.fn(),
  mockDeleteVoucher: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/voucher", () => ({
  getAllVouchers: mockGetAllVouchers,
  getVoucherWithRedemptions: mockGetVoucherWithRedemptions,
  getVoucherStats: mockGetVoucherStats,
  createVoucher: mockCreateVoucher,
  updateVoucher: mockUpdateVoucher,
  deleteVoucher: mockDeleteVoucher,
}));

import { GET, POST, PATCH, DELETE } from "@/app/api/admin/vouchers/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { query = "", body, withSession = true }: { query?: string; body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/vouchers${query}`, init);
}

const VALID_CREATE = {
  code: "WELCOME10",
  name: "Welcome credit",
  creditCents: 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockGetAllVouchers.mockResolvedValue([]);
  mockGetVoucherStats.mockResolvedValue({ total: 0 });
  mockGetVoucherWithRedemptions.mockResolvedValue({ id: "v1", code: "WELCOME10", redemptions: [] });
  mockCreateVoucher.mockResolvedValue({ id: "v1", code: "WELCOME10" });
  mockUpdateVoucher.mockResolvedValue({ id: "v1", code: "WELCOME10" });
  mockDeleteVoucher.mockResolvedValue(undefined);
});

describe("auth gating (all methods)", () => {
  it("GET returns 401 without an admin_session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetAllVouchers).not.toHaveBeenCalled();
  });

  it("GET returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(401);
    expect(mockGetAllVouchers).not.toHaveBeenCalled();
  });

  it("POST returns 401 without a session", async () => {
    const res = await POST(makeReq("POST", { body: VALID_CREATE, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockCreateVoucher).not.toHaveBeenCalled();
  });

  it("PATCH returns 401 when session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await PATCH(makeReq("PATCH", { body: { id: "v1", name: "x" } }));
    expect(res.status).toBe(401);
    expect(mockUpdateVoucher).not.toHaveBeenCalled();
  });

  it("DELETE returns 401 without a session", async () => {
    const res = await DELETE(makeReq("DELETE", { query: "?id=v1", withSession: false }));
    expect(res.status).toBe(401);
    expect(mockDeleteVoucher).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/vouchers", () => {
  it("returns the list and stats when no id is given", async () => {
    mockGetAllVouchers.mockResolvedValue([{ id: "v1" }]);
    mockGetVoucherStats.mockResolvedValue({ total: 1 });

    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vouchers).toEqual([{ id: "v1" }]);
    expect(body.stats).toEqual({ total: 1 });
    expect(mockGetVoucherWithRedemptions).not.toHaveBeenCalled();
  });

  it("returns a single voucher with redemptions when ?id= is given", async () => {
    const res = await GET(makeReq("GET", { query: "?id=v1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voucher).toMatchObject({ id: "v1" });
    expect(mockGetVoucherWithRedemptions).toHaveBeenCalledWith("v1");
    expect(mockGetAllVouchers).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested voucher does not exist", async () => {
    mockGetVoucherWithRedemptions.mockResolvedValue(null);
    const res = await GET(makeReq("GET", { query: "?id=missing" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Voucher not found");
  });

  it("returns 500 when the data layer throws", async () => {
    mockGetAllVouchers.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get voucher data");
  });
});

describe("POST /api/admin/vouchers", () => {
  it("creates a voucher and stamps the admin email as createdBy", async () => {
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockCreateVoucher).toHaveBeenCalledWith(
      expect.objectContaining({ code: "WELCOME10", createdBy: ADMIN_EMAIL })
    );
  });

  it("returns 400 with the first zod error and does not create when payload is invalid", async () => {
    const res = await POST(makeReq("POST", { body: { name: "no code", creditCents: 100 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(mockCreateVoucher).not.toHaveBeenCalled();
  });

  it("returns 400 when credit amount is not positive", async () => {
    const res = await POST(makeReq("POST", { body: { ...VALID_CREATE, creditCents: 0 } }));
    expect(res.status).toBe(400);
    expect(mockCreateVoucher).not.toHaveBeenCalled();
  });

  it("maps a P2002 unique-violation to a friendly message (no Prisma leak)", async () => {
    mockCreateVoucher.mockRejectedValue({ code: "P2002" });
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("A voucher with that code already exists");
  });

  it("maps an unknown P-code to the generic fallback (no Prisma leak)", async () => {
    mockCreateVoucher.mockRejectedValue({ code: "P9999", message: "raw prisma internals" });
    const res = await POST(makeReq("POST", { body: VALID_CREATE }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to create voucher");
    expect(body.error).not.toContain("raw prisma internals");
  });
});

describe("PATCH /api/admin/vouchers", () => {
  it("updates a voucher by id", async () => {
    const res = await PATCH(makeReq("PATCH", { body: { id: "v1", name: "Renamed" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockUpdateVoucher).toHaveBeenCalledWith("v1", expect.objectContaining({ name: "Renamed" }));
  });

  it("returns 400 when the id is missing", async () => {
    const res = await PATCH(makeReq("PATCH", { body: { name: "Renamed" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Voucher ID is required");
    expect(mockUpdateVoucher).not.toHaveBeenCalled();
  });

  it("returns 400 with a zod error when the update payload is invalid", async () => {
    const res = await PATCH(makeReq("PATCH", { body: { id: "v1", creditCents: -5 } }));
    expect(res.status).toBe(400);
    expect(mockUpdateVoucher).not.toHaveBeenCalled();
  });

  it("returns the P2000 too-long message (no Prisma leak)", async () => {
    mockUpdateVoucher.mockRejectedValue({ code: "P2000" });
    const res = await PATCH(makeReq("PATCH", { body: { id: "v1", name: "ok" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("One of the fields is too long for the database");
  });
});

describe("DELETE /api/admin/vouchers", () => {
  it("deletes a voucher by id", async () => {
    const res = await DELETE(makeReq("DELETE", { query: "?id=v1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDeleteVoucher).toHaveBeenCalledWith("v1");
  });

  it("returns 400 when no id query param is present", async () => {
    const res = await DELETE(makeReq("DELETE"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Voucher ID is required");
    expect(mockDeleteVoucher).not.toHaveBeenCalled();
  });

  it("returns 500 with the generic fallback when delete throws an unknown P-code", async () => {
    mockDeleteVoucher.mockRejectedValue({ code: "P2025" });
    const res = await DELETE(makeReq("DELETE", { query: "?id=v1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to delete voucher");
  });
});
