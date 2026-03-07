"use client";

import { useState, useCallback } from "react";
import { AccountData, ActivityEvent } from "../types";

export interface DashboardActionsState {
  topupLoading: boolean;
  hostedaiLoginLoading: boolean;
  billingPortalLoading: boolean;
}

export interface DashboardActionsCallbacks {
  openHostedaiDashboard: () => Promise<void>;
  openBillingPortal: () => Promise<void>;
  downloadActivityCSV: () => void;
  downloadTransactionsCSV: () => void;
  formatDateTime: (timestamp: number) => string;
  handleTopup: (amount: number, voucherCode?: string, launchProductId?: string) => Promise<void>;
}

interface UseDashboardActionsProps {
  token: string | null;
  data: AccountData | null;
  activityEvents: ActivityEvent[];
}

export function useDashboardActions({
  token,
  data,
  activityEvents,
}: UseDashboardActionsProps): DashboardActionsState & DashboardActionsCallbacks {
  const [topupLoading, setTopupLoading] = useState(false);
  const [hostedaiLoginLoading, setHostedaiLoginLoading] = useState(false);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);

  // Format timestamp to readable date/time
  const formatDateTime = useCallback((timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  // Open hosted.ai dashboard with a fresh OTL (one-time login) token
  const openHostedaiDashboard = useCallback(async () => {
    if (!token || hostedaiLoginLoading) return;

    setHostedaiLoginLoading(true);
    try {
      const response = await fetch("/api/account/hostedai-login", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to get hosted.ai login URL:", error);
        alert("Failed to open advanced dashboard. Please try again.");
        return;
      }

      const { url } = await response.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Failed to open hosted.ai dashboard:", error);
      alert("Failed to open advanced dashboard. Please try again.");
    } finally {
      setHostedaiLoginLoading(false);
    }
  }, [token, hostedaiLoginLoading]);

  // Open Stripe billing portal with a fresh session
  const openBillingPortal = useCallback(async () => {
    if (!token || billingPortalLoading) return;

    setBillingPortalLoading(true);
    try {
      const response = await fetch("/api/account/billing-portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to get billing portal URL:", error);
        alert("Failed to open billing portal. Please try again.");
        return;
      }

      const { url } = await response.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Failed to open billing portal:", error);
      alert("Failed to open billing portal. Please try again.");
    } finally {
      setBillingPortalLoading(false);
    }
  }, [token, billingPortalLoading]);

  // Download activity logs as CSV
  const downloadActivityCSV = useCallback(() => {
    if (activityEvents.length === 0) return;

    const headers = ["Date", "Time", "Type", "Description"];
    const rows = activityEvents.map(event => {
      const date = new Date(event.created * 1000);
      return [
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
        event.type,
        event.description
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `activity-logs-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }, [activityEvents]);

  // Download transactions as CSV
  const downloadTransactionsCSV = useCallback(() => {
    if (!data || data.transactions.length === 0) return;

    const headers = ["Date", "Time", "Type", "Description", "Amount"];
    const rows = data.transactions.map(txn => {
      const date = new Date(txn.created * 1000);
      return [
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
        txn.type,
        txn.description,
        (txn.type === "credit" ? "+" : "-") + txn.amountFormatted
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }, [data]);

  // Handle wallet top-up
  // When called from TopupModal: handleTopup(amount, voucherCode)
  // When called from LaunchGPUModal: handleTopup(amount, undefined, launchProductId)
  const handleTopup = useCallback(async (amount: number, voucherCode?: string, launchProductId?: string) => {
    if (!token || topupLoading) return;

    setTopupLoading(true);
    try {
      const res = await fetch("/api/account/wallet-topup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount, voucherCode, launchProductId }),
      });
      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        alert(result.error || "Failed to create checkout");
      }
    } catch {
      alert("Failed to initiate top-up");
    } finally {
      setTopupLoading(false);
    }
  }, [token, topupLoading]);

  return {
    topupLoading,
    hostedaiLoginLoading,
    billingPortalLoading,
    openHostedaiDashboard,
    openBillingPortal,
    downloadActivityCSV,
    downloadTransactionsCSV,
    formatDateTime,
    handleTopup,
  };
}
