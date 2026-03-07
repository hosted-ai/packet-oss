import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  getProviderByEmail,
  getProviderById,
  generateProviderLoginToken,
  verifyProviderLoginToken,
  generateProviderSessionToken,
  verifyProviderSessionToken,
  verifyAdminLoginAsToken,
} from "@/lib/auth/provider";
import { sendProviderLoginEmail } from "@/lib/email/templates/provider";
import { rateLimit } from "@/lib/ratelimit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://example.com";
const COOKIE_NAME = "provider_session";

const loginSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  token: z.string(),
});

/**
 * POST /api/providers/auth
 * Actions: login, verify, logout, session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "login":
        return handleLogin(request, body);
      case "verify":
        return handleVerify(body);
      case "verify-admin-login-as":
        return handleAdminLoginAs(body);
      case "logout":
        return handleLogout();
      default:
        return NextResponse.json(
          { success: false, error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Provider auth error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/providers/auth
 * Get current session
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const session = await verifyProviderSessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: {
        providerId: session.providerId,
        email: session.email,
        companyName: session.companyName,
        status: session.status,
      },
    });
  } catch (error) {
    console.error("Provider session error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleLogin(request: NextRequest, body: unknown) {
  // Rate limit: 5 requests per 5 minutes per IP
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateLimitResult = rateLimit(`provider-login:${ip}`, { maxRequests: 5, windowMs: 5 * 60 * 1000 });
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid email address" },
      { status: 400 }
    );
  }

  const { email } = parsed.data;
  const provider = await getProviderByEmail(email);

  if (!provider) {
    // Don't reveal if email exists - still return success
    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, a login link has been sent.",
    });
  }

  if (provider.status === "terminated") {
    return NextResponse.json({
      success: true,
      message: "If an account exists with this email, a login link has been sent.",
    });
  }

  // Generate login token and send email
  const token = generateProviderLoginToken(email);
  const loginUrl = `${APP_URL}/providers/verify?token=${token}`;

  await sendProviderLoginEmail({
    to: email,
    loginUrl,
    companyName: provider.companyName,
  });

  return NextResponse.json({
    success: true,
    message: "If an account exists with this email, a login link has been sent.",
  });
}

async function handleVerify(body: unknown) {
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid token" },
      { status: 400 }
    );
  }

  const { token } = parsed.data;
  const decoded = verifyProviderLoginToken(token);

  if (!decoded) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  const provider = await getProviderByEmail(decoded.email);
  if (!provider || provider.status === "terminated") {
    return NextResponse.json(
      { success: false, error: "Account not found or terminated" },
      { status: 401 }
    );
  }

  // Generate session token
  const sessionToken = generateProviderSessionToken(provider.id, provider.email);

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24 hours
    path: "/",
  });

  return NextResponse.json({
    success: true,
    data: {
      providerId: provider.id,
      email: provider.email,
      companyName: provider.companyName,
      status: provider.status,
    },
  });
}

async function handleAdminLoginAs(body: unknown) {
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid token" },
      { status: 400 }
    );
  }

  const { token } = parsed.data;
  const decoded = verifyAdminLoginAsToken(token);

  if (!decoded) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired admin login-as token" },
      { status: 401 }
    );
  }

  const provider = await getProviderById(decoded.providerId);
  if (!provider) {
    return NextResponse.json(
      { success: false, error: "Provider not found" },
      { status: 404 }
    );
  }

  // Generate session token (admin is impersonating provider)
  const sessionToken = generateProviderSessionToken(provider.id, provider.email);

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24 hours
    path: "/",
  });

  return NextResponse.json({
    success: true,
    data: {
      providerId: provider.id,
      email: provider.email,
      companyName: provider.companyName,
      status: provider.status,
      adminLoginAs: true,
      adminEmail: decoded.adminEmail,
    },
  });
}

async function handleLogout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);

  return NextResponse.json({ success: true });
}
