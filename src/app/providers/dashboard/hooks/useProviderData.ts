"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  ProviderTab,
  ProviderProfile,
  ProviderNode,
  ProviderStats,
  RevenueSummary,
  PayoutSummary,
} from "../types";
import { isNodeFullyProvisioned } from "../types";

// Polling interval for provisioning nodes (5 seconds)
const PROVISIONING_POLL_INTERVAL = 5000;

export function useProviderData() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProviderTab>("infrastructure");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [nodes, setNodes] = useState<ProviderNode[]>([]);
  const [stats, setStats] = useState<ProviderStats>({
    totalNodes: 0,
    activeNodes: 0,
    pendingNodes: 0,
    totalGpus: 0,
    activeGpus: 0,
    utilizationPercent: 0,
    thisMonthEarnings: 0,
    lastMonthEarnings: 0,
  });
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenuePeriod, setRevenuePeriod] = useState("30d");
  const [payoutData, setPayoutData] = useState<PayoutSummary | null>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [isAdminSession, setIsAdminSession] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/profile", {
        credentials: "include",
      });

      // Handle unauthorized - redirect to login
      if (response.status === 401) {
        router.push("/providers");
        return;
      }

      const data = await response.json();

      if (!data.success) {
        console.error("Profile fetch failed:", data.error);
        router.push("/providers");
        return;
      }

      setProfile(data.data);
      setIsAdminSession(data.isAdminSession || false);
      setAdminEmail(data.adminEmail || null);
    } catch (error) {
      console.error("Failed to fetch profile:", error);
      router.push("/providers");
    }
  }, [router]);

  const fetchNodes = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/nodes", {
        credentials: "include",
      });
      const data = await response.json();

      if (data.success) {
        setNodes(data.data.nodes);
        setStats({
          totalNodes: data.data.stats.totalNodes,
          activeNodes: data.data.stats.activeNodes,
          pendingNodes: data.data.stats.pendingNodes,
          totalGpus: data.data.stats.totalGpus,
          activeGpus: data.data.stats.activeGpus,
          utilizationPercent: data.data.stats.utilizationPercent,
          thisMonthEarnings: data.data.stats.thisMonthEarnings,
          lastMonthEarnings: data.data.stats.lastMonthEarnings,
        });
      }
    } catch (error) {
      console.error("Failed to fetch nodes:", error);
    }
  }, []);

  const fetchRevenue = useCallback(async (period: string) => {
    setRevenueLoading(true);
    try {
      const response = await fetch(`/api/providers/revenue?period=${period}`, {
        credentials: "include",
      });
      const data = await response.json();

      if (data.success) {
        setRevenue(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch revenue:", error);
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  const fetchPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      const response = await fetch("/api/providers/payouts", {
        credentials: "include",
      });
      const data = await response.json();

      if (data.success) {
        setPayoutData(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch payouts:", error);
    } finally {
      setPayoutsLoading(false);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    await fetchProfile();
    await fetchNodes();
    setLoading(false);
  }, [fetchProfile, fetchNodes]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (activeTab === "revenue" && !revenue) {
      fetchRevenue(revenuePeriod);
    }
  }, [activeTab, revenue, revenuePeriod, fetchRevenue]);

  useEffect(() => {
    if (activeTab === "payouts" && !payoutData) {
      fetchPayouts();
    }
  }, [activeTab, payoutData, fetchPayouts]);

  // Auto-poll when there are provisioning nodes
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Check if any nodes are still provisioning
    const hasProvisioningNodes = nodes.some((node) => !isNodeFullyProvisioned(node));

    if (hasProvisioningNodes && activeTab === "infrastructure") {
      // Start polling if not already running
      if (!pollingIntervalRef.current) {
        pollingIntervalRef.current = setInterval(() => {
          fetchNodes();
        }, PROVISIONING_POLL_INTERVAL);
      }
    } else {
      // Stop polling when all nodes are fully provisioned or tab changed
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [nodes, activeTab, fetchNodes]);

  const handlePeriodChange = (period: string) => {
    setRevenuePeriod(period);
    fetchRevenue(period);
  };

  const refreshNodes = () => {
    fetchNodes();
  };

  const refreshRevenue = () => {
    fetchRevenue(revenuePeriod);
  };

  const refreshPayouts = () => {
    fetchPayouts();
  };

  return {
    loading,
    activeTab,
    setActiveTab,
    profile,
    setProfile,
    nodes,
    stats,
    revenue,
    revenueLoading,
    revenuePeriod,
    payoutData,
    payoutsLoading,
    isAdminSession,
    adminEmail,
    handlePeriodChange,
    refreshNodes,
    refreshRevenue,
    refreshPayouts,
  };
}
