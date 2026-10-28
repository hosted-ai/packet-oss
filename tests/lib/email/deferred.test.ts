import { describe, it, expect, vi, beforeEach } from "vitest";
import { backoffMs, deferEmail, resendDeferredEmails } from "@/lib/email/deferred";

const mockCreate = vi.fn().mockResolvedValue({});
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deferredEmail: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const NOW = new Date("2026-09-10T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    to: "user@example.com",
    subject: "Sign in to Packet",
    html: "<p>link</p>",
    text: "link",
    replyTo: null,
    attachments: null,
    status: "deferred",
    attempts: 1,
    lastError: "452 4.5.3 Daily message limit exceeded",
    nextAttemptAt: NOW,
    sentAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
});

describe("backoffMs", () => {
  it("doubles from 30 minutes and caps at 8 hours", () => {
    expect(backoffMs(1)).toBe(30 * 60 * 1000);
    expect(backoffMs(2)).toBe(60 * 60 * 1000);
    expect(backoffMs(4)).toBe(4 * 60 * 60 * 1000);
    expect(backoffMs(5)).toBe(8 * 60 * 60 * 1000);
    expect(backoffMs(9)).toBe(8 * 60 * 60 * 1000);
  });
});

describe("deferEmail", () => {
  it("persists the whole message so it can be re-sent later", async () => {
    await deferEmail(
      {
        to: "user@example.com",
        subject: "Sign in to Packet",
        html: "<p>link</p>",
        text: "link",
        reply_to: "support@example.com",
        attachments: [{ filename: "a.pdf", content: "Zm9v", type: "application/pdf" }],
      },
      "452 4.5.3 Daily message limit exceeded",
      NOW,
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      to: "user@example.com",
      subject: "Sign in to Packet",
      html: "<p>link</p>",
      text: "link",
      replyTo: "support@example.com",
      status: "deferred",
      attempts: 1,
    });
    expect(JSON.parse(data.attachments)).toHaveLength(1);
    expect(data.nextAttemptAt.getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
  });

  it("swallows a queue-write failure rather than raising a second error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(
      deferEmail({ to: "u@e.com", subject: "s", html: "h", text: "t" }, "quota exceeded", NOW),
    ).resolves.toBeUndefined();
  });
});

describe("resendDeferredEmails", () => {
  it("only picks up rows whose backoff has elapsed", async () => {
    await resendDeferredEmails(vi.fn(), NOW);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "deferred", nextAttemptAt: { lte: NOW } },
      }),
    );
  });

  it("marks a delivered message sent and restores its options", async () => {
    mockFindMany.mockResolvedValue([
      row({
        replyTo: "support@example.com",
        attachments: JSON.stringify([{ filename: "a.pdf", content: "Zm9v", type: "application/pdf" }]),
      }),
    ]);
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await resendDeferredEmails(send, NOW);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        html: "<p>link</p>",
        reply_to: "support@example.com",
        attachments: [{ filename: "a.pdf", content: "Zm9v", type: "application/pdf" }],
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { status: "sent", attempts: 2, sentAt: NOW },
    });
    expect(result).toEqual({ resent: 1, stillDeferred: 0, abandoned: 0 });
  });

  it("re-defers with a longer backoff when the refusal is still in force", async () => {
    mockFindMany.mockResolvedValue([row({ attempts: 2 })]);
    const send = vi.fn().mockRejectedValue(new Error("452 4.5.3 Daily message limit exceeded"));

    const result = await resendDeferredEmails(send, NOW);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({
        status: "deferred",
        attempts: 3,
        nextAttemptAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
      }),
    });
    expect(result).toEqual({ resent: 0, stillDeferred: 1, abandoned: 0 });
  });

  it("abandons a message once its attempts run out", async () => {
    mockFindMany.mockResolvedValue([row({ attempts: 5 })]);
    const send = vi.fn().mockRejectedValue(new Error("452 4.5.3 Daily message limit exceeded"));

    const result = await resendDeferredEmails(send, NOW);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: expect.objectContaining({ status: "abandoned", attempts: 6 }),
    });
    expect(result).toEqual({ resent: 0, stillDeferred: 0, abandoned: 1 });
  });

  it("keeps sweeping after one message fails", async () => {
    mockFindMany.mockResolvedValue([row(), row({ id: "row-2" })]);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("452 4.5.3 Daily message limit exceeded"))
      .mockResolvedValueOnce(undefined);

    const result = await resendDeferredEmails(send, NOW);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ resent: 1, stillDeferred: 1, abandoned: 0 });
  });
});
