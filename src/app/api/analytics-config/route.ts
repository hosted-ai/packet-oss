import { NextResponse } from "next/server";

/**
 * Runtime PostHog config for the browser.
 *
 * The production bundle is built by Jenkins (debian/rules → pnpm build) with
 * no .env present, so NEXT_PUBLIC_POSTHOG_* inline as undefined in the client
 * JS. The server process, however, reads the box's .env.local at runtime
 * (same mechanism that makes server-side purchase events work), so the client
 * fetches the values from here instead.
 *
 * No auth: the PostHog project key is a publishable, write-only token that
 * ships in page source on any standard PostHog install, and init must run for
 * anonymous visitors (sign-up funnel). Session replay stays gated separately —
 * it only starts after /api/account/verify succeeds.
 */

// force-dynamic: without it this GET is prerendered at build time on the
// Jenkins agent, baking in nulls — the exact bug this route exists to fix.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY || null,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || null,
  });
}
