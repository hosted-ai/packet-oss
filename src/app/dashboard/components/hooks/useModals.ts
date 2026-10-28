"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export type TabType = "dashboard" | "billing" | "team" | "keys" | "huggingface" | "referrals" | "support" | "settings" | "metrics" | "apps" | "storage" | "baremetal" | "bare-metal-orders";

const VALID_TABS: TabType[] = ["dashboard", "billing", "team", "keys", "huggingface", "referrals", "support", "settings", "metrics", "apps", "storage", "baremetal", "bare-metal-orders"];

export interface ModalsState {
  showLaunchModal: boolean;
  showTopupModal: boolean;
  showActivityModal: boolean;
  showTransactionsModal: boolean;
  activeTab: TabType;
}

export interface ModalsActions {
  setShowLaunchModal: (show: boolean) => void;
  setShowTopupModal: (show: boolean) => void;
  setShowActivityModal: (show: boolean) => void;
  setShowTransactionsModal: (show: boolean) => void;
  setActiveTab: (tab: ModalsState["activeTab"]) => void;
}

export function useModals(): ModalsState & ModalsActions {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);

  // Get initial tab from URL or default to "dashboard"
  const getTabFromUrl = useCallback((): TabType => {
    const tabParam = searchParams.get("tab");
    if (tabParam && VALID_TABS.includes(tabParam as TabType)) {
      return tabParam as TabType;
    }
    return "dashboard";
  }, [searchParams]);

  const [activeTab, setActiveTabState] = useState<TabType>(getTabFromUrl);

  // The last tab value we observed in the URL. The sync effect reacts ONLY to
  // genuine URL changes (deep links, back/forward) — comparing against this
  // ref rather than against `activeTab`. Comparing against activeTab caused a
  // render loop: a permission guard that bounces a disallowed tab via
  // setActiveTab("dashboard") would be reverted by this effect re-reading the
  // not-yet-updated searchParams, ping-ponging activeTab forever (flicker).
  const lastUrlTab = useRef<TabType>(getTabFromUrl());

  // Sync tab state with the URL on mount and on real URL navigations.
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== lastUrlTab.current) {
      lastUrlTab.current = tabFromUrl;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs tab state from the URL (client-only) on mount and param change
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams, getTabFromUrl]);

  // Update URL when tab changes
  const setActiveTab = useCallback((tab: TabType) => {
    setActiveTabState(tab);
    // Keep the ref aligned so the URL-sync effect treats this programmatic
    // change as already-synced (and won't revert it from a lagging URL read).
    lastUrlTab.current = tab;

    // Build new URL with tab parameter
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "dashboard") {
      params.delete("tab"); // Clean URL for default tab
    } else {
      params.set("tab", tab);
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [searchParams, pathname, router]);

  return {
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
  };
}
