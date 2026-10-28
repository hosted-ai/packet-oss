// Tests for src/app/api/admin/email-templates/route.ts — list + create email
// templates (PA-287).
//
// GET lists templates ordered by slug. POST validates required fields
// (slug/name/subject/htmlContent), rejects a duplicate slug, persists the
// template (serialising `variables` to JSON, stamping updatedBy), and logs the
// mutation via logAdminActivity. Both gate on the admin_session cookie. These
// tests pin: auth gating on both methods, the list shape, create field
// validation (no prisma.create on a 400), duplicate-slug → 400, the happy
// create + admin-activity logging, and prisma-throws → 500.
//
// Mocked at the @/lib boundary. logAdminActivity is awaited by this route, so
// it must resolve. verifySessionToken is synchronous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindMany, mockFindUnique, mockCreate, mockLogAdminActivity } =
  vi.hoisted(() => ({
    mockVerifySessionToken: vi.fn(),
    mockFindMany: vi.fn(),
    mockFindUnique: vi.fn(),
    mockCreate: vi.fn(),
    mockLogAdminActivity: vi.fn(),
  }));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailTemplate: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));
vi.mock("@/lib/admin-activity", () => ({ logAdminActivity: mockLogAdminActivity }));

import { GET, POST } from "@/app/api/admin/email-templates/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

const VALID_BODY = {
  slug: "welcome",
  name: "Welcome",
  subject: "Welcome aboard",
  htmlContent: "<p>hi</p>",
};

function makeGet(withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/email-templates", { method: "GET", headers });
}

function makePost(body: unknown, withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/admin/email-templates", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindMany.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "tmpl-1",
    ...data,
  }));
  mockLogAdminActivity.mockResolvedValue(undefined);
});

describe("GET /api/admin/email-templates — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeGet(false));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/email-templates — list", () => {
  it("returns templates ordered by slug", async () => {
    mockFindMany.mockResolvedValue([{ id: "t1", slug: "a" }]);
    const res = await GET(makeGet());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { slug: "asc" } });
  });

  it("returns 500 when prisma throws", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/email-templates — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makePost(VALID_BODY, false));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makePost(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/email-templates — create", () => {
  it.each([
    ["slug", { ...VALID_BODY, slug: undefined }],
    ["name", { ...VALID_BODY, name: undefined }],
    ["subject", { ...VALID_BODY, subject: undefined }],
    ["htmlContent", { ...VALID_BODY, htmlContent: undefined }],
  ])("returns 400 (and writes nothing) when %s is missing", async (_field, body) => {
    const res = await POST(makePost(body));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).not.toHaveBeenCalled();
  });

  it("returns 400 on a duplicate slug (and writes nothing)", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing", slug: "welcome" });
    const res = await POST(makePost(VALID_BODY));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("already exists");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the template, serialises variables, and logs the activity", async () => {
    const res = await POST(makePost({ ...VALID_BODY, variables: ["name", "url"] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const createArg = mockCreate.mock.calls[0][0].data;
    expect(createArg.slug).toBe("welcome");
    expect(createArg.variables).toBe(JSON.stringify(["name", "url"]));
    expect(createArg.updatedBy).toBe(ADMIN_EMAIL);
    // The mutation must be recorded in the admin activity log.
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "email_template_created",
      expect.stringContaining("Welcome"),
      expect.objectContaining({ slug: "welcome" }),
    );
  });

  it("defaults variables to an empty-array JSON string when omitted", async () => {
    await POST(makePost(VALID_BODY));
    expect(mockCreate.mock.calls[0][0].data.variables).toBe("[]");
  });

  it("returns 500 when prisma.create throws", async () => {
    mockCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(makePost(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
