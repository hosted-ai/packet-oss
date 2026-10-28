// Tests for the GET handler in src/app/api/admin/login-log/route.ts.
//
// PA-287: admin observability coverage. This route is a thin wrapper over
// getLoginLog() from @/lib/auth/login-log — it parses + clamps page/limit,
// reads optional email/success filters, and forwards them. These tests pin:
// admin-cookie auth gating, query-param parsing/clamping, the success
// tri-state (true/false/undefined), pass-through of the result, and the
// 500 path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockGetLoginLog } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetLoginLog: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/auth/login-log", () => ({ getLoginLog: mockGetLoginLog }));

import { GET } from "@/app/api/admin/login-log/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeRequest(query = "", { withSession = true } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = `http://localhost/api/admin/login-log${query ? `?${query}` : ""}`;
  return new NextRequest(url, { method: "GET", headers });
}

const RESULT = { entries: [], total: 0, page: 1, totalPages: 0 };

function lastArgs() {
  return mockGetLoginLog.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockGetLoginLog.mockResolvedValue(RESULT);
});

describe("GET /api/admin/login-log — auth gating", () => {
  it("returns 401 without the admin_session cookie", async () => {
    const res = await GET(makeRequest("", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetLoginLog).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockGetLoginLog).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/login-log — param parsing", () => {
  it("defaults to page 1, limit 50, no filters", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(lastArgs()).toEqual({
      page: 1,
      limit: 50,
      email: undefined,
      success: undefined,
    });
  });

  it("parses page and limit", async () => {
    await GET(makeRequest("page=3&limit=25"));
    expect(lastArgs()).toMatchObject({ page: 3, limit: 25 });
  });

  it("clamps page up to a minimum of 1", async () => {
    await GET(makeRequest("page=0"));
    expect(lastArgs()).toMatchObject({ page: 1 });
  });

  it("clamps limit to a maximum of 200", async () => {
    await GET(makeRequest("limit=10000"));
    expect(lastArgs()).toMatchObject({ limit: 200 });
  });

  it("clamps limit up to a minimum of 1", async () => {
    await GET(makeRequest("limit=0"));
    expect(lastArgs()).toMatchObject({ limit: 1 });
  });

  it("forwards an email filter", async () => {
    await GET(makeRequest("email=admin%40example.com"));
    expect(lastArgs()).toMatchObject({ email: "admin@example.com" });
  });

  it("maps success=true to boolean true", async () => {
    await GET(makeRequest("success=true"));
    expect(lastArgs()).toMatchObject({ success: true });
  });

  it("maps success=false to boolean false", async () => {
    await GET(makeRequest("success=false"));
    expect(lastArgs()).toMatchObject({ success: false });
  });

  it("leaves success undefined when the param is absent", async () => {
    await GET(makeRequest("page=2"));
    expect(lastArgs().success).toBeUndefined();
  });
});

describe("GET /api/admin/login-log — result & error", () => {
  it("passes the getLoginLog result straight through", async () => {
    const payload = {
      entries: [{ id: "l1", email: "x@y.z", success: true }],
      total: 1,
      page: 1,
      totalPages: 1,
    };
    mockGetLoginLog.mockResolvedValue(payload);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it("returns 500 when getLoginLog throws", async () => {
    mockGetLoginLog.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to fetch login log");
  });
});
