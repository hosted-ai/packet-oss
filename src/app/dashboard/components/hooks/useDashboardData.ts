"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { trackEvent } from "@/lib/analytics/track-event";
import {
  AccountData,
  ActivityEvent,
  BillingStats,
  Instance,
  PoolSubscription,
  HfDeploymentInfo,
  PodSnapshot,
} from "../types";
import {
  getTimeBasedGreeting,
  getRandomTagline,
  getTimeBasedEasterEgg,
  getEmptyStateMessage,
} from "../utils";
import { buildSignInRedirect } from "@/lib/auth/signin-redirect";

export interface DashboardDataState {
  // Reservation percentage a stopped pod keeps billing at (from /api/instances).
  stoppedRatePercent: number;
  // Auth & Loading
  token: string | null;
  loading: boolean;
  error: string;

  // Account data
  data: AccountData | null;

  // Instances & Subscriptions
  instances: Instance[];
  poolSubscriptions: PoolSubscription[];
  podMetadata: Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string; deployStatus?: string | null; deployStatusReason?: string | null }>;
  hfDeployments: Record<string, HfDeploymentInfo>;
  instancesLoading: boolean;

  // Activity & Billing
  activityEvents: ActivityEvent[];
  billingStats: BillingStats | null;

  // Snapshots
  snapshots: PodSnapshot[];

  // Provisioning state
  provisioningGpu: { name: string; poolName: string } | null;

  // UI personalization
  greeting: string;
  tagline: string;
  easterEgg: string | null;
  emptyState: { title: string; subtitle: string };

  // 2FA state
  twoFactorRequired: boolean;
  twoFactorVerified: boolean;
  pendingUserEmail: string | null;

  // TOS consent state
  tosConsentRequired: boolean;
  tosConsentVersion: string | null;

  // Onboarding tour: first-ever login
  isNewSignup: boolean;
}

export interface DashboardDataActions {
  fetchInstances: () => Promise<void>;
  fetchActivityEvents: () => Promise<void>;
  fetchBillingStats: () => Promise<void>;
  fetchSnapshots: () => Promise<void>;
  setData: (data: AccountData | null) => void;
  setProvisioningGpu: (gpu: { name: string; poolName: string } | null) => void;
  setTwoFactorVerified: (verified: boolean) => void;
  setTwoFactorRequired: (required: boolean) => void;
  setTosConsentRequired: (required: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
}

export function useDashboardData(): DashboardDataState & DashboardDataActions & { ticketId: string | null } {
  const searchParams = useSearchParams();
  const urlToken = searchParams.get("token");
  const ticketId = searchParams.get("ticket"); // Deep link to specific support ticket

  // PA-267: a returning user has no one-time URL token; we bootstrap a short-lived
  // access token from the persistent session cookie via /api/account/session.
  // urlTokenDead lets a stale ?token= fall back to the cookie instead of erroring.
  const [cookieToken, setCookieToken] = useState<string | null>(null);
  const [urlTokenDead, setUrlTokenDead] = useState(false);
  const token = (urlTokenDead ? null : urlToken) || cookieToken;

  // UI personalization state
  const [greeting, setGreeting] = useState("Welcome back");
  const [tagline, setTagline] = useState("");
  const [easterEgg, setEasterEgg] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState({ title: "No GPUs running", subtitle: "Launch one to get started" });

  // Core loading state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<AccountData | null>(null);

  // Instances & subscriptions
  const [instances, setInstances] = useState<Instance[]>([]);
  const [poolSubscriptions, setPoolSubscriptions] = useState<PoolSubscription[]>([]);
  // Reservation percentage a stopped pod keeps billing at; assume full rate until told otherwise.
  const [stoppedRatePercent, setStoppedRatePercent] = useState(100);
  const [podMetadata, setPodMetadata] = useState<Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string; deployStatus?: string | null; deployStatusReason?: string | null }>>({});
  const [hfDeployments, setHfDeployments] = useState<Record<string, HfDeploymentInfo>>({});
  const [instancesLoading, setInstancesLoading] = useState(false);

  // Activity & billing
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [billingStats, setBillingStats] = useState<BillingStats | null>(null);

  // Snapshots
  const [snapshots, setSnapshots] = useState<PodSnapshot[]>([]);

  // Provisioning state
  const [provisioningGpu, setProvisioningGpu] = useState<{ name: string; poolName: string } | null>(null);

  // 2FA state
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorVerified, setTwoFactorVerified] = useState(false);
  const [pendingUserEmail, setPendingUserEmail] = useState<string | null>(null);

  // TOS consent state
  const [tosConsentRequired, setTosConsentRequired] = useState(false);
  const [tosConsentVersion, setTosConsentVersion] = useState<string | null>(null);

  // Onboarding tour: first-ever login signal from /api/account/verify
  const [isNewSignup, setIsNewSignup] = useState(false);

  // Fetch callbacks
  const fetchInstances = useCallback(async () => {
    if (!token) return;
    setInstancesLoading(true);
    try {
      const response = await fetch("/api/instances", { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const result = await response.json();
        setInstances(result.instances || []);
        // Merge hourlyRate from podMetadata into poolSubscriptions
        const metadata = result.podMetadata || {};
        const subscriptions = (result.poolSubscriptions || []).map((sub: PoolSubscription) => ({
          ...sub,
          hourlyRate: metadata[String(sub.id)]?.hourlyRate ?? sub.hourlyRate,
        }));
        setPoolSubscriptions(subscriptions);
        if (typeof result.stoppedRatePercent === "number") setStoppedRatePercent(result.stoppedRatePercent);
        setPodMetadata(metadata);
        setHfDeployments(result.hfDeployments || {});
        if (subscriptions.length > 0) setProvisioningGpu(null);
      }
    } catch (error) {
      console.error("Failed to fetch instances:", error);
    } finally {
      setInstancesLoading(false);
    }
  }, [token]);

  const fetchActivityEvents = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/account/activity", { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const result = await response.json();
        setActivityEvents(result.events || []);
      }
    } catch (error) {
      console.error("Failed to fetch activity:", error);
    }
  }, [token]);

  const fetchBillingStats = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/account/billing-stats", { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const result = await response.json();
        setBillingStats(result);
      }
    } catch (error) {
      console.error("Failed to fetch billing stats:", error);
    }
  }, [token]);

  const fetchSnapshots = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("/api/instances/snapshots", { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const result = await response.json();
        setSnapshots(result.snapshots || []);
      }
    } catch (error) {
      console.error("Failed to fetch snapshots:", error);
    }
  }, [token]);

  // Set time-based greeting and other personalization on client side
  useEffect(() => {
    setGreeting(getTimeBasedGreeting());
    setTagline(getRandomTagline());
    setEasterEgg(getTimeBasedEasterEgg());
    setEmptyState(getEmptyStateMessage());
  }, []);

  // Initial data fetch
  useEffect(() => {
    let cancelled = false;

    // { token } = refreshed; { dead:true } = genuinely no/expired session (sign in);
    // { dead:false } = transient 5xx/network — do NOT log the user out over a blip.
    async function refreshFromCookie(): Promise<{ token: string } | { dead: boolean }> {
      try {
        const r = await fetch("/api/account/session", { method: "POST" });
        if (r.ok) {
          const j = await r.json();
          if (typeof j?.token === "string") return { token: j.token };
          return { dead: true };
        }
        return { dead: r.status === 401 };
      } catch {
        return { dead: false }; // network blip — transient
      }
    }

    function signInRedirect() {
      if (typeof window !== "undefined") {
        // Clear PostHog identity before redirecting so a subsequent login
        // by a different user (e.g. a teammate on a shared device) doesn't
        // merge them with the previous user's PostHog person.
        posthog.reset();
        // PA-335: carry the deep link the visitor arrived on through the sign-in
        // bounce, so signup/signin (and the welcome email) can return them to it.
        // buildSignInRedirect already sets ?reason=session_expired.
        window.location.href = buildSignInRedirect(
          "/account",
          window.location.pathname + window.location.search,
        );
        return true;
      }
      return false;
    }

    async function bootstrap() {
      // No usable token (return visit / stripped URL) → try the session cookie.
      if (!token) {
        const res = await refreshFromCookie();
        if (cancelled) return;
        if ("token" in res) {
          setCookieToken(res.token); // re-runs this effect with a token; keep loading
          return;
        }
        if (res.dead) {
          // No URL token and no live session cookie → send them to sign in.
          if (signInRedirect()) return;
          setError("No access token provided");
        } else {
          // Transient backend issue — keep the (still-valid) session, let them retry.
          setError("Couldn't reach the server. Please refresh to try again.");
        }
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/account/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const result = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          // A stale one-time URL token can still fall back to the cookie session.
          if (response.status === 401 && !urlTokenDead && urlToken && token === urlToken) {
            const res = await refreshFromCookie();
            if (cancelled) return;
            if ("token" in res) {
              setCookieToken(res.token);
              setUrlTokenDead(true); // stop the dead URL token from winning; keep loading
              return;
            }
            // Cookie genuinely dead → sign in; transient → keep them, let them retry.
            if (res.dead) {
              if (signInRedirect()) return;
            } else {
              setError("Couldn't reach the server. Please refresh to try again.");
              setLoading(false);
              return;
            }
          }
          // Token rejected and no live session cookie to fall back to → sign in.
          if (response.status === 401 && signInRedirect()) return;
          setError(result.error || "Failed to load account");
          setLoading(false);
          return;
        }

        // Check if 2FA is required but not yet verified
        // Skip 2FA if this is an admin bypass token
        if (result.twoFactor?.enabled && !twoFactorVerified && !result.skipTwoFactor) {
          setPendingUserEmail(result.userEmail);
          setTwoFactorRequired(true);
          setLoading(false);
          return;
        }

        // Check if TOS consent is required (after 2FA passes)
        if (result.tosConsent?.required) {
          setTosConsentVersion(result.tosConsent.currentVersion || null);
          setTosConsentRequired(true);
        }

        // PA-267: strip any one-time ?token= from the URL after a successful load
        // (magic-link, billing-portal return, or stale-token fallback) so the JWT
        // never lingers in history/referrer — not only when a new session was just
        // persisted. Promote the live token into state FIRST so removing the param
        // (which useSearchParams reacts to) can't momentarily null out `token` and
        // fire a burst of spurious 401s. A token already marked dead isn't promoted.
        if (typeof window !== "undefined" && urlToken) {
          // PA-380: after a magic-link sign-in, run the session on the fresh 12h
          // access token the server just minted (result.accessToken) rather than
          // the short-lived single-use link — otherwise the tab would hit a
          // SessionGuard reload the moment the 15-min link expired. Falls back to
          // the current token on repeat loads (no new session → no accessToken).
          if (!urlTokenDead && token) setCookieToken(result.accessToken || token);
          const u = new URL(window.location.href);
          if (u.searchParams.has("token")) {
            u.searchParams.delete("token");
            window.history.replaceState({}, "", u.pathname + (u.search || ""));
          }
        }

        setData(result);

        // PostHog: identify the authenticated user and start session recording.
        // Uses email as distinctId so team members each get their own PostHog
        // person (multiple users can share one Stripe customer in team accounts).
        if (result.userEmail && typeof window !== "undefined") {
          posthog.identify(result.userEmail, {
            email: result.userEmail,
            stripe_customer_id: result.customer?.id,
            ...(result.customer?.teamName ? { team_name: result.customer.teamName } : {}),
            ...(result.role ? { role: result.role } : {}),
          });
          posthog.startSessionRecording();
        }

        // Signal the onboarding tour for first-time users.
        if (result.isNewSignup) setIsNewSignup(true);

        // GA4 + PostHog: fire sign_up_complete on the first-ever dashboard load
        // (account created + email verified via magic-link).
        if (result.isNewSignup && typeof window !== "undefined") {
          (window as Window & { gtag?: (...args: unknown[]) => void }).gtag?.(
            "event",
            "sign_up_complete",
            { method: "email" }
          );
          posthog.capture("sign_up_complete", { method: "email" });
        }

        // GA4: fire login event for returning users (not new signups)
        if (!result.isNewSignup && typeof window !== "undefined") {
          trackEvent("login");
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Failed to load account data");
          setLoading(false);
        }
      }
    }

    bootstrap();

    // Only fetch additional data if we have a token and 2FA is satisfied.
    if (token && (!twoFactorRequired || twoFactorVerified)) {
      fetchInstances();
      fetchActivityEvents();
      fetchBillingStats();
      fetchSnapshots();
    }

    return () => {
      cancelled = true;
    };
  }, [token, urlToken, urlTokenDead, fetchInstances, fetchActivityEvents, fetchBillingStats, fetchSnapshots, twoFactorRequired, twoFactorVerified]);

  // Polling interval for live updates
  useEffect(() => {
    if (!token || !data) return;
    const interval = setInterval(() => {
      fetchInstances();
      fetchActivityEvents();
    }, 30000);
    return () => clearInterval(interval);
  }, [token, data, fetchInstances, fetchActivityEvents]);

  return {
    // State
    token,
    loading,
    error,
    data,
    instances,
    poolSubscriptions,
    stoppedRatePercent,
    podMetadata,
    hfDeployments,
    instancesLoading,
    activityEvents,
    billingStats,
    snapshots,
    provisioningGpu,
    greeting,
    tagline,
    easterEgg,
    emptyState,
    twoFactorRequired,
    twoFactorVerified,
    pendingUserEmail,
    tosConsentRequired,
    tosConsentVersion,
    isNewSignup,
    ticketId, // Deep link to support ticket

    // Actions
    fetchInstances,
    fetchActivityEvents,
    fetchBillingStats,
    fetchSnapshots,
    setData,
    setProvisioningGpu,
    setTwoFactorVerified,
    setTwoFactorRequired,
    setTosConsentRequired,
    setLoading,
    setError,
  };
}
