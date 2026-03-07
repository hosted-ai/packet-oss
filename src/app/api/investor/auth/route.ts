import { NextRequest, NextResponse } from "next/server";
import {
  isInvestor,
  generateInvestorToken,
  verifyInvestorToken,
  generateInvestorSessionToken,
  verifyInvestorSessionToken,
  updateInvestorLogin,
  verifyAdminLoginAsInvestorToken,
} from "@/lib/investor";
import { sendEmail } from "@/lib/email";
import { emailLayout, emailButton, emailText, emailMuted, emailSignoff, plainTextFooter } from "@/lib/email/utils";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { getTwoFactorStatus, verifyTwoFactorCode } from "@/lib/two-factor";

async function sendInvestorLoginEmail(email: string, loginUrl: string) {
  await sendEmail({
    to: email,
    subject: "Investor Dashboard Login - GPU Cloud",
    html: emailLayout({
      preheader: "Your investor dashboard login link",
      portalLabel: "Investor Portal",
      body: `
        ${emailText("Click the button below to log in to the investor dashboard:")}
        ${emailButton("Log In to Dashboard", loginUrl)}
        ${emailMuted("This link expires in 15 minutes. If you didn't request this, ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Log in to GPU Cloud Investor Dashboard:\n\n${loginUrl}\n\nThis link expires in 15 minutes.${plainTextFooter()}`,
  });
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 requests per 5 minutes per IP
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`investor-auth:${ip}`, {
    maxRequests: 5,
    windowMs: 300000, // 5 minutes
  });

  if (!rateLimitResult.success) {
    console.log(`Investor auth rate limited for IP: ${ip}`);
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email, token, twoFactorCode } = await request.json();
    console.log(`Investor auth request for email: ${email || "(token verification)"}, IP: ${ip}`);

    // If token is provided, verify it and return session token
    if (token) {
      // First check if this is an admin-login-as token
      const adminLoginAs = verifyAdminLoginAsInvestorToken(token);
      if (adminLoginAs) {
        // Admin login-as bypasses 2FA
        console.log(`Admin ${adminLoginAs.adminEmail} logging in as investor: ${adminLoginAs.email}`);

        if (!(await isInvestor(adminLoginAs.email))) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }

        const sessionToken = generateInvestorSessionToken(adminLoginAs.email);

        const response = NextResponse.json({
          success: true,
          email: adminLoginAs.email,
          adminLoginAs: true
        });
        response.cookies.set("investor_session", sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7, // 7 days
          path: "/",
        });

        return response;
      }

      // Regular investor token verification
      const decoded = verifyInvestorToken(token);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
      }

      if (!(await isInvestor(decoded.email))) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }

      // Check 2FA status
      const twoFactorStatus = await getTwoFactorStatus(decoded.email);

      if (twoFactorStatus.enabled) {
        // If 2FA is enabled but no code provided, request it
        if (!twoFactorCode) {
          return NextResponse.json({
            requiresTwoFactor: true,
            email: decoded.email,
          });
        }

        // Verify the 2FA code
        const verifyResult = await verifyTwoFactorCode(decoded.email, twoFactorCode);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: verifyResult.error || "Invalid verification code" },
            { status: 400 }
          );
        }
      }

      // Update login timestamps (sets acceptedAt on first login, lastLoginAt always)
      await updateInvestorLogin(decoded.email);

      const sessionToken = generateInvestorSessionToken(decoded.email);

      const response = NextResponse.json({ success: true, email: decoded.email });
      response.cookies.set("investor_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });

      return response;
    }

    // Otherwise, send magic link
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check investor status
    const investorCheck = await isInvestor(email);
    console.log(`Investor check for ${email}: ${investorCheck}`);

    // Always return success to prevent email enumeration
    if (!investorCheck) {
      console.log(`Email ${email} is not an investor, skipping email send`);
      return NextResponse.json({
        success: true,
        message: "If you're an investor, you'll receive a login link shortly.",
      });
    }

    const loginToken = generateInvestorToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/investors/verify?token=${loginToken}`;
    console.log(`Sending investor login email to ${email}`);

    try {
      await sendInvestorLoginEmail(email, loginUrl);
      console.log(`Investor login email sent successfully to ${email}`);
    } catch (emailError) {
      console.error(`Failed to send investor login email to ${email}:`, emailError);
      throw emailError;
    }

    return NextResponse.json({
      success: true,
      message: "If you're an investor, you'll receive a login link shortly.",
    });
  } catch (error) {
    console.error("Investor auth error:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Check if user is authenticated
  const sessionToken = request.cookies.get("investor_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifyInvestorSessionToken(sessionToken);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: session.email });
}

export async function DELETE() {
  // Logout - clear session cookie
  const response = NextResponse.json({ success: true });
  response.cookies.delete("investor_session");
  return response;
}
