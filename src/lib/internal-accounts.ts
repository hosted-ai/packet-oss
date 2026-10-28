/**
 * Internal / test-account exclusion list (PA-410).
 *
 * Internal and test accounts must not contribute to customer-facing or investor
 * metrics. The list used to be hardcoded in investor-stats.ts; it is now
 * admin-configurable via Platform Settings (SystemSetting keys below), with the
 * hardcoded values kept as fallback defaults.
 *
 * Resolution: stored JSON setting (even an empty array wins — an explicit
 * "exclude nothing") → hardcoded default when the setting is missing/malformed.
 * Fail-safe: on any error the defaults apply, so exclusion never silently turns
 * off because the DB blipped.
 */

import { getSetting } from "./settings";
import { prisma } from "./prisma";

export const INTERNAL_EMAIL_DOMAINS_SETTING = "internal_email_domains";
export const INTERNAL_EXCLUDED_EMAILS_SETTING = "internal_excluded_emails";

// OSS edition: no built-in internal accounts; set them in Platform Settings.
export const DEFAULT_INTERNAL_EMAIL_DOMAINS: string[] = [];
export const DEFAULT_EXCLUDED_EMAILS: string[] = [];

export interface InternalExclusions {
  domains: string[];
  emails: string[];
}

function parseList(json: string | null, fallback: string[]): string[] {
  if (json == null) return fallback;
  try {
    const v = JSON.parse(json);
    // An empty array is a valid, intentional "exclude nothing".
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;
  } catch {
    return fallback;
  }
}

async function readList(key: string, fallback: string[]): Promise<string[]> {
  try {
    return parseList(await getSetting(key), fallback);
  } catch {
    return fallback; // fail safe: exclusion never silently turns off on a DB blip
  }
}

/**
 * Resolve the configured exclusion lists (DB override → hardcoded defaults).
 * Values are lowercased so matching is case-insensitive on the config side,
 * preserving the old behaviour where the hardcoded lists were all lowercase.
 */
export async function getInternalExclusions(): Promise<InternalExclusions> {
  const domains = await readList(INTERNAL_EMAIL_DOMAINS_SETTING, DEFAULT_INTERNAL_EMAIL_DOMAINS);
  const emails = await readList(INTERNAL_EXCLUDED_EMAILS_SETTING, DEFAULT_EXCLUDED_EMAILS);
  return {
    domains: domains.map((x) => x.toLowerCase()),
    emails: emails.map((x) => x.toLowerCase()),
  };
}

/** Build a sync predicate from resolved lists — resolve once, then use in loops. */
export function makeIsInternalOrExcluded(
  { domains, emails }: InternalExclusions,
): (email: string) => boolean {
  const emailSet = new Set(emails);
  return (email: string) => {
    const lower = email.toLowerCase();
    return domains.some((d) => lower.endsWith(`@${d}`)) || emailSet.has(lower);
  };
}

/** Prisma `where` fragment (matches on `email`) that excludes internal/test accounts. */
export function buildExcludeInternalWhere({ domains, emails }: InternalExclusions) {
  if (domains.length === 0 && emails.length === 0) return {}; // exclude nothing
  return {
    NOT: [
      ...domains.map((d) => ({ email: { endsWith: `@${d}` } })),
      ...emails.map((e) => ({ email: e })),
    ],
  };
}

/**
 * Raw-SQL fragment for `$queryRawUnsafe`. `col` = the email column (e.g. "email").
 * The list is admin-configurable, so single-quote-escape every value even though
 * the settings API already validates the charset — defence in depth for the
 * string-literal context. Returns "1=1" (no-op) when both lists are empty.
 */
export function internalSqlExclusion(
  { domains, emails }: InternalExclusions,
  col: string,
): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  const parts = [
    ...domains.map((d) => `${col} NOT LIKE '%@${esc(d)}'`),
    ...emails.map((e) => `${col} != '${esc(e)}'`),
  ];
  return parts.length ? parts.join(" AND ") : "1=1";
}

/**
 * Stripe customer IDs of internal/test accounts, resolved from CustomerCache
 * (covers customers without team metadata). Used to keep internal usage out of
 * investor revenue and payouts. Fail-open: an empty set excludes nothing.
 */
export async function getInternalCustomerIdsFromCache(): Promise<Set<string>> {
  try {
    const { domains, emails } = await getInternalExclusions();
    if (domains.length === 0 && emails.length === 0) return new Set();
    const rows = await prisma.customerCache.findMany({
      where: {
        OR: [
          ...domains.map((d) => ({ email: { endsWith: `@${d}` } })),
          ...emails.map((e) => ({ email: e })),
        ],
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}
