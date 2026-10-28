// Tests for src/app/api/admin/email-templates/[slug]/route.ts — single
// template GET / PUT / DELETE (PA-287).
//
// All three handlers gate on the admin_session cookie, await the Next-16
// params Promise for the slug, look the template up, and 404 if absent. PUT
// patches only the supplied fields (serialising `variables`, stamping
// updatedBy) and DELETE removes the row; both log the mutation via
// logAdminActivity. These tests pin: auth gating on each method, GET found /
// 404, PUT update-existing + 404 + activity logging, DELETE existing + 404 +
// activity logging.
//
// Mocked at the @/lib boundary. params is passed as a Promise to match how the
// handler reads it (await context.params). logAdminActivity is awaited, so it
// must resolve. verifySessionToken is synchronous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockFindUnique, mockUpdate, mockDelete, mockLogAdminActivity } =
  vi.hoisted(() => ({
    mockVerifySessionToken: vi.fn(),
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockLogAdminActivity: vi.fn(),
  }));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailTemplate: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));
vi.mock("@/lib/admin-activity", () => ({ logAdminActivity: mockLogAdminActivity }));

import { GET, PUT, DELETE } from "@/app/api/admin/email-templates/[slug]/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";
const SLUG = "welcome";

const EXISTING = { id: "tmpl-1", slug: SLUG, name: "Welcome", subject: "Hi", htmlContent: "<p>hi</p>" };

function makeReq(method: string, { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest(`http://localhost/api/admin/email-templates/${SLUG}`, init);
}

// Next 16 hands the handler { params: Promise<{ slug }> }.
function ctx(slug = SLUG) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockFindUnique.mockResolvedValue(EXISTING);
  mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...EXISTING,
    ...data,
  }));
  mockDelete.mockResolvedValue(EXISTING);
  mockLogAdminActivity.mockResolvedValue(undefined);
});

describe("GET /api/admin/email-templates/[slug]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeReq("GET", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeReq("GET"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns the template for an existing slug", async () => {
    const res = await GET(makeReq("GET"), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.slug).toBe(SLUG);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { slug: SLUG } });
  });

  it("returns 404 when the template does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), ctx("ghost"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/email-templates/[slug]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await PUT(makeReq("PUT", { body: { name: "x" }, withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the template does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(makeReq("PUT", { body: { name: "x" } }), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("patches only supplied fields, serialises variables, and logs the activity", async () => {
    const res = await PUT(
      makeReq("PUT", { body: { subject: "New subject", variables: ["a"] } }),
      ctx(),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ slug: SLUG });
    expect(updateArg.data.subject).toBe("New subject");
    expect(updateArg.data.variables).toBe(JSON.stringify(["a"]));
    expect(updateArg.data.updatedBy).toBe(ADMIN_EMAIL);
    // name was not supplied → must not be in the patch.
    expect(updateArg.data).not.toHaveProperty("name");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "email_template_updated",
      expect.any(String),
      expect.objectContaining({ slug: SLUG }),
    );
  });
});

describe("DELETE /api/admin/email-templates/[slug]", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await DELETE(makeReq("DELETE", { withSession: false }), ctx());
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the template does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the template and logs the activity", async () => {
    const res = await DELETE(makeReq("DELETE"), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { slug: SLUG } });
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      "email_template_deleted",
      expect.any(String),
      expect.objectContaining({ slug: SLUG }),
    );
  });
});
