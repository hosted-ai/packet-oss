"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseLiveCostTickerOptions {
  /** Initial balance in cents */
  initialBalance: number;
  /** Total hourly rate in dollars for all active instances */
  totalHourlyRate: number;
  /** Whether the ticker is active (has running instances) */
  isActive: boolean;
  /** Callback to sync with server (returns new balance in cents) */
  onSync?: () => Promise<number>;
  /** Sync interval in ms (default: 60000 = 1 minute) */
  syncInterval?: number;
}

interface LiveCostTickerState {
  /** Current calculated balance in cents */
  currentBalance: number;
  /** Formatted balance string */
  formattedBalance: string;
  /** Cost per second in dollars */
  costPerSecond: number;
  /** Estimated hours remaining */
  hoursRemaining: number;
  /** Formatted time remaining (e.g., "5h 23m") */
  timeRemainingFormatted: string;
  /** Balance health status for color coding */
  status: "healthy" | "warning" | "critical";
  /** Whether currently syncing with server */
  isSyncing: boolean;
}

export function useLiveCostTicker({
  initialBalance,
  totalHourlyRate,
  isActive,
  onSync,
  syncInterval = 60000,
}: UseLiveCostTickerOptions): LiveCostTickerState {
  const [serverBalance, setServerBalance] = useState(initialBalance);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const lastSyncTime = useRef(Date.now());
  const startTime = useRef(Date.now());

  // Reset elapsed time when server balance changes (sync happened)
  useEffect(() => {
    setServerBalance(initialBalance);
    setElapsedSeconds(0);
    startTime.current = Date.now();
    lastSyncTime.current = Date.now();
  }, [initialBalance]);

  // Tick every second when active
  useEffect(() => {
    if (!isActive || totalHourlyRate <= 0) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const secondsSinceStart = Math.floor((now - startTime.current) / 1000);
      setElapsedSeconds(secondsSinceStart);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, totalHourlyRate]);

  // Sync with server periodically
  const syncWithServer = useCallback(async () => {
    if (!onSync || isSyncing) return;

    setIsSyncing(true);
    try {
      const newBalance = await onSync();
      setServerBalance(newBalance);
      setElapsedSeconds(0);
      startTime.current = Date.now();
      lastSyncTime.current = Date.now();
    } catch (error) {
      console.error("Failed to sync balance:", error);
    } finally {
      setIsSyncing(false);
    }
  }, [onSync, isSyncing]);

  // Sync on interval and on tab focus
  useEffect(() => {
    if (!onSync || !isActive) return;

    const interval = setInterval(syncWithServer, syncInterval);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Only sync if more than 10 seconds since last sync
        if (Date.now() - lastSyncTime.current > 10000) {
          syncWithServer();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onSync, isActive, syncInterval, syncWithServer]);

  // Calculate current balance
  const costPerSecond = totalHourlyRate / 3600; // hourly rate to per-second
  const costSoFar = elapsedSeconds * costPerSecond * 100; // in cents
  const currentBalance = Math.max(0, serverBalance - costSoFar);

  // Format balance
  const formattedBalance = `$${(currentBalance / 100).toFixed(2)}`;

  // Calculate time remaining
  const hoursRemaining = totalHourlyRate > 0
    ? (currentBalance / 100) / totalHourlyRate
    : Infinity;

  // Format time remaining
  const formatTimeRemaining = (hours: number): string => {
    if (!isFinite(hours) || hours <= 0) return "0m";
    if (hours > 999) return "999h+";

    const totalMinutes = Math.floor(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    if (h > 0) {
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${m}m`;
  };

  const timeRemainingFormatted = formatTimeRemaining(hoursRemaining);

  // Determine status based on hours remaining
  const getStatus = (): "healthy" | "warning" | "critical" => {
    if (!isActive || totalHourlyRate <= 0) return "healthy";
    if (hoursRemaining <= 1) return "critical";
    if (hoursRemaining <= 3) return "warning";
    return "healthy";
  };

  return {
    currentBalance,
    formattedBalance,
    costPerSecond,
    hoursRemaining,
    timeRemainingFormatted,
    status: getStatus(),
    isSyncing,
  };
}
