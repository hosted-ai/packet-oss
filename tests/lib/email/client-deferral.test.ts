import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A quota or credential refusal must cost one provider hit and leave a queued
// message behind; a connection blip retries, a permanent rejection fails fast.

vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/branding", () => ({
  getEmailFromName: () => "Test",
  getEmailFromAddress: () => "test@example.com",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { emailLog: { create: vi.fn().mockResolvedValue({}) } },
}));

const mockDeferEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/deferred", () => ({
  deferEmail: (...args: unknown[]) => mockDeferEmail(...args),
}));

vi.mock("@/lib/email/send-failure-alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send-failure-alert")>()),
  noteSendSuccess: vi.fn(),
  noteSendFailure: vi.fn().mockResolvedValue(undefined),
}));

const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

function smtpError(message: string, responseCode?: number): Error {
  const err = new Error(message);
  if (responseCode !== undefined) {
    (err as Error & { responseCode: number }).responseCode = responseCode;
  }
  return err;
}

// nodemailer's shape for a credential refusal: a 5xx response plus code EAUTH.
function authError(message = "535 5.7.8 Error: authentication failed"): Error {
  const err = smtpError(message, 535);
  (err as Error & { code: string }).code = "EAUTH";
  return err;
}

const params = {
  to: "user@example.com",
  subject: "Sign in to Packet",
  html: "<p>link</p>",
  text: "link",
};

beforeEach(async () => {
  vi.clearAllMocks();
  const g = globalThis as unknown as { __smtpTransporter?: unknown; __smtpConfigHash?: string };
  delete g.__smtpTransporter;
  delete g.__smtpConfigHash;

  const { getSettings, getSetting } = await import("@/lib/settings");
  vi.mocked(getSettings).mockResolvedValue({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "user@example.com",
    SMTP_PASSWORD: "password",
  });
  vi.mocked(getSetting).mockImplementation(async (key: string) => {
    if (key === "EMAIL_FROM_NAME") return "Test";
    if (key === "EMAIL_FROM_ADDRESS") return "test@example.com";
    return null;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isDeferrableError", () => {
  it("classifies a daily-quota refusal as deferrable", async () => {
    const { isDeferrableError } = await import("@/lib/email/client");
    expect(isDeferrableError(smtpError("452 4.5.3 Daily message limit exceeded", 452))).toBe(true);
    expect(isDeferrableError(smtpError("454 4.7.0 Throttling failure: Maximum sending rate exceeded", 454))).toBe(true);
    expect(isDeferrableError(smtpError("421 4.7.0 Too many messages for this sender", 421))).toBe(true);
  });

  it("leaves connection-level failures to the retry path", async () => {
    const { isDeferrableError } = await import("@/lib/email/client");
    expect(isDeferrableError(smtpError("connect ECONNRESET 10.0.0.1:587"))).toBe(false);
    expect(isDeferrableError(smtpError("451 4.3.0 Temporary local problem", 451))).toBe(false);
  });

  it("does not defer a permanent rejection that mentions a limit", async () => {
    expect(
      (await import("@/lib/email/client")).isDeferrableError(
        smtpError("552 5.2.2 Mailbox quota exceeded", 552),
      ),
    ).toBe(false);
  });

  it("classifies a credential refusal as deferrable", async () => {
    const { isDeferrableError } = await import("@/lib/email/client");
    expect(isDeferrableError(authError())).toBe(true);
    expect(isDeferrableError(smtpError("535 5.7.8 Username and Password not accepted", 535))).toBe(true);
    expect(isDeferrableError(smtpError("530 5.7.0 Authentication required", 530))).toBe(true);
  });

  it("does not defer a permanent rejection of the message itself", async () => {
    const { isDeferrableError } = await import("@/lib/email/client");
    expect(isDeferrableError(smtpError("550 5.1.1 No such user here", 550))).toBe(false);
    expect(isDeferrableError(smtpError("553 5.1.3 Bad recipient address syntax", 553))).toBe(false);
    expect(isDeferrableError(smtpError("552 5.3.4 Message too large", 552))).toBe(false);
  });
});

describe("sendEmailDirect on a credential refusal", () => {
  it("hits the provider once, queues the message and logs it deferred", async () => {
    mockSendMail.mockRejectedValue(authError());
    const { sendEmailDirect } = await import("@/lib/email/client");
    const { prisma } = await import("@/lib/prisma");

    await expect(sendEmailDirect(params)).resolves.toBeUndefined();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockDeferEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com" }),
      "535 5.7.8 Error: authentication failed",
    );
    const statuses = vi.mocked(prisma.emailLog.create).mock.calls.map(
      ([arg]) => (arg as { data: { status: string } }).data.status,
    );
    expect(statuses).toContain("deferred");
    expect(statuses).not.toContain("failed");
  });
});

describe("sendEmailDirect on a permanent rejection", () => {
  it("fails fast without queueing the message", async () => {
    mockSendMail.mockRejectedValue(smtpError("550 5.1.1 No such user here", 550));
    const { sendEmailDirect } = await import("@/lib/email/client");

    await expect(sendEmailDirect(params)).rejects.toThrow("No such user here");
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockDeferEmail).not.toHaveBeenCalled();
  });
});

describe("sendEmailDirect on a quota refusal", () => {
  it("hits the provider once, queues the message and does not throw", async () => {
    mockSendMail.mockRejectedValue(smtpError("452 4.5.3 Daily message limit exceeded", 452));
    const { sendEmailDirect } = await import("@/lib/email/client");

    await expect(sendEmailDirect(params)).resolves.toBeUndefined();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockDeferEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com" }),
      "452 4.5.3 Daily message limit exceeded",
    );
  });
});

describe("sendEmailDirect on a connection blip", () => {
  it("still retries four times and then throws, with nothing queued", async () => {
    vi.useFakeTimers();
    mockSendMail.mockRejectedValue(smtpError("connect ECONNREFUSED 10.0.0.1:587"));
    const { sendEmailDirect } = await import("@/lib/email/client");

    const settled = sendEmailDirect(params).then(
      () => "resolved",
      (err: Error) => err.message,
    );
    await vi.runAllTimersAsync();

    await expect(settled).resolves.toContain("ECONNREFUSED");
    expect(mockSendMail).toHaveBeenCalledTimes(4);
    expect(mockDeferEmail).not.toHaveBeenCalled();
  });
});

describe("resendDeferredEmail", () => {
  it("throws on a quota refusal instead of queueing the message again", async () => {
    mockSendMail.mockRejectedValue(smtpError("452 4.5.3 Daily message limit exceeded", 452));
    const { resendDeferredEmail } = await import("@/lib/email/client");

    await expect(resendDeferredEmail(params)).rejects.toThrow("Daily message limit exceeded");
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockDeferEmail).not.toHaveBeenCalled();
  });
});
