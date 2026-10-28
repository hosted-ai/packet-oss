"use client";

import { useState, useCallback } from "react";
import { AccountData, ActivityEvent } from "../types";
import { useWalletTopup, type TopupHandler } from "@/hooks/useWalletTopup";

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
  handleTopup: TopupHandler;
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
  const { topupLoading, handleTopup } = useWalletTopup(token);
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

  // Download complete transaction history as CSV.
  // Fetches all transactions from /api/billing/history (full Stripe pagination)
  // rather than the 100-item capped set held in memory.
  const downloadTransactionsCSV = useCallback(async () => {
    if (!token) return;

    interface TxnRow {
      created: number;
      type: string;
      description: string;
      amountFormatted: string;
    }

    let txns: TxnRow[] = [];
    try {
      const response = await fetch("/api/billing/history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const result = await response.json() as { transactions?: TxnRow[] };
        txns = result.transactions ?? [];
      }
    } catch {
      // fall through to cached data
    }

    // Fall back to the cached 100-transaction set if the API call failed
    if (txns.length === 0 && data?.transactions.length) {
      txns = data.transactions;
    }

    if (txns.length === 0) return;

    const headers = ["Date", "Time", "Type", "Description", "Amount"];
    const rows = txns.map(txn => {
      const date = new Date(txn.created * 1000);
      return [
        date.toLocaleDateString(),
        date.toLocaleTimeString(),
        txn.type,
        txn.description,
        (txn.type === "credit" ? "+" : "-") + txn.amountFormatted,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `transactions-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }, [token, data]);

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
