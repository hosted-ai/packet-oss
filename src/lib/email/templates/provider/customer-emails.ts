/**
 * Provider Customer Email Templates
 *
 * Emails sent to customers affected by provider actions (e.g., server removal).
 */

import { sendEmail } from "../../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailDangerBox, emailDetailBox, emailInfoBox, emailMuted, emailSignoff, plainTextFooter } from "../../utils";
import { getBrandName, getSupportEmail, getAppUrl } from "@/lib/branding";

const APP_URL = getAppUrl();

/**
 * Send email to customers when their server is being removed (7-day notice)
 */
export async function sendCustomerServerRemovalNotice(params: {
  to: string;
  customerName: string;
  serverName: string;
  gpuModel: string;
  removalDate: string;
  daysRemaining: number;
}): Promise<void> {
  const safeCustomerName = params.customerName ? escapeHtml(params.customerName) : "";
  const safeServerName = escapeHtml(params.serverName);
  const safeGpuModel = escapeHtml(params.gpuModel);
  const safeRemovalDate = escapeHtml(params.removalDate);

  const body = `
    ${emailDangerBox(`<p style="margin: 0; font-size: 15px; color: #991b1b;"><strong>Action Required: Server Removal in ${params.daysRemaining} Days</strong></p>`)}
    ${emailGreeting(safeCustomerName || "there")}
    ${emailText(`We're writing to inform you that the server you're currently using on ${getBrandName()} will be removed on <strong>${safeRemovalDate}</strong>.`)}
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #5b6476;">Server Details</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Server:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeServerName}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">GPU:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeGpuModel}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Removal Date:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #ef4444;">${safeRemovalDate}</td>
        </tr>
      </table>
    `)}
    ${emailInfoBox(`
      <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1e40af;">What You Need to Do</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">1. Save any important data or workloads from this server</td></tr>
        <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">2. Visit your dashboard to select a new server</td></tr>
        <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">3. Migrate your workloads before the removal date</td></tr>
      </table>
    `)}
    ${emailText("We have plenty of other GPU servers available for you to choose from. Simply visit your dashboard to find a replacement that meets your needs.")}
    ${emailButton("Find a New Server", `${APP_URL}/dashboard`)}
    ${emailMuted(`If you have any questions or need assistance migrating, please contact us at <a href="mailto:${getSupportEmail()}" style="color: #1a4fff;">${getSupportEmail()}</a>.`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Action required: Your GPU server will be removed on ${params.removalDate}`, body });

  const text = `Action Required: Server Removal in ${params.daysRemaining} Days

Hi${params.customerName ? ` ${params.customerName}` : " there"},

We're writing to inform you that the server you're currently using on ${getBrandName()} will be removed on ${params.removalDate}.

Server Details:
- Server: ${params.serverName}
- GPU: ${params.gpuModel}
- Removal Date: ${params.removalDate}

What You Need to Do:
1. Save any important data or workloads from this server
2. Visit your dashboard to select a new server
3. Migrate your workloads before the removal date

We have plenty of other GPU servers available for you to choose from. Simply visit your dashboard to find a replacement that meets your needs.

Find a new server: ${APP_URL}/dashboard

If you have any questions or need assistance migrating, please contact us at ${getSupportEmail()}.

The ${getBrandName()} Team
${plainTextFooter()}`;

  await sendEmail({
    to: params.to,
    subject: `Action Required: Your GPU Server Will Be Removed on ${params.removalDate}`,
    html,
    text,
  });
}
