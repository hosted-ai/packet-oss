import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import {
  emailLayout, emailButton, emailGreeting, emailText, emailMuted,
  emailInfoBox, emailSignoff, escapeHtml, plainTextFooter,
} from "@/lib/email/utils";
import { loadTemplate } from "@/lib/email/template-loader";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { generateCustomerToken } from "@/lib/customer-auth";
import { getTeamMemberships, acceptTeamInvite } from "@/lib/team-members";
import { logLoginLinkSent } from "@/lib/admin-activity";
import { prisma } from "@/lib/prisma";
import {
  createTeam,
  getDefaultPolicies,
  getRoles,
} from "@/lib/hostedai";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import crypto from "crypto";

function generateSecurePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// Get user's session timeout preference (default 1 hour)
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

// Send access email for team members (no billing portal access)
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

// Send access email for free trial users (no billing portal, focused on Token Factory)
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

export async function POST(request: NextRequest) {
  // Rate limit: 5 requests per minute per IP (stricter for email lookups)
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`account:${ip}`, {
    maxRequests: 5,
    windowMs: 60000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // Find ALL customers by email — a customer may have separate Stripe customers
    // for hourly wallet and monthly subscriptions. We need to find the PRIMARY one
    // (the one with hostedai_team_id, preferring billing_type=hourly).
    const customers = await stripe.customers.list({
      email: email.toLowerCase(),
      limit: 10,
    });

    console.log(`[Account] Email lookup: ${email}, found ${customers.data.length} customers`);

    // Check if email is a direct Stripe customer
    if (customers.data.length > 0) {
      // Find the best customer to use for login:
      // 1. Primary hourly customer with team (most common)
      // 2. Any customer with team and hourly/free/free_trial billing
      // 3. Any customer with team
      // 4. Fall back to first customer
      const customer =
        customers.data.find(c => c.metadata?.hostedai_team_id && c.metadata?.billing_type === "hourly") ||
        customers.data.find(c => c.metadata?.hostedai_team_id && ["free", "free_trial"].includes(c.metadata?.billing_type || "")) ||
        customers.data.find(c => c.metadata?.hostedai_team_id) ||
        customers.data[0];
      const teamId = customer.metadata?.hostedai_team_id;
      const billingType = customer.metadata?.billing_type;

      console.log(`[Account] Customer found: ${customer.id}, teamId: ${teamId}, billingType: ${billingType} (checked ${customers.data.length} customers)`);

      // If customer has no team but is on a paid billing type, provision one now
      // This handles the case where team creation failed during signup but user already topped up
      let resolvedTeamId = teamId;
      if (!resolvedTeamId && billingType && billingType !== "free" && billingType !== "free_trial") {
        const customerEmail = customer.email || email.toLowerCase();
        const customerName = customer.name || customerEmail.split("@")[0];
        console.log(`[Account] Customer ${customer.id} is ${billingType} but has no team — provisioning now`);

        try {
          const generatedPassword = generateSecurePassword();
          const teamName = `${customerName}-${billingType}-${Date.now()}`;
          const [roles, policies] = await Promise.all([getRoles(), getDefaultPolicies()]);
          const team = await createTeam({
            name: teamName,
            description: `${getBrandName()} - ${billingType} (auto-provisioned on login)`,
            color: "#6366F1",
            members: [
              {
                email: customerEmail,
                name: customerName,
                role: roles.teamAdmin,
                send_email_invite: false,
                password: generatedPassword,
                pre_onboard: true,
              },
            ],
            pricing_policy_id: policies.pricing,
            resource_policy_id: policies.resource,
            service_policy_id: policies.service,
            instance_type_policy_id: policies.instanceType,
            image_policy_id: policies.image,
          });
          console.log(`[Account] Created hosted.ai team ${team.id} for ${customer.id}`);

          await stripe.customers.update(customer.id, {
            metadata: {
              ...customer.metadata,
              hostedai_team_id: team.id,
            },
          });
          resolvedTeamId = team.id;
        } catch (teamError) {
          console.error(`[Account] Failed to provision team for ${customer.id}:`, teamError);
          // Continue — still send login email even if team creation fails
        }
      }

      if (resolvedTeamId) {
        // Direct customer with provisioned team - send full access email
        const sessionTimeout = await getSessionTimeout(customer.id);
        const token = generateCustomerToken(email.toLowerCase(), customer.id, sessionTimeout);
        const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

        // Create billing portal session
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customer.id,
          return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        });

        // Send email with access link
        await sendAccessEmail({
          to: email.toLowerCase(),
          customerName: customer.name || email.split("@")[0],
          accountUrl,
          billingUrl: portalSession.url,
        });

        // Log to admin activity
        logLoginLinkSent(email.toLowerCase(), false).catch(() => {});

        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, you will receive access links shortly.",
        });
      } else if (billingType === "free" || billingType === "free_trial") {
        // Free trial customer without provisioned team - send free trial access email
        const sessionTimeout = await getSessionTimeout(customer.id);
        const token = generateCustomerToken(email.toLowerCase(), customer.id, sessionTimeout);
        const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

        // Send free trial access email (no billing portal)
        await sendFreeTrialAccessEmail({
          to: email.toLowerCase(),
          customerName: customer.name || email.split("@")[0],
          accountUrl,
        });

        // Log to admin activity
        logLoginLinkSent(email.toLowerCase(), false).catch(() => {});

        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, you will receive access links shortly.",
        });
      }
    }

    // Check if email is a team member (invited to someone else's account)
    const teamMemberships = await getTeamMemberships(email.toLowerCase());

    if (teamMemberships.length > 0) {
      // User is a team member - send access for first (most recent) membership
      const membership = teamMemberships[0];

      // Get the team owner's customer details
      let ownerCustomer;
      try {
        ownerCustomer = await stripe.customers.retrieve(membership.stripeCustomerId);
      } catch (stripeError: unknown) {
        // Owner's Stripe customer doesn't exist (e.g., switched Stripe accounts)
        console.log(`Team member ${email} has owner customer ${membership.stripeCustomerId} that doesn't exist in Stripe`);
        // Return generic message - don't reveal account status
        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, you will receive access links shortly.",
        });
      }

      if (!ownerCustomer || ("deleted" in ownerCustomer && ownerCustomer.deleted)) {
        // Owner account deleted - still send generic message
        return NextResponse.json({
          success: true,
          message: "If an account exists with this email, you will receive access links shortly.",
        });
      }

      // Generate token with owner's customer ID (team member accesses owner's dashboard)
      // Use owner's session timeout preference
      const sessionTimeout = await getSessionTimeout(membership.stripeCustomerId);
      const token = generateCustomerToken(email.toLowerCase(), membership.stripeCustomerId, sessionTimeout);
      const accountUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

      // Mark as accepted if first login
      if (!membership.acceptedAt) {
        await acceptTeamInvite(membership.id);
      }

      // Send team member access email (no billing portal)
      await sendTeamMemberAccessEmail({
        to: email.toLowerCase(),
        memberName: membership.name || email.split("@")[0],
        teamOwnerName: ownerCustomer.name || "your team",
        accountUrl,
      });

      // Log to admin activity
      logLoginLinkSent(email.toLowerCase(), true).catch(() => {});

      return NextResponse.json({
        success: true,
        message: "If an account exists with this email, you will receive access links shortly.",
      });
    }

    // Not a customer and not a team member - send generic message
    // Log the attempt anyway for admin visibility
    logLoginLinkSent(email.toLowerCase(), false).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, you will receive access links shortly.",
    });
  } catch (error) {
    console.error("Account lookup error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
