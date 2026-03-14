/**
 * Admin Notification Email Templates
 *
 * Internal alerts sent to admins for new provider applications and node submissions.
 */

import { sendEmailDirect, ADMIN_BCC_EMAIL } from "../../client";
import { escapeHtml, emailLayout, emailButton, emailDetailBox, emailMuted, plainTextFooter } from "../../utils";
import { generateAdminToken } from "@/lib/auth/admin";
import { getAppUrl } from "@/lib/branding";

const APP_URL = getAppUrl();

/**
 * Notify admins of new provider application
 */
export async function sendAdminNewProviderAlert(params: {
  providerId?: string;
  companyName: string;
  contactName: string;
  email: string;
  estimatedGpuCount?: number;
  gpuTypes?: string[];
  applicationType?: string;
  desiredDomain?: string;
  expectedCustomers?: string;
  additionalInfo?: string;
}): Promise<void> {
  if (!ADMIN_BCC_EMAIL) {
    console.log("[Email] Skipping admin new provider alert - ADMIN_BCC_EMAIL not configured");
    return;
  }

  const adminEmail = ADMIN_BCC_EMAIL;
  const isWhiteLabel = params.applicationType === "white_label";

  const safeCompanyName = escapeHtml(params.companyName);
  const safeContactName = escapeHtml(params.contactName);
  const safeEmail = escapeHtml(params.email);
  const gpuTypesText = params.gpuTypes?.length
    ? escapeHtml(params.gpuTypes.join(", "))
    : "Not specified";

  const adminToken = generateAdminToken(adminEmail);
  const targetTab = isWhiteLabel ? "tenants" : "providers";
  const providerParam = params.providerId ? `&provider=${params.providerId}` : "";
  const adminLoginUrl = `${APP_URL}/admin/verify?token=${adminToken}&tab=${targetTab}${providerParam}`;

  const typeLabel = isWhiteLabel ? "White Label Platform" : "GPU Provider";
  const typeBadge = isWhiteLabel
    ? `<span style="display:inline-block;background:#18b6a8;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:8px;">WHITE LABEL</span>`
    : `<span style="display:inline-block;background:#1a4fff;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:8px;">GPU PROVIDER</span>`;

  const detailRows = [
    `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Type:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${typeLabel} ${typeBadge}</td></tr>`,
    `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Company:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeCompanyName}</td></tr>`,
    `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Contact:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeContactName}</td></tr>`,
    `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Email:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;"><a href="mailto:${safeEmail}" style="color: #1a4fff;">${safeEmail}</a></td></tr>`,
  ];

  if (isWhiteLabel) {
    detailRows.push(
      `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Desired Domain:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${params.desiredDomain ? escapeHtml(params.desiredDomain) : "Not specified"}</td></tr>`,
      `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Expected Customers:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${params.expectedCustomers ? escapeHtml(params.expectedCustomers) : "Not specified"}</td></tr>`,
    );
  } else {
    detailRows.push(
      `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Est. GPUs:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${params.estimatedGpuCount || "Not specified"}</td></tr>`,
      `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">GPU Types:</td><td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${gpuTypesText}</td></tr>`,
    );
  }

  if (params.additionalInfo) {
    detailRows.push(
      `<tr><td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476; vertical-align: top;">Notes:</td><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">${escapeHtml(params.additionalInfo)}</td></tr>`,
    );
  }

  const body = `
    <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #0b0f1c;">New ${typeLabel} Application</p>
    ${emailDetailBox(`
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        ${detailRows.join("\n")}
      </table>
    `)}
    ${emailButton("Review in Admin Panel", adminLoginUrl)}
    ${emailMuted("This link will log you in automatically and expires in 15 minutes.")}
  `;

  const html = emailLayout({ preheader: `New ${typeLabel.toLowerCase()} application from ${params.companyName}`, body, isTransactional: true });

  const textLines = [
    `New ${typeLabel} Application`,
    "",
    `Company: ${params.companyName}`,
    `Contact: ${params.contactName}`,
    `Email: ${params.email}`,
  ];
  if (isWhiteLabel) {
    textLines.push(`Desired Domain: ${params.desiredDomain || "Not specified"}`);
    textLines.push(`Expected Customers: ${params.expectedCustomers || "Not specified"}`);
  } else {
    textLines.push(`Est. GPUs: ${params.estimatedGpuCount || "Not specified"}`);
    textLines.push(`GPU Types: ${params.gpuTypes?.join(", ") || "Not specified"}`);
  }
  if (params.additionalInfo) {
    textLines.push(`Notes: ${params.additionalInfo}`);
  }
  textLines.push("", `Review in admin panel: ${adminLoginUrl}`, "", "This link will log you in automatically and expires in 15 minutes.", plainTextFooter(true));

  await sendEmailDirect({
    to: adminEmail,
    subject: `New ${typeLabel} Application: ${params.companyName}`,
    html,
    text: textLines.join("\n"),
  });
}

/**
 * Notify admins of new node submission
 */
export async function sendAdminNewNodeAlert(params: {
  companyName: string;
  nodeName: string;
  ipAddress: string;
  gpuModel?: string;
  gpuCount?: number;
}): Promise<void> {
  if (!ADMIN_BCC_EMAIL) {
    console.log("[Email] Skipping admin new node alert - ADMIN_BCC_EMAIL not configured");
    return;
  }

  const adminEmail = ADMIN_BCC_EMAIL;

  const safeCompanyName = escapeHtml(params.companyName);
  const safeNodeName = escapeHtml(params.nodeName);
  const safeIpAddress = escapeHtml(params.ipAddress);
  const safeGpuModel = params.gpuModel ? escapeHtml(params.gpuModel) : "";

  const adminToken = generateAdminToken(adminEmail);
  const adminLoginUrl = `${APP_URL}/admin/verify?token=${adminToken}`;

  const body = `
    <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #0b0f1c;">New Server Submission</p>
    ${emailDetailBox(`
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Provider:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeCompanyName}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Server Name:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeNodeName}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">IP Address:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; font-family: monospace;">${safeIpAddress}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">GPUs:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${params.gpuCount ? `${params.gpuCount}x ${safeGpuModel}` : "Pending validation"}</td>
        </tr>
      </table>
    `)}
    ${emailButton("Review in Admin Panel", adminLoginUrl)}
    ${emailMuted("This link will log you in automatically and expires in 15 minutes.")}
  `;

  const html = emailLayout({ preheader: `New server ${params.nodeName} from ${params.companyName}`, body, isTransactional: true });

  const text = `New Server Submission

Provider: ${params.companyName}
Server Name: ${params.nodeName}
IP Address: ${params.ipAddress}
GPUs: ${params.gpuCount ? `${params.gpuCount}x ${params.gpuModel}` : "Pending validation"}

Review in admin panel: ${adminLoginUrl}

This link will log you in automatically and expires in 15 minutes.
${plainTextFooter(true)}`;

  await sendEmailDirect({
    to: adminEmail,
    subject: `New Server Submission: ${params.nodeName} from ${params.companyName}`,
    html,
    text,
  });
}
