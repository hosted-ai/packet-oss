// Tests for src/app/api/admin/email-templates/defaults/route.ts — code-based
// fallback email content for the admin editor (PA-287).
//
// GET gates on the admin_session cookie. Without a `slug` query param it
// returns the list of registered default slugs; with one it returns that
// template's subject/html/text, or 404 if there's no default. These tests pin:
// auth gating, the slug-list shape, the per-slug default shape, and the
// unknown-slug → 404.
//
// getRegisteredDefaultSlugs / getTemplateDefault are mocked at the
// @/lib/email/template-defaults boundary (both synchronous, as is
// verifySessionToken).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockGetTemplateDefault, mockGetRegisteredDefaultSlugs } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetTemplateDefault: vi.fn(),
  mockGetRegisteredDefaultSlugs: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/email/template-defaults", () => ({
  getTemplateDefault: mockGetTemplateDefault,
  getRegisteredDefaultSlugs: mockGetRegisteredDefaultSlugs,
}));

import { GET } from "@/app/api/admin/email-templates/defaults/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeGet(slug?: string, withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const url = slug
    ? `http://localhost/api/admin/email-templates/defaults?slug=${encodeURIComponent(slug)}`
    : "http://localhost/api/admin/email-templates/defaults";
  return new NextRequest(url, { method: "GET", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockGetRegisteredDefaultSlugs.mockReturnValue(["welcome", "reset-password"]);
  mockGetTemplateDefault.mockReturnValue({
    subject: "Welcome",
    html: "<p>hi</p>",
    text: "hi",
  });
});

describe("GET /api/admin/email-templates/defaults — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await GET(makeGet(undefined, false));
    expect(res.status).toBe(401);
    expect(mockGetRegisteredDefaultSlugs).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/email-templates/defaults — content", () => {
  it("returns the list of registered slugs when no slug is supplied", async () => {
    const res = await GET(makeGet());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.slugs).toEqual(["welcome", "reset-password"]);
    expect(mockGetTemplateDefault).not.toHaveBeenCalled();
  });

  it("returns the default subject/html/text for a known slug", async () => {
    const res = await GET(makeGet("welcome"));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(mockGetTemplateDefault).toHaveBeenCalledWith("welcome");
    expect(data).toEqual({ slug: "welcome", subject: "Welcome", html: "<p>hi</p>", text: "hi" });
  });

  it("returns 404 for a slug with no registered default", async () => {
    mockGetTemplateDefault.mockReturnValue(null);
    const res = await GET(makeGet("nonexistent"));
    const data = await res.json();
    expect(res.status).toBe(404);
    expect(data.error).toContain("nonexistent");
  });
});
