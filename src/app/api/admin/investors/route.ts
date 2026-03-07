import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/lib/admin";
import {
  getInvestors,
  addInvestor,
  removeInvestor,
  setInvestorAssignedNodes,
  setInvestorRevenueShare,
  generateInvestorToken,
  generateAdminLoginAsInvestorToken,
  type Investor,
} from "@/lib/auth/investor";
import { sendEmail } from "@/lib/email";

const addInvestorSchema = z.object({
  email: z.string().email(),
});

const removeInvestorSchema = z.object({
  email: z.string().email(),
});

const loginAsSchema = z.object({
  email: z.string().email(),
});

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

/**
 * GET /api/admin/investors
 * List all investors
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const investors = await getInvestors();
    return NextResponse.json({
      success: true,
      data: investors.map((inv: Investor) => ({
        email: inv.email,
        addedAt: inv.addedAt,
        addedBy: inv.addedBy,
        isOwner: inv.isOwner || false,
        acceptedAt: inv.acceptedAt || null,
        lastLoginAt: inv.lastLoginAt || null,
        assignedNodeIds: inv.assignedNodeIds || [],
        revenueSharePercent: inv.revenueSharePercent ?? null,
      })),
    });
  } catch (error) {
    console.error("Admin list investors error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list investors" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/investors
 * Add investor, remove investor, or login-as
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

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "add") {
      const parsed = addInvestorSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid email" },
          { status: 400 }
        );
      }

      const { email } = parsed.data;
      const success = await addInvestor(email, session.email);

      if (!success) {
        return NextResponse.json(
          { success: false, error: "Investor already exists" },
          { status: 409 }
        );
      }

      // Send invite email
      const loginToken = generateInvestorToken(email);
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/investors/verify?token=${loginToken}`;

      try {
        await sendInvestorInviteEmail(email, loginUrl, session.email);
        console.log(`Admin ${session.email} invited investor: ${email}`);
      } catch (emailError) {
        console.error(`Failed to send investor invite email to ${email}:`, emailError);
      }

      return NextResponse.json({
        success: true,
        message: `Investor ${email} added and invite email sent`,
      });
    }

    if (action === "remove") {
      const parsed = removeInvestorSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid email" },
          { status: 400 }
        );
      }

      const { email } = parsed.data;
      const success = await removeInvestor(email);

      if (!success) {
        return NextResponse.json(
          { success: false, error: "Cannot remove owner or investor not found" },
          { status: 400 }
        );
      }

      console.log(`Admin ${session.email} removed investor: ${email}`);

      return NextResponse.json({
        success: true,
        message: `Investor ${email} removed`,
      });
    }

    if (action === "login-as") {
      const parsed = loginAsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid email" },
          { status: 400 }
        );
      }

      const { email } = parsed.data;
      const investors = await getInvestors();
      const investor = investors.find(
        (i) => i.email.toLowerCase() === email.toLowerCase()
      );

      if (!investor) {
        return NextResponse.json(
          { success: false, error: "Investor not found" },
          { status: 404 }
        );
      }

      const token = generateAdminLoginAsInvestorToken(email, session.email);
      const loginUrl = `/investors/verify?token=${token}&type=admin-login-as`;

      console.log(`Admin ${session.email} logged in as investor: ${email}`);

      return NextResponse.json({
        success: true,
        data: { loginUrl },
      });
    }

    if (action === "resend-invite") {
      const parsed = loginAsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: "Invalid email" },
          { status: 400 }
        );
      }

      const { email } = parsed.data;
      const investors = await getInvestors();
      const investor = investors.find(
        (i) => i.email.toLowerCase() === email.toLowerCase()
      );

      if (!investor) {
        return NextResponse.json(
          { success: false, error: "Investor not found" },
          { status: 404 }
        );
      }

      const loginToken = generateInvestorToken(email);
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/investors/verify?token=${loginToken}`;

      try {
        await sendInvestorInviteEmail(email, loginUrl, session.email);
        console.log(`Admin ${session.email} resent invite to investor: ${email}`);
      } catch (emailError) {
        console.error(`Failed to resend investor invite email to ${email}:`, emailError);
        return NextResponse.json(
          { success: false, error: "Failed to send email" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Invite resent to ${email}`,
      });
    }

    if (action === "set-revenue-share") {
      const { email, revenueSharePercent } = body;
      if (!email) {
        return NextResponse.json(
          { success: false, error: "Email required" },
          { status: 400 }
        );
      }

      const investors = await getInvestors();
      const investor = investors.find(
        (i) => i.email.toLowerCase() === email.toLowerCase()
      );
      if (!investor) {
        return NextResponse.json(
          { success: false, error: "Investor not found" },
          { status: 404 }
        );
      }

      const percent = revenueSharePercent === null || revenueSharePercent === undefined || revenueSharePercent === ""
        ? null
        : Number(revenueSharePercent);

      if (percent !== null && (isNaN(percent) || percent < 0 || percent > 100)) {
        return NextResponse.json(
          { success: false, error: "Revenue share must be 0-100 or null" },
          { status: 400 }
        );
      }

      await setInvestorRevenueShare(email, percent);
      console.log(`Admin ${session.email} set revenue share for ${email}: ${percent}%`);

      return NextResponse.json({
        success: true,
        message: `Revenue share set to ${percent}% for ${email}`,
      });
    }

    if (action === "assign-nodes") {
      const { email, nodeIds } = body;
      if (!email || !Array.isArray(nodeIds)) {
        return NextResponse.json(
          { success: false, error: "Email and nodeIds array required" },
          { status: 400 }
        );
      }

      const investors = await getInvestors();
      const investor = investors.find(
        (i) => i.email.toLowerCase() === email.toLowerCase()
      );
      if (!investor) {
        return NextResponse.json(
          { success: false, error: "Investor not found" },
          { status: 404 }
        );
      }

      const stringNodeIds = nodeIds.map((id: string | number) => String(id));
      await setInvestorAssignedNodes(email, stringNodeIds);

      console.log(`Admin ${session.email} assigned ${stringNodeIds.length} nodes to investor: ${email}`);

      return NextResponse.json({
        success: true,
        message: `Assigned ${stringNodeIds.length} nodes to ${email}`,
        data: { assignedNodeIds: stringNodeIds },
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Admin investor action error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
