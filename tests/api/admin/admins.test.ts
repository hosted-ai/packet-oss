// Tests for src/app/api/admin/admins/route.ts — the admin-list management
// endpoint (GET list, POST add/invite, DELETE remove, PATCH resend-invite,
// PUT reset-PIN/2FA).
//
// What this suite protects:
//   * Admin gating on every method.
//   * POST validates the email, rejects duplicates, and (in OSS mode with no
//     email configured) returns the manual setup URL; a failing invite email
//     must NOT fail the request (admin is still added).
//   * DELETE blocks self-removal and last-admin removal, and 404s an unknown.
//   * PATCH 404s a non-admin and reports email-send failure as 500.
//   * PUT is restricted to PIN_RESET_ALLOWED_EMAILS (403 otherwise) and routes
//     reset-2fa vs the default PIN reset to the right lib fn.
//
// PIN_RESET_ALLOWED_EMAILS is read at module load, so it is set BEFORE the
// route is imported. Mocked at the @/lib/* boundaries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ADMIN_EMAIL = "admin@example.com";
const PIN_RESETTER = "root@example.com";

// The route captures PIN_RESET_ALLOWED_EMAILS / NEXT_PUBLIC_APP_URL at
// module-eval time, and the route `import` below is hoisted above ordinary
// statements. vi.hoisted runs before the imports, so set the env there.
vi.hoisted(() => {
  process.env.PIN_RESET_ALLOWED_EMAILS = "root@example.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://dash.test";
});

const {
  mockVerifySessionToken,
  mockGetAdmins,
  mockAddAdmin,
  mockRemoveAdmin,
  mockIsAdmin,
  mockGenerateAdminToken,
  mockSendEmail,
  mockLogAdminAdded,
  mockLogAdminRemoved,
  mockLogAdminInviteResent,
  mockLogAdminActivity,
  mockResetAdminPin,
  mockLoadTemplate,
  mockCreateInviteToken,
  mockIsEmailConfigured,
  mockIsOSS,
  mockDisableTwoFactor,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetAdmins: vi.fn(),
  mockAddAdmin: vi.fn(),
  mockRemoveAdmin: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockGenerateAdminToken: vi.fn(),
  mockSendEmail: vi.fn(),
  mockLogAdminAdded: vi.fn(),
  mockLogAdminRemoved: vi.fn(),
  mockLogAdminInviteResent: vi.fn(),
  mockLogAdminActivity: vi.fn(),
  mockResetAdminPin: vi.fn(),
  mockLoadTemplate: vi.fn(),
  mockCreateInviteToken: vi.fn(),
  mockIsEmailConfigured: vi.fn(),
  mockIsOSS: vi.fn(),
  mockDisableTwoFactor: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  verifySessionToken: mockVerifySessionToken,
  getAdmins: mockGetAdmins,
  addAdmin: mockAddAdmin,
  removeAdmin: mockRemoveAdmin,
  isAdmin: mockIsAdmin,
  generateAdminToken: mockGenerateAdminToken,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/admin-activity", () => ({
  logAdminAdded: mockLogAdminAdded,
  logAdminRemoved: mockLogAdminRemoved,
  logAdminInviteResent: mockLogAdminInviteResent,
  logAdminActivity: mockLogAdminActivity,
}));
vi.mock("@/lib/admin-pin", () => ({ resetAdminPin: mockResetAdminPin }));
vi.mock("@/lib/branding", () => ({ getBrandName: () => "Packet" }));
vi.mock("@/lib/email/template-loader", () => ({ loadTemplate: mockLoadTemplate }));
vi.mock("@/lib/auth/invite-tokens", () => ({ createInviteToken: mockCreateInviteToken }));
vi.mock("@/lib/settings", () => ({ isEmailConfigured: mockIsEmailConfigured }));
vi.mock("@/lib/edition", () => ({ isOSS: mockIsOSS }));
vi.mock("@/lib/two-factor", () => ({ disableTwoFactor: mockDisableTwoFactor }));

import { GET, POST, DELETE, PATCH, PUT } from "@/app/api/admin/admins/route";

const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, withSession = true, sessionEmail }: { body?: unknown; withSession?: boolean; sessionEmail?: string } = {}
) {
  // Only override the session identity when the caller asks for a specific
  // email — otherwise leave whatever the test/beforeEach configured (so an
  // explicit `mockReturnValue(null)` for the invalid-session cases survives).
  if (sessionEmail !== undefined) {
    mockVerifySessionToken.mockReturnValue({ email: sessionEmail });
  }
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/admins", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockGetAdmins.mockReturnValue([{ email: ADMIN_EMAIL }, { email: "second@example.com" }]);
  mockAddAdmin.mockReturnValue(true);
  mockRemoveAdmin.mockReturnValue(true);
  mockIsAdmin.mockReturnValue(true);
  mockGenerateAdminToken.mockReturnValue("magic-token");
  mockSendEmail.mockResolvedValue(undefined);
  mockLogAdminAdded.mockResolvedValue(undefined);
  mockLogAdminRemoved.mockResolvedValue(undefined);
  mockLogAdminInviteResent.mockResolvedValue(undefined);
  mockLogAdminActivity.mockResolvedValue(undefined);
  mockResetAdminPin.mockResolvedValue({ success: true });
  mockDisableTwoFactor.mockResolvedValue(undefined);
  mockCreateInviteToken.mockReturnValue({ token: "invite-token" });
  mockIsEmailConfigured.mockResolvedValue(true);
  mockIsOSS.mockReturnValue(false);
  mockLoadTemplate.mockImplementation(
    async (_name: string, _vars: unknown, fallback: unknown) => fallback
  );
});

describe("auth gating (all methods)", () => {
  it("GET returns 401 without a session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
  });

  it("POST returns 401 when the session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq("POST", { body: { email: "x@y.com" } }));
    expect(res.status).toBe(401);
    expect(mockAddAdmin).not.toHaveBeenCalled();
  });

  it("DELETE returns 401 without a session cookie", async () => {
    const res = await DELETE(makeReq("DELETE", { body: { email: "x@y.com" }, withSession: false }));
    expect(res.status).toBe(401);
  });

  it("PATCH returns 401 when the session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await PATCH(makeReq("PATCH", { body: { email: "x@y.com" } }));
    expect(res.status).toBe(401);
  });

  it("PUT returns 401 without a session cookie", async () => {
    const res = await PUT(makeReq("PUT", { body: { email: "x@y.com" }, withSession: false }));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/admins", () => {
  it("returns the admin list with canResetPin=false for a normal admin", async () => {
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admins).toHaveLength(2);
    expect(body.canResetPin).toBe(false);
  });

  it("returns canResetPin=true for an allowed PIN-reset admin", async () => {
    const res = await GET(makeReq("GET", { sessionEmail: PIN_RESETTER }));
    const body = await res.json();
    expect(body.canResetPin).toBe(true);
  });
});

describe("POST — add admin", () => {
  it("returns 400 for an invalid email", async () => {
    const res = await POST(makeReq("POST", { body: { email: "not-an-email" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Valid email required");
    expect(mockAddAdmin).not.toHaveBeenCalled();
  });

  it("returns 400 when the admin already exists", async () => {
    mockAddAdmin.mockReturnValue(false);
    const res = await POST(makeReq("POST", { body: { email: "dup@example.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Admin already exists");
  });

  it("Pro flow: adds the admin, sends a magic-link invite, logs it", async () => {
    const res = await POST(makeReq("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockGenerateAdminToken).toHaveBeenCalledWith("new@example.com");
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com" }));
    expect(mockLogAdminAdded).toHaveBeenCalledWith(ADMIN_EMAIL, "new@example.com");
  });

  it("Pro flow: still succeeds (and logs) when the invite email fails", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(makeReq("POST", { body: { email: "new@example.com" } }));
    // Email failure must not fail the request.
    expect(res.status).toBe(200);
    expect(mockLogAdminAdded).toHaveBeenCalledWith(ADMIN_EMAIL, "new@example.com");
  });

  it("OSS flow with no email configured: returns the manual setup URL", async () => {
    mockIsOSS.mockReturnValue(true);
    mockIsEmailConfigured.mockResolvedValue(false);

    const res = await POST(makeReq("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("url");
    expect(body.setupUrl).toContain("invite=invite-token");
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogAdminAdded).toHaveBeenCalledWith(ADMIN_EMAIL, "new@example.com");
  });

  it("OSS flow with email configured: emails the setup link", async () => {
    mockIsOSS.mockReturnValue(true);
    mockIsEmailConfigured.mockResolvedValue(true);

    const res = await POST(makeReq("POST", { body: { email: "new@example.com" } }));
    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com" }));
    expect(mockGenerateAdminToken).not.toHaveBeenCalled();
  });
});

describe("DELETE — remove admin", () => {
  it("blocks removing yourself", async () => {
    const res = await DELETE(makeReq("DELETE", { body: { email: ADMIN_EMAIL } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cannot remove yourself");
    expect(mockRemoveAdmin).not.toHaveBeenCalled();
  });

  it("blocks removing the last admin", async () => {
    mockGetAdmins.mockReturnValue([{ email: "only@example.com" }]);
    const res = await DELETE(makeReq("DELETE", { body: { email: "someone@example.com" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cannot remove last admin");
    expect(mockRemoveAdmin).not.toHaveBeenCalled();
  });

  it("404s when the admin to remove is not found", async () => {
    mockRemoveAdmin.mockReturnValue(false);
    const res = await DELETE(makeReq("DELETE", { body: { email: "ghost@example.com" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Admin not found");
  });

  it("removes an admin and logs it", async () => {
    const res = await DELETE(makeReq("DELETE", { body: { email: "second@example.com" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockRemoveAdmin).toHaveBeenCalledWith("second@example.com");
    expect(mockLogAdminRemoved).toHaveBeenCalledWith(ADMIN_EMAIL, "second@example.com");
  });
});

describe("PATCH — resend invite", () => {
  it("returns 400 for an invalid email", async () => {
    const res = await PATCH(makeReq("PATCH", { body: { email: "bogus" } }));
    expect(res.status).toBe(400);
  });

  it("404s when the target is not actually an admin", async () => {
    mockIsAdmin.mockReturnValue(false);
    const res = await PATCH(makeReq("PATCH", { body: { email: "stranger@example.com" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Admin not found");
  });

  it("Pro flow: resends the magic-link invite and logs it", async () => {
    const res = await PATCH(makeReq("PATCH", { body: { email: "second@example.com" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("second@example.com");
    expect(mockLogAdminInviteResent).toHaveBeenCalledWith(ADMIN_EMAIL, "second@example.com");
  });

  it("Pro flow: returns 500 when the invite email fails", async () => {
    mockSendEmail.mockRejectedValue(new Error("smtp down"));
    const res = await PATCH(makeReq("PATCH", { body: { email: "second@example.com" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to send invite email");
  });

  it("OSS flow with no email configured: returns the setup URL", async () => {
    mockIsOSS.mockReturnValue(true);
    mockIsEmailConfigured.mockResolvedValue(false);
    const res = await PATCH(makeReq("PATCH", { body: { email: "second@example.com" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("url");
    expect(body.setupUrl).toContain("invite=invite-token");
  });
});

describe("PUT — reset PIN / 2FA", () => {
  it("403s an admin not on the PIN_RESET allow-list", async () => {
    const res = await PUT(makeReq("PUT", { body: { email: "second@example.com" } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not authorized to reset PINs");
    expect(mockResetAdminPin).not.toHaveBeenCalled();
  });

  it("400s an invalid target email", async () => {
    const res = await PUT(makeReq("PUT", { body: { email: "bogus" }, sessionEmail: PIN_RESETTER }));
    expect(res.status).toBe(400);
  });

  it("404s a non-admin target", async () => {
    mockIsAdmin.mockReturnValue(false);
    const res = await PUT(
      makeReq("PUT", { body: { email: "stranger@example.com" }, sessionEmail: PIN_RESETTER })
    );
    expect(res.status).toBe(404);
  });

  it("resets the PIN by default and logs it", async () => {
    const res = await PUT(
      makeReq("PUT", { body: { email: "second@example.com" }, sessionEmail: PIN_RESETTER })
    );
    expect(res.status).toBe(200);
    expect(mockResetAdminPin).toHaveBeenCalledWith("second@example.com");
    expect(mockDisableTwoFactor).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      PIN_RESETTER,
      "admin_pin_set",
      expect.any(String),
      expect.objectContaining({ targetEmail: "second@example.com" })
    );
  });

  it("resets 2FA when action=reset-2fa", async () => {
    const res = await PUT(
      makeReq("PUT", {
        body: { email: "second@example.com", action: "reset-2fa" },
        sessionEmail: PIN_RESETTER,
      })
    );
    expect(res.status).toBe(200);
    expect(mockDisableTwoFactor).toHaveBeenCalledWith("second@example.com");
    expect(mockResetAdminPin).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      PIN_RESETTER,
      "settings_updated",
      expect.any(String),
      expect.objectContaining({ targetEmail: "second@example.com" })
    );
  });
});
