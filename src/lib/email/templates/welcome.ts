import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButtonTeal, emailInfoBox, emailSignoff, plainTextFooter } from "../utils";
import { loadTemplate } from "../template-loader";
import { getBrandName } from "@/lib/branding";

export async function sendWelcomeEmail(params: {
  to: string;
  customerName: string;
  productName: string;
  dashboardUrl: string;
  walletBalance?: string;
}) {
  const { to, customerName, productName, dashboardUrl, walletBalance } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safeProductName = escapeHtml(productName);
  const safeWalletBalance = walletBalance ? escapeHtml(walletBalance) : null;

  const walletLine = safeWalletBalance
    ? `Your wallet has been funded with <strong>${safeWalletBalance}</strong>.`
    : "";
  const walletLineText = safeWalletBalance
    ? `Your wallet has been funded with ${safeWalletBalance}.`
    : "";
  const subject = safeWalletBalance
    ? `Your ${safeWalletBalance} GPU wallet is ready — launch your ${safeProductName}`
    : `Your ${getBrandName()} GPU account is ready`;

  const body = `
    ${emailGreeting("{{customerName}}")}
    ${emailText(`Your <strong>{{productName}}</strong> account has been set up. ${walletLine} Your GPU resources are provisioned and ready for use.`)}
    ${emailText("Click below to launch your GPU:")}
    ${emailButtonTeal("Launch Your GPU", "{{dashboardUrl}}")}
    ${emailInfoBox(`<p style="margin: 0; font-size: 14px; color: #0b0f1c;">
      ${safeWalletBalance
        ? `<strong>Your balance:</strong> ${safeWalletBalance} — ready to launch a <strong>${safeProductName}</strong> GPU.`
        : `<strong>Next step:</strong> Launch a <strong>${safeProductName}</strong> GPU from your dashboard.`}
    </p>`)}
    ${emailText('Questions? Reply to this email and our team will help you.')}
    ${emailSignoff()}
  `;

  const template = await loadTemplate(
    "welcome",
    {
      customerName: safeCustomerName,
      productName: safeProductName,
      dashboardUrl,
      walletBalance: safeWalletBalance || "",
      walletLine,
    },
    {
      subject,
      html: emailLayout({ preheader: safeWalletBalance ? `Your ${safeWalletBalance} wallet is ready` : "Your GPU account is ready", body }),
      text: `Hi {{customerName}},

Your {{productName}} account has been set up. ${walletLineText} Your GPU resources are provisioned and ready for use.

Launch your GPU: {{dashboardUrl}}

${safeWalletBalance
    ? `Your balance: ${safeWalletBalance} — ready to launch a ${safeProductName} GPU.`
    : `Next step: Launch a ${safeProductName} GPU from your dashboard.`}

Questions? Reply to this email and our team will help you.

The ${getBrandName()} Team
${plainTextFooter()}`,
    }
  );

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}
