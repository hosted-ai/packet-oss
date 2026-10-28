// Tests for src/app/api/admin/email-templates/test/route.ts — sends a test
// email to the admin's own address to verify SMTP configuration (PA-287).
//
// POST gates on the admin_session cookie, requires an email on the session
// (else 400), then calls sendEmailDirect to the admin's address. A
// "not configured" / "SMTP" failure is mapped to a 400 (actionable), any other
// failure to a 500. These tests pin: auth gating, the no-session-email 400,
// the happy send (correct recipient), the SMTP-not-configured → 400 mapping,
// and a generic send failure → 500.
//
// sendEmailDirect is mocked at the @/lib/email/client boundary;
// verifySessionToken is synchronous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionToken, mockSendEmailDirect } = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockSendEmailDirect: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/email/client", () => ({ sendEmailDirect: mockSendEmailDirect }));

import { POST } from "@/app/api/admin/email-templates/test/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makePost(withSession = true) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  return new NextRequest("http://localhost/api/admin/email-templates/test", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockSendEmailDirect.mockResolvedValue(undefined);
});

describe("POST /api/admin/email-templates/test — auth gating", () => {
  it("returns 401 when the admin_session cookie is absent", async () => {
    const res = await POST(makePost(false));
    expect(res.status).toBe(401);
    expect(mockSendEmailDirect).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token does not verify", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makePost());
    expect(res.status).toBe(401);
    expect(mockSendEmailDirect).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/email-templates/test — send", () => {
  it("returns 400 when the session has no email address", async () => {
    mockVerifySessionToken.mockReturnValue({ email: "" });
    const res = await POST(makePost());
    expect(res.status).toBe(400);
    expect(mockSendEmailDirect).not.toHaveBeenCalled();
  });

  it("sends the test email to the admin's own address", async () => {
    const res = await POST(makePost());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.recipient).toBe(ADMIN_EMAIL);
    expect(mockSendEmailDirect).toHaveBeenCalledWith(
      expect.objectContaining({ to: ADMIN_EMAIL, subject: expect.any(String) }),
    );
  });

  it("maps an SMTP-not-configured failure to a 400", async () => {
    mockSendEmailDirect.mockRejectedValue(new Error("SMTP not configured"));
    const res = await POST(makePost());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("Email not configured");
  });

  it("maps a generic send failure to a 500", async () => {
    mockSendEmailDirect.mockRejectedValue(new Error("connection reset"));
    const res = await POST(makePost());
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toContain("Email delivery failed");
  });
});
