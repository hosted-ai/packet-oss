import { NextRequest, NextResponse } from "next/server";
import { getAdmins, addAdminWithPassword, generateSessionToken } from "@/lib/auth/admin";
import { ensureJwtSecrets } from "@/lib/settings";

/**
 * GET /api/admin/setup
 * Returns setup status - whether the platform needs initial setup.
 */
export async function GET() {
  const admins = getAdmins();
  const needsSetup = admins.length === 0;

  return NextResponse.json({
    needsSetup,
    adminCount: admins.length,
  });
}

/**
 * POST /api/admin/setup
 * Creates the first admin account. Only works when no admins exist.
 */
export async function POST(request: NextRequest) {
  const admins = getAdmins();

  if (admins.length > 0) {
    return NextResponse.json(
      { error: "Setup already completed. Use the login page instead." },
      { status: 403 }
    );
  }

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Ensure JWT secrets exist before generating tokens
    await ensureJwtSecrets();

    // Create the admin account with password
    const success = await addAdminWithPassword(email, password, "setup");
    if (!success) {
      return NextResponse.json(
        { error: "Failed to create admin account" },
        { status: 500 }
      );
    }

    // Generate session token and log them in immediately
    const sessionToken = generateSessionToken(email);

    const response = NextResponse.json({
      success: true,
      email,
      message: "Admin account created. Welcome to your platform!",
    });

    response.cookies.set("admin_session", sessionToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 4, // 4 hours
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Failed to complete setup" },
      { status: 500 }
    );
  }
}
