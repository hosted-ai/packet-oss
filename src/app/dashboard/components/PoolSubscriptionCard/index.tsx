"use client";

import { useEffect, useState } from "react";
import {
  PoolSubscription,
  ConnectionInfo,
  HfDeploymentInfo,
  StatusDot,
  TerminalModal,
  RunScriptModal,
  getGpuStatusText,
  getRunningTimeQuip,
} from "../";
import { GPUCardSSHInfo } from "./GPUCardSSHInfo";
import { GPUCardServices } from "./GPUCardServices";
import { GPUCardHfDeployment } from "./GPUCardHfDeployment";
import { SSHKeyModal } from "./SSHKeyModal";
import { AddStorageModal } from "./AddStorageModal";
import { SaveSnapshotModal } from "./SaveSnapshotModal";

export interface PoolSubscriptionCardProps {
  subscription: PoolSubscription;
  token: string;
  onRefresh: () => void;
  onSnapshotCreated?: () => void;
  gpuDashboardUrl?: string | null;
  compact?: boolean;
  metadata?: { displayName: string | null; notes: string | null; startupScriptStatus?: string | null };
  hfDeployment?: HfDeploymentInfo;
  isMonthly?: boolean;
  monthlyPriceDisplay?: string;
  billingPortalUrl?: string;
}

export function PoolSubscriptionCard({
  subscription,
  token,
  onRefresh,
  onSnapshotCreated,
  gpuDashboardUrl,
  compact = false,
  metadata,
  hfDeployment,
  isMonthly = false,
  monthlyPriceDisplay,
  billingPortalUrl,
}: PoolSubscriptionCardProps) {
  // Core state
  const [loading, setLoading] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Modal state
  const [showTerminal, setShowTerminal] = useState(false);
  const [showRunScript, setShowRunScript] = useState(false);
  const [showSSHKeyModal, setShowSSHKeyModal] = useState(false);
  const [showAddStorageModal, setShowAddStorageModal] = useState(false);
  const [showSaveSnapshotModal, setShowSaveSnapshotModal] = useState(false);

  // Metadata editing state
  const [editingName, setEditingName] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [displayName, setDisplayName] = useState(metadata?.displayName || "");
  const [notes, setNotes] = useState(metadata?.notes || "");
  const [savingMetadata, setSavingMetadata] = useState(false);

  // HuggingFace deployment state
  const [hfStatus, setHfStatus] = useState<{
    status: string;
    message: string;
    logs?: string;
    error?: string;
  } | null>(null);
  const [pollingHfStatus, setPollingHfStatus] = useState(false);

  // Service exposure state
  const [exposedServices, setExposedServices] = useState<any[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [exposingVllmApi, setExposingVllmApi] = useState(false);

  // Stopped instance rate for cost warnings
  const [stoppedInstanceRate, setStoppedInstanceRate] = useState<number>(25); // Default 25%

  // Sync state when metadata prop changes (skip if user is actively editing)
  useEffect(() => {
    if (!editingName) setDisplayName(metadata?.displayName || "");
    if (!editingNotes) setNotes(metadata?.notes || "");
  }, [metadata]);

  // Fetch stopped instance rate for cost warnings
  useEffect(() => {
    async function fetchPricingConfig() {
      try {
        const response = await fetch("/api/account/billing-stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.stoppedInstanceRatePercent) {
            setStoppedInstanceRate(data.stoppedInstanceRatePercent);
          }
        }
      } catch (error) {
        console.error("Failed to fetch pricing config:", error);
      }
    }
    fetchPricingConfig();
  }, [token]);

  // Poll HF deployment status
  const isDeploymentActive = hfDeployment && ["pending", "deploying", "installing", "starting"].includes(hfDeployment.status);
  const isHfStatusActive = hfStatus?.status === "installing" || hfStatus?.status === "starting";
  const shouldPoll = isDeploymentActive || isHfStatusActive;

  useEffect(() => {
    if (!hfDeployment) return;

    async function fetchHfStatus() {
      if (pollingHfStatus) return;
      setPollingHfStatus(true);
      try {
        const response = await fetch(`/api/huggingface/deploy-status?subscriptionId=${subscription.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setHfStatus(data);
        }
      } catch (error) {
        console.error("Failed to fetch HF status:", error);
      } finally {
        setPollingHfStatus(false);
      }
    }

    fetchHfStatus();

    if (shouldPoll) {
      const interval = setInterval(fetchHfStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [hfDeployment, subscription.id, token, pollingHfStatus, shouldPoll]);

  // Fetch connection info (all instances are unified in HAI 2.2)
  useEffect(() => {
    async function fetchConnectionInfo() {
      const s = subscription.status;
      if (s !== "subscribed" && s !== "active" && s !== "running") return;
      setLoadingConnection(true);
      try {
        const response = await fetch(`/api/instances/connection-info?instance_id=${subscription.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setConnectionInfo(data.connectionInfo?.[0] || null);
        }
      } catch (error) {
        console.error("Failed to fetch connection info:", error);
      } finally {
        setLoadingConnection(false);
      }
    }
    fetchConnectionInfo();
  }, [subscription.id, subscription.status, token]);

  // Fetch exposed services when card is expanded
  useEffect(() => {
    async function fetchExposedServices() {
      if (!expanded || (subscription.status !== "subscribed" && subscription.status !== "active" && subscription.status !== "running")) return;
      setLoadingServices(true);
      try {
        const response = await fetch(`/api/services?instanceId=${subscription.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setExposedServices(data.services || []);
        }
      } catch (error) {
        console.error("Failed to fetch exposed services:", error);
      } finally {
        setLoadingServices(false);
      }
    }
    fetchExposedServices();
  }, [expanded, subscription.id, subscription.status, token]);

  // Metadata save handler
  const saveMetadata = async (field: "displayName" | "notes", value: string) => {
    setSavingMetadata(true);
    try {
      const body = field === "displayName" ? { displayName: value } : { notes: value };
      const response = await fetch(`/api/instances/pool-subscription/${subscription.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        onRefresh();
      }
    } catch (error) {
      console.error("Failed to save metadata:", error);
    } finally {
      setSavingMetadata(false);
      if (field === "displayName") setEditingName(false);
      else setEditingNotes(false);
    }
  };

  // Action handlers
  const handleUnsubscribe = async () => {
    if (!confirm("Are you sure you want to terminate this GPU?")) return;
    setLoading("unsubscribe");
    try {
      const response = await fetch(`/api/instances/pool-subscription/${subscription.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          throw new Error(data.error || "Failed to terminate");
        } else {
          throw new Error(`Server error (${response.status}): Please try again`);
        }
      }
      // Poll more aggressively for status update
      const pollInterval = setInterval(onRefresh, 2000);
      setTimeout(() => {
        clearInterval(pollInterval);
        // Keep loading state until subscription actually disappears
        // Don't reset loading - let the card disappear when subscription is gone
      }, 60000);
      onRefresh();
    } catch (error) {
      console.error("Failed to unsubscribe:", error);
      alert(error instanceof Error ? error.message : "Failed to terminate GPU");
      setLoading(null);
    }
  };

  const handleRestart = async () => {
    if (!confirm("Restart this GPU? Unsaved data will be lost.")) return;
    setLoading("restart");
    try {
      const response = await fetch(`/api/instances/pool-subscription/${subscription.id}/restart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const pollInterval = setInterval(onRefresh, 3000);
        setTimeout(() => {
          clearInterval(pollInterval);
          setLoading(null);
        }, 60000);
        onRefresh();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to restart");
        setLoading(null);
      }
    } catch (error) {
      console.error("Failed to restart:", error);
      setLoading(null);
    }
  };

  const handleStop = async () => {
    // Calculate the reduced hourly rate for stopped instances
    // Use hourlyRate from subscription (from GpuProduct pricing)
    const hourlyRate = subscription.hourlyRate || 0;
    const reducedRate = hourlyRate > 0 ? (hourlyRate * stoppedInstanceRate / 100).toFixed(2) : "N/A";
    const fullRate = hourlyRate > 0 ? hourlyRate.toFixed(2) : "N/A";

    const confirmMessage = `Stop this GPU?\n\n` +
      `While stopped, you will still be charged $${reducedRate}/hr (${stoppedInstanceRate}% of the full $${fullRate}/hr rate) to reserve your GPU.\n\n` +
      `You can start it again anytime, or terminate it to stop all charges.`;

    if (!confirm(confirmMessage)) return;
    setLoading("stop");
    try {
      const response = await fetch(`/api/instances/pool-subscription/${subscription.id}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const pollInterval = setInterval(onRefresh, 3000);
        setTimeout(() => {
          clearInterval(pollInterval);
          setLoading(null);
        }, 30000);
        onRefresh();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to stop");
        setLoading(null);
      }
    } catch (error) {
      console.error("Failed to stop:", error);
      setLoading(null);
    }
  };

  const handleStart = async () => {
    setLoading("start");
    try {
      const response = await fetch(`/api/instances/pool-subscription/${subscription.id}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const pollInterval = setInterval(onRefresh, 3000);
        setTimeout(() => {
          clearInterval(pollInterval);
          setLoading(null);
        }, 60000);
        onRefresh();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to start");
        setLoading(null);
      }
    } catch (error) {
      console.error("Failed to start:", error);
      setLoading(null);
    }
  };

  const handleExposeVllmApi = async () => {
    const podName = subscription.pods?.[0]?.pod_name;
    if (!podName) {
      alert("No pod found for this subscription");
      return;
    }

    const modelName = hfDeployment?.hfItemName || "vllm";
    const sanitizedName = modelName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 40);
    const serviceName = `${sanitizedName}-api`;

    setExposingVllmApi(true);
    try {
      const response = await fetch('/api/services', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pod_name: podName,
          pool_subscription_id: subscription.id,
          port: 8000,
          service_name: serviceName,
          protocol: 'TCP',
          service_type: 'http',
        }),
      });

      const data = await response.json();

      if (response.ok || data.code === "SERVICE_EXISTS") {
        const servicesResponse = await fetch(`/api/services?instanceId=${subscription.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (servicesResponse.ok) {
          const servData = await servicesResponse.json();
          setExposedServices(servData.services || []);
        }
      } else {
        alert(data.error || 'Failed to expose API');
      }
    } catch (error) {
      console.error('Failed to expose vLLM API:', error);
      alert('Failed to expose API');
    } finally {
      setExposingVllmApi(false);
    }
  };

  // Computed values
  const isActive = subscription.status === "subscribed" || subscription.status === "active" || subscription.status === "running";
  const isPending = subscription.status === "subscribing" || subscription.status === "un_subscribing";
  // Terminating state - either from local loading state OR from API status
  const isTerminating = loading === "unsubscribe" || subscription.status === "un_subscribing";

  // Check if pod is stopped (pod_status will be "Stopped" or similar)
  const podStatus = subscription.pods?.[0]?.pod_status?.toLowerCase() || "";
  const isStopped = podStatus === "stopped" || podStatus === "exited";
  const isStarting = podStatus === "starting" || podStatus === "containerizing";

  const getDisplayStatus = () => {
    if (isTerminating) return { status: "terminating", label: "Cooling down..." };
    if (loading === "restart") return { status: "restarting", label: "Fresh start..." };
    if (loading === "stop") return { status: "stopping", label: "Stopping..." };
    if (loading === "start") return { status: "starting", label: "Starting up..." };
    if (isPending) return { status: "pending", label: getGpuStatusText(subscription.status, false) };
    if (isStopped) return { status: "stopped", label: "Stopped" };
    if (isStarting) return { status: "starting", label: "Starting..." };

    // Check startup script status before showing "running" state
    // Only show "setting up" if script is actively pending/running AND we don't have SSH yet
    // This prevents getting stuck if the runner crashes or PM2 restarts
    const scriptStatus = metadata?.startupScriptStatus;
    const hasSshAvailable = connectionInfo?.pods?.some((p: any) => p.ssh_info);
    if (isActive && scriptStatus === "pending" && !hasSshAvailable) return { status: "setting-up", label: "Setting up..." };
    if (isActive && scriptStatus === "running") return { status: "setting-up", label: "Setting up..." };
    // Only show "setup-failed" if SSH is NOT available - if SSH works, the pod is functional
    // even if the startup script had warnings or non-zero exit
    if (isActive && scriptStatus === "failed" && !hasSshAvailable) return { status: "setup-failed", label: "Setup failed" };

    // Don't show green/running until connection info (SSH) is actually available
    const hasSshInfo = connectionInfo?.pods?.some((p: any) => p.ssh_info);
    if (isActive && (loadingConnection || (!hasSshInfo && !connectionInfo))) {
      return { status: "starting", label: "Connecting..." };
    }

    if (isActive) return { status: "running", label: getGpuStatusText("Running", true) };
    return { status: subscription.status, label: subscription.status };
  };

  const displayStatus = getDisplayStatus();
  // Don't show running quip when terminating - show termination status instead
  const runningQuip = isActive && !isTerminating ? getRunningTimeQuip(subscription.created_at) : null;
  const gpuCount = subscription.pods?.[0]?.gpu_count || 1;

  // Get pods for SSH info display (deduplicated by pod_name to prevent transient backend duplicates)
  const podsForSSH = (connectionInfo?.pods || subscription.pods || []).map((pod, idx) => ({
    pod_name: pod.pod_name,
    pod_status: 'pod_status' in pod ? pod.pod_status : (subscription.pods?.[idx]?.pod_status || 'Unknown'),
    ssh_info: 'ssh_info' in pod ? pod.ssh_info : undefined,
    internal_ip: 'internal_ip' in pod ? pod.internal_ip : undefined,
  })).filter((pod, idx, arr) => arr.findIndex(p => p.pod_name === pod.pod_name) === idx);

  // Compact card for sidebar/quick view
  // Helper for card background based on status
  const getCardBackground = () => {
    if (isTerminating) return "bg-gradient-to-br from-amber-400 to-amber-500";
    if (displayStatus.status === "setting-up") return "bg-gradient-to-br from-blue-400 to-blue-500";
    if (displayStatus.status === "setup-failed") return "bg-gradient-to-br from-rose-400 to-rose-500";
    if (isActive) return "bg-gradient-to-br from-teal-500 to-teal-600";
    return "bg-zinc-200";
  };

  if (compact) {
    return (
      <div className={`p-3 rounded-xl transition-all ${getCardBackground()}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-white/80">{subscription.pool_name || "GPU"}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            displayStatus.status === "setting-up" || displayStatus.status === "setup-failed" || isActive
              ? "bg-white/20 text-white"
              : "bg-zinc-300 text-zinc-600"
          }`}>
            {displayStatus.label}
          </span>
        </div>
        <div className="text-2xl font-bold text-white">{subscription.hourlyRate ? `$${subscription.hourlyRate.toFixed(2)}/hr` : "--"}</div>
        <div className="text-xs text-white/70 mt-1">{gpuCount} GPU</div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition-all ${isMonthly ? "border-l-4 border-l-teal-500 border-t-[var(--line)] border-r-[var(--line)] border-b-[var(--line)]" : "border-[var(--line)]"} ${loading ? "opacity-75" : ""}`}>
      {/* Card Header */}
      <div
        className="p-4 cursor-pointer hover:bg-zinc-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isTerminating ? "bg-amber-100" :
              displayStatus.status === "setting-up" ? "bg-blue-100" :
              displayStatus.status === "setup-failed" ? "bg-rose-100" :
              isActive ? "bg-teal-100" : "bg-zinc-100"
            }`}>
              <svg className={`w-5 h-5 ${
                isTerminating ? "text-amber-600" :
                displayStatus.status === "setting-up" ? "text-blue-600 animate-pulse" :
                displayStatus.status === "setup-failed" ? "text-rose-600" :
                isActive ? "text-teal-600" : "text-zinc-400"
              }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={subscription.pool_name || "GPU Pool"}
                    className="font-medium text-[var(--ink)] bg-zinc-100 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveMetadata("displayName", displayName);
                      if (e.key === "Escape") { setEditingName(false); setDisplayName(metadata?.displayName || ""); }
                    }}
                  />
                  <button onClick={() => saveMetadata("displayName", displayName)} disabled={savingMetadata} className="text-teal-600 hover:text-teal-700 text-xs font-medium">
                    {savingMetadata ? "..." : "Save"}
                  </button>
                  <button onClick={() => { setEditingName(false); setDisplayName(metadata?.displayName || ""); }} className="text-zinc-400 hover:text-zinc-600 text-xs">
                    Cancel
                  </button>
                </div>
              ) : (
                <h3 className="font-medium text-[var(--ink)] group flex items-center gap-1.5">
                  <span className="truncate">{displayName || subscription.pool_name || "GPU Pool"}</span>
                  <button onClick={(e) => { e.stopPropagation(); setEditingName(true); }} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 transition-opacity">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </h3>
              )}
              <div className="flex items-center gap-1.5">
                <p className={`text-sm truncate ${isTerminating ? "text-amber-600" : "text-[var(--muted)]"}`}>
                  {isTerminating ? "Terminating..." : runningQuip || subscription.region?.city || subscription.region?.region_name || "GPU Instance"}
                </p>
                <span className="text-[10px] text-zinc-300 font-mono shrink-0">#{subscription.id}</span>
                {isMonthly && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-200 whitespace-nowrap">
                    Monthly
                  </span>
                )}
              </div>
              {/* HuggingFace deployment status indicator */}
              {hfDeployment && (
                <div className="flex items-center gap-2 mt-1">
                  <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${
                    hfStatus?.status === "running" ? "bg-emerald-100 text-emerald-700" :
                    hfStatus?.status === "failed" ? "bg-rose-100 text-rose-700" :
                    (hfStatus?.status === "installing" || hfStatus?.status === "starting" || isDeploymentActive) ? "bg-amber-100 text-amber-700" :
                    "bg-zinc-100 text-zinc-600"
                  }`}>
                    {(hfStatus?.status === "installing" || hfStatus?.status === "starting" || isDeploymentActive) && (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    <span className="truncate max-w-[140px]" title={hfDeployment.hfItemName}>{hfDeployment.hfItemName}</span>
                    <span className="text-[10px] opacity-75">{hfStatus?.status || hfDeployment.status}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              {isMonthly && monthlyPriceDisplay ? (
                <div className="text-sm font-semibold text-teal-600">{monthlyPriceDisplay}</div>
              ) : (
                <div className="text-sm font-semibold text-[var(--ink)]">{subscription.hourlyRate ? `$${subscription.hourlyRate.toFixed(2)}/hr` : "--"}</div>
              )}
              <div className="flex items-center gap-1.5 justify-end">
                <StatusDot status={displayStatus.status === "restarting" || displayStatus.status === "scaling" ? "pending" : displayStatus.status} />
                <span className="text-xs text-[var(--muted)]">{displayStatus.label}</span>
              </div>
            </div>
            <svg className={`w-5 h-5 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Quick Actions Bar - Always Visible */}
      {isActive && !isStopped && (
        <div className="px-4 py-2 border-t border-[var(--line)] bg-zinc-50/50 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowTerminal(true)}
            disabled={!!loading || !connectionInfo?.pods?.some((p: any) => p.ssh_info)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Terminal
          </button>
          <button
            onClick={handleStop}
            disabled={!!loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Pause
          </button>
          <button
            onClick={() => setShowRunScript(true)}
            disabled={!!loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-100 text-zinc-700 text-xs font-medium rounded-lg border border-zinc-200 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Script
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            {expanded ? "Less" : "More"}
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Monthly Subscription Management Bar */}
      {isMonthly && billingPortalUrl && (
        <div className="px-4 py-2 border-t border-[var(--line)] bg-teal-50/50 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-teal-700">
            {monthlyPriceDisplay ? `${monthlyPriceDisplay} subscription` : "Monthly subscription"}
          </span>
          <a
            href={billingPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-600 hover:text-teal-800 font-medium underline underline-offset-2"
          >
            Manage Subscription
          </a>
        </div>
      )}

      {/* Stopped State - Quick Start Button */}
      {isStopped && (
        <div className="px-4 py-2 border-t border-[var(--line)] bg-zinc-50/50 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleStart}
            disabled={!!loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Start Instance
          </button>
          <span className="text-xs text-zinc-500">
            Paused • ${((subscription.hourlyRate || 0) * stoppedInstanceRate / 100).toFixed(2)}/hr to reserve
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            {expanded ? "Less" : "More"}
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-[var(--line)]">
          {/* Image & Storage Details */}
          {(subscription.per_pod_info?.image_name || subscription.storage_details?.ephemeral_storage_gb) && (
            <div className="px-4 py-3 bg-zinc-50 flex flex-wrap gap-2">
              {subscription.per_pod_info?.image_name && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[var(--line)] text-zinc-600 text-xs rounded-lg">
                  {subscription.per_pod_info.image_name.replace(/\(.*\)/, "").trim()}
                </span>
              )}
              {subscription.storage_details?.ephemeral_storage_gb && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[var(--line)] text-zinc-600 text-xs rounded-lg">
                  {subscription.storage_details.ephemeral_storage_gb}GB Ephemeral
                </span>
              )}
              {subscription.storage_details?.persistent_storage_gb && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 text-teal-700 text-xs rounded-lg">
                  {subscription.storage_details.persistent_storage_gb}GB Persistent
                </span>
              )}
              {subscription.storage_details?.shared_volumes?.map((vol, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 border border-teal-200 text-teal-700 text-xs rounded-lg"
                  title={`Mount: ${vol.mount_point}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  {vol.size_in_gb}GB Persistent
                </span>
              ))}
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[var(--line)] text-zinc-600 text-xs rounded-lg">
                {gpuCount} GPU · {subscription.per_pod_info?.vcpu_count || 4} vCPU · {Math.round((subscription.per_pod_info?.ram_mb || 8192) / 1024)}GB RAM
              </span>
            </div>
          )}

          {/* Pending state */}
          {isPending && (
            <div className="px-4 py-3 bg-amber-50 border-y border-amber-100">
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <span className="animate-spin">⟳</span>
                {subscription.status === "subscribing" ? "Setting up your GPU..." : "Releasing resources..."}
              </div>
            </div>
          )}

          {/* Pod Info with SSH Credentials */}
          {podsForSSH.length > 0 && (
            <GPUCardSSHInfo
              pods={podsForSSH}
              subscriptionPods={subscription.pods}
              loadingConnection={loadingConnection}
              onOpenTerminal={() => setShowTerminal(true)}
            />
          )}

          {/* Exposed Services Section */}
          {isActive && (
            <GPUCardServices
              exposedServices={exposedServices}
              loadingServices={loadingServices}
              token={token}
              subscriptionId={String(subscription.id)}
              podName={subscription.pods?.[0]?.pod_name}
              onServicesUpdated={setExposedServices}
            />
          )}

          {/* HuggingFace Deployment Section */}
          {hfDeployment && (
            <GPUCardHfDeployment
              hfDeployment={hfDeployment}
              hfStatus={hfStatus}
              subscriptionId={String(subscription.id)}
              token={token}
              podName={subscription.pods?.[0]?.pod_name}
              exposedServices={exposedServices}
              onExposeVllmApi={handleExposeVllmApi}
              exposingVllmApi={exposingVllmApi}
              sshHost={connectionInfo?.pods?.[0]?.ssh_info?.cmd?.match(/@([^\s]+)/)?.[1]}
            />
          )}


          {/* Notes Section */}
          <div className="px-4 py-3 border-t border-[var(--line)]">
            <div className="flex items-start gap-2">
              <span className="text-xs text-zinc-400 w-12 shrink-0 pt-1">Notes</span>
              {editingNotes ? (
                <div className="flex-1 space-y-2">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add notes about this GPU..."
                    className="w-full text-sm text-zinc-700 bg-zinc-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveMetadata("notes", notes)} disabled={savingMetadata} className="px-3 py-1.5 text-xs font-medium bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white rounded-lg transition-colors disabled:opacity-50">
                      {savingMetadata ? "Saving..." : "Save"}
                    </button>
                    <button onClick={() => { setEditingNotes(false); setNotes(metadata?.notes || ""); }} className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-zinc-700">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div onClick={() => setEditingNotes(true)} className="flex-1 text-sm text-[var(--muted)] hover:text-zinc-700 cursor-pointer py-1 px-2 -ml-2 rounded hover:bg-zinc-50 transition-colors">
                  {notes || <span className="text-zinc-400 italic">Click to add notes...</span>}
                </div>
              )}
            </div>
          </div>

          {/* Action Links */}
          <div className="px-4 py-3 border-t border-[var(--line)] flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {/* Show Start link when stopped */}
            {isStopped && (
              <button onClick={handleStart} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                Start
              </button>
            )}
            {/* Show these links when running */}
            {isActive && !isStopped && (
              <>
                <button onClick={() => setShowSSHKeyModal(true)} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                  SSH Key
                </button>
                <button onClick={() => setShowAddStorageModal(true)} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                  Storage
                </button>
                <button onClick={handleStop} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                  Stop
                </button>
                <button onClick={handleRestart} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                  Restart
                </button>
                <button onClick={() => setShowRunScript(true)} disabled={!!loading} className="text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50">
                  Script
                </button>
                <button onClick={() => setShowSaveSnapshotModal(true)} disabled={!!loading} className="text-teal-600 hover:text-teal-700 hover:underline disabled:opacity-50">
                  Save
                </button>
              </>
            )}
            <button onClick={handleUnsubscribe} disabled={!!loading} className="text-rose-500 hover:text-rose-600 hover:underline disabled:opacity-50">
              Terminate
            </button>
          </div>
        </div>
      )}

      {/* Terminal Modal */}
      <TerminalModal
        isOpen={showTerminal}
        onClose={() => setShowTerminal(false)}
        subscriptionId={String(subscription.id)}
        token={token}
      />

      {/* Run Script Modal */}
      <RunScriptModal
        isOpen={showRunScript}
        onClose={() => setShowRunScript(false)}
        subscriptionId={String(subscription.id)}
        token={token}
      />

      {/* SSH Key Modal */}
      <SSHKeyModal
        isOpen={showSSHKeyModal}
        onClose={() => setShowSSHKeyModal(false)}
        token={token}
        subscriptionId={String(subscription.id)}
        podName={subscription.pods?.[0]?.pod_name}
        poolName={displayName || subscription.pool_name}
      />

      {/* Add Storage Modal */}
      <AddStorageModal
        isOpen={showAddStorageModal}
        onClose={() => setShowAddStorageModal(false)}
        subscriptionId={String(subscription.id)}
        token={token}
        onSuccess={onRefresh}
        existingStorage={subscription.storage_details}
      />

      {/* Save Snapshot Modal */}
      <SaveSnapshotModal
        isOpen={showSaveSnapshotModal}
        onClose={() => setShowSaveSnapshotModal(false)}
        token={token}
        subscriptionId={subscription.id}
        displayName={displayName}
        poolName={subscription.pool_name}
        onSnapshotCreated={onSnapshotCreated}
        onRefresh={onRefresh}
      />
    </div>
  );
}
