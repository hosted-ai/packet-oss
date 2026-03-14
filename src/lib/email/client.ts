import { delay } from "./utils";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import { getSetting } from "@/lib/settings";

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Resolve the Emailit API key. Checks DB-backed platform settings first
 * (set via admin UI), then falls back to process.env.
 */
async function getEmailitApiKey(): Promise<string | null> {
  return getSetting("EMAILIT_API_KEY");
}

/**
 * Resolve the admin BCC email address.
 */
async function getAdminBccEmail(): Promise<string | null> {
  return getSetting("ADMIN_BCC_EMAIL");
}

async function sendEmailToRecipient(params: EmailParams, retries = 4): Promise<void> {
  const apiKey = await getEmailitApiKey();
  if (!apiKey) {
    throw new Error("EMAILIT_API_KEY is not set — configure in Platform Settings or .env.local");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${getBrandName()} <no-reply@${new URL(getDashboardUrl()).hostname}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (response.ok) return;

    if (response.status === 429 && attempt < retries) {
      const waitMs = 1000 * (attempt + 1); // 1s, 2s, 3s, 4s
      console.warn(`Emailit rate limited (attempt ${attempt + 1}/${retries}), retrying in ${waitMs}ms`);
      await delay(waitMs);
      continue;
    }

    const error = await response.text();
    throw new Error(`Emailit API error: ${response.status} - ${error}`);
  }
}

// Send email to recipient and a copy to admin
export async function sendEmail(params: EmailParams): Promise<void> {
  // Send to actual recipient
  await sendEmailToRecipient(params);

  // Send admin copy if ADMIN_BCC_EMAIL is configured
  const adminBcc = await getAdminBccEmail();
  if (adminBcc) {
    // Wait 5 seconds to avoid Emailit rate limit
    await delay(5000);

    // Send copy to admin (with modified subject to indicate it's a copy)
    try {
      await sendEmailToRecipient({
        ...params,
        to: adminBcc,
        subject: `[Copy to: ${params.to}] ${params.subject}`,
      });
    } catch (error) {
      // Don't fail if admin copy fails
      console.error("Failed to send admin copy:", error);
    }
  }
}

// Export for templates that need direct API access with custom options
export async function sendEmailDirect(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    type: string;
    disposition?: string;
  }>;
}): Promise<void> {
  const apiKey = await getEmailitApiKey();
  if (!apiKey) {
    throw new Error("EMAILIT_API_KEY is not set — configure in Platform Settings or .env.local");
  }

  const retries = 4;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${getBrandName()} <no-reply@${new URL(getDashboardUrl()).hostname}>`,
        ...params,
      }),
    });

    if (response.ok) return;

    if (response.status === 429 && attempt < retries) {
      const waitMs = 1000 * (attempt + 1);
      console.warn(`Emailit rate limited (attempt ${attempt + 1}/${retries}), retrying in ${waitMs}ms`);
      await delay(waitMs);
      continue;
    }

    const error = await response.text();
    throw new Error(`Emailit API error: ${response.status} - ${error}`);
  }
}

// Send admin copy helper
export async function sendAdminCopy(params: {
  originalTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const adminBcc = await getAdminBccEmail();
  if (!adminBcc) {
    return; // Skip if admin email not configured
  }
  try {
    await sendEmailDirect({
      to: adminBcc,
      subject: `[Copy to: ${params.originalTo}] ${params.subject}`,
      html: params.html,
      text: params.text,
    });
  } catch (error) {
    console.error("Failed to send admin copy:", error);
  }
}

/**
 * Sync fallback for ADMIN_BCC_EMAIL — reads from env only.
 * Used by templates that need the value synchronously. For DB-backed
 * resolution, use getAdminBccEmail() instead.
 */
export const ADMIN_BCC_EMAIL = process.env.ADMIN_BCC_EMAIL || null;
