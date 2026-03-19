import { NextRequest, NextResponse } from "next/server";
import { isAdmin, generateAdminToken, verifyAdminToken, generatePreAuthToken, verifyPreAuthToken, generateSessionToken } from "@/lib/admin";
import { sendEmail } from "@/lib/email";
import { emailLayout, emailButton, emailText, emailMuted, emailSignoff, plainTextFooter } from "@/lib/email/utils";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { getTwoFactorStatus, verifyTwoFactorCode, isTwoFactorEnabled } from "@/lib/two-factor";
import { getAdminPinStatus, setAdminPin, verifyAdminPin } from "@/lib/admin-pin";
import { logAdminLogin, logAdminActivity } from "@/lib/admin-activity";
import { getBrandName } from "@/lib/branding";
import { loadTemplate } from "@/lib/email/template-loader";
import { isOSS } from "@/lib/edition";
import {
  verifyAdminPassword,
  adminHasPassword,
  isFirstRun,
  bootstrapFirstAdminWithPassword,
} from "@/lib/auth/admin";
import { logLoginAttempt } from "@/lib/auth/login-log";

async function sendAdminLoginEmail(email: string, loginUrl: string) {
  const brandName = getBrandName();

  const subject = `Admin Login - {{brandName}}`;
  const html = emailLayout({
    preheader: "Your admin login link",
    portalLabel: "Admin Portal",
    body: `
      ${emailText("Click the button below to log in to the admin dashboard:")}
      ${emailButton("Log In to Admin", "{{loginUrl}}")}
      ${emailMuted("This link expires in 15 minutes. If you didn't request this, ignore this email.")}
      ${emailSignoff()}
    `,
  });
  const text = `Log in to {{brandName}} Admin:\n\n{{loginUrl}}\n\nThis link expires in 15 minutes.${plainTextFooter()}`;

  const template = await loadTemplate(
    "admin-login",
    { email, loginUrl, brandName },
    { subject, html, text }
  );

  await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/**
 * Create a session response with the admin_session cookie set.
 */
function createSessionResponse(email: string): NextResponse {
  const sessionToken = generateSessionToken(email);
  const response = NextResponse.json({ success: true, email });
  response.cookies.set("admin_session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 4, // 4 hours
    path: "/",
  });
  return response;
}

/**
 * OSS password-based login flow.
 * Handles: first-run bootstrap, login, password setup for existing admins.
 */
async function handleOSSPasswordLogin(
  email: string,
  password: string | undefined,
  ip: string,
  userAgent: string | null
): Promise<NextResponse> {
  // First run — bootstrap admin with password
  if (isFirstRun()) {
    if (!password) {
      return NextResponse.json({
        mode: "setup",
        message: "Create your admin account",
      });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    const created = await bootstrapFirstAdminWithPassword(email, password);
    if (!created) {
      return NextResponse.json(
        { error: "Failed to create admin account" },
        { status: 500 }
      );
    }
    await logAdminLogin(email);
    logLoginAttempt({ email, success: true, ip, method: "password", userAgent });
    return createSessionResponse(email);
  }

  // Not first run — need password
  if (!password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  // Check if admin exists
  if (!isAdmin(email)) {
    console.log(`[OSS Auth] Login attempt for non-admin: ${email}, IP: ${ip}`);
    logLoginAttempt({ email, success: false, ip, method: "password", reason: "account-not-found", userAgent });
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Admin exists but no password yet — must use invite token to set password
  if (!adminHasPassword(email)) {
    console.log(`[OSS Auth] Login attempt for admin without password: ${email}, IP: ${ip}`);
    logLoginAttempt({ email, success: false, ip, method: "password", reason: "no-password-set", userAgent });
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Verify password
  const valid = await verifyAdminPassword(email, password);
  if (!valid) {
    console.log(`[OSS Auth] Failed login for: ${email}, IP: ${ip}`);
    logLoginAttempt({ email, success: false, ip, method: "password", reason: "invalid-password", userAgent });
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  // Password valid — check if 2FA is enabled
  const has2FA = await isTwoFactorEnabled(email);
  if (has2FA) {
    // Return pre-auth token for 2FA verification via /admin/verify
    const preAuthToken = generatePreAuthToken(email);
    return NextResponse.json({
      requiresTwoFactor: true,
      token: preAuthToken,
    });
  }

  await logAdminLogin(email);
  logLoginAttempt({ email, success: true, ip, method: "password", userAgent });
  return createSessionResponse(email);
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
    const body = await request.json();
    const { email, password, token, twoFactorCode, pinCode, newPin } = body;
    const userAgent = request.headers.get("user-agent");
    console.log(`Admin auth request for email: ${email || "(token verification)"}, IP: ${ip}`);

    // ── OSS password-based login ──────────────────────────────────────
    if (isOSS() && !token) {
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }
      return handleOSSPasswordLogin(email, password, ip, userAgent);
    }

    // ── Pro magic-link flow (unchanged) ───────────────────────────────

    // If token is provided, verify it and return session token
    if (token) {
      // Try pre-auth token first (OSS password + 2FA flow)
      const preAuth = verifyPreAuthToken(token);
      if (preAuth) {
        // Pre-auth token from OSS password login — only TOTP verification
        if (!isAdmin(preAuth.email)) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }

        if (!twoFactorCode) {
          return NextResponse.json({
            requiresTwoFactor: true,
            email: preAuth.email,
          });
        }

        const verifyResult = await verifyTwoFactorCode(preAuth.email, twoFactorCode);
        if (!verifyResult.success) {
          logLoginAttempt({ email: preAuth.email, success: false, ip, method: "2fa", reason: "invalid-2fa", userAgent });
          return NextResponse.json(
            { error: verifyResult.error || "Invalid verification code" },
            { status: 400 }
          );
        }

        await logAdminLogin(preAuth.email);
        logLoginAttempt({ email: preAuth.email, success: true, ip, method: "2fa", userAgent });
        return createSessionResponse(preAuth.email);
      }

      // Try magic-link token (Pro flow)
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
        // No TOTP — require PIN as second factor (Pro only)
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

      await logAdminLogin(decoded.email);
      logLoginAttempt({ email: decoded.email, success: true, ip, method: "magic-link", userAgent });
      return createSessionResponse(decoded.email);
    }

    // Otherwise, send magic link (Pro flow)
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

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
    // In OSS mode, tell the client which login mode to use
    if (isOSS()) {
      return NextResponse.json({
        authenticated: false,
        loginMode: "password",
        isFirstRun: isFirstRun(),
      }, { status: 401 });
    }
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Verify session token
  const { verifySessionToken } = await import("@/lib/admin");
  const session = verifySessionToken(sessionToken);

  if (!session) {
    // Clear the invalid cookie and include loginMode for OSS
    const response = NextResponse.json({
      authenticated: false,
      ...(isOSS() ? { loginMode: "password", isFirstRun: isFirstRun() } : {}),
    }, { status: 401 });
    response.cookies.delete("admin_session");
    return response;
  }

  return NextResponse.json({ authenticated: true, email: session.email });
}

export async function DELETE(request: NextRequest) {
  // Logout - clear session cookie
  const response = NextResponse.json({ success: true });
  response.cookies.delete("admin_session");
  return response;
}
