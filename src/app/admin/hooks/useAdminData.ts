"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Stats, Customer, Admin, ClusterOffer, Quote, PricingConfig, AdminActivity, AdminTab } from "../types";
import { PREMIUM_ADMIN_TABS, OSS_ONLY_ADMIN_TABS } from "../types";
import { isPro, isOSS } from "@/lib/edition";

const ALL_ADMIN_TABS: AdminTab[] = ["customers", "admins", "investors", "clusters", "quotes", "referrals", "vouchers", "activity", "settings", "calculator", "qa", "providers", "landing", "game", "products", "pods", "gpu-apps", "emails", "email-log", "drip", "nodes", "pools", "business", "demand", "batches", "token-providers", "skypilot", "support", "spheron", "node-revenue", "banners", "marketing", "tenants", "pixel-factory", "uptime", "payouts", "platform-settings"];

const VALID_ADMIN_TABS: AdminTab[] = ALL_ADMIN_TABS.filter((tab) => {
  if (PREMIUM_ADMIN_TABS.has(tab)) return isPro();
  if (OSS_ONLY_ADMIN_TABS.has(tab)) return isOSS();
  return true;
});

export function useAdminData() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [stats, setStats] = useState<Stats>({
    totalCustomers: 0,
    activePods: 0,
    mrr: 0,
    newCustomersThisWeek: 0,
    revenueThisWeek: 0,
    growth: null,
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [canResetPin, setCanResetPin] = useState(false);
  const [clusterOffers, setClusterOffers] = useState<ClusterOffer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [activities, setActivities] = useState<AdminActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [customersPage, setCustomersPage] = useState(1);
  const [customersTotalPages, setCustomersTotalPages] = useState(1);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [customersSortBy, setCustomersSortBy] = useState<string>("created");
  const [customersSortDir, setCustomersSortDir] = useState<"asc" | "desc">("desc");
  const [customersLoading, setCustomersLoading] = useState(false);

  // Use refs to break the circular dependency chain
  const searchRef = useRef(search);
  const customersSortByRef = useRef(customersSortBy);
  const customersSortDirRef = useRef(customersSortDir);
  searchRef.current = search;
  customersSortByRef.current = customersSortBy;
  customersSortDirRef.current = customersSortDir;

  // Get initial tab from URL query param
  const getTabFromUrl = useCallback((): AdminTab => {
    const tabParam = searchParams.get("tab");
    if (tabParam && VALID_ADMIN_TABS.includes(tabParam as AdminTab)) {
      return tabParam as AdminTab;
    }
    return "customers";
  }, [searchParams]);

  const [activeTab, setActiveTabState] = useState<AdminTab>(getTabFromUrl);

  // Stable loadCustomers that takes all params explicitly - no state deps
  const loadCustomers = useCallback(async (
    page: number,
    sortBy: string,
    sortDir: "asc" | "desc",
    searchQuery: string,
  ) => {
    setCustomersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
        sortBy,
        sortDir,
      });
      if (searchQuery) params.set("search", searchQuery);
      const res = await fetch(`/api/admin/customers?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setCustomersTotal(data.total);
        setCustomersTotalPages(data.totalPages);
        setCustomersPage(data.page);
      }
    } finally {
      setCustomersLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, adminsRes, clustersRes, quotesRes, pricingRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/admins"),
        fetch("/api/admin/cluster-offers"),
        fetch("/api/admin/quotes"),
        fetch("/api/admin/pricing"),
      ]);

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (adminsRes.ok) {
        const data = await adminsRes.json();
        setAdmins(data.admins);
        setCanResetPin(data.canResetPin ?? false);
      }
      if (clustersRes.ok) {
        const data = await clustersRes.json();
        setClusterOffers(data.offers || []);
      }
      if (quotesRes.ok) {
        const data = await quotesRes.json();
        setQuotes(data.quotes || []);
      }
      if (pricingRes.ok) {
        const data = await pricingRes.json();
        setPricing(data.pricing);
      }
    } finally {
      setLoading(false);
    }
    // Also load first page of customers
    loadCustomers(1, "created", "desc", "");
  }, [loadCustomers]);

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await fetch("/api/admin/activity?limit=200");
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error("Failed to load activities:", error);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async () => {
    setCustomersPage(1);
    loadCustomers(1, customersSortByRef.current, customersSortDirRef.current, searchRef.current);
  }, [loadCustomers]);

  const clearSearch = useCallback(() => {
    setSearch("");
    setCustomersPage(1);
    loadCustomers(1, customersSortByRef.current, customersSortDirRef.current, "");
  }, [loadCustomers]);

  const handleCustomersSort = useCallback((field: string) => {
    setCustomersSortBy((prevSortBy) => {
      setCustomersSortDir((prevSortDir) => {
        let newDir: "asc" | "desc" = "asc";
        if (prevSortBy === field) {
          newDir = prevSortDir === "asc" ? "desc" : "asc";
        } else {
          newDir = field === "created" || field === "walletBalance" || field === "activeGPUs" ? "desc" : "asc";
        }
        setCustomersPage(1);
        loadCustomers(1, field, newDir, searchRef.current);
        return newDir;
      });
      return field;
    });
  }, [loadCustomers]);

  const handleCustomersPageChange = useCallback((newPage: number) => {
    setCustomersPage(newPage);
    loadCustomers(newPage, customersSortByRef.current, customersSortDirRef.current, searchRef.current);
  }, [loadCustomers]);

  // Check auth on mount - only runs once
  useEffect(() => {
    fetch("/api/admin/auth")
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data) => {
        setAdminEmail(data.email);
        loadData();
      })
      .catch(() => {
        router.push("/admin/login");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync tab state with URL on URL changes
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTabState(tabFromUrl);
    }
  }, [searchParams, getTabFromUrl, activeTab]);

  // Update URL when tab changes
  const setActiveTab = useCallback((tab: AdminTab) => {
    setActiveTabState(tab);

    // Build new URL with tab parameter
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "customers") {
      params.delete("tab"); // Clean URL for default tab
    } else {
      params.set("tab", tab);
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.push(newUrl, { scroll: false });
  }, [searchParams, pathname, router]);

  // Load activities when activity tab is selected
  useEffect(() => {
    if (activeTab === "activity" && activities.length === 0) {
      loadActivities();
    }
  }, [activeTab, activities.length, loadActivities]);

  return {
    loading,
    adminEmail,
    stats,
    customers,
    admins,
    canResetPin,
    clusterOffers,
    quotes,
    pricing,
    activities,
    activitiesLoading,
    search,
    activeTab,
    customersPage,
    customersTotalPages,
    customersTotal,
    customersSortBy,
    customersSortDir,
    customersLoading,
    setSearch,
    setActiveTab,
    setCustomers,
    setClusterOffers,
    setQuotes,
    setPricing,
    loadData,
    loadCustomers,
    loadActivities,
    handleSearch,
    clearSearch,
    handleCustomersSort,
    handleCustomersPageChange,
    router,
  };
}
