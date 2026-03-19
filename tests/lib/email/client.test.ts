import { describe, it, expect, vi, beforeEach } from "vitest";
import { autoDetectTls } from "@/lib/email/client";

// ── autoDetectTls tests ─────────────────────────────────────────────────────

describe("autoDetectTls", () => {
  it("returns secure:true for port 465 (implicit TLS)", () => {
    const result = autoDetectTls(465);
    expect(result).toEqual({ secure: true, requireTLS: false });
  });

  it("returns requireTLS:true for port 587 (STARTTLS)", () => {
    const result = autoDetectTls(587);
    expect(result).toEqual({ secure: false, requireTLS: true });
  });

  it("returns no TLS for port 25 (plain)", () => {
    const result = autoDetectTls(25);
    expect(result).toEqual({ secure: false, requireTLS: false });
  });

  it("defaults to STARTTLS for unknown ports", () => {
    const result = autoDetectTls(2525);
    expect(result).toEqual({ secure: false, requireTLS: true });
  });

  it("handles port 0 gracefully", () => {
    const result = autoDetectTls(0);
    expect(result).toEqual({ secure: false, requireTLS: true });
  });
});

// ── Transport resolution tests ──────────────────────────────────────────────
// These test the module-level behavior via mocked settings

// Mock dependencies
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/branding", () => ({
  getEmailFromName: () => "Test",
  getEmailFromAddress: () => "test@example.com",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
const mockVerify = vi.fn().mockResolvedValue(true);
const mockClose = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: mockVerify,
      close: mockClose,
    })),
  },
}));

describe("email transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the globalThis SMTP pool between tests
    const g = globalThis as unknown as { __smtpTransporter?: unknown; __smtpConfigHash?: string };
    delete g.__smtpTransporter;
    delete g.__smtpConfigHash;
  });

  describe("sendEmail with SMTP transport", () => {
    it("sends via SMTP when SMTP_HOST is configured", async () => {
      const { getSettings } = await import("@/lib/settings");
      const { getSetting } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user@example.com",
        SMTP_PASSWORD: "password",
      });
      vi.mocked(getSetting).mockImplementation(async (key: string) => {
        if (key === "ADMIN_BCC_EMAIL") return null;
        if (key === "EMAIL_FROM_NAME") return "Test";
        if (key === "EMAIL_FROM_ADDRESS") return "test@example.com";
        return null;
      });

      // Re-import to get fresh module state
      const { sendEmail } = await import("@/lib/email/client");
      await sendEmail({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        text: "Test",
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "recipient@example.com",
          subject: "Test",
          html: "<p>Test</p>",
          text: "Test",
        }),
      );
    });
  });

  describe("sendEmail with no transport", () => {
    it("throws when SMTP is not configured", async () => {
      const { getSettings, getSetting } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: null,
        SMTP_PORT: null,
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });
      vi.mocked(getSetting).mockResolvedValue(null);

      const { sendEmail } = await import("@/lib/email/client");
      await expect(
        sendEmail({ to: "a@b.com", subject: "x", html: "x", text: "x" }),
      ).rejects.toThrow("Email not configured");
    });
  });

  describe("verifySmtpConnection", () => {
    it("returns ok:true when SMTP is configured and verify passes", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASSWORD: "pass",
      });
      mockVerify.mockResolvedValue(true);

      const { verifySmtpConnection } = await import("@/lib/email/client");
      const result = await verifySmtpConnection();
      expect(result).toEqual({ ok: true });
    });

    it("returns ok:false with error when SMTP is not configured", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: null,
        SMTP_PORT: null,
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });

      const { verifySmtpConnection } = await import("@/lib/email/client");
      const result = await verifySmtpConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("returns ok:false with error when verify fails", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASSWORD: "wrong",
      });
      mockVerify.mockRejectedValue(new Error("Authentication failed"));

      const { verifySmtpConnection } = await import("@/lib/email/client");
      const result = await verifySmtpConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Authentication failed");
    });
  });

  describe("getActiveTransport", () => {
    it("returns 'smtp' when SMTP is configured", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });

      const { getActiveTransport } = await import("@/lib/email/client");
      expect(await getActiveTransport()).toBe("smtp");
    });

    it("returns 'none' when nothing is configured", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: null,
        SMTP_PORT: null,
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });

      const { getActiveTransport } = await import("@/lib/email/client");
      expect(await getActiveTransport()).toBe("none");
    });
  });

  describe("clearSmtpPool", () => {
    it("closes the transporter and clears globalThis", async () => {
      const { getSettings } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });

      // Force transport creation
      const { getActiveTransport, clearSmtpPool } = await import("@/lib/email/client");
      await getActiveTransport();

      const g = globalThis as unknown as { __smtpTransporter?: unknown };
      expect(g.__smtpTransporter).toBeDefined();

      clearSmtpPool();
      expect(g.__smtpTransporter).toBeUndefined();
    });
  });

  describe("invalid SMTP port", () => {
    it("throws on invalid port", async () => {
      const { getSettings, getSetting } = await import("@/lib/settings");
      vi.mocked(getSettings).mockResolvedValue({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "not-a-number",
        SMTP_USER: null,
        SMTP_PASSWORD: null,
      });
      vi.mocked(getSetting).mockResolvedValue(null);

      const { sendEmail } = await import("@/lib/email/client");
      await expect(
        sendEmail({ to: "a@b.com", subject: "x", html: "x", text: "x" }),
      ).rejects.toThrow("Invalid SMTP port");
    });
  });
});
