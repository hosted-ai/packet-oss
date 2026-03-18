/**
 * Storage Alert Email
 *
 * Sends a warning email when /workspace persistent storage exceeds 80% usage.
 * Sent once per subscription (tracked via PodMetadata.storageAlertSent).
 */

import { sendEmail } from "./client";
import { emailLayout, emailGreeting, emailText, emailWarningBox, emailButton, emailMuted, emailSignoff, plainTextFooter } from "./utils";
import { getStripe } from "@/lib/stripe";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import { loadTemplate } from "./template-loader";

interface StorageAlertParams {
  subscriptionId: string;
  stripeCustomerId: string;
  displayName: string;
  usedMb: number;
  totalMb: number;
  percent: number;
}

export async function sendStorageAlert(params: StorageAlertParams): Promise<void> {
  const { subscriptionId, stripeCustomerId, displayName, usedMb, totalMb, percent } = params;

  let email: string;
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted || !customer.email) {
      console.warn(`[Storage Alert] No email for customer ${stripeCustomerId}`);
      return;
    }
    email = customer.email;
  } catch (err) {
    console.error(`[Storage Alert] Failed to look up customer ${stripeCustomerId}:`, err);
    return;
  }

  const usedGb = (usedMb / 1024).toFixed(1);
  const totalGb = (totalMb / 1024).toFixed(1);
  const pct = Math.round(percent);

  console.log(`[Storage Alert] Sending to ${email} for ${displayName}: ${usedGb}GB / ${totalGb}GB (${pct}%)`);

  const subject = `Storage almost full on "${displayName}" — ${pct}% used`;

  const body = `
    ${emailGreeting("there")}
    ${emailWarningBox(`<p style="margin: 0; font-size: 14px; color: #92400e;">
      <strong>${usedGb} GB</strong> of <strong>${totalGb} GB</strong> used on <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">/workspace</code>
    </p>
    <div style="margin-top: 12px; background: #e4e7ef; border-radius: 4px; height: 8px; overflow: hidden;">
      <div style="background: ${pct >= 90 ? '#ef4444' : '#f59e0b'}; height: 100%; width: ${Math.min(pct, 100)}%; border-radius: 4px;"></div>
    </div>`)}
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #5b6476;">Instance: <strong style="color: #0b0f1c;">${displayName}</strong></p>
    ${emailText("When storage fills up, writes will fail — this can corrupt notebooks, break pip installs, and stop running processes.")}
    ${emailText('To free space, SSH into your instance and run:')}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 6px; padding: 12px; margin: 0 0 20px 0;">
      <code style="font-size: 13px; color: #0b0f1c;">du -sh /workspace/* | sort -rh | head -20</code>
    </div>
    ${emailButton("Open Dashboard", `${getDashboardUrl()}/dashboard`)}
    ${emailMuted("This is a one-time alert. You won't receive another for this instance.")}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `${pct}% storage used on ${displayName}`, body });

  const text = `Storage alert for "${displayName}"

Your persistent storage (/workspace) is ${pct}% full: ${usedGb} GB of ${totalGb} GB used.

When storage fills up, writes will fail — this can corrupt notebooks, break pip installs, and stop running processes.

To free space, SSH into your instance and run:
  du -sh /workspace/* | sort -rh | head -20

Dashboard: ${getDashboardUrl()}/dashboard

This is a one-time alert for this instance.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("storage-alert", {
    displayName,
    usedGb,
    totalGb,
    percent: String(pct),
    dashboardUrl: `${getDashboardUrl()}/dashboard`,
  }, { subject, html, text });

  await sendEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
  console.log(`[Storage Alert] Email sent to ${email} for subscription ${subscriptionId}`);
}
