"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

function initPostHog(
  key: string | null | undefined,
  host: string | null | undefined,
) {
  if (!key || !host) return;
  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    // Session replay: disabled at boot — started explicitly after user is
    // identified (see useDashboardData). This ensures only authenticated
    // sessions are ever recorded.
    disable_session_recording: true,
    session_recording: {
      // Only mask password fields. All other inputs (settings, search,
      // forms) remain visible in recordings. Stripe card fields live in
      // cross-origin iframes that PostHog cannot access at all.
      maskAllInputs: false,
      maskInputOptions: {
        password: true,
      },
    },
  });
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // NEXT_PUBLIC_* values are inlined into the client bundle at build time.
    // Packaged (.deb) builds compile on Jenkins with no .env present, so they
    // inline as undefined — fall back to the server's runtime env via
    // /api/analytics-config. The fetch resolves well before the dashboard's
    // /api/account/verify roundtrip, so init lands ahead of identify() /
    // startSessionRecording() in useDashboardData.
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    if (key && host) {
      initPostHog(key, host);
      return;
    }
    fetch("/api/analytics-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => cfg && initPostHog(cfg.key, cfg.host))
      .catch(() => {
        // Analytics must never break the app
        console.log("init posthog failed.");
      });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
