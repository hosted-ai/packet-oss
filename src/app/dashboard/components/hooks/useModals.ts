"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export type TabType = "dashboard" | "billing" | "team" | "keys" | "tokenfactory" | "pixelfactory" | "huggingface" | "referrals" | "support" | "settings" | "metrics" | "apps" | "storage" | "baremetal";

const VALID_TABS: TabType[] = ["dashboard", "billing", "team", "keys", "tokenfactory", "pixelfactory", "huggingface", "referrals", "support", "settings", "metrics", "apps", "storage", "baremetal"];

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

  // Sync tab state with URL on mount and URL changes
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams, getTabFromUrl, activeTab]);

  // Update URL when tab changes
  const setActiveTab = useCallback((tab: TabType) => {
    setActiveTabState(tab);

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
