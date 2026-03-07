/**
 * UTM parameter capture & persistence (cookie-free).
 *
 * Uses localStorage to persist attribution data across page navigations.
 * First-touch attribution: the original traffic source is preserved and
 * never overwritten by subsequent visits.
 *
 * Flow:
 *   1. Landing page calls captureUtm() on load
 *   2. /account page calls getUtmData() and sends it with the signup POST
 *   3. Signup API stores UTM fields in Stripe customer metadata
 */

const STORAGE_KEY = "packet_utm";

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** Page the visitor first landed on */
  landing_page?: string;
  /** HTTP referrer at time of landing */
  referrer?: string;
  /** ISO timestamp of first visit */
  first_visit?: string;
}

/** Parse UTM params from the current window URL. */
export function getUtmFromUrl(): UtmParams | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const utm: UtmParams = {};
  let hasAny = false;

  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ] as const) {
    const val = params.get(key);
    if (val) {
      utm[key] = val;
      hasAny = true;
    }
  }

  return hasAny ? utm : null;
}

/** Persist UTM data to localStorage (first-touch: skip if exists). */
function persistUtm(utm: UtmParams): void {
  if (typeof localStorage === "undefined") return;
  // First-touch: don't overwrite existing data
  if (localStorage.getItem(STORAGE_KEY)) return;

  // Enrich with landing context
  utm.landing_page = window.location.pathname + window.location.search;
  utm.referrer = document.referrer || undefined;
  utm.first_visit = new Date().toISOString();

  localStorage.setItem(STORAGE_KEY, JSON.stringify(utm));
}

/** Read stored UTM data (returns null if absent). */
export function getUtmData(): UtmParams | null {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Clear stored UTM data (call after successful signup). */
export function clearUtmData(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Capture UTM from URL and persist to localStorage. Call once on page load. */
export function captureUtm(): void {
  const utm = getUtmFromUrl();
  if (utm) persistUtm(utm);
}
