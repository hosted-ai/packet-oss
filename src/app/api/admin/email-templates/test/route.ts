import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { sendEmailDirect } from "@/lib/email/client";

/**
 * POST /api/admin/email-templates/test
 * Sends a test email to the admin's own address to verify email configuration.
 */
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminEmail = session.email;
  if (!adminEmail) {
    return NextResponse.json(
      { error: "No email address found in your admin session" },
      { status: 400 }
    );
  }

  try {
    await sendEmailDirect({
      to: adminEmail,
      subject: "Test Email — Your email configuration is working",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a4fff;">Email Configuration Test</h2>
  <p>This is a test email from your admin panel. If you're reading this, your email settings are configured correctly.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 13px;">Sent from the Email Templates admin panel.</p>
</body>
</html>`,
      text: "Email Configuration Test\n\nThis is a test email from your admin panel. If you're reading this, your email settings are configured correctly.",
    });

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${adminEmail}`,
      recipient: adminEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send test email";

    // Surface actionable errors
    if (message.includes("not configured") || message.includes("SMTP")) {
      return NextResponse.json(
        { error: "Email not configured. Set up SMTP in Platform Settings first." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: `Email delivery failed: ${message}` },
      { status: 500 }
    );
  }
}
