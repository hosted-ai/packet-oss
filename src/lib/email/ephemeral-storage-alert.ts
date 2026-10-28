/**
 * Ephemeral Storage Alert Email (PA-80)
 *
 * Sends a warning email when a pod's local/ephemeral root disk (the ~150 GB
 * that backs `/`, NOT the persistent `/workspace` mount) crosses 80% and again
 * at 90% usage. When the ephemeral disk fills past its limit, the scheduler
 * evicts the pod — killing running work and losing anything written outside
 * persistent storage.
 *
 * The sibling `storage-alert.ts` covers the persistent `/workspace` volume and
 * is unrelated. Tiering (80 then 90, each once) is tracked via
 * PodMetadata.rootStorageAlertPercent by the caller in metrics/ingest.
 */

import { sendEmail } from "./client";
import { emailLayout, emailGreeting, emailText, emailWarningBox, emailButton, emailMuted, emailSignoff, plainTextFooter } from "./utils";
import { getStripe } from "@/lib/stripe";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import { loadTemplate } from "./template-loader";

interface EphemeralStorageAlertParams {
  subscriptionId: string;
  stripeCustomerId: string;
  displayName: string;
  usedMb: number;
  totalMb: number;
  percent: number;
  tier: 80 | 90; // which threshold triggered this alert
}

export async function sendEphemeralStorageAlert(params: EphemeralStorageAlertParams): Promise<void> {
  const { subscriptionId, stripeCustomerId, displayName, usedMb, totalMb, percent, tier } = params;

  let email: string;
  try {
    const stripe = await getStripe();
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted || !customer.email) {
      console.warn(`[Ephemeral Storage Alert] No email for customer ${stripeCustomerId}`);
      return;
    }
    email = customer.email;
  } catch (err) {
    console.error(`[Ephemeral Storage Alert] Failed to look up customer ${stripeCustomerId}:`, err);
    return;
  }

  const usedGb = (usedMb / 1024).toFixed(1);
  const totalGb = (totalMb / 1024).toFixed(1);
  const pct = Math.round(percent);
  const isCritical = tier >= 90;

  console.log(`[Ephemeral Storage Alert] Sending to ${email} for ${displayName}: ${usedGb}GB / ${totalGb}GB (${pct}%, tier ${tier})`);

  const subject = isCritical
    ? `Critical: local storage ${pct}% full on "${displayName}"`
    : `Local storage almost full on "${displayName}" — ${pct}% used`;

  const body = `
    ${emailGreeting("there")}
    ${emailWarningBox(`<p style="margin: 0; font-size: 14px; color: #92400e;">
      <strong>${usedGb} GB</strong> of <strong>${totalGb} GB</strong> used on the local (ephemeral) disk <code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-size: 13px;">/</code>
    </p>
    <div style="margin-top: 12px; background: #e4e7ef; border-radius: 4px; height: 8px; overflow: hidden;">
      <div style="background: ${isCritical ? '#ef4444' : '#f59e0b'}; height: 100%; width: ${Math.min(pct, 100)}%; border-radius: 4px;"></div>
    </div>`)}
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #5b6476;">Instance: <strong style="color: #0b0f1c;">${displayName}</strong></p>
    ${emailText("Local storage is the disk that backs your instance's operating system and any files you save outside persistent storage. If it fills up, the scheduler will evict your instance — stopping running processes and losing anything not saved to persistent storage.")}
    ${emailText('To see what is using the local disk, SSH into your instance and run:')}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 6px; padding: 12px; margin: 0 0 20px 0;">
      <code style="font-size: 13px; color: #0b0f1c;">du -xsh /* 2>/dev/null | sort -rh | head -20</code>
    </div>
    ${emailText("To free space, clear model/package caches (e.g. ~/.cache/huggingface, ~/.cache/pip) or move large datasets and checkpoints to persistent /workspace storage, which survives restarts.")}
    ${emailButton("Open Dashboard", `${getDashboardUrl()}/dashboard`)}
    ${emailMuted(isCritical
      ? "This is the final alert for this instance — free space now to avoid eviction."
      : "We'll send one more alert if usage passes 90%.")}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `${pct}% local storage used on ${displayName}`, body });

  const text = `${isCritical ? "Critical local storage" : "Local storage"} alert for "${displayName}"

Your local (ephemeral) disk is ${pct}% full: ${usedGb} GB of ${totalGb} GB used.

Local storage backs your instance's operating system and any files saved outside persistent storage. If it fills up, the scheduler will evict your instance — stopping running processes and losing anything not saved to persistent storage.

To see what is using the local disk, SSH into your instance and run:
  du -xsh /* 2>/dev/null | sort -rh | head -20

To free space, clear model/package caches (e.g. ~/.cache/huggingface, ~/.cache/pip) or move large datasets and checkpoints to persistent /workspace storage, which survives restarts.

Dashboard: ${getDashboardUrl()}/dashboard

${isCritical ? "This is the final alert for this instance — free space now to avoid eviction." : "We'll send one more alert if usage passes 90%."}

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("ephemeral-storage-alert", {
    displayName,
    usedGb,
    totalGb,
    percent: String(pct),
    tier: String(tier),
    dashboardUrl: `${getDashboardUrl()}/dashboard`,
  }, { subject, html, text });

  await sendEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
  console.log(`[Ephemeral Storage Alert] Email sent to ${email} for subscription ${subscriptionId}`);
}
