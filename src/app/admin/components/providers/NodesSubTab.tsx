/**
 * NodesSubTab Component
 *
 * Admin interface for managing provider nodes (GPU servers).
 * Extracted from ProvidersTab.tsx for maintainability.
 *
 * Features:
 * - Node listing with status filtering
 * - Approval workflow with pricing configuration
 * - SSH credential management (view/copy)
 * - GPUaaS provisioning integration
 * - Custom pricing overrides
 *
 * @module admin/components/providers/NodesSubTab
 */

"use client";

import { useState } from "react";
import type { ProviderNode, GpuType, PricingTier } from "../../types";
import { GpuaasProvisioningModal } from "../GpuaasProvisioningModal";

/** Props for the NodesSubTab component */
interface NodesSubTabProps {
  nodes: ProviderNode[];
  filter: string;
  actionLoading: string | null;
  gpuTypes: GpuType[];
  pricingTiers: PricingTier[];
  onFilterChange: (filter: string) => void;
  onAction: (
    id: string,
    action: string,
    reason?: string,
    pricingData?: {
      pricingTierId?: string;
      customProviderRateCents?: number | null;
      revenueSharePercent?: number | null;
    }
  ) => void;
}

export function NodesSubTab({
  nodes,
  filter,
  actionLoading,
  gpuTypes,
  pricingTiers,
  onFilterChange,
  onAction,
}: NodesSubTabProps) {
  const [pricingModal, setPricingModal] = useState<{
    node: ProviderNode;
    mode: "approve" | "edit";
    pricingTierId: string;
    useCustomRate: boolean;
    customProviderRateCents: string;
    revenueSharePercent: string;
  } | null>(null);

  // GPUaaS provisioning modal state
  const [gpuaasNodeId, setGpuaasNodeId] = useState<string | null>(null);

  // SSH credential visibility state
  const [showSshForNode, setShowSshForNode] = useState<string | null>(null);
  const [copiedSshNode, setCopiedSshNode] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending_validation: "bg-blue-100 text-blue-800",
      pending_approval: "bg-yellow-100 text-yellow-800",
      approved: "bg-purple-100 text-purple-800",
      active: "bg-green-100 text-green-800",
      suspended: "bg-red-100 text-red-800",
      rejected: "bg-gray-100 text-gray-800",
      removed: "bg-gray-200 text-gray-600",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}/hr`;

  // Open pricing modal for approval (new nodes)
  const openApprovalModal = (node: ProviderNode) => {
    const gpuType = node.requestedGpuType;
    // Find matching pricing tier based on detected GPU model or requested GPU type
    const matchingTier = pricingTiers.find(
      (t) =>
        (node.gpuModel && t.gpuModel.toLowerCase().includes(node.gpuModel.toLowerCase())) ||
        (gpuType && t.gpuModel.toLowerCase().includes(gpuType.shortName.toLowerCase()))
    );

    setPricingModal({
      node,
      mode: "approve",
      pricingTierId: matchingTier?.id || "",
      useCustomRate: false,
      customProviderRateCents: gpuType?.defaultProviderRateCents?.toString() || "",
      revenueSharePercent: gpuType?.defaultRevenueSharePercent?.toString() || "",
    });
  };

  // Open pricing modal for editing (existing nodes)
  const openEditPricingModal = (node: ProviderNode) => {
    setPricingModal({
      node,
      mode: "edit",
      pricingTierId: node.pricingTier?.id || "",
      useCustomRate: !!node.customProviderRateCents,
      customProviderRateCents: node.customProviderRateCents?.toString() || "",
      revenueSharePercent: node.revenueSharePercent?.toString() || "",
    });
  };

  const handlePricingSubmit = () => {
    if (!pricingModal) return;

    const pricingData: {
      pricingTierId?: string;
      customProviderRateCents?: number | null;
      revenueSharePercent?: number | null;
    } = {};

    if (pricingModal.pricingTierId) {
      pricingData.pricingTierId = pricingModal.pricingTierId;
    }

    if (pricingModal.useCustomRate && pricingModal.customProviderRateCents) {
      pricingData.customProviderRateCents = parseInt(pricingModal.customProviderRateCents, 10);
    } else if (!pricingModal.useCustomRate) {
      // Clear custom rate if not using custom rate
      pricingData.customProviderRateCents = null;
    }

    if (pricingModal.revenueSharePercent) {
      pricingData.revenueSharePercent = parseInt(pricingModal.revenueSharePercent, 10);
    } else {
      // Clear revenue share if empty
      pricingData.revenueSharePercent = null;
    }

    const action = pricingModal.mode === "approve" ? "approve" : "update-pricing";
    onAction(pricingModal.node.id, action, undefined, pricingData);
    setPricingModal(null);
  };

  const selectedTier = pricingModal
    ? pricingTiers.find((t) => t.id === pricingModal.pricingTierId)
    : null;

  return (
    <div>
      {/* Filter */}
      <div className="mb-4">
        <select
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c]"
        >
          <option value="all">All Nodes</option>
          <option value="pending_validation">Pending Validation</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Server</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Provider</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">GPU</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Pricing</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Submitted</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                  No nodes found
                </td>
              </tr>
            ) : (
              nodes.map((node) => (
                <tr key={node.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0b0f1c]">{node.hostname || "—"}</div>
                    <div className="text-xs text-[#5b6476]">{node.ipAddress}</div>
                    {node.sshPassword && (
                      <button
                        onClick={() => setShowSshForNode(showSshForNode === node.id ? null : node.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 mt-1"
                      >
                        {showSshForNode === node.id ? "Hide SSH" : "Show SSH"}
                      </button>
                    )}
                    {showSshForNode === node.id && node.sshPassword && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs font-mono">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[#5b6476]">User:</span>
                          <span className="text-[#0b0f1c]">{node.sshUsername || "root"}</span>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[#5b6476]">Pass:</span>
                          <span className="text-[#0b0f1c]">{node.sshPassword}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[#5b6476]">Port:</span>
                          <span className="text-[#0b0f1c]">{node.sshPort || 22}</span>
                        </div>
                        <button
                          onClick={() => {
                            const cmd = `ssh ${node.sshUsername || "root"}@${node.ipAddress} -p ${node.sshPort || 22}`;
                            navigator.clipboard.writeText(cmd);
                            setCopiedSshNode(node.id);
                            setTimeout(() => setCopiedSshNode(null), 2000);
                          }}
                          className="w-full text-center px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                        >
                          {copiedSshNode === node.id ? "Copied!" : "Copy SSH Command"}
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(node.sshPassword || "");
                            setCopiedSshNode(node.id + "-pass");
                            setTimeout(() => setCopiedSshNode(null), 2000);
                          }}
                          className="w-full text-center px-2 py-1 mt-1 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
                        >
                          {copiedSshNode === node.id + "-pass" ? "Copied!" : "Copy Password"}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {node.provider?.companyName || "Unknown"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusBadge(node.status)}`}>
                      {node.status.replace("_", " ")}
                    </span>
                    {node.statusMessage && (
                      <div className="text-xs text-[#5b6476] mt-1">{node.statusMessage}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[#0b0f1c]">
                      {node.gpuModel ? `${node.gpuCount}x ${node.gpuModel}` : "—"}
                    </div>
                    {node.requestedGpuType && (
                      <div className="text-xs text-blue-600">
                        Requested: {node.requestedGpuType.shortName}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {node.pricingTier ? (
                      <div>
                        <div className="text-[#0b0f1c]">{node.pricingTier.name}</div>
                        <div className="text-xs text-[#5b6476]">
                          {node.customProviderRateCents
                            ? formatCents(node.customProviderRateCents)
                            : formatCents(node.pricingTier.providerRateCents)}{" "}
                          (provider)
                        </div>
                        {node.pricingTier.isRevenueShare && (
                          <div className="text-xs text-purple-600">
                            Rev share: {node.revenueSharePercent || node.pricingTier.revenueSharePercent}%
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#5b6476]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {new Date(node.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {node.status === "pending_approval" && (
                      <>
                        <button
                          onClick={() => openApprovalModal(node)}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt("Rejection reason:");
                            if (reason) onAction(node.id, "reject", reason);
                          }}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {node.status === "approved" && (
                      <>
                        <button
                          onClick={() => openEditPricingModal(node)}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded disabled:opacity-50"
                        >
                          Edit Pricing
                        </button>
                        <button
                          onClick={() => setGpuaasNodeId(node.id)}
                          className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded"
                        >
                          GPUaaS
                        </button>
                        <button
                          onClick={() => onAction(node.id, "set-live")}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded disabled:opacity-50"
                        >
                          Set Live
                        </button>
                      </>
                    )}
                    {node.status === "active" && (
                      <>
                        <button
                          onClick={() => openEditPricingModal(node)}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded disabled:opacity-50"
                        >
                          Edit Pricing
                        </button>
                        <button
                          onClick={() => setGpuaasNodeId(node.id)}
                          className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded"
                        >
                          GPUaaS
                        </button>
                        <button
                          onClick={() => {
                            const reason = prompt("Suspension reason:");
                            if (reason) onAction(node.id, "suspend", reason);
                          }}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      </>
                    )}
                    {node.status === "suspended" && (
                      <>
                        <button
                          onClick={() => openEditPricingModal(node)}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded disabled:opacity-50"
                        >
                          Edit Pricing
                        </button>
                        <button
                          onClick={() => onAction(node.id, "set-live")}
                          disabled={actionLoading === node.id}
                          className="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pricing Modal (for both approval and editing) */}
      {pricingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
              {pricingModal.mode === "approve" ? "Approve Server & Set Pricing" : "Edit Node Pricing"}
            </h3>

            {/* Server Info */}
            <div className="bg-[#f7f8fb] rounded-lg p-4 mb-4">
              <div className="text-sm">
                <span className="text-[#5b6476]">Server:</span>{" "}
                <span className="font-medium text-[#0b0f1c]">
                  {pricingModal.node.hostname || pricingModal.node.ipAddress}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-[#5b6476]">Provider:</span>{" "}
                <span className="font-medium text-[#0b0f1c]">
                  {pricingModal.node.provider?.companyName}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-[#5b6476]">GPU:</span>{" "}
                <span className="font-medium text-[#0b0f1c]">
                  {pricingModal.node.gpuModel
                    ? `${pricingModal.node.gpuCount}x ${pricingModal.node.gpuModel}`
                    : "—"}
                </span>
              </div>
              {pricingModal.node.requestedGpuType && (
                <div className="text-sm">
                  <span className="text-[#5b6476]">Requested GPU Type:</span>{" "}
                  <span className="font-medium text-blue-600">
                    {pricingModal.node.requestedGpuType.name}
                  </span>
                  <span className="text-xs text-[#5b6476] ml-2">
                    (Default: {formatCents(pricingModal.node.requestedGpuType.defaultProviderRateCents)})
                  </span>
                </div>
              )}
              {pricingModal.mode === "edit" && (
                <div className="text-sm mt-2 pt-2 border-t border-[#e4e7ef]">
                  <span className="text-[#5b6476]">Status:</span>{" "}
                  <span className={`font-medium ${
                    pricingModal.node.status === "active" ? "text-green-600" :
                    pricingModal.node.status === "approved" ? "text-purple-600" : "text-orange-600"
                  }`}>
                    {pricingModal.node.status}
                  </span>
                </div>
              )}
            </div>

            {/* Pricing Tier Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                Pricing Tier
              </label>
              <select
                value={pricingModal.pricingTierId}
                onChange={(e) =>
                  setPricingModal({
                    ...pricingModal,
                    pricingTierId: e.target.value,
                    useCustomRate: false,
                  })
                }
                className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm"
              >
                <option value="">Select a pricing tier...</option>
                {pricingTiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} - {tier.gpuModel} ({formatCents(tier.providerRateCents)} provider /{" "}
                    {formatCents(tier.customerRateCents)} customer)
                  </option>
                ))}
              </select>
              {selectedTier && (
                <div className="mt-2 text-xs text-[#5b6476]">
                  Provider rate: {formatCents(selectedTier.providerRateCents)} | Customer rate:{" "}
                  {formatCents(selectedTier.customerRateCents)}
                  {selectedTier.isRevenueShare && ` | Revenue share: ${selectedTier.revenueSharePercent}%`}
                </div>
              )}
            </div>

            {/* Custom Rate Override */}
            <div className="mb-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pricingModal.useCustomRate}
                  onChange={(e) =>
                    setPricingModal({ ...pricingModal, useCustomRate: e.target.checked })
                  }
                  className="rounded border-[#e4e7ef]"
                />
                <span className="text-[#0b0f1c]">Use custom provider rate</span>
              </label>
              {pricingModal.useCustomRate && (
                <div className="mt-2">
                  <label className="block text-xs text-[#5b6476] mb-1">
                    Custom Provider Rate (cents/hr)
                  </label>
                  <input
                    type="number"
                    value={pricingModal.customProviderRateCents}
                    onChange={(e) =>
                      setPricingModal({
                        ...pricingModal,
                        customProviderRateCents: e.target.value,
                      })
                    }
                    placeholder="e.g., 85 for $0.85/hr"
                    className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm"
                  />
                  {pricingModal.customProviderRateCents && (
                    <div className="text-xs text-green-600 mt-1">
                      = {formatCents(parseInt(pricingModal.customProviderRateCents, 10) || 0)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Revenue Share Override (if applicable) */}
            {selectedTier?.isRevenueShare && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Revenue Share Percent (optional override)
                </label>
                <input
                  type="number"
                  value={pricingModal.revenueSharePercent}
                  onChange={(e) =>
                    setPricingModal({ ...pricingModal, revenueSharePercent: e.target.value })
                  }
                  placeholder={`Default: ${selectedTier.revenueSharePercent}%`}
                  className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setPricingModal(null)}
                className="px-4 py-2 text-sm text-[#5b6476] hover:text-[#0b0f1c]"
              >
                Cancel
              </button>
              <button
                onClick={handlePricingSubmit}
                disabled={!pricingModal.pricingTierId && !pricingModal.useCustomRate}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  pricingModal.mode === "approve"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-[#1a4fff] hover:bg-[#1238c9]"
                }`}
              >
                {pricingModal.mode === "approve" ? "Approve with Pricing" : "Update Pricing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPUaaS Provisioning Modal */}
      {gpuaasNodeId && (
        <GpuaasProvisioningModal
          nodeId={gpuaasNodeId}
          onClose={() => setGpuaasNodeId(null)}
          onComplete={() => setGpuaasNodeId(null)}
        />
      )}
    </div>
  );
}
