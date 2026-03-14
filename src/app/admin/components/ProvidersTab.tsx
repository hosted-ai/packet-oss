/**
 * ProvidersTab Component
 *
 * Main admin interface for managing GPU providers, nodes, and GPU types.
 *
 * Structure:
 * - ProvidersTab (main export): Tab container with sub-navigation
 * - ProvidersSubTab (inline): Provider list with actions
 *
 * Extracted components (in ./providers/):
 * - NodesSubTab: Node management with approval workflow
 * - GpuTypesSubTab: GPU type configuration
 * - ProviderDetailsModal: Provider detail view/edit
 *
 * File reduced from 1894 to ~450 lines through component extraction.
 *
 * @module admin/components/ProvidersTab
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { ProviderSummary, ProviderNode, GpuType, PricingTier } from "../types";
import { NodesSubTab, GpuTypesSubTab, ProviderDetailsModal, type ProviderDetails } from "./providers";

/** Available sub-tabs within the Providers tab */
type ProviderSubTab = "providers" | "nodes" | "gpu-types";

export function ProvidersTab() {
  const [subTab, setSubTab] = useState<ProviderSubTab>("providers");
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [nodes, setNodes] = useState<ProviderNode[]>([]);
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data.data?.providers || []);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (nodeFilter !== "all") params.set("status", nodeFilter);
      const res = await fetch(`/api/admin/providers/nodes?${params}`);
      if (res.ok) {
        const data = await res.json();
        setNodes(data.data?.nodes || []);
      }
    } catch (err) {
      console.error("Failed to load nodes:", err);
    }
  }, [nodeFilter]);

  const loadGpuTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers/gpu-types");
      if (res.ok) {
        const data = await res.json();
        setGpuTypes(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load GPU types:", err);
    }
  }, []);

  const loadPricingTiers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/providers/pricing-tiers");
      if (res.ok) {
        const data = await res.json();
        setPricingTiers(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load pricing tiers:", err);
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([loadProviders(), loadNodes(), loadGpuTypes(), loadPricingTiers()]);
      setLoading(false);
    };
    loadAll();
  }, [loadProviders, loadNodes, loadGpuTypes, loadPricingTiers]);

  // Reload nodes when filter changes
  useEffect(() => {
    if (!loading) {
      loadNodes();
    }
  }, [nodeFilter, loadNodes, loading]);

  const handleNodeAction = async (
    id: string,
    action: string,
    reason?: string,
    pricingData?: {
      pricingTierId?: string;
      customProviderRateCents?: number | null;
      revenueSharePercent?: number | null;
    }
  ) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/providers/nodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, ...pricingData }),
      });
      if (res.ok) {
        await loadNodes();
      } else {
        const data = await res.json();
        alert(data.error || "Action failed");
      }
    } catch (err) {
      console.error("Node action error:", err);
      alert("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleProviderAction = async (id: string, status: string, reason?: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      if (res.ok) {
        await loadProviders();
      } else {
        const data = await res.json();
        alert(data.error || "Action failed");
      }
    } catch (err) {
      console.error("Provider action error:", err);
      alert("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleLoginAs = async (providerId: string) => {
    try {
      const res = await fetch(`/api/admin/providers/${providerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-as" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data?.loginUrl) {
          window.open(data.data.loginUrl, "_blank");
        }
      } else {
        const data = await res.json();
        alert(data.error || "Login failed");
      }
    } catch (err) {
      console.error("Login as provider error:", err);
      alert("Login failed");
    }
  };

  const toggleGpuSubmissions = async (gpuType: GpuType) => {
    setActionLoading(gpuType.id);
    try {
      const res = await fetch("/api/admin/providers/gpu-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: gpuType.id,
          acceptingSubmissions: !gpuType.acceptingSubmissions,
        }),
      });
      if (res.ok) {
        await loadGpuTypes();
      } else {
        const data = await res.json();
        alert(data.error || "Action failed");
      }
    } catch (err) {
      console.error("Toggle submissions error:", err);
      alert("Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1a4fff]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-4 border-b border-[#e4e7ef]">
        {[
          { id: "providers" as const, label: "Providers", count: providers.length },
          { id: "nodes" as const, label: "Nodes", count: nodes.length },
          { id: "gpu-types" as const, label: "GPU Types", count: gpuTypes.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab.id
                ? "text-[#1a4fff] border-[#1a4fff]"
                : "text-[#5b6476] border-transparent hover:text-[#0b0f1c]"
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Tab content */}
      {subTab === "providers" && (
        <ProvidersSubTab
          providers={providers}
          actionLoading={actionLoading}
          onAction={handleProviderAction}
          onLoginAs={handleLoginAs}
          onRefresh={loadProviders}
        />
      )}

      {subTab === "nodes" && (
        <NodesSubTab
          nodes={nodes}
          filter={nodeFilter}
          actionLoading={actionLoading}
          gpuTypes={gpuTypes}
          pricingTiers={pricingTiers}
          onFilterChange={setNodeFilter}
          onAction={handleNodeAction}
        />
      )}

      {subTab === "gpu-types" && (
        <GpuTypesSubTab
          gpuTypes={gpuTypes}
          actionLoading={actionLoading}
          onToggleSubmissions={toggleGpuSubmissions}
          onRefresh={loadGpuTypes}
        />
      )}
    </div>
  );
}

// Providers list component
function ProvidersSubTab({
  providers,
  actionLoading,
  onAction,
  onLoginAs,
  onRefresh,
}: {
  providers: ProviderSummary[];
  actionLoading: string | null;
  onAction: (id: string, action: string, reason?: string) => void;
  onLoginAs: (id: string) => void;
  onRefresh: () => void;
}) {
  const [viewingProvider, setViewingProvider] = useState<ProviderDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      active: "bg-green-100 text-green-800",
      suspended: "bg-red-100 text-red-800",
      rejected: "bg-gray-100 text-gray-800",
      terminated: "bg-gray-200 text-gray-600",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const viewDetails = async (providerId: string) => {
    setLoadingDetails(true);
    try {
      const res = await fetch(`/api/admin/providers/${providerId}`);
      if (res.ok) {
        const data = await res.json();
        setViewingProvider({
          ...data.data.provider,
          nodes: data.data.provider.nodes || [],
          stats: data.data.stats,
        });
      }
    } catch (err) {
      console.error("Failed to load provider details:", err);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div>
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Company</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Contact</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Nodes</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">GPUs</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Applied</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {providers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[#5b6476]">
                  No providers yet
                </td>
              </tr>
            ) : (
              providers.map((provider) => (
                <tr key={provider.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0b0f1c]">{provider.companyName}</div>
                    <div className="text-xs text-[#5b6476]">{provider.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {provider.applicationType === "white_label" ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-teal-100 text-teal-800">White Label</span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">GPU Provider</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">{provider.contactName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusBadge(provider.status)}`}>
                      {provider.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0b0f1c]">
                    {provider.activeNodes} / {provider.totalNodes}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0b0f1c]">{provider.totalGpus}</td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {new Date(provider.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => viewDetails(provider.id)}
                      disabled={loadingDetails}
                      className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded disabled:opacity-50"
                    >
                      View
                    </button>
                    {provider.status === "pending" && (
                      <>
                        <button
                          onClick={() => onAction(provider.id, "active")}
                          disabled={actionLoading === provider.id}
                          className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt("Rejection reason:");
                            if (reason) onAction(provider.id, "rejected", reason);
                          }}
                          disabled={actionLoading === provider.id}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {provider.status === "active" && (
                      <>
                        <button
                          onClick={() => onLoginAs(provider.id)}
                          disabled={actionLoading === provider.id}
                          className="text-xs px-2 py-1 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded disabled:opacity-50"
                        >
                          Login As
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt("Suspension reason:");
                            if (reason) onAction(provider.id, "suspended", reason);
                          }}
                          disabled={actionLoading === provider.id}
                          className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      </>
                    )}
                    {provider.status === "suspended" && (
                      <button
                        onClick={() => onAction(provider.id, "active")}
                        disabled={actionLoading === provider.id}
                        className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Provider Details Modal */}
      {viewingProvider && (
        <ProviderDetailsModal
          provider={viewingProvider}
          onClose={() => setViewingProvider(null)}
          onAction={(action, reason) => {
            onAction(viewingProvider.id, action, reason);
            setViewingProvider(null);
            onRefresh();
          }}
          onLoginAs={() => {
            onLoginAs(viewingProvider.id);
            setViewingProvider(null);
          }}
          onUpdate={async (providerId, updates) => {
            try {
              const res = await fetch(`/api/admin/providers/${providerId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
              });
              if (res.ok) {
                // Reload provider details after update
                await viewDetails(providerId);
                onRefresh();
                return true;
              } else {
                const data = await res.json();
                alert(data.error || "Update failed");
                return false;
              }
            } catch (err) {
              console.error("Provider update error:", err);
              alert("Update failed");
              return false;
            }
          }}
        />
      )}
    </div>
  );
}
