"use client";

import React from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { BrandLogo } from "@/components/BrandLogo";
import { isPro, hasPremiumFeature } from "@/lib/edition";
import { computeHourlyBurn } from "@/lib/burn-rate";
import dynamic from "next/dynamic";

import TeamMembers from "@/components/TeamMembers";
import HuggingFaceTab from "@/components/HuggingFaceTab";
import { TwoFactorSettings } from "@/components/two-factor";
import TwoFactorVerify from "@/components/TwoFactorVerify";
import TosConsentModal from "@/components/TosConsentModal";
import { LogoutConfirmModal } from "@/components/logout-confirm-modal";
import ReferralCard from "@/components/ReferralCard";
import { formatSmartPrice } from "@/lib/format";
import { ApiKeysSettings } from "@/components/ApiKeysSettings";
import { AppsTab } from "./AppsTab";
import { StorageTab } from "./StorageTab";
import { BareMetalInstanceCard } from "./BareMetalInstanceCard";
import { resolveLaunchDeeplink } from "./launch-deeplink";
import { sanitizeNextPath } from "@/lib/auth/safe-next";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { CrispUserSync } from "@/components/CrispUserSync";
import { isTabAllowed } from "./tab-access";

// Support tab — edition-gated: Pro uses Zammad ticketing, OSS uses contact form
const SupportTab = hasPremiumFeature("support")
  ? dynamic(() => import("./SupportTab").then(m => ({ default: m.SupportTab })))
  : dynamic(() => import("./OssSupportTab").then(m => ({ default: m.OssSupportTab })));

// Premium tabs — dynamically imported, only available in Pro edition
const BareMetalTab = hasPremiumFeature("bare-metal")
  ? dynamic(() => import("./BareMetalTab").then(m => ({ default: m.BareMetalTab })))
  : () => null;

// Bare Metal Orders — term-prepay wire-invoice flow. The component file IS
// OSS-export-excluded, so it must only be referenced via an edition-gated
// dynamic import (same pattern as BareMetalTab above) or the OSS build breaks.
const BareMetalOrdersTab = isPro()
  ? dynamic(() => import("./BareMetalOrdersTab").then(m => ({ default: m.BareMetalOrdersTab })))
  : () => null;
const TruConversionIdentity = hasPremiumFeature("analytics")
  ? dynamic(() => import("@/components/TruConversionIdentity").then(m => ({ default: m.TruConversionIdentity })))
  : () => null;

import {
  // Components
  StatusDot,
  UsageChart,
  GPUUsageChart,
  NavItem,
  LaunchGPUModal,
  PoolSubscriptionCard,
  SnapshotCard,
  MetricsTab,
  BillingTab,
  // Utilities
  getWalletReaction,
} from "./";
import { useLiveCostTicker } from "@/hooks/useLiveCostTicker";
import { HelpTooltip, HELP_CONTENT } from "@/components/HelpTooltip";
import { TopupModal, ActivityLogModal, TransactionsModal, BlackwellModal, MonthlyPlansModal } from "./modals";
import { MobileHeader, MobileNav, MobileMenuSheet, MobileMoreSheet } from "./MobileDashboard";
import { ProfileSettings } from "./ProfileSettings";
import { BudgetSettings } from "./BudgetSettings";
import { getBrandName, getAppUrl, getLogoUrl } from "@/lib/branding-client";
import { useBranding } from "@/hooks/useBranding";
import SSHKeys from "@/components/SSHKeys";
import { useDashboardData, useDashboardActions, useModals, TabType } from "./hooks";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingTour } from "./OnboardingTour";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { InvitationAcceptModal } from "@/components/InvitationAcceptModal";
import { useSearchParams } from "next/navigation";
import { DashboardAnnouncements } from "./DashboardAnnouncements";
import { B200Banner } from "./B200Banner";

export function DashboardContent() {
  // PA-175: when /invite/<token> lands the user here with ?invite=<token>
  // in the URL, we render the InvitationAcceptModal. Read it once up here
  // so the JSX below can stay readable.
  const dashboardSearchParams = useSearchParams();
  const inviteTokenFromUrl = dashboardSearchParams.get("invite");

  // Use extracted hooks
  const {
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
    setTosConsentRequired,
    fetchInstances,
    fetchActivityEvents,
    fetchBillingStats,
    fetchSnapshots,
    setData,
    setProvisioningGpu,
    setTwoFactorVerified,
    setTwoFactorRequired,
    setLoading,
    setError,
    ticketId,
  } = useDashboardData();

  const {
    topupLoading,
    billingPortalLoading,
    openBillingPortal,
    downloadActivityCSV,
    downloadTransactionsCSV,
    formatDateTime,
    handleTopup,
  } = useDashboardActions({ token, data, activityEvents });

  const {
    showLaunchModal,
    showTopupModal,
    showActivityModal,
    showTransactionsModal,
    activeTab,
    setShowLaunchModal,
    setShowTopupModal,
    setShowActivityModal,
    setShowTransactionsModal,
    setActiveTab,
  } = useModals();

  // DB-backed branding (logo URL, brand name, etc.)
  const branding = useBranding();
  const logoUrl = branding?.logoUrl || getLogoUrl();
  const brandName = branding?.brandName || getBrandName();

  // Refresh account data (e.g. after voucher redemption)
  const refreshAccountData = React.useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/account/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch {
      // Silently fail — data will refresh on next page load
    }
  }, [token, setData]);

  // Logout confirmation modal state
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);

  // Blackwell subscription modal state (legacy single-product modal — kept for reference)
  const [showBlackwellModal, setShowBlackwellModal] = React.useState(false);

  // Monthly plans modal (lists all monthly products)
  const [showMonthlyPlansModal, setShowMonthlyPlansModal] = React.useState(false);


  // Track product ID to pre-select in launch modal (e.g., after returning from top-up)
  const [launchProductId, setLaunchProductId] = React.useState<string | undefined>(undefined);

  // Track GPU category slug to pre-select in launch modal (deep-link ?gpu=<slug>)
  const [launchCategorySlug, setLaunchCategorySlug] = React.useState<string | undefined>(undefined);

  // Track GPU category slug to pre-select in the monthly plans modal (deep-link ?gpu=<slug>&plan=monthly)
  const [monthlyCategorySlug, setMonthlyCategorySlug] = React.useState<string | undefined>(undefined);

  // Guard so the post-login deep-link (next claim) is applied at most once.
  const appliedNextRef = React.useRef(false);

  // When deploying a specific monthly subscription, lock the launch modal to
  // that product and pass the subscription ID to the instances API.
  const [launchSubscription, setLaunchSubscription] = React.useState<
    { productId: string | null; stripeSubscriptionId: string } | null
  >(null);

  // Toast notifications
  const [topupToast, setTopupToast] = React.useState<string | null>(null);
  const [errorToast, setErrorToast] = React.useState<string | null>(null);

  // Unread support messages state
  const [hasUnreadSupport, setHasUnreadSupport] = React.useState(false);

  // Mobile navigation state
  const [showMobileMenu, setShowMobileMenu] = React.useState(false);
  const [showMoreSheet, setShowMoreSheet] = React.useState(false);

  // Sticky header style toggles when the sentinel scrolls out of view.
  // Uses a callback ref so the observer attaches when the sentinel mounts
  // — the dashboard is rendered behind a `loading` guard, so a useEffect
  // with [activeTab] would fire while the sentinel is still null.
  const [isHeaderStuck, setIsHeaderStuck] = React.useState(false);
  const stickyHeaderObserverRef = React.useRef<IntersectionObserver | null>(null);
  const stickyHeaderSentinelRef = React.useCallback((node: HTMLDivElement | null) => {
    stickyHeaderObserverRef.current?.disconnect();
    stickyHeaderObserverRef.current = null;
    if (!node) return;
    let scrollParent: HTMLElement | null = node.parentElement;
    while (scrollParent) {
      const overflowY = window.getComputedStyle(scrollParent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setIsHeaderStuck(!entry.isIntersecting),
      { root: scrollParent, threshold: 0 }
    );
    observer.observe(node);
    stickyHeaderObserverRef.current = observer;
  }, []);

  // Bare metal deployments (active GPU nodes)
  const [bareMetalNodes, setBareMetalNodes] = React.useState<Array<{
    id: string;
    name: string | null;
    gpu: string;
    gpuCount: number;
    region: string;
    status: string;
    ipAddress: string | null;
    sshUser: string | null;
    hourlyRate: number;
    createdAt: string;
  }>>([]);

  const fetchBareMetalNodes = React.useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/dashboard/bare-metal/deployments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const result = await res.json();
        const active = (result.data || []).filter(
          (d: { status: string }) => d.status === "running" || d.status === "deploying"
        );
        setBareMetalNodes(active);
      }
    } catch {
      // Non-critical — don't block dashboard
    }
  }, [token]);

  React.useEffect(() => {
    fetchBareMetalNodes();
  }, [fetchBareMetalNodes]);

  // PA-190: real GPU telemetry (TFLOPs + VRAM) from HAI via the user-panel API,
  // replacing the old per-pod SSH nvidia-smi collector. Drives the Compute +
  // VRAM cards (number + chart). Last-5m window, polled each minute.
  const [gpuSeries, setGpuSeries] = React.useState<
    Array<{ unix_timestamp: number; formatted_time: string; tflops: number; vram_mib: number }>
  >([]);
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const fetchGpuMetrics = async () => {
      try {
        const res = await fetch("/api/instances/gpu-metrics?window=last_5m", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && Array.isArray(json.data)) setGpuSeries(json.data);
      } catch {
        // Non-critical — leave the cards in their empty/collecting state.
      }
    };
    fetchGpuMetrics();
    const interval = setInterval(fetchGpuMetrics, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  // Calculate values needed for live cost ticker (must be before any early returns)
  // Treat users as hourly if they have wallet credit (e.g. voucher users with billing_type "free")
  const isHourlyEarly = data?.customer?.billingType === "hourly" || (data?.wallet?.balance || 0) > 0;
  // Bare metal rows (nature "baremetal") are display-only in the pods grid:
  // exclude them from GPU metrics charts and app/service discovery — their
  // per-row metric/service fetches use VM-only endpoints that reject
  // baremetal ids. (Their statuses already fall outside the active filters,
  // so the cost ticker/totalRunning never count them.)
  const vmPodSubscriptions = poolSubscriptions.filter((s) => s.nature !== "baremetal");
  const activeSubscriptionsEarly = poolSubscriptions.filter((s) => s.status === "subscribed" || s.status === "active" || s.status === "running" || s.status === "pending" || s.status === "starting" || s.status === "restarting");
  const totalRunningEarly = instances.filter((i) => i.status === "running" || i.status === "active").length + activeSubscriptionsEarly.length;
  // Stopped pods keep billing at the reservation rate, so the ticker and the
  // runway must drain at running + stopped, not running alone.
  const burnEarly = computeHourlyBurn(poolSubscriptions, stoppedRatePercent);
  const totalHourlyRateEarly = burnEarly.totalHourly;

  // Live Cost Ticker - real-time balance countdown (must be called unconditionally)
  const liveCostTicker = useLiveCostTicker({
    initialBalance: data?.wallet?.balance || 0,
    totalHourlyRate: totalHourlyRateEarly,
    isActive: (totalRunningEarly > 0 || burnEarly.stoppedBillableCount > 0) && isHourlyEarly && !loading && !error,
    onSync: async () => {
      // Sync with server by fetching fresh wallet balance
      if (!token) return data?.wallet?.balance || 0;
      try {
        const res = await fetch("/api/account/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          const result = await res.json();
          return result.wallet?.balance || 0;
        }
      } catch (err) {
        console.error("Failed to sync balance:", err);
      }
      return data?.wallet?.balance || 0;
    },
  });

  // Poll for unread support messages (PA-226).
  // - Hits the lean /api/support/unread endpoint (~1 Zammad call) instead of
  //   the full /api/support/tickets path (3 + N calls).
  // - Polls every 5 minutes, not every 30 seconds.
  // - Pauses entirely while the tab is hidden; resumes with one immediate
  //   check when the tab is visible again.
  React.useEffect(() => {
    if (!token) return;

    const checkUnread = async () => {
      try {
        const res = await fetch("/api/support/unread", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          setHasUnreadSupport(data.hasUnreadReplies || false);
        }
      } catch {
        // Ignore errors silently
      }
    };

    const POLL_MS = 5 * 60 * 1000;
    let interval: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (interval !== undefined) return;
      void checkUnread();
      interval = setInterval(() => {
        void checkUnread();
      }, POLL_MS);
    };

    const stop = () => {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [token]);

  // Clear unread badge when viewing support tab
  React.useEffect(() => {
    if (activeTab === "support") {
      setHasUnreadSupport(false);
    }
  }, [activeTab]);

  // Auto-switch to support tab when deep link ticket param is present
  React.useEffect(() => {
    if (ticketId) {
      setActiveTab("support");
    }
  }, [ticketId, setActiveTab]);

  // PA-269: guard permission-gated tabs against direct ?tab= navigation. The
  // sidebar hides Billing/etc. for unprivileged roles, but the URL still mounts
  // the tab. If the loaded permission map says this user can't view the active
  // tab, bounce to the dashboard. (Defense-in-depth + UX — the data APIs are
  // the real boundary and enforce the same permissions server-side.)
  React.useEffect(() => {
    if (!data?.can) return; // can-map not loaded yet — don't redirect on first paint
    if (!isTabAllowed(activeTab, data.can, { bareMetalEnabled: isPro() && !!data.bareMetalEnabled })) {
      setActiveTab("dashboard");
    }
  }, [activeTab, data?.can, data?.bareMetalEnabled, setActiveTab]);

  // Handle return from Stripe top-up: show toast, auto-reopen launch modal
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const topupStatus = params.get("topup");
    const amountParam = params.get("amount");
    const launchProduct = params.get("launchProduct");

    if (topupStatus === "success") {
      // Track wallet refill conversion
      if (typeof window.my_analytics !== "undefined") {
        window.my_analytics.goal("0xxmvyzdifvutbty");
      }

      // Growify v2 conversion — wallet top-up
      if (amountParam) {
        try {
          const amountDollars = parseInt(amountParam) / 100;
          const custEmail = data?.customer?.email;
          const custName = data?.customer?.name || "";
          const nameParts = custName.split(" ");
          const w = window;
          w.grpQueue = w.grpQueue || [];
          if (!w.grp) { w.grp = function(...args: unknown[]) { w.grpQueue?.push(args); }; }
          w.grp('conversion', {
            userEmail: custEmail || '',
            userFirstName: nameParts[0] || '',
            userLastName: nameParts.slice(1).join(" ") || '',
            userId: custEmail || '',
            orderId: `topup-${Date.now()}`,
            tax: 0,
            shipping: 0,
            products: [{
              productId: "wallet-topup",
              productName: "Wallet Top-Up",
              productPrice: amountDollars,
              productBrand: "gpu-cloud",
              productQuantity: 1,
              purchaseValue: amountDollars,
            }],
          });
        } catch { /* Growify not loaded */ }
      }

      // Show success toast
      if (amountParam) {
        const dollars = (parseInt(amountParam) / 100).toFixed(0);
        setTopupToast(`Added $${dollars} to your wallet`);
        setTimeout(() => setTopupToast(null), 5000);
      }

      // Auto-reopen the launch modal with the product they were trying to launch
      if (launchProduct) {
        setLaunchProductId(launchProduct);
        setShowLaunchModal(true);
      }

      // Clean up URL params
      const url = new URL(window.location.href);
      url.searchParams.delete("topup");
      url.searchParams.delete("amount");
      url.searchParams.delete("bonus");
      url.searchParams.delete("launchProduct");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Category deep-link: /dashboard?gpu=<slug>&plan=<hourly|monthly>. Opens the
  // matching launch flow pre-seeded (hourly stepper with the category chosen, or
  // the monthly plans modal), then strips the params so a refresh/back doesn't
  // re-trigger. Runs once on mount; the stepper's own fund-wallet gate handles
  // an unfunded wallet at launch time, so the intent is preserved either way.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const target = resolveLaunchDeeplink(window.location.search);
    if (target.kind === "none") return;

    if (target.kind === "monthly") {
      if (target.categorySlug) setMonthlyCategorySlug(target.categorySlug);
      setShowMonthlyPlansModal(true);
    } else {
      if (target.categorySlug) setLaunchCategorySlug(target.categorySlug);
      setShowLaunchModal(true);
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("gpu");
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.pathname + (url.search || ""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the post-login deep-link intent carried in the verified token (the
  // `next` claim from the magic-link flow). Same modal handling as a direct
  // ?gpu= URL, but sourced from the signed claim that survived login. Once only.
  React.useEffect(() => {
    if (appliedNextRef.current) return;
    const next = data?.next;
    if (!next || typeof window === "undefined") return;
    appliedNextRef.current = true;
    let url: URL;
    try {
      url = new URL(next, window.location.origin);
    } catch {
      return;
    }
    const target = resolveLaunchDeeplink(url.search);
    if (target.kind === "monthly") {
      if (target.categorySlug) setMonthlyCategorySlug(target.categorySlug);
      setShowMonthlyPlansModal(true);
    } else if (target.kind === "hourly") {
      if (target.categorySlug) setLaunchCategorySlug(target.categorySlug);
      setShowLaunchModal(true);
    } else {
      // PA-335: a non-launch deep link (a shared page or ?ref= link the visitor
      // originally came in on) — send them to the real destination instead of
      // stranding them on the bare dashboard. Re-run the same sanitiser used at
      // sign time (defence in depth: only ever navigate to a same-origin app
      // path) and replace() so the one-time token URL doesn't linger in history.
      const dest = sanitizeNextPath(next, window.location.origin);
      if (dest && dest !== "/dashboard") window.location.replace(dest);
    }
  }, [data, setShowLaunchModal]);

  // PA-351: the empty-wallet "Welcome" top-up popup was removed entirely —
  // no auto-show for new users and no balance pre-check on launch. The launch
  // modal + server enforce affordability (same as the PA-271 redacted-wallet
  // path); top-up lives in the wallet UI (TopupModal).
  const handleLaunchGpu = React.useCallback(() => {
    setShowLaunchModal(true);
  }, [setShowLaunchModal]);

  // PA-384: dashboard B200 banner — mirrors the ?gpu=b200 deep-link behavior
  // (resolveLaunchDeeplink's "hourly" path) so deployment matches exactly.
  const handleLaunchB200 = React.useCallback(() => {
    setLaunchCategorySlug("b200");
    setShowLaunchModal(true);
  }, [setLaunchCategorySlug, setShowLaunchModal]);

  const handleLogout = async () => {
    // PA-267: revoke the server-side session + clear the cookie so a copied
    // refresh token is dead immediately, then return to sign-in.
    try {
      await fetch("/api/account/logout", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      // best-effort — navigate away regardless
    }
    // Stop session recording and clear the identified user so no post-logout
    // activity is attributed to the previous session.
    posthog.reset();
    // Feature 5: reset Crisp session so the next visitor starts fresh
    if (typeof window !== "undefined" && window.$crisp) {
      window.$crisp.push(["do", "session:reset"]);
    }
    window.location.href = "/account";
  };

  // Handle mobile tab changes - shows "More" sheet for overflow items
  const handleMobileTabChange = (tab: string) => {
    if (tab === "more") {
      setShowMoreSheet(true);
    } else {
      setActiveTab(tab as TabType);
      setShowMoreSheet(false);
    }
  };

  if (loading) {
    // When a deep-link (?gpu=/&plan=) has already queued a modal to open, tell
    // the user what's coming so the load doesn't read as a stuck spinner.
    const deeplinkLabel = showMonthlyPlansModal
      ? "Opening monthly plans…"
      : showLaunchModal
        ? "Opening GPU options…"
        : null;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
        {deeplinkLabel && (
          <p className="text-sm text-[var(--muted)]">{deeplinkLabel}</p>
        )}
      </div>
    );
  }

  // Show 2FA verification screen if required
  if (twoFactorRequired && !twoFactorVerified && token && pendingUserEmail) {
    return (
      <TwoFactorVerify
        token={token}
        userEmail={pendingUserEmail}
        onSuccess={(newToken) => {
          // Swap the URL token so page refreshes use the 2FA-verified JWT
          const verifiedToken = newToken || token;
          if (newToken) {
            const url = new URL(window.location.href);
            url.searchParams.set("token", newToken);
            window.history.replaceState({}, "", url.toString());
          }

          setTwoFactorVerified(true);
          setTwoFactorRequired(false);
          setLoading(true);
          // Re-fetch account data with the verified token
          fetch("/api/account/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: verifiedToken }),
          })
            .then((res) => res.json())
            .then((result) => {
              if (result.error) {
                setError(result.error);
              } else {
                setData(result);
              }
            })
            .catch(() => setError("Failed to load account data"))
            .finally(() => setLoading(false));
          fetchInstances();
          fetchActivityEvents();
          fetchBillingStats();
        }}
      />
    );
  }

  // Show TOS consent gate if required (after 2FA passes)
  if (tosConsentRequired && token) {
    return (
      <TosConsentModal
        token={token}
        currentVersion={tosConsentVersion}
        onAccept={() => {
          setTosConsentRequired(false);
        }}
      />
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="max-w-md mx-auto text-center bg-white rounded-2xl shadow-sm border border-[var(--line)] p-8">
          <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[var(--ink)] mb-2">Access Denied</h2>
          <p className="text-sm text-[var(--muted)] mb-6">{error || "Unable to load account"}</p>
          <Link href="/account" className="inline-block px-6 py-3 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-colors">
            Request New Access Link
          </Link>
        </div>
      </div>
    );
  }

  // Treat users as hourly if they have wallet credit (e.g. voucher users with billing_type "free")
  const isHourly = data.customer.billingType === "hourly" || (data.wallet?.balance || 0) > 0;
  const activeSubscriptions = poolSubscriptions.filter((s) => s.status === "subscribed" || s.status === "active" || s.status === "running" || s.status === "pending" || s.status === "starting" || s.status === "restarting");
  const totalRunning = instances.filter((i) => i.status === "running" || i.status === "active").length + activeSubscriptions.length;

  // Running pods at full rate plus stopped pods at the reservation rate —
  // what the wallet is actually draining per hour.
  const hourlyBurn = computeHourlyBurn(poolSubscriptions, stoppedRatePercent);
  const totalHourlyRate = hourlyBurn.totalHourly;
  const walletBurning = (totalRunning > 0 || hourlyBurn.stoppedBillableCount > 0) && isHourly;

  // PA-339: customer is in arrears when the effective wallet balance is negative.
  // Mirror the balance card's own source: the live-ticking balance while an
  // hourly instance runs, otherwise the server-reported balance.
  const effectiveBalanceCents = walletBurning
    ? liveCostTicker.currentBalance
    : (data.wallet?.balance ?? 0);
  const inArrears = effectiveBalanceCents < 0;

  // Calculate current GPU metrics from active subscriptions
  // Using metric_window=last_5m for both TFLOPs and VRAM (average over last 5 mins)
  // Note: hosted.ai API returns vram_usage in KB, not MB
  // PA-190: TFLOPs + VRAM come from HAI's telemetry (gpuSeries), averaged over
  // the last-5m window. The old per-subscription metrics read 0 for vGPU pods.
  // Average the buckets that actually reported. Counting an unreported bucket
  // as 0 drags the headline figure toward zero on any gap in telemetry.
  const avgReported = (xs: Array<number | null>) => {
    const real = xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
  };
  const gpuTflops = avgReported(gpuSeries.map((p) => p.tflops));
  const totalVramGb = avgReported(gpuSeries.map((p) => p.vram_mib)) / 1024; // MiB -> GB
  // Average hourly rate per subscription (for display purposes)
  const avgHourlyRate = activeSubscriptions.length > 0 && hourlyBurn.runningHourly > 0
    ? hourlyBurn.runningHourly / activeSubscriptions.length
    : 0;

  // PA-271: gate every financial surface (sidebar balance, stat cards, monthly
  // subscriptions, transactions modal, billing tab) on billing.view. The verify
  // payload is already redacted server-side; this also hides the empty widgets.
  const canViewBilling = !!data.can?.["billing.view"];

  let spentFromTxns = 0;
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000;
  data.transactions.forEach((txn) => {
    if (txn.created < startOfMonth) return;
    if (txn.type !== "debit") return;
    spentFromTxns += txn.amount / 100;
  });

  // GPU hours from spending (use average hourly rate from active subscriptions)
  const gpuHoursFromTxns = avgHourlyRate > 0 ? spentFromTxns / avgHourlyRate : 0;

  // Projected monthly spend (extrapolate from current spend)
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const projectedSpend = dayOfMonth > 0 ? (spentFromTxns / dayOfMonth) * daysInMonth : 0;

  // Storage costs from billing stats
  const storageCost = billingStats?.storageCost || 0;
  const hasStorageCost = storageCost > 0;

  // Estimated runtime from balance (use total hourly rate from all active subscriptions)

  // PA-224: per-context display name.
  // - In the user's OWN workspace (isOwner=true): prefer the Stripe customer
  //   name they set themselves; only fall back to User.displayName if Stripe
  //   has no name (e.g., legacy customers).
  // - In an INVITED workspace (isOwner=false): use User.displayName so the
  //   greeting reflects the viewer, not the inviter's Stripe profile.
  const headerDisplayName = data.isOwner
    ? (data.customer.name || data.userDisplayName || data.userEmail.split("@")[0])
    : (data.userDisplayName || data.userEmail.split("@")[0]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {data.skipTwoFactor && (
        <ImpersonationBanner
          customerEmail={data.customer.email}
          adminEmail={data.impersonator?.adminEmail}
        />
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
      {/* PA-175: when ?invite=<token> is present, surface the accept modal.
          Strips itself from the URL on accept / cancel. */}
      {inviteTokenFromUrl && token && (
        <InvitationAcceptModal
          token={inviteTokenFromUrl}
          jwt={token}
          userEmail={data.userEmail || data.customer.email}
        />
      )}
      <TruConversionIdentity email={data.customer.email} />
      <CrispUserSync data={data} token={token} />
      {/* Mobile Header */}
      <MobileHeader
        balance={canViewBilling ? (data.wallet?.balanceFormatted || "$0") : undefined}
        userName={headerDisplayName}
        onMenuOpen={() => setShowMobileMenu(true)}
        onTopUp={() => setShowTopupModal(true)}
        logoUrl={logoUrl}
      />

      {/* Sidebar - Desktop only */}
      <aside className="hidden md:flex w-72 bg-white border-r border-[var(--line)] flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-[var(--line)]">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo
              src={logoUrl}
              alt={brandName}
              width={140}
              height={50}
              className="h-12 w-auto"
            />
          </Link>
        </div>

        {/* User Info — show the LOGGED-IN user's identity (PA-224), not the
            operating account's customer. An invited member switching into
            their inviter's team should keep seeing their own name. */}
        <div className="p-6 border-b border-[var(--line)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
              {headerDisplayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">{greeting},</p>
              <p className="font-semibold text-[var(--ink)] truncate">{headerDisplayName}</p>
            </div>
          </div>
          {(tagline || easterEgg) && (
            <p className="text-xs text-zinc-400 italic mb-4 pl-1">{easterEgg || tagline}</p>
          )}

          {/* Multi-team switcher — only renders when user belongs to >1 team */}
          {token && <AccountSwitcher token={token} />}

          {/* Balance Card - Live Cost Ticker — billing-gated (PA-271) */}
          {canViewBilling && (
          <div
            data-tour="wallet-card"
            onClick={() => setShowTopupModal(true)}
            className="rounded-2xl p-4 text-white bg-gradient-to-br from-zinc-900 to-zinc-800 cursor-pointer hover:from-zinc-800 hover:to-zinc-700 transition-colors">
            {/* Low balance banner */}
            {liveCostTicker.status === "critical" && (
              <div className="bg-rose-500 text-white text-xs font-medium px-2 py-1 rounded-lg mb-3 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Time to top up!
              </div>
            )}
            {liveCostTicker.status === "warning" && (
              <div className="bg-amber-500 text-white text-xs font-medium px-2 py-1 rounded-lg mb-3 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Balance running low
              </div>
            )}
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400 whitespace-nowrap">Available balance</span>
              {/* Brand gradient (teal → violet), same pairing used on the
                  B200 waitlist success page — doubles as the top-up affordance now
                  that the whole card is clickable. */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 shrink-0 whitespace-nowrap">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs font-medium text-white">Top up</span>
              </div>
            </div>
            {walletBurning && liveCostTicker.costPerSecond > 0 && (
              <span className="text-xs text-zinc-500 font-mono block mb-1">
                -${liveCostTicker.costPerSecond.toFixed(4)}/s
              </span>
            )}
            <div className="flex items-baseline gap-2 mb-2 overflow-hidden">
              {(() => {
                const balanceStr = walletBurning ? liveCostTicker.formattedBalance : (data.wallet?.balanceFormatted || "$0");
                // Scale font down for large balances so text fits the card
                const sizeClass = balanceStr.length > 14 ? "text-lg" : balanceStr.length > 10 ? "text-xl" : "text-3xl";
                // Hide reaction text for very large balances to prevent overflow
                const showReaction = balanceStr.length <= 12;
                return (
                  <>
                    <span className={`${sizeClass} font-bold tabular-nums truncate ${
                      liveCostTicker.status === "critical" || inArrears ? "text-rose-400" : ""
                    }`}>
                      {balanceStr}
                    </span>
                    {showReaction && data.wallet && getWalletReaction(liveCostTicker.currentBalance || data.wallet.balance) && (
                      <span className="text-xs text-zinc-400 whitespace-nowrap shrink-0">{getWalletReaction(liveCostTicker.currentBalance || data.wallet.balance)}</span>
                    )}
                  </>
                );
              })()}
            </div>
            {/* PA-339: explain a negative balance instead of hiding it as $0.00 */}
            {inArrears && (
              <p className="text-xs text-rose-300 mb-2">
                Your account is in arrears. Top-ups apply to this balance first before adding spendable credit.
              </p>
            )}
            {walletBurning && data.wallet && totalHourlyRate > 0 && (
              <>
                {/* Progress bar showing time remaining */}
                <div className="h-1.5 bg-zinc-700/50 rounded-full mb-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      liveCostTicker.status === "critical" ? "bg-rose-500" :
                      liveCostTicker.status === "warning" ? "bg-amber-500" :
                      "bg-teal-400"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, (liveCostTicker.hoursRemaining / 24) * 100))}%`
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={`${
                    liveCostTicker.status === "critical" ? "text-rose-400" :
                    liveCostTicker.status === "warning" ? "text-amber-400" :
                    "text-zinc-400"
                  }`}>
                    ~{liveCostTicker.timeRemainingFormatted} remaining
                  </span>
                  <span className="text-zinc-500">
                    ${totalHourlyRate.toFixed(2)}/hr
                  </span>
                </div>
              </>
            )}
            {(!totalRunning || !isHourly || totalHourlyRate <= 0) && (
              <div className="text-xs text-zinc-500">
                No active instances
              </div>
            )}
          </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {/* Main */}
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>}
            label="Dashboard"
            active={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
          />

          {/* GPU & Compute Section */}
          <div className="pt-4 pb-1">
            <p className="px-4 text-xs font-medium text-zinc-400 uppercase tracking-wider">Compute</p>
          </div>
          {/* PA-202: per-role module visibility. HF / Apps are hidden from
              Read-only Member + Finance Manager. */}
          {data.can?.["huggingface.use"] && (
            <NavItem
              icon={<span className="text-lg">🤗</span>}
              label="Hugging Face"
              active={activeTab === "huggingface"}
              onClick={() => setActiveTab("huggingface")}
            />
          )}
          {data.can?.["apps.use"] && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
              label="Apps"
              active={activeTab === "apps"}
              onClick={() => setActiveTab("apps")}
            />
          )}
          {/* Storage: read-only visibility for both RoM (gpu.access) and FM
              (billing.view). Actions inside the tab are gated on
              storage.manage so neither can add/delete. */}
          {(data.can?.["gpu.access"] || data.can?.["billing.view"]) && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>}
              label="Storage"
              active={activeTab === "storage"}
              onClick={() => setActiveTab("storage")}
            />
          )}
          {/* Bare Metal Orders has NO desktop sidebar item by design — it's
              reached via the "Bare Metal" CTA in the dashboard header (avoids a
              duplicate door to the same tab). The tab/view + ?tab=bare-metal-orders
              deeplink remain valid; mobile keeps its own nav entry. Legacy Spheron
              "Bare Metal" tab retired (no live deployments). */}
          {/* Metrics: shown to RoM (gpu.access) and FM (billing.view).
              Server-side filtering scopes the data to what each role can see. */}
          {(data.can?.["gpu.access"] || data.can?.["billing.view"]) && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
              label="Metrics"
              active={activeTab === "metrics"}
              onClick={() => setActiveTab("metrics")}
            />
          )}

          {/* Account Section */}
          <div className="pt-4 pb-1">
            <p className="px-4 text-xs font-medium text-zinc-400 uppercase tracking-wider">Account</p>
          </div>
          {/* Billing hidden from Team Member + Read-only Member (no billing.view). */}
          {data.can?.["billing.view"] && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
              label="Billing"
              active={activeTab === "billing"}
              onClick={() => setActiveTab("billing")}
            />
          )}
          {/* Team tab visible to all active members (members list is default-read). */}
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
            label="Team"
            active={activeTab === "team"}
            onClick={() => setActiveTab("team")}
          />
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
            label="Settings"
            active={activeTab === "settings"}
            onClick={() => setActiveTab("settings")}
          />

          {/* Help Section */}
          <div className="pt-4 pb-1">
            <p className="px-4 text-xs font-medium text-zinc-400 uppercase tracking-wider">Help</p>
          </div>
          <a
            href={`${getAppUrl()}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors text-[var(--muted)] hover:bg-zinc-50 hover:text-zinc-700"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            <span className="font-medium">Docs</span>
            <svg className="w-3.5 h-3.5 ml-auto opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>}
            label="Support"
            active={activeTab === "support"}
            onClick={() => setActiveTab("support")}
            showBadge={hasUnreadSupport}
          />
          {data.can?.["referral.view"] && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>}
              label="Referrals"
              active={activeTab === "referrals"}
              onClick={() => setActiveTab("referrals")}
            />
          )}
        </nav>

        {/* Footer Links */}
        <div className="p-4 border-t border-[var(--line)] space-y-1">
          {data.can?.["billing.view"] && (
            <button
              onClick={openBillingPortal}
              disabled={billingPortalLoading}
              className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--muted)] hover:text-zinc-700 transition-colors w-full text-left disabled:opacity-50"
            >
              {billingPortalLoading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              )}
              Stripe Portal
            </button>
          )}
          <button
            onClick={() => setShowLogoutModal(true)}
            className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--muted)] hover:text-zinc-700 transition-colors w-full text-left"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Content Area - extra bottom padding on mobile for nav bar */}
        <div className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-y-auto">
          {activeTab === "dashboard" && (
            <>
              <div ref={stickyHeaderSentinelRef} aria-hidden className="h-px" />
              {/* Header with New GPU button */}
              <div
                className={`flex items-center justify-between mb-8 sticky -top-4 md:-top-8 z-10 py-4 -mt-4 -mx-4 px-4 md:-mx-8 md:px-8 transition-colors duration-200 ${
                  isHeaderStuck
                    ? "bg-white/95 backdrop-blur-md border-b border-[var(--line)] shadow-sm"
                    : "bg-[var(--surface)] border-b border-transparent"
                }`}
              >
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ink)]">Dashboard</h1>
                  <p className="text-sm text-[var(--muted)]">Manage your GPU instances</p>
                </div>
                <div className="flex items-center gap-3">
                  {data.can?.["referral.view"] && (
                    <button
                      onClick={() => setActiveTab("referrals")}
                      className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1.5"
                    >
                      <span>🎁</span>
                      Refer a friend
                    </button>
                  )}
                  {data.can?.["gpu.provision"] && (
                    <>
                      {/* PA-367: filled Packet green (--teal) so On-demand reads
                          as a primary CTA on par with Monthly / Bare Metal. */}
                      <button
                        data-tour="ondemand-btn"
                        onClick={handleLaunchGpu}
                        className="px-4 py-2.5 bg-(--teal) hover:bg-(--teal-dark) text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                        On-demand
                      </button>
                      <button
                        data-tour="monthly-btn"
                        onClick={() => setShowMonthlyPlansModal(true)}
                        className="px-4 py-2.5 bg-(--blue) hover:bg-(--blue-dark) text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        Monthly
                        <span className="text-blue-200 font-semibold text-xs">· Save up to 40%</span>
                      </button>
                    </>
                  )}
                  {/* Bare Metal Orders — must mirror the tab guard exactly
                      (billing.view AND the bareMetalEnabled entitlement), or a
                      non-entitled user clicks into a disallowed tab and the
                      guard-redirect loops. */}
                  {isPro() && data.can?.["billing.view"] && data.bareMetalEnabled && (
                    <button
                      data-tour="baremetal-btn"
                      onClick={() => setActiveTab("bare-metal-orders")}
                      className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                      </svg>
                      Bare Metal
                    </button>
                  )}
                </div>
              </div>

              {/* Dashboard announcements from admin */}
              {token && <DashboardAnnouncements token={token} />}

              {/* B200 flagship quick-deploy banner (PA-384) */}
              {token && data.can?.["gpu.provision"] && (
                <B200Banner token={token} onDeploy={handleLaunchB200} />
              )}

              {/* Onboarding checklist for new users */}
              <OnboardingChecklist
                walletBalance={data.wallet?.balance ?? 0}
                hasLaunchedGpu={instances.length > 0 || totalRunning > 0}
                hasPoolSubscriptions={poolSubscriptions.length > 0}
                onAddFunds={() => setShowTopupModal(true)}
                onExploreGPUs={() => setShowLaunchModal(true)}
                onLaunchGpu={() => setShowLaunchModal(true)}
              />

              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
                  <div className="text-xs text-[var(--muted)] mb-1">Active GPUs</div>
                  <div className="flex items-center gap-2">
                    <div className="text-3xl font-bold text-[var(--ink)]">{totalRunning}</div>
                    {totalRunning > 0 && <StatusDot status="running" />}
                  </div>
                </div>

                {/* PA-271: Spent / GPU Hours / Projected are financial — billing.view only */}
                {canViewBilling && (<>
                <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
                  <div className="text-xs text-[var(--muted)] mb-1">GPU Hours</div>
                  <div className="text-3xl font-bold text-[var(--ink)]">{gpuHoursFromTxns.toFixed(2)}h</div>
                  <div className="text-xs text-zinc-400">this month</div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
                  <div className="text-xs text-[var(--muted)] mb-1">Spent</div>
                  <div className="text-3xl font-bold text-[var(--ink)]">${spentFromTxns.toFixed(2)}</div>
                  {hasStorageCost ? (
                    <div className="text-xs text-zinc-400">
                      ${(spentFromTxns - storageCost).toFixed(2)} GPU + {formatSmartPrice(storageCost)} storage
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-400">this month</div>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
                  <div className="text-xs text-[var(--muted)] mb-1">Projected</div>
                  <div className="text-3xl font-bold text-[var(--ink)]">~${projectedSpend.toFixed(0)}</div>
                  <div className="text-xs text-zinc-400">this month</div>
                </div>
                </>)}
              </div>

              {/* Monthly Subscription Entitlements — billing-gated (PA-271) */}
              {canViewBilling && (() => {
                // Each subscription can cover multiple slots via `quantity`; a single pod
                // can only satisfy ONE slot. Iterate slot-by-slot and claim pods greedily
                // so a qty=2 sub with one running pod still surfaces a "Not Deployed" card.
                const claimedPodIds = new Set<string | number>();
                const undeployedSlots: Array<{
                  sub: typeof data.subscriptions[number];
                  slotIndex: number;
                }> = [];
                for (const sub of data.subscriptions || []) {
                  const qty = Math.max(1, sub.quantity ?? 1);
                  for (let slotIndex = 0; slotIndex < qty; slotIndex++) {
                    const matchedPod = poolSubscriptions.find((ps) => {
                      if (claimedPodIds.has(ps.id)) return false;
                      const meta = podMetadata[String(ps.id)];
                      // Primary: match by stripeSubscriptionId stored in pod metadata
                      if (meta?.stripeSubscriptionId && meta.stripeSubscriptionId === sub.id) return true;
                      // Secondary: monthly pod on a matching pool (billingType check)
                      if (meta?.billingType === "monthly" && sub.poolIds?.length && ps.pool_id != null) {
                        return sub.poolIds.map(String).includes(String(ps.pool_id));
                      }
                      // Fallback: match by pool ID overlap (convert both sides to strings for safety)
                      if (sub.poolIds?.length && ps.pool_id != null) {
                        return sub.poolIds.map(String).includes(String(ps.pool_id));
                      }
                      return false;
                    });
                    if (matchedPod) {
                      claimedPodIds.add(matchedPod.id);
                    } else {
                      undeployedSlots.push({ sub, slotIndex });
                    }
                  }
                }
                const undeployedSubs = undeployedSlots;
                const hasAnySubs = (data.subscriptions || []).length > 0;
                return (
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-[var(--ink)]">
                        Monthly Subscriptions
                        {undeployedSubs.length > 0 && (
                          <span className="ml-2 text-sm font-normal text-zinc-400">({undeployedSubs.length})</span>
                        )}
                      </h2>
                      {data.can?.["gpu.provision"] && (
                        <button
                          onClick={() => setShowMonthlyPlansModal(true)}
                          className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                        >
                          Add Subscription
                        </button>
                      )}
                    </div>
                    {undeployedSubs.length === 0 ? (
                      <div className="bg-white rounded-2xl border border-dashed border-[var(--line)] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-medium text-[var(--ink)] mb-1">
                              {hasAnySubs ? "All subscriptions deployed" : "Save with a monthly commitment"}
                            </h3>
                            <p className="text-sm text-[var(--muted)]">
                              {hasAnySubs
                                ? "Add another monthly GPU subscription at a discounted rate."
                                : "Commit to a GPU monthly and pay a lower effective hourly rate than on-demand."}
                            </p>
                          </div>
                          {data.can?.["gpu.provision"] && (
                            <button
                              onClick={() => setShowMonthlyPlansModal(true)}
                              className="shrink-0 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl transition-colors text-sm"
                            >
                              View plans
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      {undeployedSubs.map(({ sub, slotIndex }) => {
                        const periodStart = new Date(sub.currentPeriodStart * 1000);
                        const periodEnd = new Date(sub.currentPeriodEnd * 1000);
                        const priceDisplay = sub.pricePerMonthCents
                          ? `$${(sub.pricePerMonthCents / 100).toFixed(0)}/mo`
                          : "Monthly";
                        const qty = Math.max(1, sub.quantity ?? 1);
                        const slotLabel = qty > 1 ? ` · slot ${slotIndex + 1}/${qty}` : "";

                        return (
                          <div
                            key={`${sub.id}-${slotIndex}`}
                            className="bg-white rounded-2xl border-2 border-teal-200 p-5 relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-teal-50 to-transparent rounded-bl-full" />
                            <div className="relative">
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
                                      <svg className="w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                      </svg>
                                    </div>
                                    <div>
                                      <h3 className="font-semibold text-[var(--ink)]">
                                        {sub.productName || "GPU Subscription"}
                                        {slotLabel && <span className="ml-1 text-xs font-normal text-[var(--muted)]">{slotLabel}</span>}
                                      </h3>
                                      <span className="text-sm font-medium text-teal-600">{priceDisplay}</span>
                                    </div>
                                  </div>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  Not Deployed
                                </span>
                              </div>
                              <div className="text-xs text-zinc-400 mb-3">
                                Period: {periodStart.toLocaleDateString()} &ndash; {periodEnd.toLocaleDateString()}
                                {sub.cancelAtPeriodEnd && (
                                  <span className="ml-2 text-rose-500 font-medium">Cancels at period end</span>
                                )}
                              </div>
                              {data.can?.["gpu.provision"] && (
                                <button
                                  onClick={() => {
                                    // The subscription travels even when its
                                    // product link is missing: it is what pays.
                                    setLaunchSubscription({
                                      productId: sub.productId ?? null,
                                      stripeSubscriptionId: sub.id,
                                    });
                                    setShowLaunchModal(true);
                                  }}
                                  className="w-full px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  Deploy GPU
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                );
              })()}

              {/* GPU Instances */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-[var(--ink)]">
                    GPU Instances
                    {instancesLoading && <span className="ml-2 text-sm text-zinc-400 font-normal">refreshing...</span>}
                  </h2>
                  <button onClick={fetchInstances} className="text-sm text-[var(--muted)] hover:text-zinc-700 transition-colors">
                    Refresh
                  </button>
                </div>

                {poolSubscriptions.length > 0 || provisioningGpu ? (
                  <div className="grid md:grid-cols-2 gap-4">
                    {provisioningGpu && (
                      <div className="bg-white rounded-2xl border border-[var(--line)] p-5 animate-pulse">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                            <svg className="w-6 h-6 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-medium text-[var(--ink)]">{provisioningGpu.name}</h3>
                            <p className="text-sm text-[var(--muted)]">Provisioning {provisioningGpu.poolName}...</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {poolSubscriptions.map((subscription) => {
                      // Term-prepay bare metal servers (HAI unified nature
                      // "baremetal"): read-only card — VM actions don't apply
                      // (and their endpoints reject baremetal ids). Managed
                      // from the Bare Metal tab (billing.view gated, Pro-only).
                      if (subscription.nature === "baremetal") {
                        // Only offer "Manage" when the orders tab is actually
                        // reachable (entitlement + billing.view) — otherwise the
                        // link bounces off the guard and loops. The card itself
                        // (read-only + SSH) still shows for the owned server.
                        const canManageBm =
                          isPro() &&
                          !!data?.bareMetalEnabled &&
                          (!data?.can || !!data.can["billing.view"]);
                        return (
                          <BareMetalInstanceCard
                            key={`sub-${subscription.id}`}
                            subscription={subscription}
                            token={token ?? undefined}
                            onManage={
                              canManageBm
                                ? () => setActiveTab("bare-metal-orders")
                                : undefined
                            }
                          />
                        );
                      }
                      const meta = podMetadata[String(subscription.id)];
                      // Detect monthly: check billingType in metadata, or match against Stripe subscriptions via poolIds
                      const isMonthly = meta?.billingType === "monthly" || (data?.subscriptions || []).some(
                        (sub) => sub.poolIds?.length && subscription.pool_id != null && sub.poolIds.map(String).includes(String(subscription.pool_id))
                      );
                      // Find the matching Stripe subscription for monthly price
                      const matchingSub = isMonthly ? (data?.subscriptions || []).find((sub) => {
                        if (meta?.stripeSubscriptionId && meta.stripeSubscriptionId === sub.id) return true;
                        if (sub.poolIds?.length && subscription.pool_id != null) {
                          return sub.poolIds.map(String).includes(String(subscription.pool_id));
                        }
                        return false;
                      }) : undefined;
                      const monthlyPrice = matchingSub?.pricePerMonthCents
                        ? `$${(matchingSub.pricePerMonthCents / 100).toFixed(0)}/mo`
                        : undefined;

                      return (
                        <PoolSubscriptionCard
                          key={`sub-${subscription.id}`}
                          subscription={subscription}
                          token={token!}
                          onRefresh={fetchInstances}
                          onSnapshotCreated={fetchSnapshots}
                          gpuDashboardUrl={data?.gpuDashboardUrl}
                          metadata={meta}
                          hfDeployment={hfDeployments[String(subscription.id)]}
                          isMonthly={isMonthly}
                          monthlyPriceDisplay={monthlyPrice}
                          billingPortalUrl={isMonthly ? data?.billingPortalUrl : undefined}
                          can={data?.can}
                        />
                      );
                    })}
                  </div>
                ) : snapshots.length === 0 ? (
                  <div className="bg-white rounded-2xl border-2 border-dashed border-[var(--line)] p-12 text-center">
                    <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-[var(--ink)] mb-2">{emptyState.title}</h3>
                    <p className="text-sm text-[var(--muted)] mb-6">{emptyState.subtitle}</p>
                    {data.can?.["gpu.provision"] && (
                      <button
                        onClick={handleLaunchGpu}
                        className="px-6 py-3 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors"
                      >
                        Launch GPU
                      </button>
                    )}
                  </div>
                ) : null}

                {/* Active Bare Metal Nodes */}
                {bareMetalNodes.length > 0 && (
                  <div className={poolSubscriptions.length > 0 ? "mt-8" : ""}>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-[var(--ink)]">
                        Bare Metal
                        <span className="ml-2 text-sm font-normal text-zinc-400">
                          ({bareMetalNodes.length})
                        </span>
                      </h2>
                      {/* Legacy Spheron "Manage" link removed — the baremetal
                          tab is retired, so this navigated to a dead tab that
                          the guard rejects (flicker loop). */}
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {bareMetalNodes.map((node) => (
                        <div key={node.id} className="bg-white rounded-2xl border border-[var(--line)] p-5">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`w-2 h-2 rounded-full ${node.status === "running" ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`} />
                                <h3 className="font-medium text-[var(--ink)]">{node.name || node.gpu}</h3>
                              </div>
                              <p className="text-sm text-[var(--muted)]">
                                {node.gpu} x{node.gpuCount} &middot; {node.region}
                              </p>
                              {node.ipAddress && (
                                <p className="text-xs text-zinc-400 font-mono mt-1">{node.ipAddress}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-[var(--ink)]">${(node.hourlyRate / 100).toFixed(2)}/hr</div>
                              <div className="text-xs text-zinc-400 capitalize">{node.status}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Saved Snapshots / Paused Pods */}
                {snapshots.length > 0 && (
                  <div className={(poolSubscriptions.length > 0 || bareMetalNodes.length > 0) ? "mt-8" : ""}>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-[var(--ink)]">
                        Saved Pods
                        <span className="ml-2 text-sm font-normal text-zinc-400">
                          ({snapshots.length})
                        </span>
                      </h2>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {snapshots.map((snapshot) => (
                        <SnapshotCard
                          key={snapshot.id}
                          snapshot={snapshot}
                          token={token!}
                          onRestore={() => {
                            fetchInstances();
                            fetchSnapshots();
                          }}
                          onDelete={fetchSnapshots}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Cards Grid: TFLOPs, VRAM, Billing, Activity */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {/* GPU Compute Card */}
                <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                      Compute
                      <HelpTooltip {...HELP_CONTENT.tflops} />
                    </h3>
                    <span className="text-xs text-zinc-400">Last 5m</span>
                  </div>
                  <div className="text-3xl font-bold text-emerald-600 mb-1">{gpuTflops.toFixed(1)}</div>
                  <div className="text-xs text-zinc-500 mb-2">TFLOPs</div>
                  <div className="h-32">
                    <GPUUsageChart
                      data={gpuSeries}
                      metricType="tflops"
                    />
                  </div>
                </div>

                {/* VRAM Card */}
                <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                      VRAM
                      <HelpTooltip {...HELP_CONTENT.vram} />
                    </h3>
                    <span className="text-xs text-zinc-400">Last 5m</span>
                  </div>
                  <div className="text-3xl font-bold text-indigo-600 mb-1">{totalVramGb.toFixed(1)} GB</div>
                  <div className="text-xs text-zinc-500 mb-2">avg usage</div>
                  <div className="h-32">
                    <GPUUsageChart
                      data={gpuSeries}
                      metricType="vram"
                    />
                  </div>
                </div>


                {/* Billing Chart Card — hidden for roles without billing.view
                    (Read-only Member, Team Member). Same gate as the Billing
                    sidebar tab. */}
                {data.can?.["billing.view"] && (
                  <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-[var(--ink)]">Billing</h3>
                      <span className="text-xs text-zinc-400">Last 14 days</span>
                    </div>
                    <div className="h-44">
                      <UsageChart transactions={data.transactions} />
                    </div>
                  </div>
                )}

                {/* Activity Log Card */}
                <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-[var(--ink)]">Activity</h3>
                    {activityEvents.length > 0 && (
                      <button
                        onClick={() => setShowActivityModal(true)}
                        className="text-xs text-violet-600 hover:text-violet-700 font-medium"
                      >
                        View All ({activityEvents.length})
                      </button>
                    )}
                  </div>
                  <div className="h-44 overflow-y-auto">
                    {activityEvents.length > 0 ? (
                      <div className="space-y-2">
                        {activityEvents.slice(0, 6).map((event) => (
                          <div key={event.id} className="flex items-start gap-2">
                            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                              event.type === "gpu_launched" ? "bg-emerald-500" :
                              event.type === "gpu_terminated" ? "bg-zinc-400" :
                              event.type === "gpu_scaled" ? "bg-blue-500" :
                              event.type === "gpu_restarted" ? "bg-amber-500" :
                              event.type === "payment_received" ? "bg-emerald-500" :
                              "bg-zinc-300"
                            }`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-zinc-700 truncate">{event.description}</p>
                              <p className="text-xs text-zinc-400">{formatDateTime(event.created)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
                        All quiet for now...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === "billing" && canViewBilling && (
            <BillingTab
              transactions={data.transactions}
              walletBalance={data.wallet?.balanceFormatted || "$0"}
              walletBalanceCents={data.wallet?.balance ?? 0}
              onTopUp={() => setShowTopupModal(true)}
              formatDateTime={formatDateTime}
              onDownloadCSV={downloadTransactionsCSV}
              payments={data.recentPayments}
              billingPortalUrl={data?.billingPortalUrl}
              subscriptions={data?.subscriptions}
              token={token!}
              autoRefill={data?.autoRefill}
              canManageBilling={data.can?.["billing.manage"] ?? false}
            />
          )}

          {activeTab === "team" && (
            <div>
              <h1 className="text-2xl font-bold text-[var(--ink)] mb-6">Team</h1>
              <TeamMembers
                token={token!}
                accountId={data.customer.id}
                canInvite={data.can?.["team.invite"] ?? data.isOwner}
                canManage={data.can?.["team.manage"] ?? data.isOwner}
                currentUserId={null}
                teamName={data.customer.teamName}
                ownerEmailFallback={data.customer.email}
              />
            </div>
          )}

          {activeTab === "huggingface" && (
            <HuggingFaceTab
              token={token!}
              onDeploymentStarted={() => {
                // Switch to dashboard tab to show progress
                setActiveTab("dashboard");
                // Refresh instances to get the new deployment
                fetchInstances();
              }}
            />
          )}

          {activeTab === "referrals" && token && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ink)]">Refer a Friend</h1>
                  <p className="text-sm text-[var(--muted)]">Share your code and you both get free GPU time!</p>
                </div>
              </div>
              <div className="max-w-xl">
                <ReferralCard token={token} />
              </div>
            </div>
          )}

          {activeTab === "support" && token && <SupportTab token={token} initialTicketId={ticketId} />}

          {activeTab === "metrics" && token && <MetricsTab token={token} />}

          {activeTab === "apps" && token && (
            <AppsTab
              token={token}
              subscriptions={vmPodSubscriptions}
              onDeployed={(podName, appName) => {
                // Mirror the main LaunchGPUModal onSuccess: show provisioning
                // banner, switch to GPU tab, and poll until the instance appears.
                setProvisioningGpu({ name: podName, poolName: appName });
                setActiveTab("dashboard");
                const pollInterval = setInterval(() => fetchInstances(), 3000);
                setTimeout(() => clearInterval(pollInterval), 60000);
                setTimeout(() => setProvisioningGpu(null), 120000);
                fetchInstances();
              }}
            />
          )}

          {activeTab === "storage" && token && (
            <StorageTab
              token={token}
              canManage={data?.can?.["storage.manage"] ?? false}
            />
          )}

          {activeTab === "baremetal" && token && <BareMetalTab token={token} onTopUp={() => setShowTopupModal(true)} />}

          {activeTab === "bare-metal-orders" && isPro() && token && (
            <BareMetalOrdersTab token={token} canManage={data?.can?.["billing.manage"] ?? false} />
          )}

          {activeTab === "settings" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-[var(--ink)] mb-2">Settings</h1>
                <p className="text-sm text-[var(--muted)]">Manage your account settings and security</p>
              </div>

              {/* Profile Section — highlight billing/KYC when arriving from
                  the bare-metal "complete your profile" redirect. */}
              <ProfileSettings
                token={token!}
                highlightBilling={dashboardSearchParams.get("billing") === "1"}
              />

              {/* Budget Controls Section */}
              <BudgetSettings token={token!} />

              {/* API Keys Section */}
              <ApiKeysSettings token={token!} />

              {/* SSH Keys Section */}
              <SSHKeys token={token!} />

              {/* Two-Factor Authentication Section */}
              <TwoFactorSettings
                userType="customer"
                apiEndpoint="/api/account/two-factor"
                token={token!}
                initialEnabled={data.twoFactor?.enabled || false}
                initialHasBackupCodes={data.twoFactor?.hasBackupCodes || false}
                onStatusChange={async () => {
                  // Refetch account data to update 2FA status
                  const response = await fetch("/api/account/verify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                  });
                  if (response.ok) {
                    const result = await response.json();
                    setData(result);
                  }
                }}
              />
            </div>
          )}

        </div>

        {/* Footer - Desktop only */}
        <footer className="hidden md:block border-t border-[var(--line)] bg-white/80 backdrop-blur-xl px-8 py-4">
          <p className="text-center text-[var(--muted)] text-xs">
            © {new Date().getFullYear()} {brandName} · Powered by <a href="https://hosted.ai" className="text-[var(--blue)] hover:underline" target="_blank" rel="noopener noreferrer">hosted.ai</a>
            {process.env.NEXT_PUBLIC_APP_VERSION && <>
              <span className="mx-2">·</span>
              <span className="text-zinc-400">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
            </>}
          </p>
        </footer>
      </main>

      {/* Launch GPU Modal */}
      {/* key forces a clean remount when the pre-seeded product/subscription
          changes, so the stepper re-initialises instead of keeping stale state
          (the init effect only runs on isOpen/token changes). */}
      <LaunchGPUModal
        key={launchSubscription?.productId ?? launchProductId ?? launchCategorySlug ?? "browse"}
        isOpen={showLaunchModal}
        onClose={() => {
          setShowLaunchModal(false);
          setLaunchProductId(undefined);
          setLaunchCategorySlug(undefined);
          setLaunchSubscription(null);
        }}
        token={token!}
        customerEmail={data?.customer?.email}
        onSuccess={(launchInfo) => {
          setProvisioningGpu(launchInfo);
          setLaunchProductId(undefined);
          setLaunchCategorySlug(undefined);
          setLaunchSubscription(null);
          const pollInterval = setInterval(() => fetchInstances(), 3000);
          setTimeout(() => clearInterval(pollInterval), 60000);
          setTimeout(() => setProvisioningGpu(null), 120000);
          fetchInstances();
        }}
        onError={(message) => {
          setProvisioningGpu(null);
          setErrorToast(message);
          setTimeout(() => setErrorToast(null), 8000);
        }}
        gpuDashboardUrl={data?.gpuDashboardUrl}
        onTopup={handleTopup}
        topupLoading={topupLoading}
        initialProductId={launchProductId}
        initialCategorySlug={launchCategorySlug}
        lockedProductId={launchSubscription?.productId ?? undefined}
        stripeSubscriptionId={launchSubscription?.stripeSubscriptionId}
      />

      {/* Wallet Top-Up Modal */}
      <TopupModal
        isOpen={showTopupModal}
        onClose={() => setShowTopupModal(false)}
        token={token!}
        topupLoading={topupLoading}
        onTopup={handleTopup}
        onVoucherRedeemed={refreshAccountData}
      />

      {/* Activity Log Modal */}
      <ActivityLogModal
        isOpen={showActivityModal}
        onClose={() => setShowActivityModal(false)}
        events={activityEvents}
        formatDateTime={formatDateTime}
        onDownloadCSV={downloadActivityCSV}
      />

      {/* Transactions Modal — billing-gated (PA-271) */}
      {canViewBilling && (
        <TransactionsModal
          isOpen={showTransactionsModal}
          onClose={() => setShowTransactionsModal(false)}
          transactions={data?.transactions || []}
          formatDateTime={formatDateTime}
          onDownloadCSV={downloadTransactionsCSV}
        />
      )}

      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
        variant="light"
      />

      {/* Blackwell Subscription Modal */}
      <BlackwellModal
        isOpen={showBlackwellModal}
        onClose={() => setShowBlackwellModal(false)}
        customerEmail={data?.customer?.email}
      />

      {/* Monthly plans picker — lists all active monthly products */}
      <MonthlyPlansModal
        isOpen={showMonthlyPlansModal}
        onClose={() => {
          setShowMonthlyPlansModal(false);
          setMonthlyCategorySlug(undefined);
        }}
        customerEmail={data?.customer?.email}
        initialCategorySlug={monthlyCategorySlug}
      />

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={handleMobileTabChange}
        hasUnreadSupport={hasUnreadSupport}
      />

      {/* Mobile Menu Sheet (from hamburger) */}
      <MobileMenuSheet
        isOpen={showMobileMenu}
        onClose={() => setShowMobileMenu(false)}
        userName={headerDisplayName}
        userEmail={data.userEmail}
        isOwner={data.isOwner}
        can={data.can}
        bareMetalEnabled={isPro() && data.bareMetalEnabled}
        onTabChange={(tab) => {
          setActiveTab(tab as TabType);
          setShowMobileMenu(false);
        }}
        onLogout={() => {
          setShowMobileMenu(false);
          setShowLogoutModal(true);
        }}
        onBillingPortal={openBillingPortal}
        billingPortalLoading={billingPortalLoading}
      />

      {/* Mobile "More" Sheet */}
      <MobileMoreSheet
        isOpen={showMoreSheet}
        onClose={() => setShowMoreSheet(false)}
        onTabChange={(tab) => {
          setActiveTab(tab as TabType);
          setShowMoreSheet(false);
        }}
        hasUnreadSupport={hasUnreadSupport}
        bareMetalEnabled={isPro() && data.bareMetalEnabled}
        canViewBilling={!!data.can?.["billing.view"]}
      />

      {/* Top-up success toast */}
      {topupToast && (
        <div className={`fixed ${data.skipTwoFactor ? "top-16" : "top-4"} right-4 z-[60] animate-in slide-in-from-top-2 duration-300`}>
          <div className="bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium text-sm">{topupToast}</span>
            <button onClick={() => setTopupToast(null)} className="ml-2 text-white/70 hover:text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Error toast */}
      {errorToast && (
        <div className={`fixed ${data.skipTwoFactor ? "top-16" : "top-4"} right-4 z-[60] animate-in slide-in-from-top-2 duration-300`}>
          <div className="bg-red-600 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 max-w-md">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium text-sm">{errorToast}</span>
            <button onClick={() => setErrorToast(null)} className="ml-2 text-white/70 hover:text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Onboarding tour — guided tooltip walkthrough for first-time sign-ups */}
      <OnboardingTour isNewSignup={isNewSignup} customerId={data?.customer?.id} />
      </div>
    </div>
  );
}

