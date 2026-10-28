/**
 * Deferred-mail queue.
 *
 * A quota/rate refusal clears at the provider's reset, a credential refusal
 * when an operator rotates the key — neither in seconds, so in-process retries
 * multiply provider hits and the message is lost when they run out. client.ts
 * parks such a send here instead; the resend-deferred-email cron drains it.
 *
 *   sendRaw() ──transport refusal──▶ deferEmail() ──▶ deferred_email
 *                                                      │
 *   /api/cron/resend-deferred-email ──▶ resendDeferredEmails() ─┘
 */

import { prisma } from "@/lib/prisma";
import type { EmailDirectParams } from "./client";

const MAX_ATTEMPTS = 6;
const FIRST_BACKOFF_MS = 30 * 60 * 1000;
const MAX_BACKOFF_MS = 8 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

// 30m, 1h, 2h, 4h, then 8h — six attempts span a day and so outlive any
// daily quota window.
export function backoffMs(attempts: number): number {
  return Math.min(FIRST_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS);
}

function serializeAttachments(params: EmailDirectParams): string | null {
  return params.attachments?.length ? JSON.stringify(params.attachments) : null;
}

function parseAttachments(raw: string | null): EmailDirectParams["attachments"] {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as EmailDirectParams["attachments"];
  } catch {
    return undefined;
  }
}

// Park a refused message for later re-send. Never throws: a failed queue write
// must not turn a deferral into a second failure for the caller.
export async function deferEmail(
  params: EmailDirectParams,
  reason: string,
  now = new Date(),
): Promise<void> {
  try {
    await prisma.deferredEmail.create({
      data: {
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: params.reply_to ?? null,
        attachments: serializeAttachments(params),
        status: "deferred",
        attempts: 1,
        lastError: reason.substring(0, 2000),
        nextAttemptAt: new Date(now.getTime() + backoffMs(1)),
      },
    });
    console.warn(`[Email] Deferred send to ${params.to} for re-send: ${reason}`);
  } catch (err) {
    console.error("[Email] Failed to queue deferred email:", err);
  }
}

export interface ResendResult {
  resent: number;
  stillDeferred: number;
  abandoned: number;
}

// Re-send every deferred message whose backoff has elapsed. `send` must throw
// on failure rather than deferring again, so the existing row is the record.
export async function resendDeferredEmails(
  send: (params: EmailDirectParams) => Promise<void>,
  now = new Date(),
): Promise<ResendResult> {
  const due = await prisma.deferredEmail.findMany({
    where: { status: "deferred", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH_SIZE,
  });

  const result: ResendResult = { resent: 0, stillDeferred: 0, abandoned: 0 };

  for (const row of due) {
    const attempts = row.attempts + 1;
    try {
      await send({
        to: row.to,
        subject: row.subject,
        html: row.html,
        text: row.text,
        reply_to: row.replyTo ?? undefined,
        attachments: parseAttachments(row.attachments),
      });
      await prisma.deferredEmail.update({
        where: { id: row.id },
        data: { status: "sent", attempts, sentAt: now },
      });
      result.resent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const abandoned = attempts >= MAX_ATTEMPTS;
      await prisma.deferredEmail.update({
        where: { id: row.id },
        data: {
          status: abandoned ? "abandoned" : "deferred",
          attempts,
          lastError: message.substring(0, 2000),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        },
      });
      if (abandoned) {
        console.error(`[Email] Abandoned deferred send to ${row.to} after ${attempts} attempts: ${message}`);
        result.abandoned++;
      } else {
        result.stillDeferred++;
      }
    }
  }

  return result;
}
