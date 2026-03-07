"use client";

import { useState, useEffect } from "react";
import {
  Server,
  Cpu,
  HardDrive,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  MemoryStick,
  Users,
  Building,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface NodePod {
  subscriptionId: string;
  podName: string;
  status: string;
  vgpuCount: number;
  customerEmail: string | null;
  customerName: string | null;
}

interface NodeStats {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  providerId: string;
  providerName: string;
  status: "online" | "active" | "initializing" | "error" | "offline" | "pending";
  statusMessage: string;
  gpuModel: string | null;
  gpuCount: number;
  gpuaasClusterId: number | null;
  gpuaasNodeId: number | null;
  gpuaasPoolId: number | null;
  hardware: {
    cpuModel: string | null;
    cpuCores: number | null;
    memoryGb: number | null;
    storageGb: number | null;
  };
  pools: Array<{
    id: number;
    name: string;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
  }>;
  pods: NodePod[];
  summary: {
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    activePods: number;
    totalPods: number;
    totalVgpus: number;
  };
}

interface ProviderSummary {
  id: string;
  name: string;
  email: string;
  nodeCount: number;
  totalGpus: number;
  allocatedGpus: number;
  utilizationPercent: number;
  activePods: number;
}

interface MonitoringData {
  providers: ProviderSummary[];
  nodes: NodeStats[];
  summary: {
    totalProviders: number;
    totalNodes: number;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    activePods: number;
    totalVgpus: number;
  };
}

export function NodeMonitoringTab() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/admin/nodes");
      const json = await res.json();

      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error || "Failed to load node data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online":
      case "active":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "initializing":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
      case "active":
        return "bg-green-100 text-green-700 border-green-200";
      case "initializing":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "error":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getUtilizationColor = (percent: number) => {
    if (percent >= 90) return "bg-red-500";
    if (percent >= 70) return "bg-yellow-500";
    if (percent >= 30) return "bg-green-500";
    return "bg-blue-500";
  };

  const getPodStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === "running" || s === "active" || s === "ready") return "text-green-600 bg-green-50";
    if (s === "pending" || s === "starting") return "text-yellow-600 bg-yellow-50";
    if (s === "stopped" || s === "paused") return "text-gray-600 bg-gray-50";
    return "text-red-600 bg-red-50";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-teal-500 animate-spin" />
        <span className="ml-3 text-[#5b6476]">Loading node data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
        <Server className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-gray-700 mb-1">No Nodes Found</h3>
        <p className="text-gray-500">No active nodes found in the system.</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Refresh
        </button>
      </div>
    );
  }

  const filteredNodes = selectedProvider
    ? data.nodes.filter((n) => n.providerId === selectedProvider)
    : data.nodes;

  // Separate owned and unowned nodes
  const ownedNodes = filteredNodes.filter((n) => n.providerId !== "unowned");
  const unownedNodes = filteredNodes.filter((n) => n.providerId === "unowned");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Server className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[#0b0f1c]">Node Monitoring</h2>
            <p className="text-sm text-[#5b6476]">
              Real-time view of all GPU nodes and their workloads
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Global Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Providers</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">{data.summary.totalProviders}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Nodes</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">{data.summary.totalNodes}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Total GPUs</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">{data.summary.totalGpus}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Allocated</p>
          <p className="text-2xl font-bold text-blue-600">{data.summary.allocatedGpus}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Available</p>
          <p className="text-2xl font-bold text-emerald-600">{data.summary.availableGpus}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Utilization</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">{data.summary.utilizationPercent}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Active Pods</p>
          <p className="text-2xl font-bold text-purple-600">{data.summary.activePods}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-[#5b6476] uppercase tracking-wide">Total vGPUs</p>
          <p className="text-2xl font-bold text-indigo-600">{data.summary.totalVgpus}</p>
        </div>
      </div>

      {/* Provider Cards */}
      {data.providers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.providers.map((provider) => (
            <div
              key={provider.id}
              onClick={() =>
                setSelectedProvider(selectedProvider === provider.id ? null : provider.id)
              }
              className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${
                selectedProvider === provider.id
                  ? "border-teal-500 ring-2 ring-teal-100"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Building className="w-5 h-5 text-gray-400" />
                  <div>
                    <h3 className="font-semibold text-[#0b0f1c]">{provider.name}</h3>
                    <p className="text-sm text-[#5b6476]">{provider.email}</p>
                  </div>
                </div>
                <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-700">
                  Active
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-lg font-bold text-[#0b0f1c]">{provider.nodeCount}</p>
                  <p className="text-xs text-[#5b6476]">Nodes</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#0b0f1c]">{provider.totalGpus}</p>
                  <p className="text-xs text-[#5b6476]">GPUs</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-purple-600">{provider.activePods}</p>
                  <p className="text-xs text-[#5b6476]">Pods</p>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#5b6476]">Utilization</span>
                  <span className="text-xs font-medium">{provider.utilizationPercent}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getUtilizationColor(provider.utilizationPercent)}`}
                    style={{ width: `${provider.utilizationPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter indicator */}
      {selectedProvider && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#5b6476]">
            Showing nodes from:{" "}
            <strong>{data.providers.find((p) => p.id === selectedProvider)?.name}</strong>
          </span>
          <button
            onClick={() => setSelectedProvider(null)}
            className="text-teal-600 hover:text-teal-800"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Owned Nodes List */}
      {ownedNodes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-[#0b0f1c]">Provider Nodes ({ownedNodes.length})</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {ownedNodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                expanded={expandedNodes.has(node.id)}
                onToggle={() => toggleNode(node.id)}
                getStatusIcon={getStatusIcon}
                getStatusColor={getStatusColor}
                getUtilizationColor={getUtilizationColor}
                getPodStatusColor={getPodStatusColor}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unowned Nodes List */}
      {unownedNodes.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-orange-200 bg-orange-50">
            <h3 className="font-semibold text-orange-800">
              Unowned GPUaaS Nodes ({unownedNodes.length})
            </h3>
            <p className="text-sm text-orange-600">
              Nodes in GPUaaS clusters not assigned to a provider
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {unownedNodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                expanded={expandedNodes.has(node.id)}
                onToggle={() => toggleNode(node.id)}
                getStatusIcon={getStatusIcon}
                getStatusColor={getStatusColor}
                getUtilizationColor={getUtilizationColor}
                getPodStatusColor={getPodStatusColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface NodeRowProps {
  node: NodeStats;
  expanded: boolean;
  onToggle: () => void;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusColor: (status: string) => string;
  getUtilizationColor: (percent: number) => string;
  getPodStatusColor: (status: string) => string;
}

function NodeRow({
  node,
  expanded,
  onToggle,
  getStatusIcon,
  getStatusColor,
  getUtilizationColor,
  getPodStatusColor,
}: NodeRowProps) {
  return (
    <div className="hover:bg-gray-50">
      {/* Node Header */}
      <div className="px-6 py-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button className="text-gray-400 hover:text-gray-600">
              {expanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>
            <div className="flex items-center gap-2">
              {getStatusIcon(node.status)}
              <div>
                <p className="font-medium text-[#0b0f1c]">{node.hostname}</p>
                <p className="text-sm text-[#5b6476]">{node.ip}</p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded border ${getStatusColor(
                node.status
              )}`}
            >
              {node.status}
            </span>
            <span className="text-xs text-[#5b6476]">{node.providerName}</span>
          </div>

          <div className="flex items-center gap-6">
            {/* GPU Info */}
            <div className="text-right">
              <p className="text-sm font-medium text-[#0b0f1c]">
                {node.gpuModel || "Unknown GPU"}
              </p>
              <p className="text-xs text-[#5b6476]">
                {node.gpuCount} GPU{node.gpuCount !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Utilization Bar */}
            <div className="w-32">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#5b6476]">Utilization</span>
                <span className="text-xs font-medium">{node.summary.utilizationPercent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getUtilizationColor(node.summary.utilizationPercent)}`}
                  style={{ width: `${node.summary.utilizationPercent}%` }}
                />
              </div>
            </div>

            {/* Pod Count */}
            <div className="text-center min-w-[60px]">
              <p className="text-lg font-bold text-purple-600">{node.summary.activePods}</p>
              <p className="text-xs text-[#5b6476]">Pods</p>
            </div>

            {/* vGPU Count */}
            <div className="text-center min-w-[60px]">
              <p className="text-lg font-bold text-indigo-600">{node.summary.totalVgpus}</p>
              <p className="text-xs text-[#5b6476]">vGPUs</p>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-6 pb-4 bg-gray-50/50">
          <div className="ml-9 space-y-4">
            {/* Node Specs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-b border-gray-200">
              {node.hardware.cpuModel && (
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-[#5b6476]">CPU</p>
                    <p className="text-sm font-medium">{node.hardware.cpuModel}</p>
                    {node.hardware.cpuCores && (
                      <p className="text-xs text-[#5b6476]">{node.hardware.cpuCores} cores</p>
                    )}
                  </div>
                </div>
              )}
              {node.hardware.memoryGb && (
                <div className="flex items-center gap-2">
                  <MemoryStick className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-[#5b6476]">Memory</p>
                    <p className="text-sm font-medium">{node.hardware.memoryGb} GB</p>
                  </div>
                </div>
              )}
              {node.hardware.storageGb && (
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-[#5b6476]">Storage</p>
                    <p className="text-sm font-medium">{node.hardware.storageGb} GB</p>
                  </div>
                </div>
              )}
              {node.gpuaasClusterId && (
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-[#5b6476]">GPUaaS</p>
                    <p className="text-sm font-medium">
                      Cluster {node.gpuaasClusterId}
                      {node.gpuaasNodeId && ` / Node ${node.gpuaasNodeId}`}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Pools */}
            {node.pools.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-[#0b0f1c] mb-2">
                  Pools ({node.pools.length})
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {node.pools.map((pool) => (
                    <div
                      key={pool.id}
                      className="bg-white rounded-lg border border-gray-200 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{pool.name}</span>
                        <span className="text-xs text-[#5b6476]">
                          {pool.allocatedGpus}/{pool.totalGpus} GPUs
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getUtilizationColor(pool.utilizationPercent)}`}
                          style={{ width: `${pool.utilizationPercent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pods Table */}
            {node.pods.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-[#0b0f1c] mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Running Pods ({node.pods.length})
                </h4>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-[#5b6476] uppercase">
                          Pod Name
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-[#5b6476] uppercase">
                          Status
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-[#5b6476] uppercase">
                          vGPUs
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-[#5b6476] uppercase">
                          Customer
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {node.pods.map((pod, idx) => (
                        <tr key={`${pod.subscriptionId}-${idx}`}>
                          <td className="px-4 py-2 font-medium text-[#0b0f1c]">{pod.podName}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${getPodStatusColor(
                                pod.status
                              )}`}
                            >
                              {pod.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-[#5b6476]">{pod.vgpuCount}</td>
                          <td className="px-4 py-2 text-[#5b6476]">
                            {pod.customerName || pod.customerEmail || "Unknown"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 bg-gray-100 rounded-lg">
                <p className="text-[#5b6476]">No pods running on this node</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
