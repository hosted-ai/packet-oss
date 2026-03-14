import { NextRequest, NextResponse } from "next/server";
import { isAdmin, generateAdminToken, verifyAdminToken, generateSessionToken, bootstrapFirstAdmin } from "@/lib/admin";
import { sendEmail } from "@/lib/email";
import { emailLayout, emailButton, emailText, emailMuted, emailSignoff, plainTextFooter } from "@/lib/email/utils";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { getTwoFactorStatus, verifyTwoFactorCode } from "@/lib/two-factor";
import { getAdminPinStatus, setAdminPin, verifyAdminPin } from "@/lib/admin-pin";
import { logAdminLogin, logAdminActivity } from "@/lib/admin-activity";
import { getBrandName } from "@/lib/branding";

async function sendAdminLoginEmail(email: string, loginUrl: string) {
  await sendEmail({
    to: email,
    subject: `Admin Login - ${getBrandName()}`,
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
    text: `Log in to ${getBrandName()} Admin:\n\n${loginUrl}\n\nThis link expires in 15 minutes.${plainTextFooter()}`,
  });
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 requests per 5 minutes per IP (strict for admin login)
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`admin-auth:${ip}`, {
    maxRequests: 5,
    windowMs: 300000, // 5 minutes
  });

  if (!rateLimitResult.success) {
    console.log(`Admin auth rate limited for IP: ${ip}`);
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email, token, twoFactorCode, pinCode, newPin } = await request.json();
    console.log(`Admin auth request for email: ${email || "(token verification)"}, IP: ${ip}`);

    // If token is provided, verify it and return session token
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
      } else {
        // No TOTP — require PIN as second factor
        const pinStatus = await getAdminPinStatus(decoded.email);

        if (!pinStatus.hasPin || pinStatus.expired) {
          // Need to set or reset PIN
          if (newPin) {
            const result = await setAdminPin(decoded.email, newPin);
            if (!result.success) {
              return NextResponse.json(
                { error: result.error || "Failed to set PIN" },
                { status: 400 }
              );
            }
            await logAdminActivity(decoded.email, "admin_pin_set", pinStatus.expired ? "Admin PIN reset (expired)" : "Admin PIN set for first time");
            // PIN set — fall through to create session
          } else {
            return NextResponse.json({
              requiresPin: true,
              pinSetup: true,
              pinExpired: pinStatus.expired,
              email: decoded.email,
            });
          }
        } else {
          // PIN exists and valid — verify it
          if (pinCode) {
            const result = await verifyAdminPin(decoded.email, pinCode);
            if (!result.success) {
              if (result.expired) {
                // PIN expired during verification — tell client to switch to setup
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
            // PIN verified — fall through to create session
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

      // Log successful admin login
      await logAdminLogin(decoded.email);

      const response = NextResponse.json({ success: true, email: decoded.email });
      response.cookies.set("admin_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 4, // 4 hours - matches session token expiry
        path: "/",
      });

      return response;
    }

    // Otherwise, send magic link
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // In OSS mode, auto-bootstrap the first admin
    bootstrapFirstAdmin(email);

    // Check admin status
    const adminCheck = isAdmin(email);

    // Always return success to prevent email enumeration
    if (!adminCheck) {
      return NextResponse.json({
        success: true,
        message: "If you're an admin, you'll receive a login link shortly.",
      });
    }

    const loginToken = generateAdminToken(email);
    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/verify?token=${loginToken}`;
    console.log(`Sending admin login email to ${email}`);

    try {
      await sendAdminLoginEmail(email, loginUrl);
      console.log(`Admin login email sent successfully to ${email}`);
    } catch (emailError) {
      console.error(`Failed to send admin login email to ${email}:`, emailError);
      throw emailError;
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
  // Check if user is authenticated
  const sessionToken = request.cookies.get("admin_session")?.value;

  if (!sessionToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const decoded = verifyAdminToken(sessionToken);
  // Also try session token verification
  const { verifySessionToken } = await import("@/lib/admin");
  const session = verifySessionToken(sessionToken);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: session.email });
}

export async function DELETE(request: NextRequest) {
  // Logout - clear session cookie
  const response = NextResponse.json({ success: true });
  response.cookies.delete("admin_session");
  return response;
}
