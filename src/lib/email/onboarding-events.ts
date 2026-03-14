/**
 * Onboarding Event Emails
 *
 * Sends structured notification emails to onboarding@hosted.ai whenever
 * key customer events happen (signup, subscription, topup, GPU launch,
 * support ticket). This gives the AI support system real-time context.
 *
 * Every call is fire-and-forget — never blocks, never throws.
 */

import { sendEmailDirect } from "./client";

const ONBOARDING_EMAIL = "onboarding@hosted.ai";

interface OnboardingEvent {
  type: string;
  email: string;
  name: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // Format cents as dollars
    return String(value);
  }
  return String(value);
}

function buildHtml(event: OnboardingEvent): string {
  const metaRows = Object.entries(event.metadata)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(
      ([key, value]) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#6b7280;white-space:nowrap;">${key}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#111827;font-weight:500;">${formatValue(value)}</td>
        </tr>`
    )
    .join("\n");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;">${event.type}</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">${new Date().toISOString()}</p>
      </div>
      <div style="border:1px solid #e4e7ef;border-top:none;border-radius:0 0 8px 8px;padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#6b7280;white-space:nowrap;">Customer Email</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#111827;font-weight:500;">${event.email}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#6b7280;white-space:nowrap;">Customer Name</td>
            <td style="padding:6px 12px;border-bottom:1px solid #e4e7ef;font-size:13px;color:#111827;font-weight:500;">${event.name}</td>
          </tr>
          ${metaRows}
        </table>
      </div>
    </div>
  `;
}

function buildPlainText(event: OnboardingEvent): string {
  const lines = [
    `Event: ${event.type}`,
    `Time: ${new Date().toISOString()}`,
    `Customer: ${event.name} <${event.email}>`,
    "",
    ...Object.entries(event.metadata)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([key, value]) => `${key}: ${formatValue(value)}`),
  ];
  return lines.join("\n");
}

/**
 * Send an onboarding event email. Safe to call from anywhere — never throws.
 */
export function sendOnboardingEvent(event: OnboardingEvent): void {
  sendEmailDirect({
    to: ONBOARDING_EMAIL,
    subject: `[${event.type}] ${event.email}`,
    html: buildHtml(event),
    text: buildPlainText(event),
  }).catch((err) => {
    console.error(`[onboarding-event] Failed to send ${event.type} for ${event.email}:`, err);
  });
}
