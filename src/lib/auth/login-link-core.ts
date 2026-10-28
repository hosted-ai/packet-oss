/**
 * PA-380 pure login-link logic. No DB, no Next — the DB wiring lives in
 * login-link.ts. Kept separate so the TTL math, hashing, and the liveness
 * predicate are unit-testable in isolation (mirrors session-core.ts).
 *
 * A "login link" is an emailed sign-in / invitation magic link
 * (/dashboard?token=<jwt>). Unlike the stateless JWT it used to be, it now has a
 * server-side row (login_link) so it can be short-lived, single-use, and
 * superseded when a newer link is issued for the same email + account.
 */
import crypto from "crypto";

/** How long an unused sign-in / invitation link stays valid (PA-380). The
 *  persistent session (customer_session, 15 days) is unaffected — this only
 *  bounds the emailed link itself. */
export const LOGIN_LINK_TTL_MINUTES = 15;

const MINUTE_MS = 60 * 1000;

/** sha256(jti) hex — what we store in login_link.token_hash. Same scheme as the
 *  session cookie so we never persist a usable secret. */
export function hashLoginLinkToken(jti: string): string {
  return crypto.createHash("sha256").update(jti).digest("hex");
}

/** Expiry for a freshly minted login link. */
export function computeLoginLinkExpiry(nowMs: number): Date {
  return new Date(nowMs + LOGIN_LINK_TTL_MINUTES * MINUTE_MS);
}

/**
 * A login-link row is usable iff it exists, hasn't been consumed (single-use),
 * hasn't been superseded by a newer link, and hasn't expired. Fails safe to
 * `false` for a missing row.
 */
export function isLoginLinkLive(
  row: { consumedAt: Date | null; supersededAt: Date | null; expiresAt: Date } | null,
  nowMs: number,
): boolean {
  if (!row) return false;
  if (row.consumedAt) return false;
  if (row.supersededAt) return false;
  return row.expiresAt.getTime() > nowMs;
}
