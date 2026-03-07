"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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

export interface DashboardDataState {
  // Auth & Loading
  token: string | null;
  loading: boolean;
  error: string;

  // Account data
  data: AccountData | null;

  // Instances & Subscriptions
  instances: Instance[];
  poolSubscriptions: PoolSubscription[];
  podMetadata: Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string }>;
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
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
}

export function useDashboardData(): DashboardDataState & DashboardDataActions & { ticketId: string | null } {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const ticketId = searchParams.get("ticket"); // Deep link to specific support ticket

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
  const [podMetadata, setPodMetadata] = useState<Record<string, { displayName: string | null; notes: string | null; hourlyRate?: number; startupScriptStatus?: string | null; stripeSubscriptionId?: string; billingType?: string }>>({});
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
    if (!token) {
      setError("No access token provided");
      setLoading(false);
      return;
    }

    async function fetchAccountData() {
      try {
        const response = await fetch("/api/account/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const result = await response.json();
        if (!response.ok) {
          setError(result.error || "Failed to load account");
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

        setData(result);
      } catch {
        setError("Failed to load account data");
      } finally {
        setLoading(false);
      }
    }

    fetchAccountData();

    // Only fetch additional data if 2FA is not required or already verified
    if (!twoFactorRequired || twoFactorVerified) {
      fetchInstances();
      fetchActivityEvents();
      fetchBillingStats();
      fetchSnapshots();
    }
  }, [token, fetchInstances, fetchActivityEvents, fetchBillingStats, fetchSnapshots, twoFactorRequired, twoFactorVerified]);

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
    setLoading,
    setError,
  };
}
