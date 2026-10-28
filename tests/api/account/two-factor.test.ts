// Tests for src/app/api/account/two-factor/route.ts (PA-287).
//
// 2FA self-service. GET reports status; POST is a verb-switch on `action`:
// setup, confirm, disable, regenerate-backup-codes, verify. The code-protected
// actions verify the current TOTP before mutating.
//
// Pinned contracts:
//   * Bearer auth on both verbs (missing/invalid -> 401)
//   * GET returns { enabled, hasBackupCodes }
//   * setup returns QR + secret + backup codes
//   * confirm/disable/regenerate/verify require `code` -> 400 when absent
//   * disable + regenerate verify the current code first (bad code -> 400, no mutation)
//   * verify issues a fresh 2FA-verified token
//   * unknown action -> 400
//   * unexpected throw -> 500

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockVerifyCustomerToken,
  mockGenerateTwoFactorVerifiedToken,
  mockGetTwoFactorStatus,
  mockStartTwoFactorSetup,
  mockCompleteTwoFactorSetup,
  mockDisableTwoFactor,
  mockRegenerateBackupCodes,
  mockVerifyTwoFactorCode,
} = vi.hoisted(() => ({
  mockVerifyCustomerToken: vi.fn(),
  mockGenerateTwoFactorVerifiedToken: vi.fn(),
  mockGetTwoFactorStatus: vi.fn(),
  mockStartTwoFactorSetup: vi.fn(),
  mockCompleteTwoFactorSetup: vi.fn(),
  mockDisableTwoFactor: vi.fn(),
  mockRegenerateBackupCodes: vi.fn(),
  mockVerifyTwoFactorCode: vi.fn(),
}));

vi.mock("@/lib/customer-auth", () => ({
  verifyCustomerToken: mockVerifyCustomerToken,
  generateTwoFactorVerifiedToken: mockGenerateTwoFactorVerifiedToken,
}));
vi.mock("@/lib/two-factor", () => ({
  getTwoFactorStatus: mockGetTwoFactorStatus,
  startTwoFactorSetup: mockStartTwoFactorSetup,
  completeTwoFactorSetup: mockCompleteTwoFactorSetup,
  disableTwoFactor: mockDisableTwoFactor,
  regenerateBackupCodes: mockRegenerateBackupCodes,
  verifyTwoFactorCode: mockVerifyTwoFactorCode,
}));

import { GET, POST } from "@/app/api/account/two-factor/route";

const PAYLOAD = { customerId: "cus_2fa", email: "f@example.com" };

function makeRequest(
  method: "GET" | "POST",
  { auth = "Bearer t", body }: { auth?: string | null; body?: unknown } = {},
) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest("http://localhost/api/account/two-factor", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCustomerToken.mockReturnValue(PAYLOAD);
  mockGetTwoFactorStatus.mockResolvedValue({ enabled: true, hasBackupCodes: true });
  mockStartTwoFactorSetup.mockResolvedValue({
    qrCode: "data:image/png;base64,abc",
    secret: "SECRET",
    backupCodes: ["c1", "c2"],
  });
  mockCompleteTwoFactorSetup.mockResolvedValue({ success: true });
  mockDisableTwoFactor.mockResolvedValue(undefined);
  mockRegenerateBackupCodes.mockResolvedValue(["n1", "n2"]);
  mockVerifyTwoFactorCode.mockResolvedValue({ success: true, usedBackupCode: false });
  mockGenerateTwoFactorVerifiedToken.mockReturnValue("verified_token");
});

describe("GET /api/account/two-factor", () => {
  it("returns 401 with no token", async () => {
    const res = await GET(makeRequest("GET", { auth: null }));
    expect(res.status).toBe(401);
    expect(mockGetTwoFactorStatus).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid token", async () => {
    mockVerifyCustomerToken.mockReturnValue(null);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("returns the 2FA status for the authenticated email", async () => {
    const res = await GET(makeRequest("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ enabled: true, hasBackupCodes: true });
    expect(mockGetTwoFactorStatus).toHaveBeenCalledWith("f@example.com");
  });

  it("returns 500 when the status lookup throws", async () => {
    mockGetTwoFactorStatus.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/account/two-factor", () => {
  it("returns 401 with no token", async () => {
    const res = await POST(makeRequest("POST", { auth: null, body: { action: "setup" } }));
    expect(res.status).toBe(401);
  });

  it("setup returns the QR code, secret and backup codes", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "setup" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.qrCode).toContain("data:image/png");
    expect(body.secret).toBe("SECRET");
    expect(body.backupCodes).toEqual(["c1", "c2"]);
    expect(mockStartTwoFactorSetup).toHaveBeenCalledWith("f@example.com");
  });

  it("confirm requires a code", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "confirm" } }));
    expect(res.status).toBe(400);
    expect(mockCompleteTwoFactorSetup).not.toHaveBeenCalled();
  });

  it("confirm completes setup with a valid code", async () => {
    const res = await POST(
      makeRequest("POST", { body: { action: "confirm", code: "123456" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCompleteTwoFactorSetup).toHaveBeenCalledWith("f@example.com", "123456");
  });

  it("confirm returns 400 with the lib error when the code is wrong", async () => {
    mockCompleteTwoFactorSetup.mockResolvedValue({ success: false, error: "Invalid code" });
    const res = await POST(
      makeRequest("POST", { body: { action: "confirm", code: "000000" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid code");
  });

  it("disable requires a code", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "disable" } }));
    expect(res.status).toBe(400);
    expect(mockDisableTwoFactor).not.toHaveBeenCalled();
  });

  it("disable verifies the current code before disabling (bad code -> 400, no mutation)", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false });
    const res = await POST(
      makeRequest("POST", { body: { action: "disable", code: "000000" } }),
    );
    expect(res.status).toBe(400);
    expect(mockDisableTwoFactor).not.toHaveBeenCalled();
  });

  it("disable succeeds with a valid code", async () => {
    const res = await POST(
      makeRequest("POST", { body: { action: "disable", code: "123456" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDisableTwoFactor).toHaveBeenCalledWith("f@example.com");
  });

  it("regenerate-backup-codes requires a code", async () => {
    const res = await POST(
      makeRequest("POST", { body: { action: "regenerate-backup-codes" } }),
    );
    expect(res.status).toBe(400);
    expect(mockRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it("regenerate-backup-codes verifies the current code first (bad code -> 400)", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false });
    const res = await POST(
      makeRequest("POST", { body: { action: "regenerate-backup-codes", code: "000000" } }),
    );
    expect(res.status).toBe(400);
    expect(mockRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it("regenerate-backup-codes returns fresh codes on success", async () => {
    const res = await POST(
      makeRequest("POST", { body: { action: "regenerate-backup-codes", code: "123456" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.backupCodes).toEqual(["n1", "n2"]);
  });

  it("regenerate-backup-codes returns 400 when 2FA is not enabled", async () => {
    mockRegenerateBackupCodes.mockResolvedValue(null);
    const res = await POST(
      makeRequest("POST", { body: { action: "regenerate-backup-codes", code: "123456" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain("2FA not enabled");
  });

  it("verify requires a code", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "verify" } }));
    expect(res.status).toBe(400);
  });

  it("verify returns 400 with the lib error on a bad code", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: false, error: "Invalid code" });
    const res = await POST(
      makeRequest("POST", { body: { action: "verify", code: "000000" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid code");
  });

  it("verify issues a fresh 2FA-verified token on success", async () => {
    mockVerifyTwoFactorCode.mockResolvedValue({ success: true, usedBackupCode: true });
    const res = await POST(
      makeRequest("POST", { body: { action: "verify", code: "123456" } }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.usedBackupCode).toBe(true);
    expect(body.token).toBe("verified_token");
    expect(mockGenerateTwoFactorVerifiedToken).toHaveBeenCalledWith("t");
  });

  it("rejects an unknown action with 400", async () => {
    const res = await POST(makeRequest("POST", { body: { action: "frobnicate" } }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid action");
  });

  it("returns 500 when an action throws", async () => {
    mockStartTwoFactorSetup.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest("POST", { body: { action: "setup" } }));
    expect(res.status).toBe(500);
  });
});
