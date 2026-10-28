/**
 * PA-380 single-use sign-in / invitation links — DB layer.
 *
 * Emailed magic links used to be pure stateless JWTs: they lingered for their
 * whole TTL, could be replayed, and a newly issued link never invalidated the
 * old one. This module gives every emailed link a login_link row so it can be:
 *   - short-lived  (LOGIN_LINK_TTL_MINUTES; the JWT `exp` mirrors it)
 *   - invalidate-prior — issuing a new link supersedes older live links for the
 *     same email + account
 *   - single-use — consumed the moment it establishes a session
 *
 * Mint via createLoginLink(); enforce via checkLoginLinkLive() + consumeLoginLink()
 * in /api/account/verify. The access token minted from a live session
 * (/api/account/session) and admin-bypass tokens deliberately carry no login-link
 * claims, so they stay reusable and are never gated here.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { generateCustomerToken } from "./customer";
import {
  LOGIN_LINK_TTL_MINUTES,
  computeLoginLinkExpiry,
  hashLoginLinkToken,
  isLoginLinkLive,
} from "./login-link-core";

export { LOGIN_LINK_TTL_MINUTES } from "./login-link-core";

export interface CreateLoginLinkOptions {
  email: string;
  customerId: string;
  userId?: string;
  activeAccountId?: string;
  /** Deep-link intent to carry through login (sanitized when signed). */
  next?: string;
}

/**
 * Create a single-use sign-in / invitation link and return the JWT to embed in
 * the emailed URL. Supersedes any prior live links for the same email + account
 * (so the newest link is the only valid one) and records the row that
 * /api/account/verify consumes on first use.
 */
export async function createLoginLink(opts: CreateLoginLinkOptions): Promise<string> {
  const email = opts.email.toLowerCase().trim();
  const nowMs = Date.now();

  // Invalidate-prior: any still-live link for this email + account is superseded
  // the instant a newer one is minted (ticket requirement #2).
  await prisma.loginLink.updateMany({
    where: {
      email,
      stripeCustomerId: opts.customerId,
      consumedAt: null,
      supersededAt: null,
    },
    data: { supersededAt: new Date(nowMs) },
  });

  const jti = crypto.randomUUID();
  await prisma.loginLink.create({
    data: {
      tokenHash: hashLoginLinkToken(jti),
      email,
      stripeCustomerId: opts.customerId,
      expiresAt: computeLoginLinkExpiry(nowMs),
    },
  });

  // Best-effort prune of this email's dead-and-expired rows to bound growth.
  // Expired rows are already unusable (the JWT `exp` has passed), so dropping
  // them changes nothing an attacker could observe.
  prisma.loginLink
    .deleteMany({ where: { email, expiresAt: { lt: new Date(nowMs) } } })
    .catch(() => {});

  return generateCustomerToken(email, opts.customerId, {
    userId: opts.userId,
    activeAccountId: opts.activeAccountId,
    next: opts.next,
    jti,
    loginLink: true,
    expiresInMinutes: LOGIN_LINK_TTL_MINUTES,
  });
}

/**
 * Is the login link behind this jti still usable (live, unconsumed, not
 * superseded, not expired)? Used to reject a dead link early, before the
 * session-creation step.
 */
export async function checkLoginLinkLive(jti: string): Promise<boolean> {
  const row = await prisma.loginLink.findUnique({
    where: { tokenHash: hashLoginLinkToken(jti) },
    select: { consumedAt: true, supersededAt: true, expiresAt: true },
  });
  return isLoginLinkLive(row, Date.now());
}

/**
 * Atomically mark the login link consumed (single-use). Returns true only if
 * THIS call flipped a still-live row — so a replay or a concurrent second use
 * gets false and must be rejected. The guarded updateMany is the race-safe
 * compare-and-set: only one caller can transition consumedAt from null.
 */
export async function consumeLoginLink(jti: string): Promise<boolean> {
  const res = await prisma.loginLink.updateMany({
    where: {
      tokenHash: hashLoginLinkToken(jti),
      consumedAt: null,
      supersededAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  return res.count === 1;
}
