/**
 * Client-side page view tracker (cookie-free).
 *
 * Uses sessionStorage for a per-tab session ID.
 * Fires a single POST to /api/track on every page navigation.
 * Designed to be called inside a useEffect in the marketing layout.
 */

import { getUtmData } from "@/lib/utm";

const SESSION_KEY = "packet_sid";

/** Get or create a session ID (survives reloads, dies on tab close). */
export function getSessionId(): string {
  if (typeof sessionStorage === "undefined") return "";

  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

/** Record a page view. Call once per page load. */
export function trackPageView(): void {
  if (typeof window === "undefined") return;

  const sessionId = getSessionId();
  if (!sessionId) return;

  const utm = getUtmData();

  const payload = {
    sessionId,
    page: window.location.pathname,
    referrer: document.referrer || undefined,
    ...(utm ? { utm } : {}),
  };

  // Fire-and-forget, never block rendering
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", JSON.stringify(payload));
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // tracking should never break the app
  }
}
