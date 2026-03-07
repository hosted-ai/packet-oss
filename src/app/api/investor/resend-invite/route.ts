import { NextRequest, NextResponse } from "next/server";
import {
  verifyInvestorSessionToken,
  isInvestorOwner,
  getInvestors,
  generateInvestorToken,
} from "@/lib/investor";
import { sendEmail } from "@/lib/email";

async function sendInvestorInviteEmail(email: string, loginUrl: string, invitedBy: string) {
  await sendEmail({
    to: email,
    subject: "You've been invited to the GPU Cloud Investor Dashboard",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #000; margin: 0;">GPU Cloud Investor Dashboard</h1>
          </div>

          <p>You've been invited by <strong>${invitedBy}</strong> to access the GPU Cloud Investor Dashboard.</p>

          <p>Click the button below to log in and view real-time business metrics:</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="display: inline-block; background-color: #6366f1; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Access Investor Dashboard
            </a>
          </div>

          <p style="color: #666; font-size: 14px;">
            This link expires in 15 minutes. You can always request a new login link at the investor login page.
          </p>
        </body>
      </html>
    `,
    text: `You've been invited to the GPU Cloud Investor Dashboard by ${invitedBy}.\n\nAccess the dashboard: ${loginUrl}\n\nThis link expires in 15 minutes.`,
  });
}

// POST - Resend invite to an existing investor (owner only)
export async function POST(request: NextRequest) {
  // Verify investor session
  const sessionToken = request.cookies.get("investor_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await verifyInvestorSessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only owner can resend invites
  if (!(await isInvestorOwner(session.email))) {
    return NextResponse.json(
      { error: "Only the owner can resend invites" },
      { status: 403 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check if investor exists
    const investors = await getInvestors();
    const investor = investors.find((inv) => inv.email === email);

    if (!investor) {
      return NextResponse.json(
        { error: "Investor not found" },
        { status: 404 }
      );
    }

    // Cannot resend invite to owner
    if (investor.isOwner) {
      return NextResponse.json(
        { error: "Cannot resend invite to the owner" },
        { status: 400 }
      );
    }

    // Generate login token and send invite email
    const loginToken = generateInvestorToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/investors/verify?token=${loginToken}`;

    await sendInvestorInviteEmail(email, loginUrl, session.email);
    console.log(`Investor invite email resent to: ${email} by ${session.email}`);

    return NextResponse.json({
      success: true,
      message: `Invite email resent to ${email}`,
    });
  } catch (error) {
    console.error("Resend invite error:", error);
    return NextResponse.json(
      { error: "Failed to resend invite" },
      { status: 500 }
    );
  }
}
