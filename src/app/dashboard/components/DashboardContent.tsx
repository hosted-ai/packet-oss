"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { isPro, hasPremiumFeature } from "@/lib/edition";
import dynamic from "next/dynamic";

const XTerminal = dynamic(() => import("@/components/XTerminal"), { ssr: false });
import TeamMembers from "@/components/TeamMembers";
import HuggingFaceTab from "@/components/HuggingFaceTab";
import { TwoFactorSettings } from "@/components/two-factor";
import TwoFactorVerify from "@/components/TwoFactorVerify";
import { LogoutConfirmModal } from "@/components/logout-confirm-modal";
import ReferralCard from "@/components/ReferralCard";
import { formatSmartPrice } from "@/lib/format";
import { ApiKeysSettings } from "@/components/ApiKeysSettings";
import { GPUHardwareMetrics } from "@/components/GPUHardwareMetrics";
import { AppsTab } from "./AppsTab";
import { StorageTab } from "./StorageTab";

// Support tab — edition-gated: Pro uses Zammad ticketing, OSS uses contact form
const SupportTab = hasPremiumFeature("support")
  ? dynamic(() => import("./SupportTab").then(m => ({ default: m.SupportTab })))
  : dynamic(() => import("./OssSupportTab").then(m => ({ default: m.OssSupportTab })));

// Premium tabs — dynamically imported, only available in Pro edition
const TokenFactoryTab = hasPremiumFeature("token-factory")
  ? dynamic(() => import("./TokenFactoryTab").then(m => ({ default: m.TokenFactoryTab })))
  : () => null;
const PixelFactoryTab = hasPremiumFeature("pixel-factory")
  ? dynamic(() => import("./PixelFactoryTab").then(m => ({ default: m.PixelFactoryTab })))
  : () => null;
const BareMetalTab = hasPremiumFeature("bare-metal")
  ? dynamic(() => import("./BareMetalTab").then(m => ({ default: m.BareMetalTab })))
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
import { TopupModal, ActivityLogModal, TransactionsModal, BlackwellModal, WelcomeModal } from "./modals";
import { MobileHeader, MobileNav, MobileMenuSheet, MobileMoreSheet } from "./MobileDashboard";
import { ProfileSettings } from "./ProfileSettings";
import { BudgetSettings } from "./BudgetSettings";
import { getBrandName, getAppUrl } from "@/lib/branding";
import { RateLimitSettings } from "./RateLimitSettings";
import { SessionSettings } from "./SessionSettings";
import { useDashboardData, useDashboardActions, useModals, TabType } from "./hooks";
import { OnboardingChecklist } from "./OnboardingChecklist";

export function DashboardContent() {
  // Use extracted hooks
  const {
    token,
    loading,
    error,
    data,
    instances,
    poolSubscriptions,
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
    hostedaiLoginLoading,
    billingPortalLoading,
    openHostedaiDashboard,
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

  // Blackwell subscription modal state
  const [showBlackwellModal, setShowBlackwellModal] = React.useState(false);

  // Welcome modal for new users with no infrastructure or wallet balance
  const [showWelcomeModal, setShowWelcomeModal] = React.useState(false);

  // Track product ID to pre-select in launch modal (e.g., after returning from top-up)
  const [launchProductId, setLaunchProductId] = React.useState<string | undefined>(undefined);

  // Toast notifications
  const [topupToast, setTopupToast] = React.useState<string | null>(null);
  const [errorToast, setErrorToast] = React.useState<string | null>(null);

  // Unread support messages state
  const [hasUnreadSupport, setHasUnreadSupport] = React.useState(false);

  // Session timeout setting (for footer display)
  const [sessionTimeoutHours, setSessionTimeoutHours] = React.useState(1);

  // Mobile navigation state
  const [showMobileMenu, setShowMobileMenu] = React.useState(false);
  const [showMoreSheet, setShowMoreSheet] = React.useState(false);

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

  // Calculate values needed for live cost ticker (must be before any early returns)
  // Treat users as hourly if they have wallet credit (e.g. voucher users with billing_type "free")
  const isHourlyEarly = data?.customer?.billingType === "hourly" || (data?.wallet?.balance || 0) > 0;
  const activeSubscriptionsEarly = poolSubscriptions.filter((s) => s.status === "subscribed" || s.status === "active");
  const totalRunningEarly = instances.filter((i) => i.status === "running" || i.status === "active").length + activeSubscriptionsEarly.length;
  let totalHourlyRateEarly = 0;
  activeSubscriptionsEarly.forEach((sub) => {
    totalHourlyRateEarly += sub.hourlyRate || 0;
  });

  // Live Cost Ticker - real-time balance countdown (must be called unconditionally)
  const liveCostTicker = useLiveCostTicker({
    initialBalance: data?.wallet?.balance || 0,
    totalHourlyRate: totalHourlyRateEarly,
    isActive: totalRunningEarly > 0 && isHourlyEarly && !loading && !error,
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

  // Poll for unread support messages
  React.useEffect(() => {
    if (!token) return;

    const checkUnread = async () => {
      try {
        const res = await fetch("/api/support/tickets", {
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

    checkUnread();
    const interval = setInterval(checkUnread, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
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

  // Handle return from Stripe top-up: show toast, auto-reopen launch modal
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const topupStatus = params.get("topup");
    const amountParam = params.get("amount");
    const launchProduct = params.get("launchProduct");

    if (topupStatus === "success") {
      // Track wallet refill conversion
      if (typeof (window as any).my_analytics !== "undefined") {
        (window as any).my_analytics.goal("0xxmvyzdifvutbty");
      }

      // Growify v2 conversion — wallet top-up
      if (amountParam) {
        try {
          const amountDollars = parseInt(amountParam) / 100;
          const custEmail = data?.customer?.email;
          const custName = data?.customer?.name || "";
          const nameParts = custName.split(" ");
          const w = window as any;
          w.grpQueue = w.grpQueue || [];
          if (!w.grp) { w.grp = function() { w.grpQueue.push(arguments); }; }
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

  // Show welcome modal for brand-new users (no balance, no infra, not returning from Stripe)
  React.useEffect(() => {
    if (!data || loading) return;
    // Don't show if returning from Stripe top-up
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("topup") === "success") return;
    }
    const walletBalance = data.wallet?.balance ?? 0;
    const isNewUser =
      walletBalance <= 0 &&
      poolSubscriptions.length === 0 &&
      instances.length === 0 &&
      bareMetalNodes.length === 0;
    if (isNewUser) {
      setShowWelcomeModal(true);
    }
  }, [data, loading, poolSubscriptions.length, instances.length, bareMetalNodes.length]);

  // Gate GPU launch: monthly subscribers and funded wallets go straight to launch,
  // new users (no subs, no wallet) pick billing type first
  const handleLaunchGpu = React.useCallback(() => {
    const monthlySubscriptions = data?.subscriptions || [];
    if (monthlySubscriptions.length > 0) {
      setShowLaunchModal(true);
      return;
    }
    const walletBalance = data?.wallet?.balance ?? 0;
    if (walletBalance <= 0) {
      setShowWelcomeModal(true);
      return;
    }
    setShowLaunchModal(true);
  }, [data?.wallet?.balance, data?.subscriptions, setShowLaunchModal]);

  const handleLogout = () => {
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
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  // Show 2FA verification screen if required
  if (twoFactorRequired && !twoFactorVerified && token && pendingUserEmail) {
    return (
      <TwoFactorVerify
        token={token}
        userEmail={pendingUserEmail}
        onSuccess={() => {
          setTwoFactorVerified(true);
          setTwoFactorRequired(false);
          setLoading(true);
          // Re-fetch account data and instances after 2FA verification
          fetch("/api/account/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
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
  const isFree = data.customer.billingType === "free" || data.customer.billingType === "free_trial";
  const activeSubscriptions = poolSubscriptions.filter((s) => s.status === "subscribed" || s.status === "active");
  const totalRunning = instances.filter((i) => i.status === "running" || i.status === "active").length + activeSubscriptions.length;

  // Calculate current GPU metrics from active subscriptions
  // Using metric_window=last_5m for both TFLOPs and VRAM (average over last 5 mins)
  // Note: hosted.ai API returns vram_usage in KB, not MB
  let totalTflops = 0;
  let totalVramKb = 0;
  let totalHourlyRate = 0; // Sum of hourly rates from all active subscriptions
  activeSubscriptions.forEach((sub) => {
    totalTflops += sub.metrics?.tflops_usage || 0;
    totalVramKb += sub.metrics?.vram_usage || 0;
    totalHourlyRate += sub.hourlyRate || 0; // Use catalog-based hourly rate
  });
  const totalVramGb = totalVramKb / (1024 * 1024); // KB -> GB
  // Average hourly rate per subscription (for display purposes)
  const avgHourlyRate = activeSubscriptions.length > 0 && totalHourlyRate > 0
    ? totalHourlyRate / activeSubscriptions.length
    : 0;

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
  const balanceAmount = data.wallet?.balance ? data.wallet.balance / 100 : 0;
  const runtimeHours = totalHourlyRate > 0 ? balanceAmount / totalHourlyRate : (balanceAmount / avgHourlyRate);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <TruConversionIdentity email={data.customer.email} />
      {/* Mobile Header */}
      <MobileHeader
        balance={data.wallet?.balanceFormatted || "$0"}
        userName={data.customer.name || data.customer.email.split("@")[0]}
        onMenuOpen={() => setShowMobileMenu(true)}
        onTopUp={() => setShowTopupModal(true)}
      />

      {/* Sidebar - Desktop only */}
      <aside className="hidden md:flex w-72 bg-white border-r border-[var(--line)] flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-[var(--line)]">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/packet-logo.png"
              alt={getBrandName()}
              width={140}
              height={50}
              className="h-12 w-auto"
            />
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gradient-to-r from-teal-500 to-teal-600 text-white">Beta</span>
          </Link>
        </div>

        {/* User Info */}
        <div className="p-6 border-b border-[var(--line)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-teal-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
              {(data.customer.name || data.customer.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">{greeting},</p>
              <p className="font-semibold text-[var(--ink)] truncate">{data.customer.name || data.customer.email.split("@")[0]}</p>
            </div>
          </div>
          {(tagline || easterEgg) && (
            <p className="text-xs text-zinc-400 italic mb-4 pl-1">{easterEgg || tagline}</p>
          )}

          {/* Balance Card - Live Cost Ticker */}
          <div className="rounded-2xl p-4 text-white bg-gradient-to-br from-zinc-900 to-zinc-800">
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
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-400">Available balance</span>
              <div className="flex items-center gap-2">
                {totalRunning > 0 && isHourly && liveCostTicker.costPerSecond > 0 && (
                  <span className="text-xs text-zinc-500 font-mono">
                    -${liveCostTicker.costPerSecond.toFixed(4)}/s
                  </span>
                )}
                <div className="w-8 h-5 rounded-sm bg-gradient-to-r from-rose-400 to-orange-400"></div>
              </div>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className={`text-3xl font-bold tabular-nums ${
                liveCostTicker.status === "critical" ? "text-rose-400" : ""
              }`}>
                {totalRunning > 0 && isHourly ? liveCostTicker.formattedBalance : (data.wallet?.balanceFormatted || "$0")}
              </span>
              {data.wallet && getWalletReaction(liveCostTicker.currentBalance || data.wallet.balance) && (
                <span className="text-xs text-zinc-400">{getWalletReaction(liveCostTicker.currentBalance || data.wallet.balance)}</span>
              )}
            </div>
            {totalRunning > 0 && isHourly && data.wallet && totalHourlyRate > 0 && (
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
          {isPro() && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
              label="Token Factory"
              badge="Alpha"
              active={activeTab === "tokenfactory"}
              onClick={() => setActiveTab("tokenfactory")}
            />
          )}
          {isPro() && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
              label="Pixel Factory"
              badge="Alpha"
              active={activeTab === "pixelfactory"}
              onClick={() => setActiveTab("pixelfactory")}
            />
          )}
          <NavItem
            icon={<span className="text-lg">🤗</span>}
            label="Hugging Face"
            active={activeTab === "huggingface"}
            onClick={() => setActiveTab("huggingface")}
          />
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
            label="Apps"
            active={activeTab === "apps"}
            onClick={() => setActiveTab("apps")}
          />
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>}
            label="Storage"
            active={activeTab === "storage"}
            onClick={() => setActiveTab("storage")}
          />
          {isPro() && data.bareMetalEnabled && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>}
              label="Bare Metal"
              active={activeTab === "baremetal"}
              onClick={() => setActiveTab("baremetal")}
            />
          )}
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
            label="Metrics"
            active={activeTab === "metrics"}
            onClick={() => setActiveTab("metrics")}
          />

          {/* Account Section */}
          <div className="pt-4 pb-1">
            <p className="px-4 text-xs font-medium text-zinc-400 uppercase tracking-wider">Account</p>
          </div>
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
            label="Billing"
            active={activeTab === "billing"}
            onClick={() => setActiveTab("billing")}
          />
          {data.isOwner && (
            <NavItem
              icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
              label="Team"
              active={activeTab === "team"}
              onClick={() => setActiveTab("team")}
            />
          )}
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
          <NavItem
            icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>}
            label="Referrals"
            active={activeTab === "referrals"}
            onClick={() => setActiveTab("referrals")}
          />
        </nav>

        {/* Footer Links */}
        <div className="p-4 border-t border-[var(--line)] space-y-1">
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
              {/* Header with New GPU button */}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ink)]">Dashboard</h1>
                  <p className="text-sm text-[var(--muted)]">Manage your GPU instances</p>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setActiveTab("referrals")}
                    className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1.5"
                  >
                    <span>🎁</span>
                    Refer a friend
                  </button>
                  <button
                    onClick={handleLaunchGpu}
                    className="px-5 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New GPU
                  </button>
                </div>
              </div>

              {/* Onboarding checklist for new users */}
              <OnboardingChecklist
                walletBalance={data.wallet?.balance ?? 0}
                hasGpuRunning={totalRunning > 0}
                hasPoolSubscriptions={poolSubscriptions.length > 0}
                onNavigateToTab={(tab) => setActiveTab(tab as TabType)}
                onAddFunds={() => setShowTopupModal(true)}
                onExploreGPUs={() => setShowLaunchModal(true)}
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
              </div>

              {/* Monthly Subscription Entitlements — only show subscriptions without running pods */}
              {(() => {
                const undeployedSubs = (data.subscriptions || []).filter((sub) => {
                  // Check via stripeSubscriptionId match first, then fall back to poolIds / billingType match
                  const hasRunningPod = poolSubscriptions.some((ps) => {
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
                  return !hasRunningPod;
                });
                if (undeployedSubs.length === 0 && (data.subscriptions || []).length === 0) return null;
                if (undeployedSubs.length === 0) return null;
                return (
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-[var(--ink)]">
                        Monthly Subscriptions
                        <span className="ml-2 text-sm font-normal text-zinc-400">({undeployedSubs.length})</span>
                      </h2>
                      <button
                        onClick={() => setShowBlackwellModal(true)}
                        className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                      >
                        Add Subscription
                      </button>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {undeployedSubs.map((sub) => {
                        const periodStart = new Date(sub.currentPeriodStart * 1000);
                        const periodEnd = new Date(sub.currentPeriodEnd * 1000);
                        const priceDisplay = sub.pricePerMonthCents
                          ? `$${(sub.pricePerMonthCents / 100).toFixed(0)}/mo`
                          : "Monthly";

                        return (
                          <div
                            key={sub.id}
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
                                      <h3 className="font-semibold text-[var(--ink)]">{sub.productName || "GPU Subscription"}</h3>
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
                              <button
                                onClick={handleLaunchGpu}
                                className="w-full px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Deploy GPU
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                    <button
                      onClick={handleLaunchGpu}
                      className="px-6 py-3 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors"
                    >
                      Launch GPU
                    </button>
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
                      <button
                        onClick={() => setActiveTab("baremetal")}
                        className="text-sm text-[var(--blue)] hover:underline"
                      >
                        Manage
                      </button>
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

              {/* 6 Cards Grid: TFLOPs, VRAM, GPU Load, Hardware, Billing, Activity */}
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
                  <div className="text-3xl font-bold text-emerald-600 mb-1">{totalTflops.toFixed(1)}</div>
                  <div className="text-xs text-zinc-500 mb-2">TFLOPs</div>
                  <div className="h-32">
                    <GPUUsageChart
                      token={token!}
                      subscriptions={poolSubscriptions}
                      podMetadata={podMetadata}
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
                      token={token!}
                      subscriptions={poolSubscriptions}
                      podMetadata={podMetadata}
                      metricType="vram"
                    />
                  </div>
                </div>

                {/* Real-time GPU Hardware Metrics (from Netdata) */}
                {totalRunning > 0 && <GPUHardwareMetrics token={token!} variant="dashboard" />}

                {/* Billing Chart Card */}
                <div className="bg-white rounded-2xl border border-[var(--line)] p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-[var(--ink)]">Billing</h3>
                    <span className="text-xs text-zinc-400">Last 14 days</span>
                  </div>
                  <div className="h-44">
                    <UsageChart transactions={data.transactions} />
                  </div>
                </div>

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

          {activeTab === "billing" && (
            <BillingTab
              transactions={data.transactions}
              walletBalance={data.wallet?.balanceFormatted || "$0"}
              onTopUp={() => setShowTopupModal(true)}
              formatDateTime={formatDateTime}
              onDownloadCSV={downloadTransactionsCSV}
              payments={data.recentPayments}
              billingPortalUrl={data?.billingPortalUrl}
              subscriptions={data?.subscriptions}
            />
          )}

          {activeTab === "team" && data.isOwner && (
            <div>
              <h1 className="text-2xl font-bold text-[var(--ink)] mb-6">Team</h1>
              <TeamMembers token={token!} isOwner={data.isOwner} />
            </div>
          )}

          {activeTab === "tokenfactory" && token && <TokenFactoryTab token={token} />}

          {activeTab === "pixelfactory" && (
            <div style={{
              maxWidth: "640px",
              margin: "80px auto",
              textAlign: "center",
              padding: "60px 40px",
              background: "var(--panel)",
              borderRadius: "16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}>
              <div style={{
                width: "80px",
                height: "80px",
                margin: "0 auto 24px",
                background: "linear-gradient(135deg, var(--blue) 0%, var(--teal) 100%)",
                borderRadius: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.7,
              }}>
                <svg style={{ width: "40px", height: "40px", color: "white" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 style={{
                fontSize: "24px",
                fontWeight: "700",
                color: "var(--ink)",
                fontFamily: "var(--font-display)",
                marginBottom: "12px",
              }}>
                Pixel Factory is Under Maintenance
              </h2>
              <p style={{
                fontSize: "15px",
                color: "var(--muted)",
                lineHeight: "1.6",
                maxWidth: "440px",
                margin: "0 auto",
              }}>
                {"We're upgrading our image generation infrastructure. Pixel Factory will be back shortly. Thanks for your patience!"}
              </p>
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
              subscriptions={poolSubscriptions}
              onRefresh={fetchInstances}
            />
          )}

          {activeTab === "storage" && token && <StorageTab token={token} />}

          {activeTab === "baremetal" && token && <BareMetalTab token={token} onTopUp={() => setShowTopupModal(true)} />}

          {activeTab === "settings" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-[var(--ink)] mb-2">Settings</h1>
                <p className="text-sm text-[var(--muted)]">Manage your account settings and security</p>
              </div>

              {/* Profile Section */}
              <ProfileSettings token={token!} />

              {/* Budget Controls Section */}
              <BudgetSettings token={token!} />

              {/* Rate Limit Settings Section */}
              <RateLimitSettings token={token!} />

              {/* Session Settings Section */}
              <SessionSettings
                token={token!}
                onSessionTimeoutChange={setSessionTimeoutHours}
              />

              {/* API Keys Section */}
              <ApiKeysSettings token={token!} />

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
            Session expires in {sessionTimeoutHours} {sessionTimeoutHours === 1 ? "hour" : "hours"} · <Link href="/account" className="text-[var(--blue)] hover:underline">Request new link</Link>
            <span className="mx-2">·</span>
            © {new Date().getFullYear()} {getBrandName()} · Powered by <a href="https://hosted.ai" className="text-[var(--blue)] hover:underline" target="_blank" rel="noopener noreferrer">hosted.ai</a>
            {process.env.NEXT_PUBLIC_APP_VERSION && <>
              <span className="mx-2">·</span>
              <span className="text-zinc-400">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
            </>}
          </p>
        </footer>
      </main>

      {/* Launch GPU Modal */}
      <LaunchGPUModal
        isOpen={showLaunchModal}
        onClose={() => {
          setShowLaunchModal(false);
          setLaunchProductId(undefined);
        }}
        token={token!}
        customerEmail={data?.customer?.email}
        onSuccess={(launchInfo) => {
          setProvisioningGpu(launchInfo);
          setLaunchProductId(undefined);
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

      {/* Transactions Modal */}
      <TransactionsModal
        isOpen={showTransactionsModal}
        onClose={() => setShowTransactionsModal(false)}
        transactions={data?.transactions || []}
        formatDateTime={formatDateTime}
        onDownloadCSV={downloadTransactionsCSV}
      />

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

      {/* Welcome Modal for new users */}
      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        token={token!}
        topupLoading={topupLoading}
        onTopup={handleTopup}
        onVoucherRedeemed={refreshAccountData}
        customerEmail={data?.customer?.email}
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
        userName={data.customer.name || data.customer.email.split("@")[0]}
        userEmail={data.customer.email}
        isOwner={data.isOwner}
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
      />

      {/* Top-up success toast */}
      {topupToast && (
        <div className="fixed top-4 right-4 z-[60] animate-in slide-in-from-top-2 duration-300">
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
        <div className="fixed top-4 right-4 z-[60] animate-in slide-in-from-top-2 duration-300">
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
    </div>
  );
}

