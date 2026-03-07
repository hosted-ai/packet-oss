/**
 * Pod Failure Alert Email Template
 *
 * Sends an urgent email to SUPPORT_EMAIL when a customer pod
 * transitions to a failed status, including all relevant debugging info.
 */

import { sendEmailDirect } from "../client";
import {
  escapeHtml,
  emailLayout,
  emailDangerBox,
  emailDetailBox,
  emailText,
  emailDivider,
} from "../utils";

interface PodFailureAlertParams {
  podName: string;
  podStatus: string;
  subscriptionId: string;
  teamId: string;
  customerEmail: string | null;
  poolName: string | null;
  gpuCount: number;
  region: string | null;
  zammadTicketId: number | null;
}

export async function sendPodFailureAlertEmail(
  params: PodFailureAlertParams
): Promise<void> {
  const to = process.env.SUPPORT_EMAIL || "support@example.com";

  const detailRows = [
    ["Pod Name", params.podName],
    ["Pod Status", params.podStatus],
    ["Subscription ID", params.subscriptionId],
    ["Team ID", params.teamId],
    ["Customer Email", params.customerEmail || "unknown"],
    ["Pool / GPU", params.poolName || "unknown"],
    ["GPU Count", String(params.gpuCount)],
    ["Region", params.region || "unknown"],
    ...(params.zammadTicketId
      ? [["Zammad Ticket", `#${params.zammadTicketId}`]]
      : []),
  ];

  const detailHtml = detailRows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding: 6px 12px 6px 0; font-size: 13px; color: #5b6476; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}:</td>
          <td style="padding: 6px 0; font-size: 13px; color: #0b0f1c; font-family: monospace;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("\n");

  const detailText = detailRows
    .map(([label, value]) => `- ${label}: ${value}`)
    .join("\n");

  const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/admin?tab=pods`;

  const body = `
    ${emailDangerBox(`<p style="margin: 0; font-size: 16px; color: #991b1b;"><strong>URGENT: Pod Failed</strong></p>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #991b1b;">A customer pod has entered <strong>${escapeHtml(params.podStatus)}</strong> status and requires immediate attention.</p>`)}
    ${emailDetailBox(`
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        ${detailHtml}
      </table>
    `)}
    ${emailDivider()}
    ${emailText(`<a href="${adminUrl}" style="color: #1a4fff;">View in Admin Panel</a>`)}
  `;

  const html = emailLayout({
    preheader: `URGENT: Pod ${params.podName} failed (${params.customerEmail || "unknown customer"})`,
    body,
    portalLabel: "System Alert",
  });

  const text = `URGENT: Pod Failed
====================================

A customer pod has entered ${params.podStatus} status.

${detailText}

Admin Panel: ${adminUrl}
`;

  await sendEmailDirect({
    to,
    subject: `[URGENT] Pod Failed: ${params.podName} (${params.customerEmail || params.teamId})`,
    html,
    text,
  });
}
