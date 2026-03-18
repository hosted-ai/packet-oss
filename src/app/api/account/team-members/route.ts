import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { sendEmail, escapeHtml } from "@/lib/email";
import { generateCustomerToken } from "@/lib/customer-auth";
import {
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  isTeamMember,
  ensureOwnerRecord,
} from "@/lib/team-members";
import { getBrandName } from "@/lib/branding";
import { loadTemplate } from "@/lib/email/template-loader";

// Send invite email to new team member
async function sendTeamInviteEmail(params: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  teamOwnerName: string;
  dashboardUrl: string;
}) {
  const { to, inviterName, inviterEmail, teamOwnerName, dashboardUrl } = params;
  const safeInviterName = escapeHtml(inviterName);
  const safeInviterEmail = escapeHtml(inviterEmail);
  const safeTeamOwnerName = escapeHtml(teamOwnerName);
  const brandName = getBrandName();

  const subject = `{{inviterName}} invited you to {{brandName}}`;
  const html = `
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
    `;
  const text = `You're invited!

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

The {{brandName}} Team`;

  const template = await loadTemplate(
    "team-member-invite",
    {
      inviterName: safeInviterName,
      inviterEmail: safeInviterEmail,
      teamOwnerName: safeTeamOwnerName,
      dashboardUrl,
      brandName,
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

// GET - List team members
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer } = auth;

    // Ensure owner record exists
    await ensureOwnerRecord(
      payload.email,
      payload.customerId,
      customer.name || undefined
    );

    // Get all team members
    const members = await getTeamMembers(payload.customerId);

    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        role: m.role,
        invitedAt: m.invitedAt.toISOString(),
        acceptedAt: m.acceptedAt?.toISOString() || null,
        invitedBy: m.invitedBy,
      })),
    });
  } catch (error) {
    console.error("Get team members error:", error);
    return NextResponse.json(
      { error: "Failed to get team members" },
      { status: 500 }
    );
  }
}

// POST - Invite a new team member
export async function POST(request: NextRequest) {
  try {
    console.log("[Team Invite] Starting invite process...");

    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer, teamId } = auth;

    console.log("[Team Invite] Token valid for customer:", payload.customerId);

    const { email, name } = await request.json();
    console.log("[Team Invite] Inviting email:", email, "name:", name);

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Check if already a member
    console.log("[Team Invite] Checking if already a member...");
    if (await isTeamMember(normalizedEmail, payload.customerId)) {
      console.log("[Team Invite] Already a member");
      return NextResponse.json(
        { error: "This email is already a team member" },
        { status: 409 }
      );
    }

    console.log("[Team Invite] Customer name:", customer.name, "metadata:", JSON.stringify(customer.metadata));
    if (!teamId) {
      console.log("[Team Invite] No hostedai_team_id in customer metadata");
      return NextResponse.json(
        { error: "No team associated with this account" },
        { status: 400 }
      );
    }

    // Add the team member to the database
    console.log("[Team Invite] Adding team member to database...");
    const member = await addTeamMember({
      email: normalizedEmail,
      name: name || null,
      stripeCustomerId: payload.customerId,
      invitedBy: payload.email,
    });
    console.log("[Team Invite] Member added with ID:", member.id);

    // Generate a token for the invite link
    // Team members use the same token structure - customerId points to the owner
    const inviteToken = generateCustomerToken(normalizedEmail, payload.customerId);
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${inviteToken}`;
    console.log("[Team Invite] Dashboard URL generated:", dashboardUrl);

    // Send invite email
    console.log("[Team Invite] Sending invite email...");
    await sendTeamInviteEmail({
      to: normalizedEmail,
      inviterName: customer.name || payload.email.split("@")[0],
      inviterEmail: payload.email,
      teamOwnerName: customer.name || payload.email.split("@")[0],
      dashboardUrl,
    });
    console.log("[Team Invite] Invite email sent successfully");

    return NextResponse.json({
      success: true,
      member: {
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        invitedAt: member.invitedAt.toISOString(),
        acceptedAt: null,
        invitedBy: member.invitedBy,
      },
    });
  } catch (error) {
    console.error("Invite team member error:", error);
    // Log more details for debugging
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    return NextResponse.json(
      { error: "Failed to invite team member" },
      { status: 500 }
    );
  }
}

// DELETE - Remove a team member
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("id");

    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID is required" },
        { status: 400 }
      );
    }

    // Remove the team member
    await removeTeamMember(memberId, payload.customerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove team member error:", error);
    return NextResponse.json(
      { error: "Failed to remove team member" },
      { status: 500 }
    );
  }
}
