"use client";

import { useEffect } from "react";
import { buildSignInRedirect } from "@/lib/auth/signin-redirect";

/**
 * Wraps window.fetch once per page load. When a same-origin /api/* call returns
 * 401, redirects the user to the supplied login page so they can re-authenticate
 * instead of silently failing in place.
 *
 * Auth endpoints (anything matching /api/(...)/auth) are skipped so the initial
 * "am I logged in?" check doesn't trigger a redirect loop with the existing
 * mount-time check in useAdminData.
 */

interface SessionGuardProps {
  redirectTo: string;
}

const INSTALL_FLAG = "__packetSessionGuardInstalled" as const;

function isAuthEndpoint(pathname: string): boolean {
  return /\/auth(\/|$)/.test(pathname);
}

// PA-267: the session-bootstrap endpoints handle their own 401s (the dashboard
// hook owns verify + cookie fallback). Excluding them here prevents a
// refresh → reload → 401 loop.
function isSessionBootstrapEndpoint(pathname: string): boolean {
  return (
    pathname === "/api/account/session" ||
    pathname === "/api/account/verify" ||
    pathname === "/api/account/logout"
  );
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function SessionGuard({ redirectTo }: SessionGuardProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const w = window as unknown as Record<string, unknown>;
    if (w[INSTALL_FLAG]) return;
    w[INSTALL_FLAG] = true;

    const originalFetch = window.fetch.bind(window);
    let redirecting = false;

    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);

      if (response.status !== 401 || redirecting) return response;

      try {
        const url = new URL(getRequestUrl(input), window.location.origin);
        const sameOrigin = url.origin === window.location.origin;
        const isApi = url.pathname.startsWith("/api/");

        if (
          sameOrigin &&
          isApi &&
          !isAuthEndpoint(url.pathname) &&
          !isSessionBootstrapEndpoint(url.pathname)
        ) {
          redirecting = true; // gate re-entry while we recover
          // PA-267: the in-memory access token likely just expired. Try to mint a
          // fresh one from the persistent session cookie before sending the user
          // to sign in. originalFetch bypasses this wrapper (no recursion).
          let refreshStatus: number | "error" = "error";
          try {
            const r = await originalFetch("/api/account/session", { method: "POST" });
            refreshStatus = r.ok ? 200 : r.status;
          } catch {
            refreshStatus = "error";
          }
          const toLogin = () => {
            // PA-335: preserve the deep link the visitor was on so signup/signin
            // (and the welcome email) can send them back to it.
            window.location.href = buildSignInRedirect(
              redirectTo,
              window.location.pathname + window.location.search,
            );
          };
          if (refreshStatus === 200) {
            // Fresh token minted. Reload to re-bootstrap — but at most once per ~15s
            // so a 401 that a fresh token can't fix never becomes an infinite loop.
            const RELOAD_KEY = "packet_sg_reloaded_at";
            let last = 0;
            try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* ignore */ }
            if (last && Date.now() - last < 15000) {
              toLogin(); // already reloaded recently and still 401 → stop looping
            } else {
              try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
              window.location.reload();
            }
          } else if (refreshStatus === 401) {
            toLogin(); // session genuinely dead
          } else {
            // Transient 5xx / network — don't force a logout; let the 401 surface.
            redirecting = false;
          }
        }
      } catch {
        // If URL parsing fails, just return the response — better to surface
        // the 401 normally than to break the page.
      }

      return response;
    };
  }, [redirectTo]);

  return null;
}
