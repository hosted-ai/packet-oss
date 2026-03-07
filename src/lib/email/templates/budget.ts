/**
 * Budget Alert Email Templates
 *
 * Sends alerts to customers when they approach or exceed their budget limits.
 */

import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailWarningBox, emailDangerBox, emailMuted, emailSignoff, plainTextFooter } from "../utils";
import { loadTemplate } from "../template-loader";

interface BudgetAlertParams {
  to: string;
  customerName: string;
  percentUsed: number;
  currentSpendCents: number;
  limitCents: number;
  limitType: "daily" | "monthly";
  dashboardUrl: string;
  autoShutdownEnabled: boolean;
  autoShutdownThreshold?: number;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function sendBudgetAlertEmail(params: BudgetAlertParams): Promise<void> {
  const {
    to,
    customerName,
    percentUsed,
    currentSpendCents,
    limitCents,
    limitType,
    dashboardUrl,
    autoShutdownEnabled,
    autoShutdownThreshold,
  } = params;

  const safeCustomerName = escapeHtml(customerName);
  const limitTypeLabel = limitType === "daily" ? "Daily" : "Monthly";
  const currentSpend = formatCurrency(currentSpendCents);
  const limit = formatCurrency(limitCents);

  let alertColor = "#f59e0b";
  let alertTitle = `${limitTypeLabel} Budget: ${percentUsed}% Used`;
  let alertMessage = `You have used ${percentUsed}% of your ${limitTypeLabel.toLowerCase()} budget.`;

  if (percentUsed >= 100) {
    alertColor = "#ef4444";
    alertTitle = `${limitTypeLabel} Budget Limit Reached`;
    alertMessage = `You have reached your ${limitTypeLabel.toLowerCase()} budget limit.`;
  } else if (percentUsed >= 80) {
    alertColor = "#f97316";
    alertTitle = `${limitTypeLabel} Budget: ${percentUsed}% Used`;
    alertMessage = `You are approaching your ${limitTypeLabel.toLowerCase()} budget limit.`;
  }

  const alertBox = percentUsed >= 100
    ? emailDangerBox(`<p style="margin: 0; font-size: 15px; color: #991b1b;"><strong>${alertTitle}</strong></p>`)
    : emailWarningBox(`<p style="margin: 0; font-size: 15px; color: #92400e;"><strong>${alertTitle}</strong></p>`);

  const shutdownWarning = autoShutdownEnabled && autoShutdownThreshold
    ? emailWarningBox(`<p style="margin: 0; color: #92400e; font-size: 14px;">
        <strong>Auto-shutdown is enabled.</strong> Your instances will be automatically stopped when usage reaches ${autoShutdownThreshold}% of your budget limit.
      </p>`)
    : "";

  const shutdownWarningText = autoShutdownEnabled && autoShutdownThreshold
    ? `\n\nAuto-shutdown is enabled. Your instances will be automatically stopped when usage reaches ${autoShutdownThreshold}% of your budget limit.`
    : "";

  const body = `
    ${alertBox}
    ${emailGreeting(safeCustomerName)}
    ${emailText(alertMessage)}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 12px 0; font-size: 14px; color: #5b6476;">Current Spend:</td>
          <td style="padding: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${currentSpend}</td>
        </tr>
        <tr>
          <td style="padding: 0 0 12px 0; font-size: 14px; color: #5b6476;">${limitTypeLabel} Limit:</td>
          <td style="padding: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${limit}</td>
        </tr>
      </table>
      <div style="background: #e4e7ef; border-radius: 4px; height: 8px; overflow: hidden;">
        <div style="background: ${alertColor}; height: 100%; width: ${Math.min(percentUsed, 100)}%; border-radius: 4px;"></div>
      </div>
      <p style="text-align: center; margin: 8px 0 0 0; font-size: 13px; color: #5b6476;">${percentUsed}% used</p>
    </div>
    ${shutdownWarning}
    ${emailButton("Manage Budget Settings", dashboardUrl)}
    ${emailMuted("You can adjust your budget limits, alert thresholds, or enable/disable auto-shutdown from your dashboard.")}
    ${emailSignoff()}
  `;

  const subject = `${alertTitle}`;
  const fallbackHtml = emailLayout({ preheader: `${alertTitle} — ${currentSpend} of ${limit}`, body });
  const fallbackText = `${alertTitle}

Hi ${customerName},

${alertMessage}

Current Spend: ${currentSpend}
${limitTypeLabel} Limit: ${limit}
Usage: ${percentUsed}%
${shutdownWarningText}

Manage your budget settings: ${dashboardUrl}

You can adjust your budget limits, alert thresholds, or enable/disable auto-shutdown from your dashboard.

The ${process.env.NEXT_PUBLIC_BRAND_NAME || "GPU Cloud"} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "budget-alert",
    { customerName: safeCustomerName, alertTitle, alertMessage, currentSpend, limit, percentUsed: String(percentUsed), limitTypeLabel, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function sendAutoShutdownNotificationEmail(params: {
  to: string;
  customerName: string;
  currentSpendCents: number;
  limitCents: number;
  limitType: "daily" | "monthly";
  stoppedInstances: string[];
  dashboardUrl: string;
}): Promise<void> {
  const {
    to,
    customerName,
    currentSpendCents,
    limitCents,
    limitType,
    stoppedInstances,
    dashboardUrl,
  } = params;

  const safeCustomerName = escapeHtml(customerName);
  const limitTypeLabel = limitType === "daily" ? "Daily" : "Monthly";
  const currentSpend = formatCurrency(currentSpendCents);
  const limit = formatCurrency(limitCents);
  const instanceList = stoppedInstances.map(name => `&#8226; ${escapeHtml(name)}`).join("<br>");
  const instanceListText = stoppedInstances.map(name => `- ${name}`).join("\n");

  const body = `
    ${emailDangerBox(`<p style="margin: 0; font-size: 15px; color: #991b1b;"><strong>Instances Stopped - Budget Threshold Reached</strong></p>`)}
    ${emailGreeting(safeCustomerName)}
    ${emailText(`Your GPU instances have been automatically stopped because you reached your ${limitTypeLabel.toLowerCase()} budget threshold.`)}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <p style="margin: 0 0 12px 0; font-weight: 600; font-size: 14px; color: #0b0f1c;">Stopped Instances:</p>
      <p style="margin: 0; color: #5b6476; font-size: 14px;">${instanceList}</p>
    </div>
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 14px; color: #5b6476;">Current Spend:</td>
          <td style="padding: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${currentSpend}</td>
        </tr>
        <tr>
          <td style="font-size: 14px; color: #5b6476;">${limitTypeLabel} Limit:</td>
          <td style="font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${limit}</td>
        </tr>
      </table>
    </div>
    ${emailMuted(`To restart your instances, either increase your budget limit or wait for the next ${limitType === "daily" ? "day" : "billing period"}.`)}
    ${emailButton("Manage Budget Settings", dashboardUrl)}
    ${emailSignoff()}
  `;

  const subject = `GPU instances stopped - ${limitTypeLabel} budget threshold reached`;
  const fallbackHtml = emailLayout({ preheader: `${stoppedInstances.length} instance${stoppedInstances.length > 1 ? "s" : ""} stopped — budget threshold reached`, body });
  const fallbackText = `Instances Auto-Shutdown

Hi ${customerName},

Your GPU instances have been automatically stopped because you reached your ${limitTypeLabel.toLowerCase()} budget threshold.

Stopped Instances:
${instanceListText}

Current Spend: ${currentSpend}
${limitTypeLabel} Limit: ${limit}

To restart your instances, either increase your budget limit or wait for the next ${limitType === "daily" ? "day" : "billing period"}.

Manage your budget settings: ${dashboardUrl}

The ${process.env.NEXT_PUBLIC_BRAND_NAME || "GPU Cloud"} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "auto-shutdown",
    { customerName: safeCustomerName, currentSpend, limit, limitTypeLabel, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}

export async function sendNegativeBalanceShutdownEmail(params: {
  to: string;
  customerName: string;
  balanceOwedCents: number;
  podsTerminated: number;
  volumesDeleted: number;
  dashboardUrl: string;
}): Promise<void> {
  const {
    to,
    customerName,
    balanceOwedCents,
    podsTerminated,
    volumesDeleted,
    dashboardUrl,
  } = params;

  const safeCustomerName = escapeHtml(customerName);
  const balanceOwed = formatCurrency(balanceOwedCents);

  const body = `
    ${emailDangerBox(`<p style="margin: 0; font-size: 15px; color: #991b1b;"><strong>Account Resources Terminated</strong></p>`)}
    ${emailGreeting(safeCustomerName)}
    ${emailText("Your account balance has gone negative. To prevent further charges, we have terminated your active resources.")}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 0 0 12px 0; font-size: 14px; color: #5b6476;">Balance Owed:</td>
          <td style="padding: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #ef4444; text-align: right;">${balanceOwed}</td>
        </tr>
        ${podsTerminated > 0 ? `
        <tr>
          <td style="padding: 0 0 12px 0; font-size: 14px; color: #5b6476;">GPU Pods Terminated:</td>
          <td style="padding: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${podsTerminated}</td>
        </tr>
        ` : ""}
        ${volumesDeleted > 0 ? `
        <tr>
          <td style="font-size: 14px; color: #5b6476;">Storage Volumes Deleted:</td>
          <td style="font-size: 14px; font-weight: 600; color: #0b0f1c; text-align: right;">${volumesDeleted}</td>
        </tr>
        ` : ""}
      </table>
    </div>
    ${emailDangerBox(`<p style="margin: 0; color: #991b1b; font-size: 14px;">
      <strong>Important:</strong> Any data stored on deleted volumes has been permanently removed. To continue using the platform, please add funds to your wallet.
    </p>`)}
    ${emailButton("Add Funds to Wallet", dashboardUrl)}
    ${emailMuted(`If you believe this was an error, please contact support at ${process.env.SUPPORT_EMAIL || "support@example.com"}`)}
    ${emailSignoff()}
  `;

  const subject = "Account resources terminated - Negative balance";
  const fallbackHtml = emailLayout({ preheader: `Account balance negative — ${podsTerminated} pod${podsTerminated !== 1 ? "s" : ""} terminated`, body });
  const fallbackText = `Account Resources Terminated

Hi ${customerName},

Your account balance has gone negative. To prevent further charges, we have terminated your active resources.

Balance Owed: ${balanceOwed}
${podsTerminated > 0 ? `GPU Pods Terminated: ${podsTerminated}` : ""}
${volumesDeleted > 0 ? `Storage Volumes Deleted: ${volumesDeleted}` : ""}

Important: Any data stored on deleted volumes has been permanently removed. To continue using the platform, please add funds to your wallet.

Add funds: ${dashboardUrl}

If you believe this was an error, please contact support at ${process.env.SUPPORT_EMAIL || "support@example.com"}

The ${process.env.NEXT_PUBLIC_BRAND_NAME || "GPU Cloud"} Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "negative-balance",
    { customerName: safeCustomerName, balanceOwed, dashboardUrl, podsTerminated: String(podsTerminated), volumesDeleted: String(volumesDeleted) },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}
