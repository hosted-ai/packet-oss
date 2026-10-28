import jwt from "jsonwebtoken";
import { getSecret } from "./secrets";
import { sanitizeNextPath } from "./safe-next";

function getJwtSecret(): string {
  return getSecret("CUSTOMER_JWT_SECRET");
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export interface CustomerTokenPayload {
  email: string;
  customerId: string;
  type: "customer-dashboard";
  skipTwoFactor?: boolean; // Set to true for admin bypass tokens
  twoFactorVerified?: boolean; // Set after user completes TOTP verification
  // PA-175: optional new-format claims. Tokens issued before PR 2 rolls out
  // won't have these; getAuthenticatedCustomer falls back to email lookup.
  // 1-hour TTL guarantees full rollover within one release cycle.
  userId?: string;          // User.id (cuid)
  activeAccountId?: string; // stripe_customer_id of the account this token is acting on
  // PA-266: post-login redirect (deep-link intent). Sanitized to a same-origin
  // relative /dashboard|/account path at sign time, so it's safe to honour.
  next?: string;
  // PA-266: admin "Login as" impersonation marker. Presence (with skipTwoFactor)
  // keeps the token ephemeral (never persisted to a cookie) and drives the
  // dashboard's impersonation banner + audit attribution.
  impersonator?: { adminEmail: string };
  // PA-380: emailed sign-in / invitation links are single-use. `loginLink` marks
  // the token as such and `jti` keys the server-side login_link row that enforces
  // short expiry + invalidate-prior + single-use. Access tokens (minted from a
  // live session) and admin-bypass tokens carry neither, so they stay reusable.
  loginLink?: boolean;
  jti?: string;
}

export interface GenerateCustomerTokenOptions {
  userId?: string;
  activeAccountId?: string;
  expiresInHours?: number;
  /** Minute-granularity TTL. Takes precedence over expiresInHours when set —
   *  used for short-lived sign-in links (PA-380). */
  expiresInMinutes?: number;
  /** Deep-link intent to carry through login. Sanitized before signing. */
  next?: string;
  /** PA-380: mark this as a single-use sign-in link and bind it to a login_link
   *  row via `jti`. Set by createLoginLink — do not set by hand. */
  loginLink?: boolean;
  jti?: string;
}

export function generateCustomerToken(
  email: string,
  customerId: string,
  optionsOrExpires: GenerateCustomerTokenOptions | number = {},
): string {
  // Back-compat: a number argument used to mean expiresInHours. Keep that path.
  const options: GenerateCustomerTokenOptions =
    typeof optionsOrExpires === "number"
      ? { expiresInHours: optionsOrExpires }
      : optionsOrExpires;
  const expiresInHours = options.expiresInHours ?? 1;

  const payload: Record<string, unknown> = {
    email: email.toLowerCase(),
    customerId,
    type: "customer-dashboard",
  };
  if (options.userId) payload.userId = options.userId;
  if (options.activeAccountId) payload.activeAccountId = options.activeAccountId;
  // Sanitize the deep-link target before it goes into the signed token, so a
  // recipient can never rewrite it and the dashboard can honour it as-is.
  const safeNext = sanitizeNextPath(options.next, getAppUrl());
  if (safeNext) payload.next = safeNext;
  // PA-380: single-use sign-in link claims. `jti` binds the token to its
  // login_link row; `loginLink` flags it so /api/account/verify enforces
  // single-use + supersede (plain access tokens omit both and stay reusable).
  if (options.jti) payload.jti = options.jti;
  if (options.loginLink) payload.loginLink = true;

  // Minute-granularity TTL wins for short-lived sign-in links; otherwise hours.
  // (Kept as inline template literals so the jwt SignOptions type narrows.)
  return options.expiresInMinutes != null
    ? jwt.sign(payload, getJwtSecret(), { expiresIn: `${options.expiresInMinutes}m` })
    : jwt.sign(payload, getJwtSecret(), { expiresIn: `${expiresInHours}h` });
}

/**
 * Generate a customer token that bypasses 2FA.
 * Used by admins for the "Login As" feature.
 */
export function generateAdminBypassToken(email: string, customerId: string, adminEmail?: string): string {
  return jwt.sign(
    {
      email: email.toLowerCase(),
      customerId,
      type: "customer-dashboard",
      skipTwoFactor: true,
      ...(adminEmail ? { impersonator: { adminEmail: adminEmail.toLowerCase() } } : {}),
    },
    getJwtSecret(),
    { expiresIn: "1h" }
  );
}

/**
 * Re-sign a customer token with the twoFactorVerified flag set.
 * Preserves the original token's expiry so the session isn't extended.
 */
export function generateTwoFactorVerifiedToken(originalToken: string): string | null {
  try {
    const decoded = jwt.verify(originalToken, getJwtSecret(), { algorithms: ['HS256'] }) as CustomerTokenPayload & { exp: number };
    if (decoded.type !== "customer-dashboard") return null;

    const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) return null;

    return jwt.sign(
      {
        email: decoded.email,
        customerId: decoded.customerId,
        type: "customer-dashboard",
        twoFactorVerified: true,
        // Preserve every claim that affects identity/intent/isolation. Dropping
        // these caused: (1) an admin "Login as" (skipTwoFactor) token to be
        // laundered into a persistent session, (2) multi-team users to snap to
        // their default account, (3) the deep-link `next` intent to be lost.
        ...(decoded.skipTwoFactor ? { skipTwoFactor: true } : {}),
        ...(decoded.impersonator ? { impersonator: decoded.impersonator } : {}),
        ...(decoded.userId ? { userId: decoded.userId } : {}),
        ...(decoded.activeAccountId ? { activeAccountId: decoded.activeAccountId } : {}),
        ...(decoded.next ? { next: decoded.next } : {}),
        // PA-380: keep the login-link identity so the post-2FA token still maps
        // to the same login_link row and gets consumed (single-use) on session
        // creation, instead of leaking a second uncontrolled sign-in token.
        ...(decoded.loginLink ? { loginLink: true } : {}),
        ...(decoded.jti ? { jti: decoded.jti } : {}),
      },
      getJwtSecret(),
      { expiresIn: remainingSeconds }
    );
  } catch {
    return null;
  }
}

export function verifyCustomerToken(token: string): CustomerTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as CustomerTokenPayload;
    if (decoded.type !== "customer-dashboard") {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate a long-lived token for drip email unsubscribe links.
 * Valid for 90 days — outlives the drip sequence itself.
 */
export function generateUnsubscribeToken(email: string): string {
  return jwt.sign(
    { email: email.toLowerCase(), type: "drip-unsubscribe" },
    getJwtSecret(),
    { expiresIn: "90d" }
  );
}

/**
 * Verify a drip unsubscribe token.
 */
export function verifyUnsubscribeToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as { email: string; type: string };
    if (decoded.type !== "drip-unsubscribe") {
      return null;
    }
    return { email: decoded.email };
  } catch {
    return null;
  }
}
