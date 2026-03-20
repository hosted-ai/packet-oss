/**
 * Shared login email logic for customer accounts.
 *
 * Used by both:
 *   - /api/account (login route) — when user requests a login link
 *   - /api/account/signup (signup route) — when existing user tries to sign up again
 *
 * Resolves the customer's account type and sends the appropriate email template.
 * All email sends are wrapped in try/catch so failures are non-fatal (anti-enumeration).
 */

import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import {
  emailLayout, emailButton, emailGreeting, emailText, emailMuted,
  emailInfoBox, emailSignoff, escapeHtml, plainTextFooter,
} from "@/lib/email/utils";
import { loadTemplate } from "@/lib/email/template-loader";
import { generateCustomerToken } from "@/lib/customer-auth";
import { getTeamMemberships, acceptTeamInvite } from "@/lib/team-members";
import { logLoginLinkSent } from "@/lib/admin-activity";
import { prisma } from "@/lib/prisma";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import type Stripe from "stripe";

// ── Session timeout ──────────────────────────────────────────────────────────

async function getSessionTimeout(stripeCustomerId: string): Promise<number> {
  const settings = await prisma.customerSettings.findUnique({
    where: { stripeCustomerId },
  });
  return settings?.sessionTimeoutHours || 1;
}

function formatExpiryText(hours: number): string {
  if (hours === 1) return "1 hour";
  if (hours === 24) return "24 hours";
  return `${hours} hours`;
}

// ── Email templates ──────────────────────────────────────────────────────────

async function sendAccessEmail(params: {
  to: string;
  customerName: string;
  accountUrl: string;
  billingUrl: string;
}) {
  const { to, customerName, accountUrl, billingUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const brandName = getBrandName();
  const dashboardUrl = getDashboardUrl();

  const subject = `Your {{brandName}} login link`;
  const html = emailLayout({
    preheader: `Your login link for {{brandName}}`,
    body: `
      ${emailGreeting("{{customerName}}")}
      ${emailText(`Here is your login link for {{brandName}}:`)}
      ${emailButton("Open Dashboard", "{{accountUrl}}")}
      ${emailText("From your dashboard you can:")}
      <ul style="font-size: 15px; line-height: 1.8; color: #0b0f1c; padding-left: 20px; margin: 0 0 16px 0;">
        <li>Access your GPU dashboard</li>
        <li>Check wallet balance and usage</li>
        <li>View payments and invoices</li>
      </ul>
      ${emailInfoBox(`
        <p style="margin: 0; font-size: 14px; color: #0b0f1c;">
          <strong>Manage billing:</strong>
          <a href="{{billingUrl}}" style="color: #1a4fff; text-decoration: none;">Open billing portal</a> to update payment methods or view invoices.
        </p>
      `)}
      ${emailMuted(`This link expires in 1 hour. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>`)}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
  });
  const text = `Hi {{customerName}},

Here is your login link for {{brandName}}:

Open Dashboard: {{accountUrl}}

From your dashboard you can:
- Access your GPU dashboard
- Check wallet balance and usage
- View payments and invoices

Manage billing: {{billingUrl}}

This link expires in 1 hour. Request a new one at {{dashboardUrl}}/account
${plainTextFooter()}`;

  const template = await loadTemplate(
    "customer-login",
    {
      customerName: safeCustomerName,
      accountUrl,
      billingUrl,
      brandName,
      dashboardUrl,
    },
    { subject, html, text }
  );

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendFreeTrialAccessEmail(params: {
  to: string;
  customerName: string;
  accountUrl: string;
}) {
  const { to, customerName, accountUrl } = params;
  const safeCustomerName = escapeHtml(customerName);
  const brandName = getBrandName();
  const dashboardUrl = getDashboardUrl();

  const subject = `Your {{brandName}} login link`;
  const html = emailLayout({
    preheader: `Your login link for {{brandName}}`,
    body: `
      ${emailGreeting("{{customerName}}")}
      ${emailText(`Here is your login link for {{brandName}}:`)}
      ${emailButton("Open Dashboard", "{{accountUrl}}")}
      ${emailText("From your dashboard you can:")}
      <ul style="font-size: 15px; line-height: 1.8; color: #0b0f1c; padding-left: 20px; margin: 0 0 16px 0;">
        <li>Use Token Factory for LLM inference</li>
        <li>Create and manage your API keys</li>
        <li>Run batch processing jobs</li>
      </ul>
      ${emailMuted("Need dedicated GPU instances? Add funds from the Billing tab in your dashboard.")}
      ${emailMuted(`This link expires in 1 hour. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>`)}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
  });
  const text = `Hi {{customerName}},

Here is your login link for {{brandName}}:

Open Dashboard: {{accountUrl}}

From your dashboard you can:
- Use Token Factory for LLM inference
- Create and manage your API keys
- Run batch processing jobs

Need dedicated GPU instances? Add funds from the Billing tab in your dashboard.

This link expires in 1 hour. Request a new one at {{dashboardUrl}}/account
${plainTextFooter()}`;

  const template = await loadTemplate(
    "free-trial-login",
    {
      customerName: safeCustomerName,
      accountUrl,
      brandName,
      dashboardUrl,
    },
    { subject, html, text }
  );

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendTeamMemberAccessEmail(params: {
  to: string;
  memberName: string;
  teamOwnerName: string;
  accountUrl: string;
  sessionTimeoutHours?: number;
}) {
  const { to, memberName, teamOwnerName, accountUrl } = params;
  const safeMemberName = escapeHtml(memberName);
  const safeTeamOwnerName = escapeHtml(teamOwnerName);
  const expiryText = formatExpiryText(params.sessionTimeoutHours || 1);
  const brandName = getBrandName();
  const dashboardUrl = getDashboardUrl();

  const subject = `Your {{brandName}} login link`;
  const html = emailLayout({
    preheader: `Your login link for {{brandName}}`,
    body: `
      ${emailGreeting("{{memberName}}")}
      ${emailText(`Here is your login link for {{brandName}}:`)}
      ${emailButton("Open Team Dashboard", "{{accountUrl}}")}
      ${emailInfoBox(`
        <p style="margin: 0; font-size: 14px; color: #0b0f1c;">
          <strong>Team:</strong> {{teamOwnerName}}'s workspace<br>
          You have team member access to this {{brandName}} dashboard.
        </p>
      `)}
      ${emailMuted(`This link expires in {{expiryText}}. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>`)}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
  });
  const text = `Hi {{memberName}},

Here is your login link for {{brandName}}:

Open Team Dashboard: {{accountUrl}}

Team: {{teamOwnerName}}'s workspace
You have team member access to this {{brandName}} dashboard.

This link expires in {{expiryText}}. Request a new one at {{dashboardUrl}}/account

Did not request this? You can ignore this email.
${plainTextFooter()}`;

  const template = await loadTemplate(
    "team-member-login",
    {
      memberName: safeMemberName,
      teamOwnerName: safeTeamOwnerName,
      accountUrl,
      expiryText,
      brandName,
      dashboardUrl,
    },
    { subject, html, text }
  );

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

// ── Main exported function ───────────────────────────────────────────────────

/**
 * Send the appropriate login email for a given email address.
 *
 * Resolves the account type (paid customer, free trial, team member, or unknown)
 * and sends the matching email template. All email sends are wrapped in try/catch
 * so SMTP failures never leak account existence.
 *
 * Returns true if an email was sent (or attempted), false if no account was found.
 */
export async function sendLoginEmailForCustomer(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const stripe = getStripe();

  // Find all Stripe customers matching this email
  const customers = await stripe.customers.list({
    email: normalizedEmail,
    limit: 10,
  });

  if (customers.data.length > 0) {
    // Resolve the best customer (same priority as login route)
    const customer =
      customers.data.find(c => c.metadata?.hostedai_team_id && c.metadata?.billing_type === "hourly") ||
      customers.data.find(c => c.metadata?.hostedai_team_id && ["free", "free_trial"].includes(c.metadata?.billing_type || "")) ||
      customers.data.find(c => c.metadata?.hostedai_team_id) ||
      customers.data[0];

    const teamId = customer.metadata?.hostedai_team_id;
    const billingType = customer.metadata?.billing_type;

    if (teamId) {
      // Paid/provisioned customer — send full access email with billing portal
      const sessionTimeout = await getSessionTimeout(customer.id);
      const token = generateCustomerToken(normalizedEmail, customer.id, sessionTimeout);
      const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      });

      try {
        await sendAccessEmail({
          to: normalizedEmail,
          customerName: customer.name || normalizedEmail.split("@")[0],
          accountUrl,
          billingUrl: portalSession.url,
        });
      } catch (emailError) {
        console.error(`[LoginEmail] Failed to send login email to ${normalizedEmail} (non-fatal):`, emailError);
      }

      logLoginLinkSent(normalizedEmail, false).catch(() => {});
      return true;
    } else if (billingType === "free" || billingType === "free_trial") {
      // Free trial customer — send free trial email (no billing portal)
      const sessionTimeout = await getSessionTimeout(customer.id);
      const token = generateCustomerToken(normalizedEmail, customer.id, sessionTimeout);
      const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

      try {
        await sendFreeTrialAccessEmail({
          to: normalizedEmail,
          customerName: customer.name || normalizedEmail.split("@")[0],
          accountUrl,
        });
      } catch (emailError) {
        console.error(`[LoginEmail] Failed to send free trial login email to ${normalizedEmail} (non-fatal):`, emailError);
      }

      logLoginLinkSent(normalizedEmail, false).catch(() => {});
      return true;
    }
  }

  // Check if email is a team member
  const teamMemberships = await getTeamMemberships(normalizedEmail);

  if (teamMemberships.length > 0) {
    const membership = teamMemberships[0];

    let ownerCustomer: Stripe.Customer | Stripe.DeletedCustomer;
    try {
      ownerCustomer = await stripe.customers.retrieve(membership.stripeCustomerId);
    } catch {
      // Owner's Stripe customer doesn't exist
      return false;
    }

    if (!ownerCustomer || ("deleted" in ownerCustomer && ownerCustomer.deleted)) {
      return false;
    }

    const sessionTimeout = await getSessionTimeout(membership.stripeCustomerId);
    const token = generateCustomerToken(normalizedEmail, membership.stripeCustomerId, sessionTimeout);
    const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

    if (!membership.acceptedAt) {
      await acceptTeamInvite(membership.id);
    }

    try {
      await sendTeamMemberAccessEmail({
        to: normalizedEmail,
        memberName: membership.name || normalizedEmail.split("@")[0],
        teamOwnerName: ownerCustomer.name || "your team",
        accountUrl,
      });
    } catch (emailError) {
      console.error(`[LoginEmail] Failed to send team member login email to ${normalizedEmail} (non-fatal):`, emailError);
    }

    logLoginLinkSent(normalizedEmail, true).catch(() => {});
    return true;
  }

  // No account found
  return false;
}
