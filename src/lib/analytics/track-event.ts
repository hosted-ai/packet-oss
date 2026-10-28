/**
 * Client-side GA4 + PostHog event tracking utility.
 *
 * Provides a single `trackEvent()` function for all frontend analytics events.
 * Fires both GA4 (via gtag) and PostHog (via posthog-js) in parallel.
 * Fire-and-forget: never throws, never blocks UI.
 *
 * Usage:
 *   import { trackEvent } from "@/lib/analytics/track-event";
 *   trackEvent("gpu_browse");
 *   trackEvent("plan_selected", { plan_type: "dedicated", price_monthly: 1299 });
 */

import posthog from "posthog-js";

type EventParams = Record<string, string | number | boolean | undefined>;

/**
 * Fire a named event to both GA4 and PostHog.
 *
 * @param eventName  GA4-style snake_case event name
 * @param params     Optional key-value parameters (undefined values are stripped)
 */
export function trackEvent(
  eventName: string,
  params?: EventParams
): void {
  if (typeof window === "undefined") return;

  // Strip undefined values for a clean payload
  const clean: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) clean[k] = v;
    }
  }

  // GA4 via gtag (loaded in layout.tsx)
  try {
    const w = window as Window & { gtag?: (...args: unknown[]) => void };
    w.gtag?.("event", eventName, clean);
  } catch {
    // Analytics must never break the main flow
  }

  // PostHog via posthog-js (initialized in PostHogProvider)
  try {
    posthog.capture(eventName, clean);
  } catch {
    // Analytics must never break the main flow
  }
}


