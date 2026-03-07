import { delay } from "./utils";

const EMAILIT_API_KEY = process.env.EMAILIT_API_KEY;
// Admin email for receiving copies of all transactional emails
// Configure via ADMIN_BCC_EMAIL environment variable
const ADMIN_BCC_EMAIL = process.env.ADMIN_BCC_EMAIL;

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmailToRecipient(params: EmailParams, retries = 4): Promise<void> {
  if (!EMAILIT_API_KEY) {
    throw new Error("EMAILIT_API_KEY is not set");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EMAILIT_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "GPU Cloud <no-reply@example.com>",
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
  if (ADMIN_BCC_EMAIL) {
    // Wait 5 seconds to avoid Emailit rate limit
    await delay(5000);

    // Send copy to admin (with modified subject to indicate it's a copy)
    try {
      await sendEmailToRecipient({
        ...params,
        to: ADMIN_BCC_EMAIL,
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
  if (!EMAILIT_API_KEY) {
    throw new Error("EMAILIT_API_KEY is not set");
  }

  const retries = 4;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch("https://api.emailit.com/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EMAILIT_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "GPU Cloud <no-reply@example.com>",
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
  if (!ADMIN_BCC_EMAIL) {
    return; // Skip if admin email not configured
  }
  try {
    await sendEmailDirect({
      to: ADMIN_BCC_EMAIL,
      subject: `[Copy to: ${params.originalTo}] ${params.subject}`,
      html: params.html,
      text: params.text,
    });
  } catch (error) {
    console.error("Failed to send admin copy:", error);
  }
}

export { ADMIN_BCC_EMAIL };
