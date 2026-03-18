/**
 * Provider Node Email Templates
 *
 * Notifications about node lifecycle: approved, live, removal scheduled, vacated.
 */

import { sendEmail } from "../../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailSuccessBox, emailWarningBox, emailDetailBox, emailMuted, emailSignoff, plainTextFooter } from "../../utils";
import { getBrandName, getAppUrl } from "@/lib/branding";
import { loadTemplate } from "../../template-loader";

const APP_URL = getAppUrl();

/**
 * Send email when a node is approved
 */
export async function sendNodeApprovedEmail(params: {
  to: string;
  companyName: string;
  nodeName: string;
  gpuModel: string;
  gpuCount: number;
  hourlyRate: string;
}): Promise<void> {
  const safeNodeName = escapeHtml(params.nodeName);
  const safeGpuModel = escapeHtml(params.gpuModel);
  const safeHourlyRate = escapeHtml(params.hourlyRate);

  const body = `
    ${emailSuccessBox(`<p style="margin: 0; font-size: 16px; color: #065f46;"><strong>Server Approved</strong></p>`)}
    ${emailText(`Your server <strong>${safeNodeName}</strong> has been approved and is being provisioned.`)}
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #5b6476;">Server Details</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Server Name:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeNodeName}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">GPUs:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${params.gpuCount}x ${safeGpuModel}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 0; font-size: 14px; color: #5b6476;">Your Rate:</td>
          <td style="padding: 4px 0; font-size: 14px; font-weight: 600; color: #0b0f1c;">${safeHourlyRate}/GPU/hour</td>
        </tr>
      </table>
    `)}
    ${emailText("We'll send you another email once provisioning is complete and your server is live on the marketplace.")}
    ${emailButton("View Dashboard", `${APP_URL}/providers/dashboard`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Server ${params.nodeName} approved — provisioning started`, body, portalLabel: "Provider Portal" });

  const text = `Server Approved!

Your server ${params.nodeName} has been approved and is being provisioned.

Server Details:
- Server Name: ${params.nodeName}
- GPUs: ${params.gpuCount}x ${params.gpuModel}
- Your Rate: ${params.hourlyRate}/GPU/hour

We'll send you another email once provisioning is complete and your server is live on the marketplace.

View your dashboard: ${APP_URL}/providers/dashboard

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("node-approved", {
    nodeName: params.nodeName,
    gpuModel: params.gpuModel,
    gpuCount: String(params.gpuCount),
    hourlyRate: params.hourlyRate,
    companyName: params.companyName,
  }, {
    subject: `Server Approved: ${params.nodeName}`,
    html,
    text,
  });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send email when a node goes live
 */
export async function sendNodeLiveEmail(params: {
  to: string;
  nodeName: string;
  gpuModel: string;
  gpuCount: number;
}): Promise<void> {
  const safeNodeName = escapeHtml(params.nodeName);
  const safeGpuModel = escapeHtml(params.gpuModel);

  const body = `
    ${emailSuccessBox(`
      <p style="margin: 0; font-size: 16px; color: #065f46;"><strong>Your Server is Live!</strong></p>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #065f46;">${params.gpuCount}x ${safeGpuModel} — now available for customers</p>
    `)}
    ${emailText(`Great news! Your server <strong>${safeNodeName}</strong> is now live on the ${getBrandName()} marketplace.`)}
    ${emailText("Customers can now rent your GPUs. You'll start earning revenue as soon as they're used!")}
    ${emailButton("View Dashboard", `${APP_URL}/providers/dashboard`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `${params.nodeName} is live — ${params.gpuCount}x ${params.gpuModel} available`, body, portalLabel: "Provider Portal" });

  const text = `Your Server is Live!

Great news! Your server ${params.nodeName} is now live on the ${getBrandName()} marketplace.

${params.gpuCount}x ${params.gpuModel} — now available for customers

Customers can now rent your GPUs. You'll start earning revenue as soon as they're used!

View your dashboard: ${APP_URL}/providers/dashboard

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("node-live", {
    nodeName: params.nodeName,
    gpuModel: params.gpuModel,
    gpuCount: String(params.gpuCount),
  }, {
    subject: `Your Server is Live: ${params.nodeName}`,
    html,
    text,
  });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send email when removal is scheduled (7 days notice)
 */
export async function sendRemovalScheduledEmail(params: {
  to: string;
  nodeName: string;
  removalDate: string;
}): Promise<void> {
  const safeNodeName = escapeHtml(params.nodeName);
  const safeRemovalDate = escapeHtml(params.removalDate);

  const body = `
    ${emailWarningBox(`<p style="margin: 0; font-size: 15px; color: #92400e;"><strong>Server Removal Scheduled</strong></p>`)}
    ${emailText(`Your request to remove <strong>${safeNodeName}</strong> has been processed.`)}
    ${emailDetailBox(`
      <p style="margin: 0 0 8px 0; font-size: 14px; color: #0b0f1c;"><strong>Scheduled Removal Date:</strong> ${safeRemovalDate}</p>
      <p style="margin: 0; font-size: 13px; color: #92400e;">Because this server has active customers, removal will occur after a 7-day notice period. You'll continue earning revenue until removal.</p>
    `)}
    ${emailText("If you'd like to cancel this removal request, you can do so from your dashboard before the scheduled date.")}
    ${emailButton("View Dashboard", `${APP_URL}/providers/dashboard`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `${params.nodeName} removal scheduled for ${params.removalDate}`, body, portalLabel: "Provider Portal" });

  const text = `Server Removal Scheduled

Your request to remove ${params.nodeName} has been processed.

Scheduled Removal Date: ${params.removalDate}

Because this server has active customers, removal will occur after a 7-day notice period. You'll continue earning revenue until removal.

If you'd like to cancel this removal request, you can do so from your dashboard before the scheduled date.

View your dashboard: ${APP_URL}/providers/dashboard

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("node-removal-scheduled", {
    nodeName: params.nodeName,
    removalDate: params.removalDate,
  }, {
    subject: `Server Removal Scheduled: ${params.nodeName}`,
    html,
    text,
  });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send email to provider when all customers have vacated the server
 */
export async function sendProviderServerVacatedEmail(params: {
  to: string;
  nodeName: string;
  companyName: string;
}): Promise<void> {
  const safeNodeName = escapeHtml(params.nodeName);

  const body = `
    ${emailSuccessBox(`<p style="margin: 0; font-size: 15px; color: #065f46;"><strong>Server Ready for Removal</strong></p>`)}
    ${emailGreeting("there")}
    ${emailText(`All customers have moved their workloads off your server <strong>${safeNodeName}</strong>.`)}
    ${emailText(`You can now proceed with removing the server from the ${getBrandName()} network whenever you're ready.`)}
    ${emailButton("Complete Removal", `${APP_URL}/providers/dashboard`)}
    ${emailMuted(`Simply visit your provider dashboard and complete the removal process. Once removed, the server will no longer be part of the ${getBrandName()} network.`)}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `${params.nodeName} — all customers vacated, ready for removal`, body, portalLabel: "Provider Portal" });

  const text = `Server Ready for Removal

Hi there,

All customers have moved their workloads off your server ${params.nodeName}.

You can now proceed with removing the server from the ${getBrandName()} network whenever you're ready.

Complete the removal: ${APP_URL}/providers/dashboard

Simply visit your provider dashboard and complete the removal process. Once removed, the server will no longer be part of the ${getBrandName()} network.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("provider-server-vacated", {
    nodeName: params.nodeName,
    companyName: params.companyName,
  }, {
    subject: `Server Ready for Removal: ${params.nodeName}`,
    html,
    text,
  });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}
