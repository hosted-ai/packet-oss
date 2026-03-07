import { NextRequest, NextResponse } from "next/server";
import { isAdmin, generateAdminToken, verifyAdminToken, generateSessionToken, verifyAdminPassword } from "@/lib/admin";
import { sendEmail } from "@/lib/email";
import { emailLayout, emailButton, emailText, emailMuted, emailSignoff, plainTextFooter } from "@/lib/email/utils";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { getTwoFactorStatus, verifyTwoFactorCode } from "@/lib/two-factor";
import { getAdminPinStatus, setAdminPin, verifyAdminPin } from "@/lib/admin-pin";
import { logAdminLogin, logAdminActivity } from "@/lib/admin-activity";
import { isServiceConfigured } from "@/lib/settings";

async function sendAdminLoginEmail(email: string, loginUrl: string) {
  await sendEmail({
    to: email,
    subject: "Admin Login",
    html: emailLayout({
      preheader: "Your admin login link",
      portalLabel: "Admin Portal",
      body: `
        ${emailText("Click the button below to log in to the admin dashboard:")}
        ${emailButton("Log In to Admin", loginUrl)}
        ${emailMuted("This link expires in 15 minutes. If you didn't request this, ignore this email.")}
        ${emailSignoff()}
      `,
    }),
    text: `Log in to Admin:\n\n${loginUrl}\n\nThis link expires in 15 minutes.${plainTextFooter()}`,
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`admin-auth:${ip}`, {
    maxRequests: 5,
    windowMs: 300000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email, password, token, twoFactorCode, pinCode, newPin } = await request.json();

    // --- Password login path ---
    if (email && password) {
      if (!isAdmin(email)) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }

      const valid = verifyAdminPassword(email, password);
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }

      const sessionToken = generateSessionToken(email);
      await logAdminLogin(email);

      const response = NextResponse.json({ success: true, email });
      response.cookies.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 4,
        path: "/",
      });
      return response;
    }

    // --- Magic link token verification path ---
    if (token) {
      const decoded = verifyAdminToken(token);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid or expired link" }, { status: 401 });
      }

      if (!isAdmin(decoded.email)) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }

      // Check 2FA status
      const twoFactorStatus = await getTwoFactorStatus(decoded.email);

      if (twoFactorStatus.enabled) {
        if (!twoFactorCode) {
          return NextResponse.json({
            requiresTwoFactor: true,
            email: decoded.email,
          });
        }

        const verifyResult = await verifyTwoFactorCode(decoded.email, twoFactorCode);
        if (!verifyResult.success) {
          return NextResponse.json(
            { error: verifyResult.error || "Invalid verification code" },
            { status: 400 }
          );
        }
      } else {
        const pinStatus = await getAdminPinStatus(decoded.email);

        if (!pinStatus.hasPin || pinStatus.expired) {
          if (newPin) {
            const result = await setAdminPin(decoded.email, newPin);
            if (!result.success) {
              return NextResponse.json(
                { error: result.error || "Failed to set PIN" },
                { status: 400 }
              );
            }
            await logAdminActivity(decoded.email, "admin_pin_set", pinStatus.expired ? "Admin PIN reset (expired)" : "Admin PIN set for first time");
          } else {
            return NextResponse.json({
              requiresPin: true,
              pinSetup: true,
              pinExpired: pinStatus.expired,
              email: decoded.email,
            });
          }
        } else {
          if (pinCode) {
            const result = await verifyAdminPin(decoded.email, pinCode);
            if (!result.success) {
              if (result.expired) {
                return NextResponse.json({
                  requiresPin: true,
                  pinSetup: true,
                  pinExpired: true,
                  email: decoded.email,
                  error: result.error,
                });
              }
              return NextResponse.json(
                { error: result.error || "Invalid PIN" },
                { status: 400 },
              );
            }
          } else {
            return NextResponse.json({
              requiresPin: true,
              pinSetup: false,
              email: decoded.email,
            });
          }
        }
      }

      const sessionToken = generateSessionToken(decoded.email);
      await logAdminLogin(decoded.email);

      const response = NextResponse.json({ success: true, email: decoded.email });
      response.cookies.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 4,
        path: "/",
      });

      return response;
    }

    // --- Magic link send path ---
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const adminCheck = isAdmin(email);

    if (!adminCheck) {
      return NextResponse.json({
        success: true,
        message: "If you're an admin, you'll receive a login link shortly.",
      });
    }

    // Check if email is configured
    const emailConfigured = await isServiceConfigured("emailit");
    if (!emailConfigured) {
      return NextResponse.json(
        { error: "Email service not configured. Use password login instead, or configure Emailit in Platform Settings." },
        { status: 400 }
      );
    }

    const loginToken = generateAdminToken(email);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const loginUrl = `${appUrl}/admin/verify?token=${loginToken}`;

    try {
      await sendAdminLoginEmail(email, loginUrl);
    } catch (emailError) {
      console.error(`Failed to send admin login email to ${email}:`, emailError);
      return NextResponse.json(
        { error: "Failed to send login email. Check email configuration in Platform Settings." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "If you're an admin, you'll receive a login link shortly.",
    });
  } catch (error) {
    console.error("Admin auth error:", error);
    const msg = error instanceof Error && error.message.includes("429")
      ? "Email rate limited — please try again in a few seconds."
      : "Failed to process request";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const { verifySessionToken } = await import("@/lib/admin");
  const session = verifySessionToken(sessionToken);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: session.email });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete("admin_session");
  return response;
}
