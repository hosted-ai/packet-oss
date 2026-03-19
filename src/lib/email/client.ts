/**
 * Email transport client — SMTP via nodemailer.
 *
 * Transport resolution:
 *   1. SMTP_HOST configured → nodemailer SMTP pool
 *   2. Not configured → throws ConfigError
 *
 * The SMTP pool is stored on globalThis so it survives Next.js hot-reloads
 * (same pattern as prisma.ts and settings cache).
 *
 *   ┌─────────────┐     ┌───────────────┐     ┌────────────────┐
 *   │ sendEmail()  │────▶│ resolveTransp │────▶│ SMTP pool      │
 *   │ sendDirect() │     │ (SMTP or none)│     │ (nodemailer)   │
 *   └─────────────┘     └───────────────┘     └────────────────┘
 *         │
 *         └──▶ EmailLog.create() (non-blocking)
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getEmailFromName, getEmailFromAddress } from "@/lib/branding";
import { getSetting, getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailDirectParams extends EmailParams {
  reply_to?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    type: string;
    disposition?: string;
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SmtpTransporter = Transporter<any>;

type TransportConfig =
  | { type: "smtp"; transporter: SmtpTransporter }
  | { type: "none" };

// ── SMTP pool singleton on globalThis ───────────────────────────────────────

const globalForSmtp = globalThis as unknown as {
  __smtpTransporter?: SmtpTransporter;
  __smtpConfigHash?: string;
};

/**
 * Clear the SMTP connection pool.
 * Call when admin changes SMTP settings in Platform Settings.
 */
export function clearSmtpPool(): void {
  if (globalForSmtp.__smtpTransporter) {
    globalForSmtp.__smtpTransporter.close();
  }
  globalForSmtp.__smtpTransporter = undefined;
  globalForSmtp.__smtpConfigHash = undefined;
}

/**
 * Detect TLS settings from SMTP port number.
 *
 *   Port 465 → implicit TLS (secure: true)
 *   Port 587 → STARTTLS (secure: false, requireTLS: true)
 *   Port 25  → no encryption (warning shown in UI)
 *   Other    → default to STARTTLS behavior
 */
export function autoDetectTls(port: number): { secure: boolean; requireTLS: boolean } {
  if (port === 465) return { secure: true, requireTLS: false };
  if (port === 587) return { secure: false, requireTLS: true };
  if (port === 25) return { secure: false, requireTLS: false };
  // Unknown port — default to STARTTLS
  return { secure: false, requireTLS: true };
}

// ── Transport resolution ────────────────────────────────────────────────────

async function resolveTransport(): Promise<TransportConfig> {
  const settings = await getSettings([
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD",
  ]);

  const smtpHost = settings["SMTP_HOST"]?.trim();
  if (smtpHost) {
    const port = parseInt(settings["SMTP_PORT"] || "587", 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid SMTP port: ${settings["SMTP_PORT"]}. Must be 1-65535.`);
    }

    const configHash = `${smtpHost}:${port}:${settings["SMTP_USER"] || ""}`;

    // Reuse existing pool if config hasn't changed
    if (globalForSmtp.__smtpTransporter && globalForSmtp.__smtpConfigHash === configHash) {
      return { type: "smtp", transporter: globalForSmtp.__smtpTransporter };
    }

    // Close stale pool if config changed
    if (globalForSmtp.__smtpTransporter) {
      globalForSmtp.__smtpTransporter.close();
    }

    const { secure, requireTLS } = autoDetectTls(port);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      requireTLS,
      pool: true,
      maxConnections: 5,
      auth: settings["SMTP_USER"]
        ? { user: settings["SMTP_USER"], pass: settings["SMTP_PASSWORD"] || "" }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    globalForSmtp.__smtpTransporter = transporter;
    globalForSmtp.__smtpConfigHash = configHash;

    console.info(`[Email] Transport: SMTP (${smtpHost}:${port}, ${secure ? "TLS" : requireTLS ? "STARTTLS" : "plain"})`);
    return { type: "smtp", transporter };
  }

  return { type: "none" };
}

// ── Email "From" and BCC helpers ────────────────────────────────────────────

async function getEmailFrom(): Promise<string> {
  const name = await getSetting("EMAIL_FROM_NAME") || getEmailFromName();
  const addr = await getSetting("EMAIL_FROM_ADDRESS") || getEmailFromAddress();
  return `${name} <${addr}>`;
}

async function getAdminBccEmail(): Promise<string | null> {
  return getSetting("ADMIN_BCC_EMAIL");
}

// ── Retry logic ─────────────────────────────────────────────────────────────

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Connection-level failures are retriable
  if (msg.includes("econnrefused") || msg.includes("econnreset") ||
      msg.includes("etimedout") || msg.includes("esocket") ||
      msg.includes("timeout") || msg.includes("connection")) {
    return true;
  }
  // SMTP 4xx codes are retriable (temporary failures)
  const smtpCode = (err as { responseCode?: number }).responseCode;
  if (smtpCode && smtpCode >= 400 && smtpCode < 500) return true;
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "email",
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries && isRetriableError(err)) {
        const waitMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[Email] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${waitMs}ms:`, err instanceof Error ? err.message : err);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error(`[Email] ${label} failed after ${maxRetries + 1} attempts`);
}

// ── EmailLog writer (non-blocking) ──────────────────────────────────────────

function logEmail(to: string, subject: string, status: "sent" | "failed", provider: string, error?: string): void {
  prisma.emailLog.create({
    data: { to, subject, status, provider, error: error?.substring(0, 2000) },
  }).catch((err) => {
    console.error("[Email] Failed to write EmailLog:", err);
  });
}

// ── Transport send functions ────────────────────────────────────────────────

async function sendViaSmtp(
  transporter: SmtpTransporter,
  from: string,
  params: EmailDirectParams,
): Promise<void> {
  const mailOptions: nodemailer.SendMailOptions = {
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    replyTo: params.reply_to,
  };

  // Convert attachments to nodemailer format
  if (params.attachments?.length) {
    mailOptions.attachments = params.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.type,
      contentDisposition: (a.disposition as "attachment" | "inline") || "attachment",
    }));
  }

  await transporter.sendMail(mailOptions);
}

// ── Core send function ──────────────────────────────────────────────────────

async function sendRaw(params: EmailDirectParams): Promise<void> {
  const transport = await resolveTransport();

  if (transport.type === "none") {
    throw new Error(
      "Email not configured. Set up SMTP in Platform Settings.",
    );
  }

  const from = await getEmailFrom();

  try {
    await withRetry(
      () => sendViaSmtp(transport.transporter, from, params),
      3,
      `SMTP send to ${params.to}`,
    );
    logEmail(params.to, params.subject, "sent", "smtp");
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logEmail(params.to, params.subject, "failed", "smtp", errorMsg);
    throw err;
  }
}

// ── Public API (unchanged signatures) ───────────────────────────────────────

/**
 * Send email to recipient + admin BCC copy (if configured).
 */
export async function sendEmail(params: EmailParams): Promise<void> {
  await sendRaw(params);

  // Send admin copy if ADMIN_BCC_EMAIL is configured
  const adminBcc = await getAdminBccEmail();
  if (adminBcc) {
    try {
      await sendRaw({
        ...params,
        to: adminBcc,
        subject: `[Copy to: ${params.to}] ${params.subject}`,
      });
    } catch (error) {
      console.error("[Email] Failed to send admin copy:", error);
    }
  }
}

/**
 * Send email with custom options (reply-to, attachments).
 */
export async function sendEmailDirect(params: EmailDirectParams): Promise<void> {
  await sendRaw(params);
}

/**
 * Send admin copy of an email.
 */
export async function sendAdminCopy(params: {
  originalTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const adminBcc = await getAdminBccEmail();
  if (!adminBcc) return;
  try {
    await sendRaw({
      to: adminBcc,
      subject: `[Copy to: ${params.originalTo}] ${params.subject}`,
      html: params.html,
      text: params.text,
    });
  } catch (error) {
    console.error("[Email] Failed to send admin copy:", error);
  }
}

/**
 * Verify SMTP connection without sending an email.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function verifySmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  const transport = await resolveTransport();
  if (transport.type !== "smtp") {
    return { ok: false, error: "SMTP is not configured. Set SMTP_HOST in Platform Settings." };
  }
  try {
    await transport.transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get the currently active email transport type.
 */
export async function getActiveTransport(): Promise<"smtp" | "none"> {
  const transport = await resolveTransport();
  return transport.type;
}
