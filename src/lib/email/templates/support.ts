import { sendEmail } from "../client";
import { escapeHtml, emailLayout, emailGreeting, emailText, emailButtonTeal, emailSignoff, plainTextFooter } from "../utils";
import { loadTemplate } from "../template-loader";

export async function sendSupportReplyNotification(params: {
  to: string;
  customerName: string;
  ticketTitle: string;
  messagePreview: string;
  dashboardUrl: string;
}) {
  const { to, customerName, ticketTitle, messagePreview, dashboardUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const safeTicketTitle = escapeHtml(ticketTitle);
  const safeMessagePreview = escapeHtml(messagePreview);

  const body = `
    ${emailGreeting(safeCustomerName)}
    ${emailText("Our support team has replied to your ticket:")}
    <div style="background-color: #f7f8fb; border: 1px solid #e4e7ef; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #18b6a8;">
      <p style="margin: 0 0 8px 0; font-weight: 600; color: #0b0f1c;">${safeTicketTitle}</p>
      <p style="margin: 0; font-size: 14px; color: #5b6476;">${safeMessagePreview}</p>
    </div>
    ${emailButtonTeal("View Full Conversation", dashboardUrl)}
    ${emailText('You can reply directly from your dashboard or respond to this email.')}
    ${emailSignoff()}
  `;

  const subject = `New reply to your support ticket: ${ticketTitle}`;
  const fallbackHtml = emailLayout({ preheader: `New reply on "${ticketTitle}"`, body });
  const fallbackText = `Hi ${customerName},

Our support team has replied to your ticket:

${ticketTitle}
"${messagePreview}"

View the full conversation in your dashboard: ${dashboardUrl}

You can reply directly from your dashboard or respond to this email.

The GPU Cloud Team
${plainTextFooter()}`;

  const template = await loadTemplate(
    "support-reply",
    { customerName: safeCustomerName, ticketTitle: safeTicketTitle, messagePreview: safeMessagePreview, dashboardUrl },
    { subject, html: fallbackHtml, text: fallbackText }
  );

  await sendEmail({ to, subject: template.subject, html: template.html, text: template.text });
}
