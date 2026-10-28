// Tests for src/app/api/admin/two-factor/route.ts.
//
// GET reports the admin's 2FA status; POST drives the lifecycle via an
// `action` field: setup / confirm / disable / regenerate-backup-codes / verify.
// What this suite protects:
//   * Admin gating on GET and POST.
//   * GET returns the enabled / hasBackupCodes shape and 500s on a thrown lib.
//   * confirm/disable/regenerate/verify all require a `code` (400 otherwise).
//   * confirm 400s on a failed setup; disable/regenerate 400 on a bad TOTP code
//     and only mutate after a successful verify.
//   * verify returns the usedBackupCode flag; an unknown action is a 400.
//
// Mocked at the @/lib/two-factor boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifySessionToken,
  mockGetTwoFactorStatus,
  mockStartTwoFactorSetup,
  mockCompleteTwoFactorSetup,
  mockDisableTwoFactor,
  mockRegenerateBackupCodes,
  mockVerifyTwoFactorCode,
} = vi.hoisted(() => ({
  mockVerifySessionToken: vi.fn(),
  mockGetTwoFactorStatus: vi.fn(),
  mockStartTwoFactorSetup: vi.fn(),
  mockCompleteTwoFactorSetup: vi.fn(),
  mockDisableTwoFactor: vi.fn(),
  mockRegenerateBackupCodes: vi.fn(),
  mockVerifyTwoFactorCode: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ verifySessionToken: mockVerifySessionToken }));
vi.mock("@/lib/two-factor", () => ({
  getTwoFactorStatus: mockGetTwoFactorStatus,
  startTwoFactorSetup: mockStartTwoFactorSetup,
  completeTwoFactorSetup: mockCompleteTwoFactorSetup,
  disableTwoFactor: mockDisableTwoFactor,
  regenerateBackupCodes: mockRegenerateBackupCodes,
  verifyTwoFactorCode: mockVerifyTwoFactorCode,
}));

import { GET, POST } from "@/app/api/admin/two-factor/route";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SESSION_TOKEN = "valid-admin-session";

function makeReq(
  method: string,
  { body, withSession = true }: { body?: unknown; withSession?: boolean } = {}
) {
  const headers = new Headers();
  if (withSession) headers.set("cookie", `admin_session=${ADMIN_SESSION_TOKEN}`);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers.set("content-type", "application/json");
  }
  return new NextRequest("http://localhost/api/admin/two-factor", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySessionToken.mockReturnValue({ email: ADMIN_EMAIL });
  mockGetTwoFactorStatus.mockResolvedValue({ enabled: false, hasBackupCodes: false });
  mockStartTwoFactorSetup.mockResolvedValue({
    qrCode: "data:image/png;base64,xxx",
    secret: "SECRET",
    backupCodes: ["aaaa-bbbb"],
  });
  mockCompleteTwoFactorSetup.mockResolvedValue({ success: true });
  mockDisableTwoFactor.mockResolvedValue(undefined);
  mockRegenerateBackupCodes.mockResolvedValue(["cccc-dddd"]);
  mockVerifyTwoFactorCode.mockResolvedValue({ success: true, usedBackupCode: false });
});

describe("auth gating", () => {
  it("GET returns 401 without a session cookie", async () => {
    const res = await GET(makeReq("GET", { withSession: false }));
    expect(res.status).toBe(401);
    expect(mockGetTwoFactorStatus).not.toHaveBeenCalled();
  });

  it("POST returns 401 when the session is invalid", async () => {
    mockVerifySessionToken.mockReturnValue(null);
    const res = await POST(makeReq("POST", { body: { action: "setup" } }));
    expect(res.status).toBe(401);
    expect(mockStartTwoFactorSetup).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/two-factor", () => {
  it("returns the enabled / hasBackupCodes shape for the session email", async () => {
    mockGetTwoFactorStatus.mockResolvedValue({ enabled: true, hasBackupCodes: true });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true, hasBackupCodes: true });
    expect(mockGetTwoFactorStatus).toHaveBeenCalledWith(ADMIN_EMAIL);
  });

  it("returns 500 when the status lookup throws", async () => {
    mockGetTwoFactorStatus.mockRejectedValue(new Error("db down"));
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to get 2FA status");
  });
});

describe("POST — setup", () => {
  it("returns the QR code, secret and backup codes", async () => {
    const res = await POST(makeReq("POST", { body: { action: "setup" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toBe("SECRET");
    expect(body.backupCodes).toEqual(["aaaa-bbbb"]);
    expect(mockStartTwoFactorSetup).toHaveBeenCalledWith(ADMIN_EMAIL);
  });
});

describe("POST — confirm", () => {
  it("requires a code", async () => {
    const res = await POST(makeReq("POST", { body: { action: "confirm" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Code is required");
    expect(mockCompleteTwoFactorSetup).not.toHaveBeenCalled();
  });

  it("enables 2FA on a valid code", async () => {
    const res = await POST(makeReq("POST", { body: { action: "confirm", code: "123456" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockCompleteTwoFactorSetup).toHaveBeenCalledWith(ADMIN_EMAIL, "123456");
  });

  it("400s with the lib error when setup completion fails", async () => {
    mockCompleteTwoFactorSetup.mockResolvedValue({ success: false, error: "Invalid code" });
    const res = await POST(makeReq("POST", { body: { action: "confirm", code: "000000" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid code");
  });
});

describe("POST — disable", () => {
  it("requires a code", async () => {
    const res = await POST(makeReq("POST", { body: { action: "disable" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Code is required to disable 2FA");
    expect(mockDisableTwoFactor).not.toHaveBeenCalled();
  });

  it("400s on a bad TOTP code and does NOT disable", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false });
    const res = await POST(makeReq("POST", { body: { action: "disable", code: "000000" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid code");
    expect(mockDisableTwoFactor).not.toHaveBeenCalled();
  });

  it("disables 2FA after a successful verify", async () => {
    const res = await POST(makeReq("POST", { body: { action: "disable", code: "123456" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDisableTwoFactor).toHaveBeenCalledWith(ADMIN_EMAIL);
  });
});

describe("POST — regenerate-backup-codes", () => {
  it("requires a code", async () => {
    const res = await POST(makeReq("POST", { body: { action: "regenerate-backup-codes" } }));
    expect(res.status).toBe(400);
    expect(mockRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it("400s on a bad TOTP code", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false });
    const res = await POST(
      makeReq("POST", { body: { action: "regenerate-backup-codes", code: "000000" } })
    );
    expect(res.status).toBe(400);
    expect(mockRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it("returns the new codes on success", async () => {
    const res = await POST(
      makeReq("POST", { body: { action: "regenerate-backup-codes", code: "123456" } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).backupCodes).toEqual(["cccc-dddd"]);
  });

  it("400s when 2FA is not enabled (regenerate returns null)", async () => {
    mockRegenerateBackupCodes.mockResolvedValue(null);
    const res = await POST(
      makeReq("POST", { body: { action: "regenerate-backup-codes", code: "123456" } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("2FA not enabled");
  });
});

describe("POST — verify", () => {
  it("requires a code", async () => {
    const res = await POST(makeReq("POST", { body: { action: "verify" } }));
    expect(res.status).toBe(400);
  });

  it("400s with the lib error on a failed verify", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false, error: "Expired code" });
    const res = await POST(makeReq("POST", { body: { action: "verify", code: "000000" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Expired code");
  });

  it("returns usedBackupCode on a successful verify", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: true, usedBackupCode: true });
    const res = await POST(makeReq("POST", { body: { action: "verify", code: "aaaa-bbbb" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.usedBackupCode).toBe(true);
  });
});

describe("POST — misc", () => {
  it("returns 400 for an unknown action", async () => {
    const res = await POST(makeReq("POST", { body: { action: "frobnicate" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
  });

  it("returns 500 when a lib call throws unexpectedly", async () => {
    mockStartTwoFactorSetup.mockRejectedValue(new Error("kaboom"));
    const res = await POST(makeReq("POST", { body: { action: "setup" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to process 2FA action");
  });
});
