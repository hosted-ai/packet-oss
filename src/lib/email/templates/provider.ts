/**
 * Provider Portal Email Templates
 *
 * Login magic links, application status notifications for providers.
 */

import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButton, emailInfoBox, emailSuccessBox, emailDetailBox, emailMuted, emailSignoff, plainTextFooter } from "../utils";
import { getBrandName, getSupportEmail } from "@/lib/branding";
import { loadTemplate } from "../template-loader";

// Re-export functions from split files for backward compatibility
export * from "./provider/node-emails";
export * from "./provider/customer-emails";
export * from "./provider/admin-emails";

/**
 * Send magic link for provider login
 */
export async function sendProviderLoginEmail(params: {
  to: string;
  loginUrl: string;
  companyName: string;
}): Promise<void> {
  const safeCompanyName = escapeHtml(params.companyName);

  const body = `
    ${emailGreeting("there")}
    ${emailText(`Click the button below to access your ${safeCompanyName} provider dashboard:`)}
    ${emailButton("Login to Dashboard", params.loginUrl)}
    ${emailMuted("This link will expire in 15 minutes. If you didn't request this login link, you can safely ignore this email.")}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Login to your ${getBrandName()} provider dashboard`, body, portalLabel: "Provider Portal" });

  const text = `Login to Your Provider Dashboard

Hi there,

Click the link below to access your ${params.companyName} provider dashboard:

${params.loginUrl}

This link will expire in 15 minutes. If you didn't request this login link, you can safely ignore this email.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("provider-login", {
    companyName: params.companyName,
    loginUrl: params.loginUrl,
  }, {
    subject: `Login to ${getBrandName()} Provider Portal`,
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
 * Send welcome email when provider application is submitted
 */
export async function sendProviderApplicationReceivedEmail(params: {
  to: string;
  companyName: string;
  contactName: string;
  applicationType?: string;
}): Promise<void> {
  const safeContactName = escapeHtml(params.contactName);
  const safeCompanyName = escapeHtml(params.companyName);
  const isWhiteLabel = params.applicationType === "white_label";

  const introText = isWhiteLabel
    ? `Thank you for your interest in launching a White Label GPU cloud with ${getBrandName()}! We've received your application for <strong>${safeCompanyName}</strong>.`
    : `Thank you for applying to become a provider on ${getBrandName()}! We've received your application for <strong>${safeCompanyName}</strong>.`;

  const stepsHtml = isWhiteLabel
    ? `<tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">1. Our team will review your application (usually within 24 hours)</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">2. We'll schedule a call to discuss your platform requirements</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">3. We'll set up your branded platform and get you selling GPUs</td></tr>`
    : `<tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">1. Our team will review your application (usually within 24 hours)</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">2. Once approved, you'll receive an email with login instructions</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">3. You can then add your infrastructure and start earning</td></tr>`;

  const stepsText = isWhiteLabel
    ? `1. Our team will review your application (usually within 24 hours)
2. We'll schedule a call to discuss your platform requirements
3. We'll set up your branded platform and get you selling GPUs`
    : `1. Our team will review your application (usually within 24 hours)
2. Once approved, you'll receive an email with login instructions
3. You can then add your infrastructure and start earning`;

  const subject = isWhiteLabel
    ? `White Label Application Received - ${params.companyName}`
    : `Welcome to ${getBrandName()} - Application Received`;

  const body = `
    ${emailGreeting(safeContactName)}
    ${emailText(introText)}
    ${emailInfoBox(`
      <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1e40af;">What happens next?</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        ${stepsHtml}
      </table>
    `)}
    ${emailText('If you have any questions, feel free to reply to this email or contact us at <a href="mailto:${getSupportEmail()}" style="color: #1a4fff;">${getSupportEmail()}</a>.')}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Application received for ${params.companyName}`, body, portalLabel: isWhiteLabel ? "White Label" : "Provider Portal" });

  const text = `${isWhiteLabel ? "White Label Application Received" : `Welcome to ${getBrandName()}!`}

Hi ${params.contactName},

${isWhiteLabel ? `Thank you for your interest in launching a White Label GPU cloud with ${getBrandName()}! We've received your application for ${params.companyName}.` : `Thank you for applying to become a provider on ${getBrandName()}! We've received your application for ${params.companyName}.`}

What happens next?
${stepsText}

If you have any questions, feel free to reply to this email or contact us at ${getSupportEmail()}.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("provider-app-received", {
    contactName: params.contactName,
    companyName: params.companyName,
  }, { subject, html, text });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send email when provider is approved
 */
export async function sendProviderApprovedEmail(params: {
  to: string;
  companyName: string;
  contactName: string;
  loginUrl: string;
  applicationType?: string;
}): Promise<void> {
  const safeContactName = escapeHtml(params.contactName);
  const safeCompanyName = escapeHtml(params.companyName);
  const isWhiteLabel = params.applicationType === "white_label";

  const approvalText = isWhiteLabel
    ? `Great news! Your White Label platform application for <strong>${safeCompanyName}</strong> has been approved.`
    : `Great news! Your provider application for <strong>${safeCompanyName}</strong> has been approved.`;

  const nextStepText = isWhiteLabel
    ? "Our team will be in touch shortly to schedule a setup call. In the meantime, you can access your account:"
    : "You can now access your provider dashboard and start adding your GPU infrastructure:";

  const stepsHtml = isWhiteLabel
    ? `<tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">1. We'll schedule a setup call to discuss branding and domain</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">2. We configure your platform with your branding and domain</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">3. You start selling GPU capacity to your customers</td></tr>`
    : `<tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">1. Click "Add Server" to add your first GPU node</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">2. Provide SSH access for us to verify and provision</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">3. Review and accept the pricing</td></tr>
       <tr><td style="padding: 4px 0; font-size: 14px; color: #0b0f1c;">4. Start earning when customers use your GPUs!</td></tr>`;

  const stepsText = isWhiteLabel
    ? `Next Steps:
1. We'll schedule a setup call to discuss branding and domain
2. We configure your platform with your branding and domain
3. You start selling GPU capacity to your customers`
    : `Getting Started:
1. Click "Add Server" to add your first GPU node
2. Provide SSH access for us to verify and provision
3. Review and accept the pricing
4. Start earning when customers use your GPUs!`;

  const subject = isWhiteLabel
    ? `Your White Label Platform is Approved - ${params.companyName}`
    : `Your ${getBrandName()} Provider Account is Approved!`;

  const body = `
    ${emailSuccessBox(`<p style="margin: 0; font-size: 16px; color: #065f46;"><strong>Your Application is Approved!</strong></p>`)}
    ${emailGreeting(safeContactName)}
    ${emailText(approvalText)}
    ${emailText(nextStepText)}
    ${emailButton(isWhiteLabel ? "View Your Account" : "Go to Provider Dashboard", params.loginUrl)}
    ${emailInfoBox(`
      <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1e40af;">${isWhiteLabel ? "Next Steps" : "Getting Started"}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
        ${stepsHtml}
      </table>
    `)}
    ${emailText('If you have any questions, our team is here to help at <a href="mailto:${getSupportEmail()}" style="color: #1a4fff;">${getSupportEmail()}</a>.')}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Your application for ${params.companyName} has been approved`, body, portalLabel: isWhiteLabel ? "White Label" : "Provider Portal" });

  const text = `Your Application is Approved!

Hi ${params.contactName},

${isWhiteLabel ? `Great news! Your White Label platform application for ${params.companyName} has been approved.` : `Great news! Your provider application for ${params.companyName} has been approved.`}

${isWhiteLabel ? "Our team will be in touch shortly to schedule a setup call. In the meantime, you can access your account:" : "You can now access your provider dashboard and start adding your GPU infrastructure:"}

${params.loginUrl}

${stepsText}

If you have any questions, our team is here to help at ${getSupportEmail()}.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("provider-approved", {
    contactName: params.contactName,
    companyName: params.companyName,
    loginUrl: params.loginUrl,
  }, { subject, html, text });

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Send email when provider application is rejected
 */
export async function sendProviderRejectedEmail(params: {
  to: string;
  companyName: string;
  contactName: string;
  reason?: string;
}): Promise<void> {
  const safeContactName = escapeHtml(params.contactName);
  const safeCompanyName = escapeHtml(params.companyName);
  const safeReason = params.reason ? escapeHtml(params.reason) : "";

  const reasonBlock = safeReason
    ? emailDetailBox(`<p style="margin: 0; font-size: 14px; color: #0b0f1c;"><strong>Reason:</strong> ${safeReason}</p>`)
    : "";

  const body = `
    ${emailGreeting(safeContactName)}
    ${emailText(`Thank you for your interest in becoming a provider on ${getBrandName()}. After reviewing your application for <strong>${safeCompanyName}</strong>, we're unable to approve it at this time.`)}
    ${reasonBlock}
    ${emailText('If you believe this was in error or would like to discuss further, please reply to this email or contact us at <a href="mailto:${getSupportEmail()}" style="color: #1a4fff;">${getSupportEmail()}</a>.')}
    ${emailSignoff()}
  `;

  const html = emailLayout({ preheader: `Update on your ${params.companyName} provider application`, body, portalLabel: "Provider Portal" });

  const text = `Application Update

Hi ${params.contactName},

Thank you for your interest in becoming a provider on ${getBrandName()}. After reviewing your application for ${params.companyName}, we're unable to approve it at this time.

${params.reason ? `Reason: ${params.reason}\n` : ""}
If you believe this was in error or would like to discuss further, please reply to this email or contact us at ${getSupportEmail()}.

The ${getBrandName()} Team
${plainTextFooter()}`;

  const template = await loadTemplate("provider-rejected", {
    contactName: params.contactName,
    companyName: params.companyName,
    reason: params.reason || "",
  }, {
    subject: `${getBrandName()} Provider Application Update`,
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
