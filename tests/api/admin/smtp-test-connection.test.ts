// Tests for src/app/api/admin/smtp/test-connection/route.ts (POST).
//
// PA-287 — admin SMTP connectivity test coverage. Admin-cookie gated. The
// handler reads host/port/user/password from the body, falls back to the stored
// SMTP_PASSWORD when the supplied password is a masked value ("...****"),
// derives secure/requireTLS via autoDetectTls(port), builds a nodemailer
// transport and calls transporter.verify(). Success → { ok:true, transport }.
// Validation failures and verify() rejections → { ok:false, error } with 400.
//
// Mocked at the nodemailer + @/lib boundary. verifySessionToken and
// autoDetectTls are synchronous; getSetting is async.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockCreateTransport,
  mockVerify,
  mockClose,
  mockAutoDetectTls,
  mockGetSetting,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockCreateTransport: vi.fn(),
  mockVerify: vi.fn(),
  mockClose: vi.fn(),
  mockAutoDetectTls: vi.fn(),
  mockGetSetting: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));
vi.mock("@/lib/email/client", () => ({ autoDetectTls: mockAutoDetectTls }));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));

import { POST } from "@/app/api/admin/smtp/test-connection/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/smtp/test-connection", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: "admin@example.com" });
  mockVerify.mockResolvedValue(true);
  mockClose.mockReturnValue(undefined);
  mockCreateTransport.mockReturnValue({ verify: mockVerify, close: mockClose });
  mockAutoDetectTls.mockReturnValue({ secure: false, requireTLS: true });
  mockGetSetting.mockResolvedValue("stored-password");
});

describe("POST /api/admin/smtp/test-connection — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makeReq({ body: { host: "smtp.example.com" }, withSession: false }));
    expect(res.status).toBe(401);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it("returns 401 when verifySessionToken returns null", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq({ body: { host: "smtp.example.com" } }));
    expect(res.status).toBe(401);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/smtp/test-connection — validation", () => {
  it("returns 400 when the host is missing", async () => {
    const res = await POST(makeReq({ body: { port: "587" } }));
    expect(res.status).toBe(400);
    expect((await res.json())).toEqual({ ok: false, error: "SMTP host is required." });
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range port", async () => {
    const res = await POST(makeReq({ body: { host: "smtp.example.com", port: "70000" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid port");
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric port", async () => {
    const res = await POST(makeReq({ body: { host: "smtp.example.com", port: "abc" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid port");
  });
});

describe("POST /api/admin/smtp/test-connection — verify success", () => {
  it("verifies and returns ok:true with transport smtp", async () => {
    const res = await POST(
      makeReq({ body: { host: "smtp.example.com", port: "465", user: "u", password: "pw" } })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, transport: "smtp" });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("defaults the port to 587 when not supplied", async () => {
    await POST(makeReq({ body: { host: "smtp.example.com" } }));
    expect(mockAutoDetectTls).toHaveBeenCalledWith(587);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587 })
    );
  });

  it("passes derived secure/requireTLS from autoDetectTls into the transport", async () => {
    mockAutoDetectTls.mockReturnValue({ secure: true, requireTLS: false });
    await POST(makeReq({ body: { host: "smtp.example.com", port: "465" } }));
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false })
    );
  });

  it("builds auth from the supplied user/password", async () => {
    await POST(
      makeReq({ body: { host: "smtp.example.com", user: "me@x.com", password: "secret" } })
    );
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "me@x.com", pass: "secret" } })
    );
    expect(mockGetSetting).not.toHaveBeenCalled();
  });

  it("omits auth entirely when no user is supplied", async () => {
    await POST(makeReq({ body: { host: "smtp.example.com" } }));
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined })
    );
  });
});

describe("POST /api/admin/smtp/test-connection — masked password fallback", () => {
  it("falls back to the stored SMTP_PASSWORD when the password is masked", async () => {
    await POST(
      makeReq({ body: { host: "smtp.example.com", user: "u", password: "secre****" } })
    );
    expect(mockGetSetting).toHaveBeenCalledWith("SMTP_PASSWORD");
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "u", pass: "stored-password" } })
    );
  });

  it("passes an empty string password when the stored value is also missing", async () => {
    mockGetSetting.mockResolvedValue(null);
    await POST(
      makeReq({ body: { host: "smtp.example.com", user: "u", password: "secre****" } })
    );
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "u", pass: "" } })
    );
  });
});

describe("POST /api/admin/smtp/test-connection — verify failure", () => {
  it("returns 400 with the error message when verify() rejects", async () => {
    mockVerify.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ body: { host: "smtp.example.com", port: "587" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("returns a generic message when verify() rejects with a non-Error", async () => {
    mockVerify.mockRejectedValue("nope");
    const res = await POST(makeReq({ body: { host: "smtp.example.com" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Connection test failed");
  });
});
