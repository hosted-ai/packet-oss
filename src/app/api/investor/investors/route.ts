import { NextRequest, NextResponse } from "next/server";
import {
  verifyInvestorSessionToken,
  isInvestorOwner,
  getInvestors,
  addInvestor,
  removeInvestor,
  Investor,
  generateInvestorToken,
  getInvestorAssignedNodes,
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
            This link expires in 24 hours. You can always request a new login link at the investor login page.
          </p>
        </body>
      </html>
    `,
    text: `You've been invited to the GPU Cloud Investor Dashboard by ${invitedBy}.\n\nAccess the dashboard: ${loginUrl}\n\nThis link expires in 24 hours.`,
  });
}

// GET - List all investors
export async function GET(request: NextRequest) {
  // Verify investor session
  const sessionToken = request.cookies.get("investor_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await verifyInvestorSessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allInvestors = await getInvestors();
    const isOwner = await isInvestorOwner(session.email);

    // Non-owners only see themselves. Owners see everyone.
    const investors = allInvestors.filter((inv: Investor) => {
      if (isOwner) return true;
      return inv.email.toLowerCase() === session.email.toLowerCase();
    });

    // Return investor list with ownership info and login status
    return NextResponse.json({
      investors: investors.map((inv: Investor) => ({
        email: inv.email,
        addedAt: inv.addedAt,
        isOwner: inv.isOwner || false,
        acceptedAt: inv.acceptedAt || null,
        lastLoginAt: inv.lastLoginAt || null,
      })),
      currentUserIsOwner: isOwner,
    });
  } catch (error) {
    console.error("List investors error:", error);
    return NextResponse.json(
      { error: "Failed to list investors" },
      { status: 500 }
    );
  }
}

// POST - Add a new investor (owner only)
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

  // Only owner can add investors
  if (!(await isInvestorOwner(session.email))) {
    return NextResponse.json(
      { error: "Only the owner can add investors" },
      { status: 403 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const success = await addInvestor(email, session.email);

    if (!success) {
      return NextResponse.json(
        { error: "Investor already exists" },
        { status: 409 }
      );
    }

    // Generate login token and send invite email
    const loginToken = generateInvestorToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/investors/verify?token=${loginToken}`;

    try {
      await sendInvestorInviteEmail(email, loginUrl, session.email);
      console.log(`Investor invite email sent to: ${email} by ${session.email}`);
    } catch (emailError) {
      console.error(`Failed to send investor invite email to ${email}:`, emailError);
      // Don't fail the whole operation if email fails - they're still added
    }

    console.log(`Investor added: ${email} by ${session.email}`);

    return NextResponse.json({
      success: true,
      message: `Investor ${email} added and invite email sent`,
    });
  } catch (error) {
    console.error("Add investor error:", error);
    return NextResponse.json(
      { error: "Failed to add investor" },
      { status: 500 }
    );
  }
}

// DELETE - Remove an investor (owner only)
export async function DELETE(request: NextRequest) {
  // Verify investor session
  const sessionToken = request.cookies.get("investor_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await verifyInvestorSessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only owner can remove investors
  if (!(await isInvestorOwner(session.email))) {
    return NextResponse.json(
      { error: "Only the owner can remove investors" },
      { status: 403 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Cannot remove the owner
    if (await isInvestorOwner(email)) {
      return NextResponse.json(
        { error: "Cannot remove the owner" },
        { status: 400 }
      );
    }

    // Prevent removing investors from a different dashboard
    const myNodes = await getInvestorAssignedNodes(session.email);
    const targetNodes = await getInvestorAssignedNodes(email);
    if (targetNodes.length > 0 && myNodes.length > 0) {
      const myNodeSet = new Set(myNodes);
      const hasOverlap = targetNodes.some((nid) => myNodeSet.has(nid));
      if (!hasOverlap) {
        return NextResponse.json(
          { error: "Cannot remove an investor from a different dashboard" },
          { status: 403 }
        );
      }
    }

    const success = await removeInvestor(email);

    if (!success) {
      return NextResponse.json(
        { error: "Investor not found" },
        { status: 404 }
      );
    }

    console.log(`Investor removed: ${email} by ${session.email}`);

    return NextResponse.json({
      success: true,
      message: `Investor ${email} removed successfully`,
    });
  } catch (error) {
    console.error("Remove investor error:", error);
    return NextResponse.json(
      { error: "Failed to remove investor" },
      { status: 500 }
    );
  }
}
