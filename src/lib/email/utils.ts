/**
 * Email utility functions
 * @module email/utils
 */

import type { EmailBranding } from './tenant-branding';
import { getBrandName, getAppUrl, getPrimaryColor, getAccentColor } from '../branding';

// ── Default branding values ─────────────────────────────────────────────────
// Used when no branding object is passed — keeps every existing call-site
// producing byte-identical output.

const DEFAULT_BRAND_NAME = getBrandName();
const DEFAULT_PRIMARY_COLOR = '#1a4fff';
const DEFAULT_ACCENT_COLOR = '#18b6a8';
const DEFAULT_DASHBOARD_URL = getAppUrl();

/**
 * Escape HTML special characters to prevent injection
 * @param str - String to escape
 * @returns Escaped string safe for HTML output
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Delay execution for rate limiting
 * @internal Used by email client for rate limiting
 * @param ms - Milliseconds to wait
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate HTML for a text link below a button
 * For email clients that don't render buttons well
 * @param url - The URL to link to
 * @param branding - Optional tenant branding
 * @returns HTML string for the text link
 */
export function textLinkHtml(url: string, branding?: EmailBranding): string {
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR;
  return `<p style="text-align: center; margin: 10px 0 0 0; font-size: 12px; color: #5b6476;">Or copy this link: <a href="${url}" style="color: ${primary}; word-break: break-all;">${url}</a></p>`;
}

/**
 * Standard email footer with company info (CAN-SPAM compliant)
 * @param isTransactional - If true, shows transactional notice instead of unsubscribe
 * @param branding - Optional tenant branding
 * @returns HTML and text versions of the footer
 */
export function getEmailFooter(isTransactional = true, branding?: EmailBranding): { html: string; text: string } {
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR;
  const dashboard = branding?.dashboardUrl || DEFAULT_DASHBOARD_URL;

  const html = `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e7ef; text-align: center; color: #5b6476; font-size: 12px;">
      <p style="margin: 0 0 8px 0;">
        <strong>${escapeHtml(brand)}</strong> by Hosted AI Inc.
      </p>
      <p style="margin: 0 0 8px 0;">
        622 North 9th Street, San Jose, CA 95112, USA
      </p>
      ${isTransactional
        ? `<p style="margin: 0; font-size: 11px; color: #5b6476;">This is a transactional email related to your ${escapeHtml(brand)} account.</p>`
        : `<p style="margin: 0;"><a href="${dashboard}/account/settings" style="color: ${primary};">Manage email preferences</a></p>`
      }
    </div>
  `;

  const text = `
---
${brand} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
${isTransactional ? `This is a transactional email related to your ${brand} account.` : `Manage email preferences: ${dashboard}/account/settings`}`;

  return { html, text };
}

/**
 * Email footer with a one-click unsubscribe link for marketing emails.
 */
export function getEmailFooterWithUnsubscribe(unsubscribeUrl: string, branding?: EmailBranding): { html: string; text: string } {
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;

  const html = `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e4e7ef; text-align: center; color: #5b6476; font-size: 12px;">
      <p style="margin: 0 0 8px 0;">
        <strong>${escapeHtml(brand)}</strong> by Hosted AI Inc.
      </p>
      <p style="margin: 0 0 8px 0;">
        622 North 9th Street, San Jose, CA 95112, USA
      </p>
      <p style="margin: 0;">
        <a href="${unsubscribeUrl}" style="color: #5b6476; text-decoration: underline;">Unsubscribe from onboarding emails</a>
      </p>
    </div>
  `;

  const text = `
---
${brand} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
Unsubscribe: ${unsubscribeUrl}`;

  return { html, text };
}

// ── Shared email layout primitives ──────────────────────────────────────────
// All customer-facing emails use these to ensure consistent branding and
// maximum deliverability (spam-filter safe: no <style> blocks, no CSS classes,
// balanced text-to-image ratio, proper List-Unsubscribe hints, physical address).

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || getAppUrl();

/**
 * Full HTML email wrapper.
 * - Proper DOCTYPE + meta for responsive rendering
 * - 600px centered table layout (Outlook-safe)
 * - Brand header with text logo (no images = no image-blocking issues)
 * - CAN-SPAM footer with physical address
 * - Preheader text for inbox preview
 */
export function emailLayout(opts: {
  preheader?: string;
  body: string;
  isTransactional?: boolean;
  portalLabel?: string;
  unsubscribeUrl?: string;
  branding?: EmailBranding;
}): string {
  const { preheader = "", body, isTransactional = true, portalLabel, unsubscribeUrl, branding } = opts;
  const footer = unsubscribeUrl
    ? getEmailFooterWithUnsubscribe(unsubscribeUrl, branding)
    : getEmailFooter(isTransactional, branding);

  const brand = branding?.brandName || DEFAULT_BRAND_NAME;
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR;

  // For the default brand we render the stylized "Packet<span>.ai" header.
  // For tenant brands we render the plain brand name in their primary color.
  const headerHtml = brand === 'Packet.ai'
    ? `<h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #0b0f1c; letter-spacing: -0.3px;">Packet<span style="color: ${primary};">.</span>ai</h1>`
    : `<h1 style="margin: 0; font-size: 22px; font-weight: 700; color: ${primary}; letter-spacing: -0.3px;">${escapeHtml(brand)}</h1>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(brand)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f7f8fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f7f8fb;">${escapeHtml(preheader)}${"&nbsp;&zwnj;".repeat(30)}</div>` : ""}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f8fb;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; border: 1px solid #e4e7ef; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px 24px 40px; text-align: center; border-bottom: 1px solid #e4e7ef;">
              ${headerHtml}
              ${portalLabel ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #5b6476;">${escapeHtml(portalLabel)}</p>` : ""}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              ${footer.html}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Primary call-to-action button
 * Uses brand primary color (default: #1a4fff) — solid color for Outlook compatibility
 */
export function emailButton(label: string, url: string, branding?: EmailBranding): string {
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR;
  // Darken primary slightly for Outlook stroke color — keep the hex fallback for default
  const strokeColor = branding ? primary : '#1238c9';

  return `<div style="text-align: center; margin: 28px 0;">
  <!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" strokecolor="${strokeColor}" fillcolor="${primary}">
    <w:anchorlock/>
    <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">${escapeHtml(label)}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-->
  <a href="${url}" style="display: inline-block; background-color: ${primary}; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; line-height: 1; mso-hide: all;" target="_blank">${escapeHtml(label)}</a>
  <!--<![endif]-->
  <p style="margin: 10px 0 0 0; font-size: 12px; color: #5b6476;">Or copy this link: <a href="${url}" style="color: ${primary}; word-break: break-all;">${url}</a></p>
</div>`;
}

/**
 * Secondary/alternate button (default: teal for positive actions like "Launch GPU")
 */
export function emailButtonTeal(label: string, url: string, branding?: EmailBranding): string {
  const accent = branding?.accentColor || DEFAULT_ACCENT_COLOR;
  const primary = branding?.primaryColor || DEFAULT_PRIMARY_COLOR;

  return `<div style="text-align: center; margin: 28px 0;">
  <a href="${url}" style="display: inline-block; background-color: ${accent}; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; line-height: 1;" target="_blank">${escapeHtml(label)}</a>
  <p style="margin: 10px 0 0 0; font-size: 12px; color: #5b6476;">Or copy this link: <a href="${url}" style="color: ${primary}; word-break: break-all;">${url}</a></p>
</div>`;
}

/**
 * Info/highlight box — light blue background
 */
export function emailInfoBox(content: string): string {
  return `<div style="background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 16px; margin: 20px 0;">
  ${content}
</div>`;
}

/**
 * Success box — green
 */
export function emailSuccessBox(content: string): string {
  return `<div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #10b981;">
  ${content}
</div>`;
}

/**
 * Warning box — amber
 */
export function emailWarningBox(content: string): string {
  return `<div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #f59e0b;">
  ${content}
</div>`;
}

/**
 * Error/danger box — red
 */
export function emailDangerBox(content: string): string {
  return `<div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #ef4444;">
  ${content}
</div>`;
}

/**
 * Neutral detail box — grey background for data/quotes
 */
export function emailDetailBox(content: string): string {
  return `<div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
  ${content}
</div>`;
}

/**
 * Standard paragraph
 */
export function emailText(text: string): string {
  return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #0b0f1c;">${text}</p>`;
}

/**
 * Greeting line
 */
export function emailGreeting(name: string): string {
  return `<h2 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600; color: #0b0f1c;">Hi ${escapeHtml(name)},</h2>`;
}

/**
 * Muted helper text
 */
export function emailMuted(text: string): string {
  return `<p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #5b6476;">${text}</p>`;
}

/**
 * Section divider
 */
export function emailDivider(): string {
  return `<hr style="border: none; border-top: 1px solid #e4e7ef; margin: 24px 0;">`;
}

/**
 * Sign-off
 */
export function emailSignoff(branding?: EmailBranding): string {
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;
  return `${emailDivider()}
<p style="margin: 0; font-size: 14px; color: #5b6476; text-align: center;"><strong>The ${escapeHtml(brand)} Team</strong></p>`;
}

/**
 * Standard plain-text footer
 */
export function plainTextFooter(opts?: boolean | { isTransactional?: boolean; unsubscribeUrl?: string; branding?: EmailBranding }): string {
  // Support legacy boolean signature: plainTextFooter(true)
  if (typeof opts === "boolean") {
    opts = { isTransactional: opts };
  }
  const { isTransactional = true, unsubscribeUrl, branding } = opts || {};
  const brand = branding?.brandName || DEFAULT_BRAND_NAME;
  const dashboard = branding?.dashboardUrl || DEFAULT_DASHBOARD_URL;

  if (unsubscribeUrl) {
    return `
---
${brand} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
Unsubscribe from onboarding emails: ${unsubscribeUrl}`;
  }
  return `
---
${brand} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
${isTransactional ? `This is a transactional email related to your ${brand} account.` : `Manage email preferences: ${dashboard}/account/settings`}`;
}
