// Tests for src/lib/email/send-failure-alert.ts — the outbound-send failure
// threshold that turns a run of SMTP failures into one throttled ops alert.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  noteSendFailure,
  noteSendSuccess,
  isQuotaRefusal,
  isAuthRefusal,
} from "@/lib/email/send-failure-alert";

const h = vi.hoisted(() => ({ opsAlert: vi.fn() }));
vi.mock("@/lib/ops-alert", () => ({ opsAlert: h.opsAlert }));

const smtpDown = () => new Error("ECONNREFUSED smtp.example.com:587");
const quotaRefused = () => new Error("550 5.7.1 Daily sending quota exceeded");

function authRefused(): Error {
  const err = new Error("535 5.7.8 Error: authentication failed") as Error & {
    responseCode: number;
    code: string;
  };
  err.responseCode = 535;
  err.code = "EAUTH";
  return err;
}

async function fail(times: number, err: () => Error = smtpDown) {
  for (let i = 0; i < times; i++) await noteSendFailure(`user${i}@example.com`, err());
}

describe("outbound send failure threshold", () => {
  beforeEach(() => {
    h.opsAlert.mockReset();
    h.opsAlert.mockResolvedValue(undefined);
    delete (globalThis as { __emailFailureState?: unknown }).__emailFailureState;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T18:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet below the threshold — one bad address is not an incident", async () => {
    await fail(4);
    expect(h.opsAlert).not.toHaveBeenCalled();
  });

  it("alerts once when the consecutive-failure threshold is breached", async () => {
    await fail(5);
    expect(h.opsAlert).toHaveBeenCalledTimes(1);
    const [tag, subject] = h.opsAlert.mock.calls[0];
    expect(tag).toBe("Email Delivery");
    expect(subject).toContain("5 consecutive outbound email failures");
  });

  it("throttles rather than alerting per send", async () => {
    await fail(20);
    expect(h.opsAlert).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29 * 60 * 1000);
    await fail(5);
    expect(h.opsAlert).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2 * 60 * 1000);
    await fail(1);
    expect(h.opsAlert).toHaveBeenCalledTimes(2);
  });

  it("resets the run on a successful send", async () => {
    await fail(4);
    noteSendSuccess();
    await fail(4);
    expect(h.opsAlert).not.toHaveBeenCalled();
  });

  it("alerts on the first quota refusal and labels it as one", async () => {
    await noteSendFailure("user@example.com", quotaRefused());
    expect(h.opsAlert).toHaveBeenCalledTimes(1);
    const [, subject, lines] = h.opsAlert.mock.calls[0];
    expect(subject).toContain("quota/limit");
    expect(lines.join("\n")).toContain("shared across the estate");
  });

  it("alerts on the first credential refusal, distinctly from a quota one", async () => {
    await noteSendFailure("user@example.com", authRefused());
    expect(h.opsAlert).toHaveBeenCalledTimes(1);
    const [, subject, lines] = h.opsAlert.mock.calls[0];
    expect(subject).toContain("credential");
    expect(subject).not.toContain("quota/limit");
    expect(lines.join("\n")).toMatch(/revoked, rotated or suspended/);
  });

  it("does not let a quota alert throttle the credential alert", async () => {
    await noteSendFailure("user@example.com", quotaRefused());
    await noteSendFailure("user@example.com", authRefused());
    expect(h.opsAlert).toHaveBeenCalledTimes(2);
    expect(h.opsAlert.mock.calls[1][1]).toContain("credential");
  });

  it("does not recurse when the alert's own send fails", async () => {
    h.opsAlert.mockImplementation(async () => {
      await noteSendFailure("ops@example.com", smtpDown());
    });
    await noteSendFailure("user@example.com", quotaRefused());
    expect(h.opsAlert).toHaveBeenCalledTimes(1);
  });

  it("never throws when the alert channel itself fails", async () => {
    h.opsAlert.mockRejectedValue(new Error("settings lookup failed"));
    await expect(noteSendFailure("user@example.com", quotaRefused())).resolves.toBeUndefined();
  });
});

describe("isQuotaRefusal", () => {
  it.each([
    "550 5.7.1 Daily sending quota exceeded",
    "421 4.7.0 Too many messages from this account",
    "550 rate limit exceeded, try again later",
    "452 Sending limit reached for this hour",
    "Throttled by provider policy",
  ])("classifies %s as a quota/limit refusal", (msg) => {
    expect(isQuotaRefusal(new Error(msg))).toBe(true);
  });

  it.each([
    "ECONNREFUSED smtp.example.com:587",
    "550 5.1.1 No such user here",
    "Connection timed out",
  ])("does not classify %s as a quota/limit refusal", (msg) => {
    expect(isQuotaRefusal(new Error(msg))).toBe(false);
  });
});

describe("isAuthRefusal", () => {
  it.each([
    "535 5.7.8 Error: authentication failed",
    "535 5.7.3 Authentication unsuccessful",
    "534 5.7.9 Application-specific password required",
    "530 5.7.0 Authentication Required",
    "Invalid login: 535 Username and Password not accepted",
  ])("classifies %s as a credential refusal", (msg) => {
    expect(isAuthRefusal(new Error(msg))).toBe(true);
  });

  it.each([
    "ECONNREFUSED smtp.example.com:587",
    "550 5.1.1 No such user here",
    "452 4.5.3 Daily message limit exceeded",
    "552 5.3.4 Message too large",
  ])("does not classify %s as a credential refusal", (msg) => {
    expect(isAuthRefusal(new Error(msg))).toBe(false);
  });

  it("classifies nodemailer's EAUTH code with no telling message", () => {
    expect(isAuthRefusal(authRefused())).toBe(true);
  });
});
