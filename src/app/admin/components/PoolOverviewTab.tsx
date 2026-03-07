"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Server,
  Cpu,
  Users,
  RefreshCw,
  Database,
  HardDrive,
  Activity,
  MapPin,
  Layers,
} from "lucide-react";

interface PoolGPU {
  id: number;
  uuid: string;
  gpuModel: string;
  memoryMb: number;
  nodeId: number;
  nodeName: string;
  nodeIp: string;
  assignmentStatus: string;
}

interface PoolNode {
  id: number;
  name: string;
  ip: string;
  gpuCount: number;
  gpuModel: string | null;
  initStatus: number;
  cpuModel: string | null;
  cpuCores: number | null;
  memoryGb: number | null;
  storageGb: number | null;
  providerId: string | null;
  providerName: string | null;
}

interface PoolPod {
  subscriptionId: string;
  podName: string;
  status: string;
  vgpuCount: number;
  customerEmail: string | null;
  customerName: string | null;
  teamId: string;
  teamName: string | null;
}

interface PoolDetails {
  id: number;
  name: string;
  clusterId: number;
  regionId: number;
  regionName: string;
  totalGpus: number;
  allocatedGpus: number;
  availableGpus: number;
  utilizationPercent: number;
  overcommitRatio: number;
  securityMode: string | null;
  createdAt: string;
  gpus: PoolGPU[];
  nodes: PoolNode[];
  pods: PoolPod[];
}

interface ClusterSummary {
  id: number;
  regionId: number;
  regionName: string;
  status: string;
  poolCount: number;
  totalGpus: number;
  allocatedGpus: number;
  nodeCount: number;
}

interface PoolOverviewData {
  clusters: ClusterSummary[];
  pools: PoolDetails[];
  summary: {
    totalClusters: number;
    totalPools: number;
    totalGpus: number;
    allocatedGpus: number;
    availableGpus: number;
    utilizationPercent: number;
    totalNodes: number;
    activePods: number;
  };
}

export function PoolOverviewTab() {
  const [data, setData] = useState<PoolOverviewData | null>(null);
  const [maintenancePoolIds, setMaintenancePoolIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPools, setExpandedPools] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<
    Map<number, Set<string>>
  >(new Map());
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pools");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setMaintenancePoolIds(new Set(json.maintenancePoolIds || []));
        setLastRefresh(new Date());
      } else {
        setError(json.error || "Failed to fetch pool data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const togglePool = (poolId: number) => {
    const newExpanded = new Set(expandedPools);
    if (newExpanded.has(poolId)) {
      newExpanded.delete(poolId);
    } else {
      newExpanded.add(poolId);
    }
    setExpandedPools(newExpanded);
  };

  const toggleSection = (poolId: number, section: string) => {
    const poolSections = expandedSections.get(poolId) || new Set();
    const newSections = new Set(poolSections);
    if (newSections.has(section)) {
      newSections.delete(section);
    } else {
      newSections.add(section);
    }
    const newMap = new Map(expandedSections);
    newMap.set(poolId, newSections);
    setExpandedSections(newMap);
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === "running" || s === "active" || s === "ready" || s === "assigned") {
      return "bg-green-100 text-green-800";
    }
    if (s === "stopped" || s === "paused" || s === "reserved") {
      return "bg-yellow-100 text-yellow-800";
    }
    if (s === "unassigned" || s === "available") {
      return "bg-blue-100 text-blue-800";
    }
    return "bg-gray-100 text-gray-800";
  };

  const getUtilizationColor = (percent: number) => {
    if (percent >= 80) return "bg-green-500";
    if (percent >= 50) return "bg-yellow-500";
    if (percent >= 20) return "bg-orange-500";
    return "bg-gray-300";
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading pool data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error: {error}</p>
        <button
          onClick={fetchData}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Pools</p>
              <p className="text-2xl font-bold text-gray-900">
                {data.summary.totalPools}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Cpu className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">GPUs Allocated</p>
              <p className="text-2xl font-bold text-gray-900">
                {data.summary.allocatedGpus}/{data.summary.totalGpus}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Server className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Nodes</p>
              <p className="text-2xl font-bold text-gray-900">
                {data.summary.totalNodes}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg">
              <Activity className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Active Pods</p>
              <p className="text-2xl font-bold text-gray-900">
                {data.summary.activePods}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Utilization Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Overall GPU Utilization
          </span>
          <span className="text-sm font-bold text-gray-900">
            {data.summary.utilizationPercent}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full ${getUtilizationColor(
              data.summary.utilizationPercent
            )}`}
            style={{ width: `${data.summary.utilizationPercent}%` }}
          />
        </div>
      </div>

      {/* Refresh Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Pools by Cluster
        </h2>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-500">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Clusters and Pools */}
      {data.clusters.map((cluster) => {
        const clusterPools = data.pools.filter(
          (p) => p.clusterId === cluster.id
        );

        return (
          <div
            key={cluster.id}
            className="bg-white rounded-lg border border-gray-200 overflow-hidden"
          >
            {/* Cluster Header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-gray-500" />
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {cluster.regionName}
                    </h3>
                    <p className="text-xs text-gray-500">
                      Cluster #{cluster.id} • {cluster.poolCount} pools •{" "}
                      {cluster.nodeCount} nodes
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      {cluster.allocatedGpus}/{cluster.totalGpus} GPUs
                    </p>
                    <p className="text-xs text-gray-500">
                      {cluster.totalGpus > 0
                        ? Math.round(
                            (cluster.allocatedGpus / cluster.totalGpus) * 100
                          )
                        : 0}
                      % utilized
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${
                      cluster.status === "GPUAAS_ACTIVE"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {cluster.status.replace("GPUAAS_", "")}
                  </span>
                </div>
              </div>
            </div>

            {/* Pools in Cluster */}
            <div className="divide-y divide-gray-100">
              {clusterPools.map((pool) => {
                const isExpanded = expandedPools.has(pool.id);
                const poolSections = expandedSections.get(pool.id) || new Set();
                const activePods = pool.pods.filter((p) => {
                  const status = p.status?.toLowerCase() || "";
                  return (
                    status === "running" ||
                    status === "active" ||
                    status === "ready"
                  );
                });

                return (
                  <div key={pool.id}>
                    {/* Pool Row */}
                    <div
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => togglePool(pool.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                          )}
                          <Database className="w-5 h-5 text-blue-500" />
                          <div>
                            <h4 className="font-medium text-gray-900 flex items-center gap-2">
                              {pool.name}
                              {maintenancePoolIds.has(pool.id) && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-800 uppercase tracking-wide">
                                  Maintenance
                                </span>
                              )}
                            </h4>
                            <p className="text-xs text-gray-500">
                              Pool #{pool.id} • Overcommit: {pool.overcommitRatio}x
                              {pool.securityMode &&
                                ` • Security: ${pool.securityMode}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          {/* GPUs */}
                          <div className="text-center">
                            <p className="text-sm font-medium text-gray-900">
                              {pool.allocatedGpus}/{pool.totalGpus}
                            </p>
                            <p className="text-xs text-gray-500">GPUs</p>
                          </div>
                          {/* Nodes */}
                          <div className="text-center">
                            <p className="text-sm font-medium text-gray-900">
                              {pool.nodes.length}
                            </p>
                            <p className="text-xs text-gray-500">Nodes</p>
                          </div>
                          {/* Pods */}
                          <div className="text-center">
                            <p className="text-sm font-medium text-gray-900">
                              {activePods.length}/{pool.pods.length}
                            </p>
                            <p className="text-xs text-gray-500">Pods</p>
                          </div>
                          {/* Utilization */}
                          <div className="w-24">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-gray-500">Util</span>
                              <span className="font-medium">
                                {pool.utilizationPercent}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${getUtilizationColor(
                                  pool.utilizationPercent
                                )}`}
                                style={{
                                  width: `${pool.utilizationPercent}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Pool Details */}
                    {isExpanded && (
                      <div className="px-4 py-4 bg-gray-50 border-t border-gray-100">
                        <div className="space-y-4 pl-8">
                          {/* GPUs Section */}
                          <div>
                            <button
                              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSection(pool.id, "gpus");
                              }}
                            >
                              {poolSections.has("gpus") ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                              <Cpu className="w-4 h-4 text-green-600" />
                              GPUs ({pool.gpus.length})
                            </button>
                            {poolSections.has("gpus") && pool.gpus.length > 0 && (
                              <div className="mt-2 ml-6 overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-gray-500">
                                      <th className="pb-2 font-medium">Model</th>
                                      <th className="pb-2 font-medium">Memory</th>
                                      <th className="pb-2 font-medium">Node</th>
                                      <th className="pb-2 font-medium">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {pool.gpus.map((gpu) => (
                                      <tr key={gpu.id} className="text-gray-700">
                                        <td className="py-2">{gpu.gpuModel}</td>
                                        <td className="py-2">
                                          {Math.round(gpu.memoryMb / 1024)}GB
                                        </td>
                                        <td className="py-2">
                                          <span className="text-gray-900">
                                            {gpu.nodeName}
                                          </span>
                                          <span className="text-gray-400 ml-1">
                                            ({gpu.nodeIp})
                                          </span>
                                        </td>
                                        <td className="py-2">
                                          <span
                                            className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(
                                              gpu.assignmentStatus
                                            )}`}
                                          >
                                            {gpu.assignmentStatus}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>

                          {/* Nodes Section */}
                          <div>
                            <button
                              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSection(pool.id, "nodes");
                              }}
                            >
                              {poolSections.has("nodes") ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                              <Server className="w-4 h-4 text-purple-600" />
                              Nodes ({pool.nodes.length})
                            </button>
                            {poolSections.has("nodes") &&
                              pool.nodes.length > 0 && (
                                <div className="mt-2 ml-6 overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-gray-500">
                                        <th className="pb-2 font-medium">Name</th>
                                        <th className="pb-2 font-medium">IP</th>
                                        <th className="pb-2 font-medium">GPUs</th>
                                        <th className="pb-2 font-medium">Hardware</th>
                                        <th className="pb-2 font-medium">Provider</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {pool.nodes.map((node) => (
                                        <tr key={node.id} className="text-gray-700">
                                          <td className="py-2 font-medium">
                                            {node.name}
                                          </td>
                                          <td className="py-2 font-mono text-xs">
                                            {node.ip}
                                          </td>
                                          <td className="py-2">
                                            {node.gpuCount}{" "}
                                            {node.gpuModel && (
                                              <span className="text-gray-400">
                                                ({node.gpuModel})
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2">
                                            {node.cpuCores && (
                                              <span>{node.cpuCores} cores</span>
                                            )}
                                            {node.memoryGb && (
                                              <span className="ml-2">
                                                {node.memoryGb}GB RAM
                                              </span>
                                            )}
                                            {node.storageGb && (
                                              <span className="ml-2">
                                                {node.storageGb}GB
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2">
                                            {node.providerName || (
                                              <span className="text-gray-400">
                                                Unowned
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                          </div>

                          {/* Pods Section */}
                          <div>
                            <button
                              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSection(pool.id, "pods");
                              }}
                            >
                              {poolSections.has("pods") ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                              <Users className="w-4 h-4 text-orange-600" />
                              Pods ({pool.pods.length})
                            </button>
                            {poolSections.has("pods") && pool.pods.length > 0 && (
                              <div className="mt-2 ml-6 overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-gray-500">
                                      <th className="pb-2 font-medium">Pod Name</th>
                                      <th className="pb-2 font-medium">Status</th>
                                      <th className="pb-2 font-medium">vGPUs</th>
                                      <th className="pb-2 font-medium">Customer</th>
                                      <th className="pb-2 font-medium">Team</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {pool.pods.map((pod, idx) => (
                                      <tr key={idx} className="text-gray-700">
                                        <td className="py-2 font-mono text-xs">
                                          {pod.podName}
                                        </td>
                                        <td className="py-2">
                                          <span
                                            className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(
                                              pod.status
                                            )}`}
                                          >
                                            {pod.status}
                                          </span>
                                        </td>
                                        <td className="py-2">{pod.vgpuCount}</td>
                                        <td className="py-2">
                                          {pod.customerEmail || (
                                            <span className="text-gray-400">-</span>
                                          )}
                                        </td>
                                        <td className="py-2">
                                          {pod.teamName || (
                                            <span className="text-gray-400 text-xs">
                                              {pod.teamId.substring(0, 8)}...
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {poolSections.has("pods") && pool.pods.length === 0 && (
                              <p className="mt-2 ml-6 text-sm text-gray-500">
                                No pods in this pool
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {clusterPools.length === 0 && (
                <div className="px-4 py-6 text-center text-gray-500">
                  No pools in this cluster
                </div>
              )}
            </div>
          </div>
        );
      })}

      {data.clusters.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            No Active Clusters
          </h3>
          <p className="text-gray-500">
            No GPUaaS clusters are currently active.
          </p>
        </div>
      )}
    </div>
  );
}
