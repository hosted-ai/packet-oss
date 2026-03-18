/**
 * Email Template Defaults
 *
 * Central registry of code-based fallback renderers for every email template slug.
 * Used by the admin Email Templates tab to pre-fill the editor with the actual
 * fallback HTML/text that would be sent when no database template exists.
 *
 * Each renderer builds the same HTML that the corresponding route file builds,
 * but uses {{variable}} placeholders instead of real values so the admin can
 * see (and customise) the template structure.
 */

import {
  emailLayout,
  emailButton,
  emailGreeting,
  emailText,
  emailMuted,
  emailInfoBox,
  emailSignoff,
  plainTextFooter,
} from "@/lib/email/utils";

export interface TemplateDefault {
  subject: string;
  html: string;
  text: string;
}

type DefaultRenderer = () => TemplateDefault;

// ---------------------------------------------------------------------------
// Renderer map — one entry per slug
// ---------------------------------------------------------------------------

const renderers: Record<string, DefaultRenderer> = {

  // ── Customer Login ────────────────────────────────────────────────────────
  "customer-login": () => ({
    subject: "Your {{brandName}} login link",
    html: emailLayout({
      preheader: "Your login link for {{brandName}}",
      body: `
      ${emailGreeting("{{customerName}}")}
      ${emailText("Here is your login link for {{brandName}}:")}
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
      ${emailMuted('This link expires in 1 hour. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>')}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
    }),
    text: `Hi {{customerName}},

Here is your login link for {{brandName}}:

Open Dashboard: {{accountUrl}}

From your dashboard you can:
- Access your GPU dashboard
- Check wallet balance and usage
- View payments and invoices

Manage billing: {{billingUrl}}

This link expires in 1 hour. Request a new one at {{dashboardUrl}}/account
${plainTextFooter()}`,
  }),

  // ── Free Trial Login ──────────────────────────────────────────────────────
  "free-trial-login": () => ({
    subject: "Your {{brandName}} login link",
    html: emailLayout({
      preheader: "Your login link for {{brandName}}",
      body: `
      ${emailGreeting("{{customerName}}")}
      ${emailText("Here is your login link for {{brandName}}:")}
      ${emailButton("Open Dashboard", "{{accountUrl}}")}
      ${emailText("From your dashboard you can:")}
      <ul style="font-size: 15px; line-height: 1.8; color: #0b0f1c; padding-left: 20px; margin: 0 0 16px 0;">
        <li>Use Token Factory for LLM inference</li>
        <li>Create and manage your API keys</li>
        <li>Run batch processing jobs</li>
      </ul>
      ${emailMuted("Need dedicated GPU instances? Add funds from the Billing tab in your dashboard.")}
      ${emailMuted('This link expires in 1 hour. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>')}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
    }),
    text: `Hi {{customerName}},

Here is your login link for {{brandName}}:

Open Dashboard: {{accountUrl}}

From your dashboard you can:
- Use Token Factory for LLM inference
- Create and manage your API keys
- Run batch processing jobs

Need dedicated GPU instances? Add funds from the Billing tab in your dashboard.

This link expires in 1 hour. Request a new one at {{dashboardUrl}}/account
${plainTextFooter()}`,
  }),

  // ── Team Member Login ─────────────────────────────────────────────────────
  "team-member-login": () => ({
    subject: "Your {{brandName}} login link",
    html: emailLayout({
      preheader: "Your login link for {{brandName}}",
      body: `
      ${emailGreeting("{{memberName}}")}
      ${emailText("Here is your login link for {{brandName}}:")}
      ${emailButton("Open Team Dashboard", "{{accountUrl}}")}
      ${emailInfoBox(`
        <p style="margin: 0; font-size: 14px; color: #0b0f1c;">
          <strong>Team:</strong> {{teamOwnerName}}'s workspace<br>
          You have team member access to this {{brandName}} dashboard.
        </p>
      `)}
      ${emailMuted('This link expires in {{expiryText}}. Request a new one at <a href="{{dashboardUrl}}/account" style="color: #1a4fff;">{{dashboardUrl}}/account</a>')}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
    }),
    text: `Hi {{memberName}},

Here is your login link for {{brandName}}:

Open Team Dashboard: {{accountUrl}}

Team: {{teamOwnerName}}'s workspace
You have team member access to this {{brandName}} dashboard.

This link expires in {{expiryText}}. Request a new one at {{dashboardUrl}}/account

Did not request this? You can ignore this email.
${plainTextFooter()}`,
  }),

  // ── Team Member Invite ────────────────────────────────────────────────────
  "team-member-invite": () => ({
    subject: "{{inviterName}} invited you to {{brandName}}",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #000; margin: 0; font-size: 28px;">{{brandName}}</h1>
          </div>

          <h2 style="color: #000; font-size: 22px;">You're invited!</h2>

          <p style="font-size: 16px;">{{inviterName}} ({{inviterEmail}}) has invited you to join their team on {{brandName}}.</p>

          <p style="font-size: 15px;">As a team member, you'll be able to:</p>
          <ul style="font-size: 15px; color: #555; padding-left: 20px;">
            <li>View and manage GPU instances</li>
            <li>Access the team dashboard</li>
            <li>Monitor usage and activity</li>
          </ul>

          <div style="text-align: center; margin: 30px 0;">
            <a href="{{dashboardUrl}}" style="display: inline-block; background: linear-gradient(135deg, #9b51e0 0%, #7c3aed 100%); color: #fff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Accept Invitation
            </a>
          </div>

          <div style="background: #f8f8f8; border-radius: 8px; padding: 16px; margin: 25px 0;">
            <p style="margin: 0; font-size: 14px; color: #666;">
              <strong>Team:</strong> {{teamOwnerName}}'s workspace<br>
              <strong>Billing:</strong> All usage is billed to the team owner
            </p>
          </div>

          <p style="color: #888; font-size: 14px;">
            This invitation link is valid for 1 hour. After that, just ask your team admin to resend it.
          </p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

          <p style="color: #999; font-size: 13px; text-align: center;">
            Didn't expect this email? Someone may have entered your email by mistake. You can safely ignore it.
          </p>

          <p style="color: #999; font-size: 13px; text-align: center; margin-top: 15px;">
            <strong>The {{brandName}} Team</strong>
          </p>
        </body>
      </html>
    `,
    text: `You're invited!

{{inviterName}} ({{inviterEmail}}) has invited you to join their team on {{brandName}}.

As a team member, you'll be able to:
- View and manage GPU instances
- Access the team dashboard
- Monitor usage and activity

Accept Invitation: {{dashboardUrl}}

Team: {{teamOwnerName}}'s workspace
Billing: All usage is billed to the team owner

This invitation link is valid for 1 hour. After that, just ask your team admin to resend it.

Didn't expect this email? Someone may have entered your email by mistake. You can safely ignore it.

The {{brandName}} Team`,
  }),

  // ── Admin Login ───────────────────────────────────────────────────────────
  "admin-login": () => ({
    subject: "Admin Login - {{brandName}}",
    html: emailLayout({
      preheader: "Your admin login link",
      portalLabel: "Admin Portal",
      body: `
      ${emailText("Click the button below to log in to the admin dashboard:")}
      ${emailButton("Log In to Admin", "{{loginUrl}}")}
      ${emailMuted("This link expires in 15 minutes. If you didn't request this, ignore this email.")}
      ${emailSignoff()}
    `,
    }),
    text: `Log in to {{brandName}} Admin:\n\n{{loginUrl}}\n\nThis link expires in 15 minutes.${plainTextFooter()}`,
  }),

  // ── Admin Invite ──────────────────────────────────────────────────────────
  "admin-invite": () => ({
    subject: "You've been invited as an admin - {{brandName}}",
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #000; margin: 0;">{{brandName}} Admin</h1>
            </div>

            <p>You've been invited to join the {{brandName}} admin dashboard by {{invitedBy}}.</p>

            <p>Click the button below to accept the invitation and log in:</p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="{{loginUrl}}" style="display: inline-block; background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 500;">
                Accept Invitation
              </a>
            </div>

            <p style="color: #666; font-size: 14px;">
              This link expires in 15 minutes. If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </body>
        </html>
      `,
    text: `You've been invited to join the {{brandName}} admin dashboard by {{invitedBy}}.\n\nClick the link below to accept the invitation:\n\n{{loginUrl}}\n\nThis link expires in 15 minutes.`,
  }),

  // ── Investor Invite ───────────────────────────────────────────────────────
  "investor-invite": () => ({
    subject: "You've been invited to the {{brandName}} Investor Dashboard",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #000; margin: 0;">{{brandName}} Investor Dashboard</h1>
          </div>

          <p>You've been invited by <strong>{{invitedBy}}</strong> to access the {{brandName}} Investor Dashboard.</p>

          <p>Click the button below to log in and view real-time business metrics:</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="{{loginUrl}}" style="display: inline-block; background-color: #6366f1; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Access Investor Dashboard
            </a>
          </div>

          <p style="color: #666; font-size: 14px;">
            This link expires in 24 hours. You can always request a new login link at the investor login page.
          </p>
        </body>
      </html>
    `,
    text: `You've been invited to the {{brandName}} Investor Dashboard by {{invitedBy}}.\n\nAccess the dashboard: {{loginUrl}}\n\nThis link expires in 24 hours.`,
  }),

  // ── Investor Login ────────────────────────────────────────────────────────
  "investor-login": () => ({
    subject: "Investor Dashboard Login - {{brandName}}",
    html: emailLayout({
      preheader: "Your investor dashboard login link",
      portalLabel: "Investor Portal",
      body: `
        ${emailText("Click the button below to log in to the investor dashboard:")}
        ${emailButton("Log In to Dashboard", "{{loginUrl}}")}
        ${emailMuted("This link expires in 15 minutes. If you didn't request this, ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Log in to {{brandName}} Investor Dashboard:\n\n{{loginUrl}}\n\nThis link expires in 15 minutes.${plainTextFooter()}`,
  }),

  // ── Tenant Admin Login ────────────────────────────────────────────────────
  "tenant-admin-login": () => ({
    subject: "Admin Login - {{tenantBrandName}}",
    html: emailLayout({
      preheader: "Your {{tenantBrandName}} admin login link",
      body: `
        ${emailText('Click the button below to access the <strong>{{tenantBrandName}}</strong> admin portal:')}
        ${emailButton("Log In to Admin Portal", "{{setupUrl}}")}
        ${emailMuted("This link expires in 24 hours. If you didn't request this, ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Log in to {{tenantBrandName}} Admin Portal:\n\n{{setupUrl}}\n\nThis link expires in 24 hours.${plainTextFooter(true)}`,
  }),

  // ── Tenant Customer Login ─────────────────────────────────────────────────
  "tenant-customer-login": () => ({
    subject: "Login - {{tenantBrandName}}",
    html: emailLayout({
      preheader: "Your {{tenantBrandName}} dashboard login link",
      body: `
        ${emailText('Click the button below to access your <strong>{{tenantBrandName}}</strong> dashboard:')}
        ${emailButton("Log In to Dashboard", "{{loginUrl}}")}
        ${emailMuted("This link expires in 24 hours. If you didn't request this, ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Log in to your {{tenantBrandName}} dashboard:\n\n{{loginUrl}}\n\nThis link expires in 24 hours.${plainTextFooter(true)}`,
  }),

  // ── Tenant Customer Welcome ───────────────────────────────────────────────
  "tenant-customer-welcome": () => ({
    subject: "Welcome to {{tenantBrandName}}",
    html: emailLayout({
      preheader: "Welcome to {{tenantBrandName}}",
      body: `
        ${emailText('Welcome to <strong>{{tenantBrandName}}</strong>! Your account has been created.')}
        ${emailText("Click the button below to access your dashboard:")}
        ${emailButton("Go to Dashboard", "{{loginUrl}}")}
        ${emailMuted("This link expires in 24 hours.")}
        ${emailSignoff()}
      `,
    }),
    text: `Welcome to {{tenantBrandName}}!\n\nYour account has been created. Access your dashboard:\n\n{{loginUrl}}\n\nThis link expires in 24 hours.${plainTextFooter(true)}`,
  }),

  // ── Widget Login ──────────────────────────────────────────────────────────
  "widget-login": () => ({
    subject: "Your {{tenantBrandName}} login link",
    html: emailLayout({
      preheader: "Your login link for {{tenantBrandName}}",
      body: `
        ${emailGreeting("{{customerName}}")}
        ${emailText("Here is your login link for {{tenantBrandName}}:")}
        ${emailButton("Open Dashboard", "{{loginUrl}}")}
        ${emailMuted("This link expires in 1 hour. If you did not request this, you can safely ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Hi {{customerName}},

Here is your login link for {{tenantBrandName}}:

Open Dashboard: {{loginUrl}}

This link expires in 1 hour. If you did not request this, you can safely ignore this email.

The {{tenantBrandName}} Team

---
{{tenantBrandName}} by Hosted AI Inc.
622 North 9th Street, San Jose, CA 95112, USA
This is a transactional email related to your {{tenantBrandName}} account.`,
  }),

  // ── Game Voucher ──────────────────────────────────────────────────────────
  "game-voucher": () => ({
    subject: "Your GPU Tetris Voucher: {{voucherCode}}",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width: 500px; background: linear-gradient(180deg, #1a1a2e 0%, #0f0f18 100%); border-radius: 16px; border: 1px solid #2a2a4a; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #2a2a4a;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #fff;">GPU TETRIS WINNER!</h1>
              <p style="margin: 12px 0 0; color: #888; font-size: 14px;">Congratulations on optimizing your GPUs!</p>
            </td>
          </tr>

          <!-- Voucher Code -->
          <tr>
            <td style="padding: 32px;">
              <div style="background: rgba(34, 197, 94, 0.1); border: 2px solid #22c55e; border-radius: 12px; padding: 24px; text-align: center;">
                <p style="margin: 0 0 12px; color: #22c55e; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Your Voucher Code</p>
                <p style="margin: 0; font-size: 32px; font-weight: 900; font-family: monospace; color: #feca57; letter-spacing: 2px;">{{voucherCode}}</p>
              </div>

              <div style="margin-top: 24px; text-align: center;">
                <p style="margin: 0 0 8px; color: #64ffda; font-size: 24px; font-weight: 700;">\${{creditDollars}} GPU Credits</p>
                <p style="margin: 0; color: #888; font-size: 14px;">Approx. 1 hour of RTX PRO 6000 compute time</p>
              </div>
            </td>
          </tr>

          <!-- How to Use -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <div style="background: #0a0a0f; border-radius: 8px; padding: 20px;">
                <p style="margin: 0 0 12px; color: #fff; font-weight: 600;">How to use your voucher:</p>
                <ol style="margin: 0; padding-left: 20px; color: #aaa; font-size: 14px; line-height: 1.8;">
                  <li>Sign up at <a href="{{dashboardUrl}}/checkout" style="color: #64ffda;">{{brandName}}</a></li>
                  <li>Enter your voucher code at checkout</li>
                  <li>Or add it in Dashboard > Billing > Add Voucher</li>
                </ol>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="{{dashboardUrl}}/checkout" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #e94560, #ff6b6b); color: #fff; text-decoration: none; font-weight: 700; border-radius: 8px; font-size: 16px;">Start Using GPUs</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #2a2a4a; text-align: center;">
              <p style="margin: 0 0 8px; color: #666; font-size: 12px;">Expires: {{expiresDate}}</p>
              <p style="margin: 0; color: #666; font-size: 12px;">Questions? Reply to this email or contact {{supportEmail}}</p>
            </td>
          </tr>
        </table>

        <p style="margin: 24px 0 0; color: #444; font-size: 12px;">
          <a href="{{appUrl}}" style="color: #666;">{{brandName}}</a> - GPU Infrastructure for AI
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`,
    text: `GPU TETRIS WINNER!

Congratulations on optimizing your GPUs!

YOUR VOUCHER CODE: {{voucherCode}}

Value: \${{creditDollars}} GPU Credits (Approx. 1 hour of RTX PRO 6000 compute time)

HOW TO USE:
1. Sign up at {{dashboardUrl}}/checkout
2. Enter your voucher code at checkout
3. Or add it in Dashboard > Billing > Add Voucher

Expires: {{expiresDate}}

Questions? Contact {{supportEmail}}

---
{{brandName}} - GPU Infrastructure for AI
{{appUrl}}
`,
  }),

  // ── Quote Request Notification (Internal) ─────────────────────────────────
  "quote-request-notification": () => ({
    subject: "New Quote Request: {{gpuCount}}x {{gpuType}} - {{quoteNumber}}",
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 10px 0; color: #1e293b;">New Quote Request</h2>
              <p style="margin: 0; color: #64748b;">Quote #{{quoteNumber}}</p>
            </div>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Contact Information</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 120px;">Name:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">{{name}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Email:</td>
                <td style="padding: 8px 0;"><a href="mailto:{{email}}" style="color: #6366f1;">{{email}}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Company:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{company}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Phone:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{phone}}</td>
              </tr>
            </table>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-top: 30px;">GPU Requirements</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 120px;">GPU Type:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">{{gpuType}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Quantity:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{gpuCount}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Preferred Location:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{location}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Commitment:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{commitmentMonths}} months</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Target Budget:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">{{budget}}</td>
              </tr>
            </table>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-top: 30px;">Additional Requirements</h3>
            <div style="background-color: #f8fafc; border-radius: 6px; padding: 15px; white-space: pre-wrap;">{{requirements}}</div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
              <a href="{{adminUrl}}" style="display: inline-block; background-color: #6366f1; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
                View in Admin Dashboard
              </a>
            </div>

            <div style="margin-top: 20px; padding: 15px; background-color: #f0fdf4; border-radius: 6px; border: 1px solid #bbf7d0;">
              <p style="margin: 0; color: #166534; font-size: 13px;">
                <strong>Payment Methods:</strong> We accept credit cards, bank transfers, and crypto payments.
              </p>
            </div>

            <div style="margin-top: 20px; color: #64748b; font-size: 12px;">
              <p>This request was submitted via <a href="{{appUrl}}/request-quote" style="color: #6366f1;">{{brandName}}/request-quote</a></p>
            </div>
          </body>
        </html>
      `,
    text: `New Quote Request - {{quoteNumber}}

Contact Information:
- Name: {{name}}
- Email: {{email}}
- Company: {{company}}
- Phone: {{phone}}

GPU Requirements:
- GPU Type: {{gpuType}}
- Quantity: {{gpuCount}}
- Preferred Location: {{location}}
- Commitment: {{commitmentMonths}} months
- Target Budget: {{budget}}

Additional Requirements:
{{requirements}}

Payment Methods: We accept credit cards, bank transfers, and crypto payments.

View in admin: {{adminUrl}}`,
  }),

  // ── Cluster Inquiry Notification (Internal) ───────────────────────────────
  "cluster-inquiry-notification": () => ({
    subject: "Cluster Inquiry: {{offerName}}",
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 10px 0; color: #1e293b;">New Cluster Inquiry</h2>
              <p style="margin: 0; color: #64748b;">From {{brandName}} Clusters Page</p>
            </div>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Contact Information</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 120px;">Name:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">{{name}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Email:</td>
                <td style="padding: 8px 0;"><a href="mailto:{{email}}" style="color: #6366f1;">{{email}}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Company:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{company}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Phone:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{phone}}</td>
              </tr>
            </table>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-top: 30px;">Cluster Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 120px;">Cluster:</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">{{offerName}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">GPU Type:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{gpuDescription}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Location:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{location}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Min Commit:</td>
                <td style="padding: 8px 0; color: #1e293b;">{{minimumCommitment}}</td>
              </tr>
            </table>

            <h3 style="color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-top: 30px;">Message</h3>
            <div style="background-color: #f8fafc; border-radius: 6px; padding: 15px; white-space: pre-wrap;">{{message}}</div>

            <div style="margin-top: 20px; padding: 15px; background-color: #f0fdf4; border-radius: 6px; border: 1px solid #bbf7d0;">
              <p style="margin: 0; color: #166534; font-size: 13px;">
                <strong>Payment Methods:</strong> We accept credit cards, bank transfers, and crypto payments.
              </p>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">
              <p>Inquiry submitted via <a href="{{appUrl}}/clusters" style="color: #6366f1;">{{brandName}}/clusters</a></p>
              <p>Offer ID: {{offerId}}</p>
            </div>
          </body>
        </html>
      `,
    text: `New Cluster Inquiry from {{brandName}}

Contact Information:
- Name: {{name}}
- Email: {{email}}
- Company: {{company}}
- Phone: {{phone}}

Cluster Details:
- Cluster: {{offerName}}
- GPU: {{gpuDescription}}
- Location: {{location}}
- Min Commitment: {{minimumCommitment}}

Message:
{{message}}

Payment Methods: We accept credit cards, bank transfers, and crypto payments.

---
Offer ID: {{offerId}}`,
  }),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the code-based fallback template for a given slug.
 * Returns null if the slug is not registered in this file.
 */
export function getTemplateDefault(slug: string): TemplateDefault | null {
  const renderer = renderers[slug];
  if (!renderer) return null;
  return renderer();
}

/**
 * List all slugs that have a registered default renderer.
 */
export function getRegisteredDefaultSlugs(): string[] {
  return Object.keys(renderers);
}
