import { sendEmailDirect } from "../client";
import { escapeHtml, emailLayout, emailText, emailDetailBox } from "../utils";
import { getBrandName, getSupportEmail } from "@/lib/branding";
import { loadTemplate } from "../template-loader";

export async function sendContactEmail(params: {
  name: string;
  email: string;
  company?: string;
  message: string;
}) {
  const { name, email, company, message } = params;
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeCompany = company ? escapeHtml(company) : "";
  const safeMessage = escapeHtml(message);

  const body = `
    <h2 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600; color: #0b0f1c;">New Contact Form Submission</h2>
    ${emailDetailBox(`
      <p style="margin: 0 0 10px 0; font-size: 14px; color: #0b0f1c;"><strong>Name:</strong> ${safeName}</p>
      <p style="margin: 0 0 10px 0; font-size: 14px; color: #0b0f1c;"><strong>Email:</strong> <a href="mailto:${safeEmail}" style="color: #1a4fff;">${safeEmail}</a></p>
      ${safeCompany ? `<p style="margin: 0 0 10px 0; font-size: 14px; color: #0b0f1c;"><strong>Company:</strong> ${safeCompany}</p>` : ""}
    `)}
    <div style="background-color: #ffffff; border: 1px solid #e4e7ef; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <p style="margin: 0 0 10px 0; font-weight: 600; color: #5b6476; font-size: 13px;">Message:</p>
      <p style="margin: 0; white-space: pre-wrap; font-size: 14px; color: #0b0f1c;">${safeMessage}</p>
    </div>
    ${emailText(`<span style="font-size: 13px; color: #5b6476;">This message was sent from the ${getBrandName()} contact form.</span>`)}
  `;

  const fallbackSubject = `[${getBrandName()}] New inquiry from ${safeName}${safeCompany ? ` (${safeCompany})` : ""}`;
  const fallbackHtml = emailLayout({ preheader: `New inquiry from ${name}`, body });
  const fallbackText = `New Contact Form Submission from ${getBrandName()}

Name: ${name}
Email: ${email}
${company ? `Company: ${company}\n` : ""}
Message:
${message}

---
Sent from ${getBrandName()} contact form`;

  const template = await loadTemplate("contact-form", {
    name: safeName,
    email: safeEmail,
    company: safeCompany,
    message: safeMessage,
  }, {
    subject: fallbackSubject,
    html: fallbackHtml,
    text: fallbackText,
  });

  await sendEmailDirect({
    to: getSupportEmail(),
    reply_to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}
