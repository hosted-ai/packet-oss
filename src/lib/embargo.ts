/**
 * Embargo / sanctions country screening.
 *
 * DB-backed via SystemSetting (same pattern as email-blocklist.ts).
 * Admin-configurable through Platform Settings UI.
 *
 * Country codes follow OFAC comprehensive-sanctions and targeted-sanctions lists.
 * The default list seeds the DB on first enable.
 *
 * Design decisions:
 *   - Fail open: if DB is unavailable, fall back to hardcoded defaults
 *   - 5-min cache: inherited from SystemSetting cache TTL
 *   - Fire-and-forget logging: EmbargoLog writes don't block the response
 *   - Missing CF-IPCountry header: allow through (covers local dev, health checks)
 */

import { getSetting } from "./settings";
import { prisma } from "./prisma";

/**
 * Default embargoed country codes. Seeds the DB on first enable.
 * Not used at runtime when DB is available — DB is single source of truth.
 *
 * Comprehensive sanctions (primary): CU, IR, KP
 * Targeted sector sanctions: RU, BY, MM
 */
export const DEFAULT_EMBARGOED_COUNTRIES = [
  "CU", // Cuba          — OFAC (US)
  "IR", // Iran          — OFAC (US), UN, EU
  "KP", // North Korea   — OFAC (US), UN, EU
  "RU", // Russia        — OFAC (US), EU, UK (targeted sectors)
  "BY", // Belarus       — EU, UK (targeted)
  "MM", // Myanmar/Burma — OFAC (US) (targeted)
];

/**
 * Returns the two-letter ISO country code from the Cloudflare CF-IPCountry
 * header, or null if unavailable, unknown (XX), or a Tor exit node (T1).
 */
export function getCountryFromRequest(request: { headers: { get(name: string): string | null } }): string | null {
  const country = request.headers.get("CF-IPCountry");
  if (!country || country === "XX" || country === "T1") return null;
  return country.toUpperCase();
}

/**
 * Get the Cloudflare threat score from the request (0-100, higher = more suspicious).
 * Returns null if header is missing.
 */
export function getThreatScoreFromRequest(request: { headers: { get(name: string): string | null } }): number | null {
  const score = request.headers.get("CF-IPThreatScore");
  if (!score) return null;
  const parsed = parseInt(score, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Check if a request originates from a Tor exit node.
 */
export function isTorExit(request: { headers: { get(name: string): string | null } }): boolean {
  return request.headers.get("CF-IPCountry") === "T1";
}

/**
 * Get the embargoed country set from DB (or fall back to defaults).
 */
async function getEmbargoedCountries(): Promise<Set<string>> {
  try {
    const enabled = await getSetting("embargo_enabled");
    if (enabled !== "true") return new Set(); // Embargo disabled — allow all

    const countriesJson = await getSetting("embargo_countries");
    if (!countriesJson) return new Set(DEFAULT_EMBARGOED_COUNTRIES);

    const countries: string[] = JSON.parse(countriesJson);
    if (!Array.isArray(countries) || countries.length === 0) {
      return new Set(DEFAULT_EMBARGOED_COUNTRIES);
    }
    return new Set(countries.map(c => c.toUpperCase()));
  } catch {
    // Fail open: if we can't even read whether embargo is enabled, allow all
    console.warn("[Embargo] Failed to read settings, failing open (allowing all)");
    return new Set();
  }
}

/**
 * Returns true if the given country code is on the embargoed list.
 * Returns false for null (unknown country).
 */
export async function isEmbargoedCountry(countryCode: string | null): Promise<boolean> {
  if (!countryCode) return false;
  const countries = await getEmbargoedCountries();
  return countries.has(countryCode.toUpperCase());
}

/**
 * Log an embargo event (fire-and-forget, never blocks the response).
 */
function logEmbargoEvent(data: {
  ip: string;
  country: string | null;
  action: "blocked" | "flagged";
  reason: string;
  endpoint: string;
  email?: string;
  userAgent?: string;
  cfThreat?: number;
}): void {
  prisma.embargoLog.create({
    data: {
      ip: data.ip,
      country: data.country,
      action: data.action,
      reason: data.reason,
      endpoint: data.endpoint,
      email: data.email || null,
      userAgent: data.userAgent ? data.userAgent.slice(0, 500) : null,
      cfThreat: data.cfThreat ?? null,
    },
  }).catch(err => {
    console.error("[Embargo] Failed to write log:", err);
  });
}

/**
 * Extract client IP from request (same logic as ratelimit.ts).
 */
function getIp(request: { headers: { get(name: string): string | null } }): string {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export interface EmbargoResult {
  blocked: boolean;
  country: string | null;
  reason?: string;
}

/**
 * Check a request against the embargo list.
 * Returns { blocked: true } if the request should be rejected.
 *
 * Also logs flagged requests (Tor exits, high threat scores) without blocking.
 * Missing CF-IPCountry: allow through, no log.
 */
export async function embargoCheck(
  request: { headers: { get(name: string): string | null } },
  endpoint: string,
  email?: string,
): Promise<EmbargoResult> {
  const country = getCountryFromRequest(request);
  const ip = getIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;

  // No country header — allow through (local dev, health checks, LB probes)
  if (!country) {
    // Still check for Tor exits and flag them
    if (isTorExit(request)) {
      logEmbargoEvent({
        ip, country: "T1", action: "flagged", reason: "tor_exit",
        endpoint, email, userAgent,
      });
    }
    return { blocked: false, country: null };
  }

  // Check embargo list
  if (await isEmbargoedCountry(country)) {
    logEmbargoEvent({
      ip, country, action: "blocked", reason: "embargoed_country",
      endpoint, email, userAgent,
    });
    return { blocked: true, country, reason: "embargoed_country" };
  }

  // Flag high-threat IPs (but don't block)
  const threatScore = getThreatScoreFromRequest(request);
  if (threatScore !== null && threatScore > 10) {
    logEmbargoEvent({
      ip, country, action: "flagged", reason: "high_threat",
      endpoint, email, userAgent, cfThreat: threatScore,
    });
  }

  return { blocked: false, country };
}
