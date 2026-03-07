import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Get the CRON_SECRET, throwing if not set.
 * This ensures fail-closed behavior: if CRON_SECRET is missing,
 * the cron endpoint will return 500 instead of silently allowing access.
 */
function getCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET environment variable is required for cron endpoints");
  }
  return secret;
}

/**
 * Verify a cron request's authentication.
 * Accepts secret via:
 *   - Authorization: Bearer <secret>
 *   - x-cron-secret header
 *
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns null if authorized, or a NextResponse with 401/500 if not.
 */
export function verifyCronAuth(request: NextRequest): NextResponse | null {
  let expected: string;
  try {
    expected = getCronSecret();
  } catch {
    // CRON_SECRET not configured — fail closed
    return NextResponse.json(
      { error: "Cron endpoint not configured" },
      { status: 500 }
    );
  }

  // Extract secret from headers only (query params removed for security)
  const authHeader = request.headers.get("authorization");
  const cronSecretHeader = request.headers.get("x-cron-secret");

  const provided = cronSecretHeader || authHeader?.replace("Bearer ", "");

  if (!provided) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Timing-safe comparison
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // Authorized
}
