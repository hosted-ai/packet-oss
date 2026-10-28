/**
 * PA-267 logout. Revokes the server-side session row (so a copied refresh token
 * is dead immediately) and clears the cookie. `?all=1` revokes every session for
 * the customer ("log out everywhere"), identified from the Bearer access token.
 *
 * Impersonation never creates a session row (the verify route gates on
 * isEphemeralToken), so a customer logout can never touch an impersonation.
 *
 * PA-459: also logs an "account_logout" activity event (paired with the
 * "account_login" one from /api/account/verify) whenever the customer is
 * identifiable from the refresh cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  revokeSessionByToken,
  revokeAllSessionsForCustomer,
  decodeRefreshCustomerId,
  decodeRefreshEmail,
  decodeRefreshActiveAccountId,
  buildClearedSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/customer-session";
import { verifyCustomerToken } from "@/lib/auth/customer";
import { logAccountLogout } from "@/lib/activity";

export async function POST(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";
  const refresh = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const all = request.nextUrl.searchParams.get("all") === "1";

  // Identify the customer from the refresh cookie first (it outlives the
  // short Bearer access token, which is often already expired at logout).
  let customerId: string | null = refresh ? decodeRefreshCustomerId(refresh) : null;
  const logoutEmail: string | null = refresh ? decodeRefreshEmail(refresh) : null;
  // PA-175: team members operating in an owner's account carry their own
  // customerId but the owner's Stripe customer ID as activeAccountId. Log the
  // event to the operating account so it appears in the owner's activity feed.
  const activeAccountId: string | null = refresh ? decodeRefreshActiveAccountId(refresh) : null;

  if (all) {
    // Fall back to the Bearer only when there's no cookie-derived id.
    if (!customerId) {
      const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
      const payload = bearer ? verifyCustomerToken(bearer) : null;
      customerId = payload?.customerId ?? null;
    }
    if (customerId) {
      await revokeAllSessionsForCustomer(customerId);
    }
  }

  if (refresh) {
    await revokeSessionByToken(refresh);
  }

  const logTarget = activeAccountId ?? customerId;
  if (logTarget) {
    logAccountLogout(logTarget, logoutEmail ?? undefined).catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(buildClearedSessionCookie(isProd));
  return res;
}
