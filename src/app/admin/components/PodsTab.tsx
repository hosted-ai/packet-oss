"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  RefreshCw,
  Server,
  User,
  Terminal,
  Check,
  AlertCircle,
  Cpu,
  Zap,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
  BarChart3,
  Skull,
  DollarSign,
  ExternalLink,
  Copy,
  Eye,
} from "lucide-react";
import { PodDetailModal } from "./PodDetailModal";
import { HistoryChart, type PodHistory } from "./pods/HistoryChart";

interface AdminPod {
  subscriptionId: string;
  teamId: string;
  poolId: number;
  poolName: string;
  status: string;
  podStatus?: string;
  isDead: boolean;
  nature?: string;
  vgpuCount: number;
  podName?: string;
  owner?: {
    customerId: string;
    email: string;
    name: string;
  };
  ssh?: {
    host: string;
    port: number;
    username: string;
    password?: string;
  };
  metrics?: {
    tflopsUsage?: number;
    vramUsage?: number;
  };
  gpuMetrics?: {
    tflops: number;
    vramGb: number;
  };
  metadata?: {
    displayName?: string;
    deployTime?: string;
    notes?: string;
  };
  billing?: {
    hourlyRateCents: number | null;
    monthlyRateCents?: number | null;
    billingType?: string;
    prepaidUntil?: string;
    stripeCustomerId?: string;
  };
  publicIps?: string[];
  accelerator?: string;
  baremetal?: {
    invoiceNumber: string;
    hostedInvoiceUrl?: string;
    contractMonths: number;
    totalInvoiceCents: number;
    status: string;
  };
  createdAt?: string;
}

interface PodsSummary {
  totalPods: number;
  activePods: number;
  deadPods: number;
  totalVGPUs: number;
  ownedPods: number;
  unownedPods: number;
  unbilledPods: number;
}

type SortField = "owner" | "status" | "vgpus" | "metrics" | "ssh" | "created";
type SortDirection = "asc" | "desc";

export function PodsTab() {
  const [pods, setPods] = useState<AdminPod[]>([]);
  const [summary, setSummary] = useState<PodsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "owned" | "unowned" | "dead" | "unbilled">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedPod, setSelectedPod] = useState<AdminPod | null>(null);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // GPU metrics loading state
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [lastMetricsUpdate, setLastMetricsUpdate] = useState<Date | null>(null);

  // History chart state
  const [showHistoryChart, setShowHistoryChart] = useState(false);
  const [historyData, setHistoryData] = useState<PodHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHours, setHistoryHours] = useState(24);

  // Per-pod SSH creds, fetched on demand when the admin clicks "Get SSH".
  const [sshCreds, setSshCreds] = useState<
    Record<string, { command: string; password?: string } | "loading" | "error">
  >({});

  const loadPods = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pods");
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setPods(data.pods || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pods");
    } finally {
      setLoading(false);
    }
  };

  // Fetch GPU metrics for running pods with SSH access
  const loadGpuMetrics = useCallback(async () => {
    // PA-187: GPU metrics now come from HAI telemetry, keyed by instance id +
    // team (no SSH needed). Run for any active pod that has a team.
    const gpuPods = pods.filter(
      (p) =>
        (p.status === "running" || p.status === "subscribed" || p.status === "active") &&
        p.teamId &&
        p.nature !== "baremetal"
    );

    if (gpuPods.length === 0) return;

    setMetricsLoading(true);
    try {
      const res = await fetch("/api/admin/pods/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pods: gpuPods.map((p) => ({
            subscriptionId: p.subscriptionId,
            teamId: p.teamId,
          })),
        }),
      });

      const data = await res.json();
      if (data.metrics) {
        // Update pods with GPU metrics
        setPods((prevPods) =>
          prevPods.map((pod) => {
            const metricsResult = data.metrics.find(
              (m: { subscriptionId: string }) => m.subscriptionId === pod.subscriptionId
            );
            if (metricsResult?.gpu) {
              return { ...pod, gpuMetrics: metricsResult.gpu };
            }
            return pod;
          })
        );
        setLastMetricsUpdate(new Date());
      }
    } catch (err) {
      console.error("Failed to load GPU metrics:", err);
    } finally {
      setMetricsLoading(false);
    }
  }, [pods]);

  // Load historical metrics for charting
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/pods/history?hours=${historyHours}&interval=5`);
      const data = await res.json();
      if (data.history) {
        setHistoryData(data.history);
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyHours]);

  // Load history when chart is shown
  useEffect(() => {
    if (showHistoryChart) {
      loadHistory();
    }
  }, [showHistoryChart, historyHours, loadHistory]);

  useEffect(() => {
    loadPods();
    // Auto-refresh pod data every 5 minutes
    const autoRefresh = setInterval(loadPods, 5 * 60 * 1000);
    return () => clearInterval(autoRefresh);
  }, []);

  // Keep the latest loadGpuMetrics in a ref so the polling effect below does NOT
  // depend on its identity. loadGpuMetrics calls setPods, which changes `pods`
  // and thus the callback identity; depending on it here would re-fire the effect
  // on every metrics update and re-fetch in a tight loop (the "Fetching…" flicker).
  const loadGpuMetricsRef = useRef(loadGpuMetrics);
  loadGpuMetricsRef.current = loadGpuMetrics;

  // Auto-refresh metrics every 30 seconds. Re-armed only when the pod set size or
  // load state changes, not on every metrics update.
  useEffect(() => {
    if (pods.length > 0 && !loading) {
      loadGpuMetricsRef.current();
      const interval = setInterval(() => loadGpuMetricsRef.current(), 30000);
      return () => clearInterval(interval);
    }
  }, [pods.length, loading]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusColor = (status: string, isDead?: boolean) => {
    if (isDead) {
      return "bg-red-100 text-red-700 border border-red-200";
    }
    switch (status) {
      case "running":
      case "active":
      case "subscribed":
        return "bg-green-100 text-green-700 border border-green-200";
      case "pending":
      case "starting":
      case "restarting":
      case "subscribing":
        return "bg-yellow-100 text-yellow-700 border border-yellow-200";
      case "stopping":
      case "un_subscribing":
        return "bg-orange-100 text-orange-700 border border-orange-200";
      case "stopped":
      case "terminated":
        return "bg-gray-100 text-gray-600 border border-gray-200";
      case "error":
      case "failed":
        return "bg-red-100 text-red-700 border border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border border-gray-200";
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString();
  };

  // Reveal a pod's SSH creds. Uses the creds already in the list payload when
  // present, otherwise fetches them on demand (baremetal + pods the bulk fetch missed).
  const fetchSshCreds = async (pod: AdminPod) => {
    if (pod.ssh) {
      setSshCreds((prev) => ({
        ...prev,
        [pod.subscriptionId]: {
          command: `ssh -p ${pod.ssh!.port} ${pod.ssh!.username}@${pod.ssh!.host}`,
          password: pod.ssh!.password,
        },
      }));
      return;
    }
    setSshCreds((prev) => ({ ...prev, [pod.subscriptionId]: "loading" }));
    try {
      const params = new URLSearchParams({ id: pod.subscriptionId });
      if (pod.teamId) params.set("teamId", pod.teamId);
      if (pod.nature) params.set("nature", pod.nature);
      const res = await fetch(`/api/admin/pods/ssh?${params}`);
      if (!res.ok) throw new Error("not ok");
      const data = await res.json();
      setSshCreds((prev) => ({
        ...prev,
        [pod.subscriptionId]: { command: data.command, password: data.password },
      }));
    } catch {
      setSshCreds((prev) => ({ ...prev, [pod.subscriptionId]: "error" }));
    }
  };

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3" />
    ) : (
      <ArrowDown className="w-3 h-3" />
    );
  };

  // Filter pods
  const filteredPods = useMemo(() => {
    return pods.filter((pod) => {
      // Owner/dead/unbilled filter
      if (filter === "owned" && !pod.owner) return false;
      if (filter === "unowned" && pod.owner) return false;
      if (filter === "dead" && !pod.isDead) return false;
      if (filter === "unbilled") {
        const activeStatuses = ["running", "pending", "starting", "restarting", "subscribed", "active"];
        const isActive = activeStatuses.includes(pod.status) && !pod.isDead;
        const isBilled = pod.billing && ((pod.billing.hourlyRateCents && pod.billing.hourlyRateCents > 0) || (pod.billing.monthlyRateCents && pod.billing.monthlyRateCents > 0));
        if (!isActive || isBilled) return false;
      }

      // Status filter
      if (statusFilter !== "all" && pod.status !== statusFilter) return false;

      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          pod.subscriptionId.toLowerCase().includes(searchLower) ||
          pod.poolName.toLowerCase().includes(searchLower) ||
          pod.podName?.toLowerCase().includes(searchLower) ||
          pod.owner?.email.toLowerCase().includes(searchLower) ||
          pod.owner?.name.toLowerCase().includes(searchLower) ||
          pod.teamId.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [pods, filter, statusFilter, search]);

  // Sort filtered pods
  const sortedPods = useMemo(() => {
    const sorted = [...filteredPods];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "owner":
          const aOwner = a.owner?.name || a.owner?.email || "";
          const bOwner = b.owner?.name || b.owner?.email || "";
          comparison = aOwner.localeCompare(bOwner);
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        case "vgpus":
          comparison = a.vgpuCount - b.vgpuCount;
          break;
        case "metrics":
          const aTf = a.gpuMetrics?.tflops ?? -1;
          const bTf = b.gpuMetrics?.tflops ?? -1;
          comparison = aTf - bTf;
          break;
        case "ssh":
          const aHasSSH = a.ssh ? 1 : 0;
          const bHasSSH = b.ssh ? 1 : 0;
          comparison = aHasSSH - bHasSSH;
          break;
        case "created":
          const aDate = a.createdAt ? new Date(a.createdAt).getTime() : (a.metadata?.deployTime ? new Date(a.metadata.deployTime).getTime() : 0);
          const bDate = b.createdAt ? new Date(b.createdAt).getTime() : (b.metadata?.deployTime ? new Date(b.metadata.deployTime).getTime() : 0);
          comparison = aDate - bDate;
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [filteredPods, sortField, sortDirection]);

  // Get unique statuses for filter
  const uniqueStatuses = [...new Set(pods.map((p) => p.status))];

  // Average TFLOPs across pods that have metrics (HAI telemetry).
  const avgTflops = useMemo(() => {
    const podsWithMetrics = pods.filter((p) => p.gpuMetrics);
    if (podsWithMetrics.length === 0) return null;
    const sum = podsWithMetrics.reduce((acc, p) => acc + (p.gpuMetrics?.tflops || 0), 0);
    return sum / podsWithMetrics.length;
  }, [pods]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 animate-spin text-[#1a4fff]" />
        <span className="ml-3 text-[#5b6476]">Loading pods...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <div>
          <h3 className="font-semibold text-red-700">Error loading pods</h3>
          <p className="text-red-600">{error}</p>
        </div>
        <button
          onClick={loadPods}
          className="ml-auto px-4 py-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#5b6476] text-sm mt-1">
            All pods running on the HostedAI infrastructure
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastMetricsUpdate && (
            <span className="text-xs text-[#9ca3af]">
              Metrics updated {lastMetricsUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={loadGpuMetrics}
            disabled={metricsLoading}
            className="flex items-center gap-2 px-3 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <Activity className={`w-4 h-4 ${metricsLoading ? "animate-pulse" : ""}`} />
            {metricsLoading ? "Refreshing..." : "Refresh Metrics"}
          </button>
          <button
            onClick={() => setShowHistoryChart(!showHistoryChart)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              showHistoryChart
                ? "bg-indigo-600 text-white"
                : "bg-indigo-100 hover:bg-indigo-200 text-indigo-700"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            History
          </button>
          <button
            onClick={loadPods}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] hover:bg-[#1a4fff]/90 text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        // 8 across only once the viewport is wide enough to hold them: each card needs
        // ~150px, so 8 + gaps (~1280px) plus the 256px sidebar want ~1600px. lg (1024px)
        // fired ~600px too early, clipping the last cards in the 1024-1660px band (also
        // reachable via browser zoom) - PA-429.
        <div className="grid grid-cols-2 sm:grid-cols-4 min-[1700px]:grid-cols-8 gap-4">
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Server className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">{summary.totalPods}</p>
                <p className="text-xs text-[#5b6476]">Total Pods</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Zap className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">{summary.activePods}</p>
                <p className="text-xs text-[#5b6476]">Active</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Cpu className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">{summary.totalVGPUs}</p>
                <p className="text-xs text-[#5b6476]">Total vGPUs</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-100 rounded-lg">
                <User className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">{summary.ownedPods}</p>
                <p className="text-xs text-[#5b6476]">With Owner</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <AlertCircle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">{summary.unownedPods}</p>
                <p className="text-xs text-[#5b6476]">Unowned</p>
              </div>
            </div>
          </div>
          <div
            className={`bg-white border rounded-xl p-4 shadow-sm cursor-pointer transition-colors ${
              summary.deadPods > 0
                ? "border-red-300 bg-red-50 hover:bg-red-100"
                : "border-[#e4e7ef] hover:bg-[#f7f8fb]"
            }`}
            onClick={() => summary.deadPods > 0 && setFilter("dead")}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${summary.deadPods > 0 ? "bg-red-100" : "bg-gray-100"}`}>
                <Skull className={`w-5 h-5 ${summary.deadPods > 0 ? "text-red-600" : "text-gray-400"}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${summary.deadPods > 0 ? "text-red-600" : "text-[#0b0f1c]"}`}>{summary.deadPods}</p>
                <p className="text-xs text-[#5b6476]">Dead Pods</p>
              </div>
            </div>
          </div>
          <div
            className={`bg-white border rounded-xl p-4 shadow-sm cursor-pointer transition-colors ${
              summary.unbilledPods > 0
                ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
                : "border-[#e4e7ef] hover:bg-[#f7f8fb]"
            }`}
            onClick={() => summary.unbilledPods > 0 && setFilter("unbilled")}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${summary.unbilledPods > 0 ? "bg-amber-100" : "bg-gray-100"}`}>
                <DollarSign className={`w-5 h-5 ${summary.unbilledPods > 0 ? "text-amber-600" : "text-gray-400"}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${summary.unbilledPods > 0 ? "text-amber-600" : "text-[#0b0f1c]"}`}>{summary.unbilledPods}</p>
                <p className="text-xs text-[#5b6476]">Unbilled</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Activity className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  {avgTflops !== null ? avgTflops.toFixed(1) : "-"}
                </p>
                <p className="text-xs text-[#5b6476]">Avg TFLOPs</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Chart */}
      {showHistoryChart && (
        <HistoryChart
          historyData={historyData}
          historyLoading={historyLoading}
          historyHours={historyHours}
          setHistoryHours={setHistoryHours}
          loadHistory={loadHistory}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search pods..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#9ca3af] focus:outline-none focus:border-[#1a4fff] focus:ring-1 focus:ring-[#1a4fff] w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#5b6476]">Owner:</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "owned" | "unowned" | "dead" | "unbilled")}
            className="px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] focus:outline-none focus:border-[#1a4fff]"
          >
            <option value="all">All</option>
            <option value="owned">With Owner</option>
            <option value="unowned">Unowned</option>
            <option value="dead">Dead / Unhealthy</option>
            <option value="unbilled">Unbilled (Active, no billing)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#5b6476]">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] focus:outline-none focus:border-[#1a4fff]"
          >
            <option value="all">All</option>
            {uniqueStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-[#5b6476] ml-auto">
          Showing {sortedPods.length} of {pods.length} pods
        </div>
      </div>

      {/* Pods Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e4e7ef] bg-[#f7f8fb] text-left text-sm text-[#5b6476]">
                <th className="px-4 py-3 font-medium">Pod</th>
                <th className="px-4 py-3 font-medium">Accelerator</th>
                <th className="px-4 py-3 font-medium">Public IP</th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("owner")}
                >
                  <div className="flex items-center gap-1">
                    Owner {getSortIcon("owner")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center gap-1">
                    Status {getSortIcon("status")}
                  </div>
                </th>
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-1">
                    Billing
                  </div>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("vgpus")}
                >
                  <div className="flex items-center gap-1">
                    vGPUs {getSortIcon("vgpus")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("metrics")}
                >
                  <div className="flex items-center gap-1">
                    Metrics {getSortIcon("metrics")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("ssh")}
                >
                  <div className="flex items-center gap-1">
                    SSH {getSortIcon("ssh")}
                  </div>
                </th>
                <th
                  className="px-4 py-3 font-medium cursor-pointer hover:bg-[#e4e7ef] transition-colors"
                  onClick={() => handleSort("created")}
                >
                  <div className="flex items-center gap-1">
                    Created {getSortIcon("created")}
                  </div>
                </th>
                <th className="px-4 py-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {sortedPods.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-[#5b6476]">
                    No pods found matching your filters
                  </td>
                </tr>
              ) : (
                sortedPods.map((pod) => (
                  <tr
                    key={pod.subscriptionId}
                    onClick={() => setSelectedPod(pod)}
                    className={`transition-colors cursor-pointer ${
                      pod.isDead
                        ? "bg-red-50 hover:bg-red-100"
                        : "hover:bg-[#f7f8fb]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-[#0b0f1c]">
                          {pod.metadata?.displayName || pod.podName || `Pod ${pod.subscriptionId}`}
                        </div>
                        <div className="text-xs text-[#5b6476] font-mono">
                          {pod.poolName}
                        </div>
                        <div className="text-xs text-[#9ca3af] font-mono">
                          ID: {pod.subscriptionId}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {pod.accelerator ? (
                        <span className="text-xs text-[#0b0f1c]">{pod.accelerator}</span>
                      ) : (
                        <span className="text-xs text-[#9ca3af]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pod.publicIps && pod.publicIps.length > 0 ? (
                        <span className="text-xs font-mono text-[#0b0f1c]">
                          {pod.publicIps.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9ca3af]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pod.owner ? (
                        <div>
                          <div className="text-sm text-[#0b0f1c]">{pod.owner.name}</div>
                          <div className="text-xs text-[#5b6476]">{pod.owner.email}</div>
                        </div>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 border border-orange-200 rounded">
                          Unowned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-1 rounded ${getStatusColor(pod.status, pod.isDead)}`}>
                          {pod.isDead ? `DEAD` : pod.status}
                        </span>
                        {pod.podStatus && pod.podStatus !== "Running" && (
                          <span className="text-[10px] text-[#9ca3af] font-mono">
                            {pod.podStatus}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        // Baremetal is term-prepaid by Stripe invoice, not an hourly/monthly rate.
                        if (pod.nature === "baremetal") {
                          if (pod.baremetal) {
                            const label = `${pod.baremetal.contractMonths}mo prepaid`;
                            return pod.baremetal.hostedInvoiceUrl ? (
                              <a
                                href={pod.baremetal.hostedInvoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={`Invoice ${pod.baremetal.invoiceNumber}`}
                                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 border border-blue-200 rounded hover:bg-blue-200 inline-flex items-center gap-1"
                              >
                                {label}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span
                                title={`Invoice ${pod.baremetal.invoiceNumber}`}
                                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 border border-blue-200 rounded"
                              >
                                {label}
                              </span>
                            );
                          }
                          return <span className="text-xs text-[#9ca3af]">-</span>;
                        }
                        const activeStatuses = ["running", "pending", "starting", "restarting", "subscribed", "active", "online"];
                        const isActive = activeStatuses.includes(pod.status) && !pod.isDead;
                        if (!isActive) {
                          return <span className="text-xs text-[#9ca3af]">-</span>;
                        }
                        if (pod.billing && pod.billing.hourlyRateCents && pod.billing.hourlyRateCents > 0) {
                          return (
                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 border border-green-200 rounded">
                              ${(pod.billing.hourlyRateCents / 100).toFixed(2)}/hr
                            </span>
                          );
                        }
                        if (pod.billing && pod.billing.monthlyRateCents && pod.billing.monthlyRateCents > 0) {
                          return (
                            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 border border-blue-200 rounded">
                              ${(pod.billing.monthlyRateCents / 100).toFixed(0)}/mo
                            </span>
                          );
                        }
                        return (
                          <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded font-medium">
                            UNBILLED
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {pod.nature === "baremetal" ? (
                        // Baremetal nodes aren't vGPU-sliced; the listing's default of 1 is meaningless here.
                        <span className="text-xs text-[#9ca3af]">N/A</span>
                      ) : (
                        <div className="flex items-center gap-1 text-[#0b0f1c]">
                          <Cpu className="w-4 h-4 text-purple-600" />
                          <span>{pod.vgpuCount}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pod.nature === "baremetal" ? (
                        <span className="text-xs text-[#9ca3af]">N/A</span>
                      ) : pod.gpuMetrics ? (
                        <div className="text-xs space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[#5b6476]">TFLOPs:</span>
                            <span className="font-medium text-[#0b0f1c]">
                              {pod.gpuMetrics.tflops.toFixed(1)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[#5b6476]">VRAM:</span>
                            <span className="text-[#0b0f1c]">
                              {pod.gpuMetrics.vramGb.toFixed(1)} GB
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-[#9ca3af]">
                          {metricsLoading ? "Loading..." : "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const cred = sshCreds[pod.subscriptionId];
                        if (cred === "loading") {
                          return <span className="text-xs text-[#9ca3af]">Fetching…</span>;
                        }
                        if (cred === "error") {
                          return (
                            <button
                              onClick={(e) => { e.stopPropagation(); fetchSshCreds(pod); }}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Unavailable · retry
                            </button>
                          );
                        }
                        if (cred) {
                          return (
                            <div className="flex flex-col gap-1 max-w-[260px]">
                              <button
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(cred.command, `${pod.subscriptionId}:cmd`); }}
                                title={cred.command}
                                className="flex items-center gap-1 text-xs px-2 py-1 bg-[#f7f8fb] hover:bg-[#e4e7ef] border border-[#e4e7ef] rounded transition-colors text-[#0b0f1c] font-mono"
                              >
                                {copiedId === `${pod.subscriptionId}:cmd` ? (
                                  <><Check className="w-3 h-3 text-green-600 shrink-0" /><span className="text-green-600">Copied</span></>
                                ) : (
                                  <><Terminal className="w-3 h-3 shrink-0" /><span className="truncate">{cred.command}</span></>
                                )}
                              </button>
                              {cred.password && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(cred.password!, `${pod.subscriptionId}:pass`); }}
                                  className="flex items-center gap-1 text-xs px-2 py-1 bg-[#f7f8fb] hover:bg-[#e4e7ef] border border-[#e4e7ef] rounded transition-colors text-[#5b6476]"
                                >
                                  {copiedId === `${pod.subscriptionId}:pass` ? (
                                    <><Check className="w-3 h-3 text-green-600" /><span className="text-green-600">Copied pass</span></>
                                  ) : (
                                    <><Copy className="w-3 h-3" /><span>Copy password</span></>
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        }
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); fetchSshCreds(pod); }}
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-[#f7f8fb] hover:bg-[#e4e7ef] border border-[#e4e7ef] rounded transition-colors text-[#0b0f1c]"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Get SSH</span>
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5b6476]">
                      {formatDate(pod.createdAt || pod.metadata?.deployTime)}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-[#9ca3af]" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pod Detail Modal */}
      {selectedPod && (
        <PodDetailModal
          pod={selectedPod}
          isOpen={!!selectedPod}
          onClose={() => setSelectedPod(null)}
          onActionComplete={() => {
            loadPods();
            setSelectedPod(null);
          }}
        />
      )}
    </div>
  );
}
