import { NextRequest, NextResponse } from "next/server";
import { isAdmin, generateSessionToken } from "@/lib/admin";
import { setAdminPassword } from "@/lib/auth/admin";
import { validateInviteToken, markInviteTokenUsed } from "@/lib/auth/invite-tokens";
import { logAdminLogin } from "@/lib/admin-activity";
import { rateLimit, getClientIp } from "@/lib/ratelimit";

/**
 * GET /api/admin/auth/setup?invite=<token>
 * Validate an invite token and return the associated email.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`admin-setup-check:${ip}`, { maxRequests: 20, windowMs: 300000 });
  if (!rl.success) {
    return NextResponse.json({ valid: false, error: "Too many attempts" }, { status: 429 });
  }

  const invite = request.nextUrl.searchParams.get("invite");
  if (!invite) {
    return NextResponse.json({ valid: false, error: "Missing invite token" }, { status: 400 });
  }

  const result = validateInviteToken(invite);
  if (!result.valid) {
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ valid: true, email: result.email });
}

/**
 * POST /api/admin/auth/setup
 * Claim an invite token: validate, set password, create session.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`admin-setup:${ip}`, {
    maxRequests: 10,
    windowMs: 300000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { invite, password, confirmPassword } = await request.json();

    if (!invite) {
      return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
    }
    if (!password || !confirmPassword) {
      return NextResponse.json({ error: "Password and confirmation are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }

    // Validate the invite token
    const result = validateInviteToken(invite);
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    const email = result.email;

    // Verify the admin record still exists
    if (!isAdmin(email)) {
      return NextResponse.json({ error: "Admin account not found" }, { status: 404 });
    }

    // Set the password
    const passwordSet = await setAdminPassword(email, password);
    if (!passwordSet) {
      return NextResponse.json({ error: "Failed to set password" }, { status: 500 });
    }

    // Mark token as used
    markInviteTokenUsed(invite);

    // Log and create session
    await logAdminLogin(email);
    console.log(`[Admin Setup] Password set via invite token for: ${email}, IP: ${ip}`);

    const sessionToken = generateSessionToken(email);
    const response = NextResponse.json({ success: true, email });
    response.cookies.set("admin_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 4,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Admin setup error:", error);
    return NextResponse.json({ error: "Failed to process setup" }, { status: 500 });
  }
}
