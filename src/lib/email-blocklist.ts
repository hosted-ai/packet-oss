/**
 * Email domain blocklist for signup abuse prevention.
 *
 * Admin-configurable via Platform Settings. When enabled, signups from
 * disposable/temporary email domains are blocked. The blocklist is stored
 * in the SystemSetting table (DB as single source of truth).
 *
 * On first enable, the DB is seeded with DEFAULT_BLOCKED_DOMAINS.
 * Admins can add/remove domains through the Platform Settings UI.
 *
 * Design decisions:
 *   - Fail open: if DB is unavailable, allow signup (rate limiter still protects)
 *   - 5-min cache: inherited from SystemSetting cache TTL
 *   - Subdomain matching: blocks sub.mailinator.com if mailinator.com is listed
 */

import { getSetting } from "./settings";

/**
 * Default disposable email domains. Used to seed the DB on first enable.
 * Not used at runtime — DB is the single source of truth.
 */
export const DEFAULT_BLOCKED_DOMAINS = [
  // Major disposable email providers
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.de",
  "throwaway.email",
  "throwaway.com",
  "yopmail.com",
  "yopmail.fr",
  "sharklasers.com",
  "grr.la",
  "guerrillamailblock.com",
  "pokemail.net",
  "spam4.me",
  "trashmail.com",
  "trashmail.me",
  "trashmail.net",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "mintemail.com",
  "tempail.com",
  "tempr.email",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "fakeinbox.com",
  "mailcatch.com",
  "mailexpire.com",
  "mailforspam.com",
  "safetymail.info",
  "trashymail.com",
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "binkmail.com",
  "bobmail.info",
  "chammy.info",
  "devnullmail.com",
  "dodgeit.com",
  "emailigo.de",
  "emailsensei.com",
  "emailtemporario.com.br",
  "ephemail.net",
  "gishpuppy.com",
  "harakirimail.com",
  "jetable.org",
  "kasmail.com",
  "mailblocks.com",
  "mailscrap.com",
];

/**
 * Check if an email domain is blocked.
 *
 * Checks both exact match and subdomain match (e.g., sub.mailinator.com
 * is blocked if mailinator.com is in the list).
 *
 * Fails open: returns false if DB is unavailable or settings are malformed.
 */
export async function isBlockedDomain(email: string): Promise<boolean> {
  try {
    // Check if blocklist is enabled
    const enabled = await getSetting("email_blocklist_enabled");
    if (enabled !== "true") return false;

    // Get the domain list
    const domainsJson = await getSetting("email_blocklist_domains");
    if (!domainsJson) return false;

    let domains: string[];
    try {
      domains = JSON.parse(domainsJson);
    } catch {
      console.error("[Blocklist] Malformed email_blocklist_domains JSON, failing open");
      return false;
    }

    if (!Array.isArray(domains) || domains.length === 0) return false;

    // Extract domain from email
    const emailDomain = email.toLowerCase().split("@")[1];
    if (!emailDomain) return false;

    // Check exact match and subdomain match
    const domainSet = new Set(domains.map(d => d.toLowerCase()));

    // Exact match
    if (domainSet.has(emailDomain)) return true;

    // Subdomain match: check if any parent domain is blocked
    // e.g., "sub.mailinator.com" → check "mailinator.com"
    const parts = emailDomain.split(".");
    for (let i = 1; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join(".");
      if (domainSet.has(parentDomain)) return true;
    }

    return false;
  } catch (error) {
    // Fail open — if DB/cache is unavailable, allow the signup
    console.error("[Blocklist] Error checking email blocklist, failing open:", error);
    return false;
  }
}
