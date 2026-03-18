import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, getAdmins, addAdmin, removeAdmin, isAdmin, generateAdminToken } from "@/lib/admin";
import { sendEmail } from "@/lib/email";
import { logAdminAdded, logAdminRemoved, logAdminInviteResent, logAdminActivity } from "@/lib/admin-activity";
import { resetAdminPin } from "@/lib/admin-pin";
import { getBrandName } from "@/lib/branding";
import { loadTemplate } from "@/lib/email/template-loader";

const PIN_RESET_ALLOWED_EMAILS = (process.env.PIN_RESET_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function sendAdminInviteEmail(email: string, loginUrl: string, invitedBy: string) {
  const brandName = getBrandName();

  const subject = `You've been invited as an admin - {{brandName}}`;
  const html = `
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
      `;
  const text = `You've been invited to join the {{brandName}} admin dashboard by {{invitedBy}}.\n\nClick the link below to accept the invitation:\n\n{{loginUrl}}\n\nThis link expires in 15 minutes.`;

  const template = await loadTemplate(
    "admin-invite",
    { email, loginUrl, invitedBy, brandName },
    { subject, html, text }
  );

  await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admins = getAdmins();
  const canResetPin = PIN_RESET_ALLOWED_EMAILS.includes(session.email.toLowerCase());
  return NextResponse.json({ admins, canResetPin });
}

export async function POST(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const success = addAdmin(email, session.email);

  if (!success) {
    return NextResponse.json({ error: "Admin already exists" }, { status: 400 });
  }

  // Send invite email to the new admin
  try {
    const loginToken = generateAdminToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/verify?token=${loginToken}`;

    await sendAdminInviteEmail(email, loginUrl, session.email);

    console.log(`Admin invite sent by ${session.email} to ${email}`);
  } catch (error) {
    console.error("Failed to send admin invite email:", error);
    // Don't fail the request if email fails - admin is still added
  }

  // Log admin added
  await logAdminAdded(session.email, email);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();

  // Prevent removing yourself
  if (email.toLowerCase() === session.email.toLowerCase()) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const admins = getAdmins();
  if (admins.length <= 1) {
    return NextResponse.json({ error: "Cannot remove last admin" }, { status: 400 });
  }

  const success = removeAdmin(email);

  if (!success) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  // Log admin removed
  await logAdminRemoved(session.email, email);

  return NextResponse.json({ success: true });
}

// PATCH - Resend invite to an admin
export async function PATCH(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Check if user is actually an admin
  if (!isAdmin(email)) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  try {
    // Generate login token and send email
    const loginToken = generateAdminToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/verify?token=${loginToken}`;

    await sendAdminInviteEmail(email, loginUrl, session.email);

    console.log(`Admin invite resent by ${session.email} to ${email}`);

    // Log invite resent
    await logAdminInviteResent(session.email, email);

    return NextResponse.json({ success: true, message: `Invite sent to ${email}` });
  } catch (error) {
    console.error("Failed to resend admin invite:", error);
    return NextResponse.json({ error: "Failed to send invite email" }, { status: 500 });
  }
}

// PUT - Reset an admin's PIN (restricted to PIN_RESET_ALLOWED_EMAILS env var)
export async function PUT(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!PIN_RESET_ALLOWED_EMAILS.includes(session.email.toLowerCase())) {
    return NextResponse.json({ error: "Not authorized to reset PINs" }, { status: 403 });
  }

  const { email } = await request.json();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  if (!isAdmin(email)) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  await resetAdminPin(email);
  await logAdminActivity(session.email, "admin_pin_set", `Reset PIN for ${email}`, { targetEmail: email });

  return NextResponse.json({ success: true, message: `PIN reset for ${email}. They'll set a new one on next login.` });
}
