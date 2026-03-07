/**
 * Tenant Welcome Email
 *
 * Sent to resellers when their white-label tenant is created by admin.
 * Includes a setup portal link, checklist, and WHMCS download link.
 */

import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailInfoBox, emailDetailBox, emailMuted, emailSignoff, plainTextFooter } from "../utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";

export async function sendTenantWelcomeEmail(params: {
  to: string;
  contactName: string;
  brandName: string;
  setupUrl: string;
  slug: string;
}): Promise<void> {
  const safeName = escapeHtml(params.contactName || "there");
  const safeBrand = escapeHtml(params.brandName);

  const previewUrl = `${APP_URL.replace("://", `://${params.slug}.`)}`;
  const whmcsUrl = `${APP_URL}/docs/white-label#whmcs`;

  const body = `
    ${emailGreeting(safeName)}
    ${emailText(`Great news! Your white-label platform <strong>${safeBrand}</strong> has been approved and created.`)}
    ${emailText("To get your platform live, you'll need to complete a few setup steps:")}
    ${emailInfoBox(`
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #0b0f1c;">
            <strong style="color: #1a4fff;">1.</strong> &nbsp;Configure your <strong>branding</strong> (logo, colors, name)
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #0b0f1c;">
            <strong style="color: #1a4fff;">2.</strong> &nbsp;Set up your <strong>custom domain</strong>
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #0b0f1c;">
            <strong style="color: #1a4fff;">3.</strong> &nbsp;Connect your <strong>Stripe account</strong> for billing
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #0b0f1c;">
            <strong style="color: #1a4fff;">4.</strong> &nbsp;Configure <strong>GPU pricing</strong> and margins
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #0b0f1c;">
            <strong style="color: #1a4fff;">5.</strong> &nbsp;Set up <strong>support contact</strong> details
          </td>
        </tr>
      </table>
    `)}
    ${emailButton("Complete Your Setup", params.setupUrl)}
    ${emailMuted("This link is valid for 24 hours. After that you can request a new one from your admin contact.")}
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #5b6476;">Your Platform Details</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Brand:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeBrand}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Preview URL:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">
            <a href="${previewUrl}" style="color: #1a4fff;">${previewUrl}</a>
          </td>
        </tr>
      </table>
    `)}
    ${emailText(`<strong>WHMCS Integration:</strong> If you use WHMCS for customer management, we have a ready-made provisioning module. <a href="${whmcsUrl}" style="color: #1a4fff;">Download the WHMCS plugin &rarr;</a>`)}
    ${emailMuted(`Need help? Reply to this email or reach us at <a href="mailto:${process.env.SUPPORT_EMAIL || "support@example.com"}" style="color: #1a4fff;">${process.env.SUPPORT_EMAIL || "support@example.com"}</a>.`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({
    preheader: `Your white-label platform ${params.brandName} is ready — complete setup now`,
    body,
    isTransactional: true,
  });

  const text = `Hi ${params.contactName || "there"},

Great news! Your white-label platform ${params.brandName} has been approved and created.

To get your platform live, complete these setup steps:
1. Configure your branding (logo, colors, name)
2. Set up your custom domain
3. Connect your Stripe account for billing
4. Configure GPU pricing and margins
5. Set up support contact details

Complete your setup: ${params.setupUrl}

This link is valid for 24 hours. After that you can request a new one from your admin contact.

Your Platform Details:
- Brand: ${params.brandName}
- Preview URL: ${previewUrl}

WHMCS Integration: If you use WHMCS, download our provisioning module at ${whmcsUrl}

Need help? Reply to this email or reach us at ${process.env.SUPPORT_EMAIL || "support@example.com"}.
${plainTextFooter(true)}`;

  await sendEmail({
    to: params.to,
    subject: `Your ${params.brandName} Platform is Ready — Complete Setup`,
    html,
    text,
  });
}
