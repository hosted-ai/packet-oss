"use client";

import { useState, useEffect } from "react";
import type { ProviderNode, ProviderStats } from "../types";
import { isNodeFullyProvisioned } from "../types";
import { ProvisioningProgress } from "./ProvisioningProgress";

interface InfrastructureTabProps {
  nodes: ProviderNode[];
  stats: ProviderStats;
  actionLoading: string | null;
  onAddServer: () => void;
  onRemoveServer: (nodeId: string, reason?: string) => void;
  onCancelRemoval: (nodeId: string) => void;
  onRefresh: () => void;
}

export function InfrastructureTab({
  nodes,
  stats,
  actionLoading,
  onAddServer,
  onRemoveServer,
  onCancelRemoval,
  onRefresh,
}: InfrastructureTabProps) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Auto-expand the first provisioning node so users can see progress immediately
  useEffect(() => {
    const provisioningNode = nodes.find(
      (n) => n.status === "provisioning" || (n.status === "active" && !isNodeFullyProvisioned(n))
    );
    if (provisioningNode && !expandedNode) {
      setExpandedNode(provisioningNode.id);
    }
  }, [nodes, expandedNode]);

  const getStatusBadge = (node: ProviderNode) => {
    const isProvisioning = node.status === "active" && !isNodeFullyProvisioned(node);

    const statusStyles: Record<string, string> = {
      provisioning: "bg-blue-100 text-blue-800",
      active: "bg-green-100 text-green-800",
      pending_validation: "bg-yellow-100 text-yellow-800",
      pending_approval: "bg-yellow-100 text-yellow-800",
      validation_failed: "bg-red-100 text-red-800",
      provisioning_failed: "bg-red-100 text-red-800",
      failed: "bg-red-100 text-red-800",
      rejected: "bg-red-100 text-red-800",
      offline: "bg-gray-100 text-gray-800",
      maintenance: "bg-blue-100 text-blue-800",
      removal_scheduled: "bg-orange-100 text-orange-800",
      removal_requested: "bg-orange-100 text-orange-800",
      removed: "bg-gray-100 text-gray-800",
    };

    const statusLabels: Record<string, string> = {
      provisioning: "Provisioning",
      active: "Active",
      pending_validation: "Validating",
      pending_approval: "Pending Approval",
      validation_failed: "Validation Failed",
      provisioning_failed: "Provisioning Failed",
      failed: "Failed",
      rejected: "Rejected",
      offline: "Offline",
      maintenance: "Maintenance",
      removal_scheduled: "Removal Scheduled",
      removal_requested: "Removal Requested",
      removed: "Removed",
    };

    const displayStatus = isProvisioning ? "provisioning" : node.status;

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          statusStyles[displayStatus] || "bg-gray-100 text-gray-800"
        }`}
      >
        {statusLabels[displayStatus] || node.status}
      </span>
    );
  };

  const handleConfirmRemove = (nodeId: string) => {
    onRemoveServer(nodeId, removeReason || undefined);
    setConfirmRemoveId(null);
    setRemoveReason("");
  };

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-[#0b0f1c]">Your Servers</h2>
          <button
            onClick={onRefresh}
            className="text-[#5b6476] hover:text-[#0b0f1c]"
            title="Refresh"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
        <button
          onClick={onAddServer}
          className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90 flex items-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
          Add Server
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Total Servers</p>
          <p className="text-xl font-bold text-[#0b0f1c]">{stats.totalNodes}</p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Active</p>
          <p className="text-xl font-bold text-green-600">{stats.activeNodes}</p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Pending</p>
          <p className="text-xl font-bold text-yellow-600">{stats.pendingNodes}</p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Total GPUs</p>
          <p className="text-xl font-bold text-[#0b0f1c]">{stats.totalGpus}</p>
        </div>
      </div>

      {/* Servers List */}
      {!nodes || nodes.length === 0 ? (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
          <svg
            className="w-16 h-16 mx-auto text-[#e4e7ef] mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-2">
            No servers yet
          </h3>
          <p className="text-[#5b6476] mb-4">
            Add your first GPU server to start earning
          </p>
          <button
            onClick={onAddServer}
            className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90"
          >
            Add Your First Server
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden"
            >
              {/* Server Header */}
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() =>
                  setExpandedNode(expandedNode === node.id ? null : node.id)
                }
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-[#f7f8fb] rounded-lg flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-[#5b6476]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-[#0b0f1c]">
                      {node.hostname || node.ipAddress}
                    </p>
                    <p className="text-sm text-[#5b6476]">
                      {node.gpuModel || "GPU detecting..."} × {node.gpuCount || "?"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {getStatusBadge(node)}
                  <svg
                    className={`w-5 h-5 text-[#5b6476] transition-transform ${
                      expandedNode === node.id ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedNode === node.id && (
                <div className="border-t border-[#e4e7ef] p-4">
                  {/* Provisioning Progress - show for "provisioning" status or "active" that isn't fully provisioned */}
                  {(node.status === "provisioning" || (node.status === "active" && !isNodeFullyProvisioned(node))) && (
                    <div className="mb-4">
                      <ProvisioningProgress node={node} />
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-[#5b6476]">IP Address</p>
                      <p className="text-[#0b0f1c]">{node.ipAddress}:{node.sshPort}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[#5b6476]">Location</p>
                      <p className="text-[#0b0f1c]">
                        {[node.datacenter, node.region, node.country]
                          .filter(Boolean)
                          .join(", ") || "Not specified"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-[#5b6476]">Added</p>
                      <p className="text-[#0b0f1c]">
                        {new Date(node.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {node.gpuModel && (
                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-[#5b6476]">GPU</p>
                        <p className="text-[#0b0f1c]">{node.gpuModel}</p>
                      </div>
                      <div>
                        <p className="text-sm text-[#5b6476]">CPU</p>
                        <p className="text-[#0b0f1c]">
                          {node.cpuModel || "—"} ({node.cpuCores || "?"} cores)
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-[#5b6476]">RAM</p>
                        <p className="text-[#0b0f1c]">{node.ramGb || "?"} GB</p>
                      </div>
                      <div>
                        <p className="text-sm text-[#5b6476]">Storage</p>
                        <p className="text-[#0b0f1c]">{node.storageGb || "?"} GB</p>
                      </div>
                    </div>
                  )}

                  {node.pricing && (
                    <div className="bg-[#f7f8fb] rounded-lg p-4 mb-4">
                      <p className="text-sm font-medium text-[#0b0f1c] mb-2">
                        Pricing: {node.pricing.tierName}
                      </p>
                      <p className="text-sm text-[#5b6476]">
                        {node.pricing.isRevenueShare
                          ? `${node.pricing.revenueSharePercent}% revenue share`
                          : `$${(node.pricing.providerRateCents / 100).toFixed(2)}/hr per GPU`}
                      </p>
                    </div>
                  )}

                  {/* Status Messages */}
                  {node.statusMessage && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-[#5b6476]">{node.statusMessage}</p>
                    </div>
                  )}

                  {node.validationError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-700">{node.validationError}</p>
                    </div>
                  )}

                  {node.rejectionReason && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-700">
                        Rejection reason: {node.rejectionReason}
                      </p>
                    </div>
                  )}

                  {node.removalScheduledFor && (
                    <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <p className="text-sm text-orange-700">
                        Removal scheduled for:{" "}
                        {new Date(node.removalScheduledFor).toLocaleDateString()}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {(node.status === "removal_scheduled" ||
                      node.status === "removal_requested") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelRemoval(node.id);
                        }}
                        disabled={actionLoading === node.id}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionLoading === node.id
                          ? "Cancelling..."
                          : "Cancel Removal"}
                      </button>
                    )}

                    {node.status !== "removed" &&
                      node.status !== "removal_scheduled" &&
                      node.status !== "removal_requested" && (
                        <>
                          {confirmRemoveId === node.id ? (
                            <div className="flex-1 space-y-3">
                              {/* 20-minute cooldown warning */}
                              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <p className="text-sm text-amber-800 font-medium">
                                  Important: After removal, this server cannot be re-added for 20 minutes.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Reason (optional)"
                                  value={removeReason}
                                  onChange={(e) => setRemoveReason(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex-1 px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleConfirmRemove(node.id);
                                  }}
                                  disabled={actionLoading === node.id}
                                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                                >
                                  {actionLoading === node.id
                                    ? "Removing..."
                                    : "Confirm"}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmRemoveId(null);
                                    setRemoveReason("");
                                  }}
                                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmRemoveId(node.id);
                              }}
                              className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100"
                            >
                              Remove Server
                            </button>
                          )}
                        </>
                      )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
