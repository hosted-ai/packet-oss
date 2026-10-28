/**
 * PA-267 persistent customer sessions — DB + JWT layer.
 *
 * The refresh JWT (stored in the httpOnly `packet_session` cookie) carries a
 * random `jti`; the customer_session row keys off sha256(jti). The row is the
 * revocable source of truth, so logout / "log out everywhere" actually end the
 * session even though the JWT is self-validating. The short-lived access token
 * (existing Bearer flow) is minted separately from a live row.
 *
 * Pure helpers (expiry math, hashing, cookie config, the ephemeral guard) live
 * in ./session-core and are unit-tested there.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { getSecret } from "./secrets";
import {
  hashSessionToken,
  computeSessionExpiry,
  isSessionLive,
  SESSION_ABSOLUTE_CAP_DAYS,
} from "./session-core";

export {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  buildClearedSessionCookie,
  isEphemeralToken,
} from "./session-core";

function getJwtSecret(): string {
  return getSecret("CUSTOMER_JWT_SECRET");
}

interface RefreshPayload {
  jti: string;
  customerId: string;
  email: string;
  userId?: string;
  // PA-175: the account the user is operating in. Carried in the refresh JWT (not
  // the row) so an account switch survives a cookie-backed access-token refresh.
  activeAccountId?: string;
  type: "customer-refresh";
}

export interface SessionIdentity {
  customerId: string;
  email: string;
  userId?: string;
  activeAccountId?: string;
}

/**
 * Create a persistent session row and return the refresh JWT to put in the
 * httpOnly cookie. Callers MUST gate on !isEphemeralToken(...) first.
 */
export async function createCustomerSession(opts: {
  customerId: string;
  email: string;
  userId?: string;
  activeAccountId?: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<string> {
  const nowMs = Date.now();
  const jti = crypto.randomUUID();
  const { expiresAt, absoluteExpiresAt } = computeSessionExpiry(nowMs, nowMs);

  await prisma.customerSession.create({
    data: {
      tokenHash: hashSessionToken(jti),
      stripeCustomerId: opts.customerId,
      userId: opts.userId ?? null,
      email: opts.email.toLowerCase(),
      expiresAt,
      absoluteExpiresAt,
      userAgent: opts.userAgent ? opts.userAgent.slice(0, 1000) : null,
      ip: opts.ip ? opts.ip.slice(0, 64) : null,
    },
  });

  return jwt.sign(
    {
      jti,
      customerId: opts.customerId,
      email: opts.email.toLowerCase(),
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.activeAccountId ? { activeAccountId: opts.activeAccountId } : {}),
      type: "customer-refresh",
    },
    getJwtSecret(),
    { expiresIn: `${SESSION_ABSOLUTE_CAP_DAYS}d` },
  );
}

/**
 * Validate a refresh token against its live row, roll the window forward, and
 * return the session identity — or null if the cookie is invalid/revoked/expired.
 */
export async function validateAndRotateSession(refreshToken: string): Promise<SessionIdentity | null> {
  let payload: RefreshPayload;
  try {
    payload = jwt.verify(refreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload;
  } catch {
    return null;
  }
  if (payload.type !== "customer-refresh" || !payload.jti) return null;

  const row = await prisma.customerSession.findUnique({
    where: { tokenHash: hashSessionToken(payload.jti) },
  });
  const nowMs = Date.now();
  if (!row || !isSessionLive(row, nowMs)) return null;

  // Roll the rolling window forward (capped at createdAt + 30d).
  const { expiresAt } = computeSessionExpiry(nowMs, row.createdAt.getTime());
  await prisma.customerSession.update({
    where: { id: row.id },
    data: { expiresAt, lastSeenAt: new Date(nowMs) },
  });

  return {
    customerId: row.stripeCustomerId,
    email: row.email,
    userId: row.userId ?? undefined,
    // activeAccountId lives in the refresh JWT (not the row), so an account
    // switch — which re-issues the cookie — survives this refresh.
    activeAccountId: payload.activeAccountId,
  };
}

/**
 * Re-sign the refresh token for the SAME session (same jti, same absolute
 * expiry) with a new activeAccountId. Used by account-switch so the switched
 * workspace survives a later cookie-backed access-token refresh. Returns null if
 * the current refresh token is invalid. Does NOT touch the DB row (jti unchanged).
 */
export function reissueRefreshTokenWithAccount(
  currentRefreshToken: string,
  activeAccountId: string | undefined,
): string | null {
  let payload: RefreshPayload & { exp?: number };
  try {
    payload = jwt.verify(currentRefreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload & { exp: number };
  } catch {
    return null;
  }
  if (payload.type !== "customer-refresh" || !payload.jti || !payload.exp) return null;

  return jwt.sign(
    {
      jti: payload.jti,
      customerId: payload.customerId,
      email: payload.email,
      ...(payload.userId ? { userId: payload.userId } : {}),
      ...(activeAccountId ? { activeAccountId } : {}),
      type: "customer-refresh",
      exp: payload.exp, // preserve the original absolute expiry — don't extend the cap
    },
    getJwtSecret(),
  );
}

/** Revoke the single session behind a refresh token (logout). No-op if invalid. */
export async function revokeSessionByToken(refreshToken: string): Promise<void> {
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload;
    if (payload.type !== "customer-refresh" || !payload.jti) return;
    await prisma.customerSession.updateMany({
      where: { tokenHash: hashSessionToken(payload.jti), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    /* invalid token — nothing to revoke */
  }
}

/** Decode the customerId from a refresh token without touching the DB or rolling
 *  expiry — used by "log out everywhere" to identify the customer from the cookie
 *  (the Bearer access token is short-lived and often already expired at logout). */
export function decodeRefreshCustomerId(refreshToken: string): string | null {
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload;
    return payload.type === "customer-refresh" ? payload.customerId : null;
  } catch {
    return null;
  }
}

/** Decode the email from a refresh token — used at logout to identify who
 *  is logging out (owner vs. team member) for the activity log. */
export function decodeRefreshEmail(refreshToken: string): string | null {
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload;
    return payload.type === "customer-refresh" ? payload.email : null;
  } catch {
    return null;
  }
}

/** Decode the activeAccountId from a refresh token — used at logout to
 *  identify the operating account for PA-175 team member sessions. Team
 *  members carry their own customerId but the owner's Stripe customer ID
 *  in activeAccountId after an account switch. */
export function decodeRefreshActiveAccountId(refreshToken: string): string | null {
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret(), { algorithms: ["HS256"] }) as RefreshPayload;
    return payload.type === "customer-refresh" ? (payload.activeAccountId ?? null) : null;
  } catch {
    return null;
  }
}

/** Revoke every live session for a customer ("log out everywhere"). */
export async function revokeAllSessionsForCustomer(stripeCustomerId: string): Promise<number> {
  const result = await prisma.customerSession.updateMany({
    where: { stripeCustomerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
