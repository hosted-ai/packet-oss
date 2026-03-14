/**
 * ProviderDetailsModal Component
 *
 * Modal dialog for viewing and editing provider details.
 * Extracted from ProvidersTab.tsx for maintainability.
 *
 * Features:
 * - View provider company info, contacts, and infrastructure
 * - Edit provider details (company, contacts, GPU info)
 * - Provider action buttons (approve, reject, suspend, reactivate)
 * - Login as provider functionality
 * - Node listing for the provider
 *
 * @module admin/components/providers/ProviderDetailsModal
 */

"use client";

import { useState } from "react";
import type { ProviderNode } from "../../types";

/**
 * Extended provider details including stats and nodes.
 * Used for the detailed provider view modal.
 */
export interface ProviderDetails {
  id: string;
  companyName: string;
  email: string;
  contactName: string;
  phone: string | null;
  website: string | null;
  status: string;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  createdAt: string;
  estimatedGpuCount: number | null;
  gpuTypes: string[];
  regions: string[];
  additionalInfo: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  commercialEmail: string | null;
  commercialPhone: string | null;
  generalEmail: string | null;
  nodes: ProviderNode[];
  // Token Factory revenue share (null = use default)
  tokenRevenueSharePercent: number | null;
  tokenRevenueShareDefault: number;
  stats: {
    totalNodes: number;
    activeNodes: number;
    totalGpus: number;
    totalPaid: number;
    totalPending: number;
  };
}

interface ProviderDetailsModalProps {
  provider: ProviderDetails;
  onClose: () => void;
  onAction: (action: string, reason?: string) => void;
  onLoginAs: () => void;
  onUpdate: (providerId: string, updates: Record<string, unknown>) => Promise<boolean>;
}

export function ProviderDetailsModal({
  provider,
  onClose,
  onAction,
  onLoginAs,
  onUpdate,
}: ProviderDetailsModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    companyName: provider.companyName,
    contactName: provider.contactName,
    email: provider.email,
    phone: provider.phone || "",
    website: provider.website || "",
    supportEmail: provider.supportEmail || "",
    supportPhone: provider.supportPhone || "",
    commercialEmail: provider.commercialEmail || "",
    commercialPhone: provider.commercialPhone || "",
    generalEmail: provider.generalEmail || "",
    estimatedGpuCount: provider.estimatedGpuCount?.toString() || "",
    gpuTypes: provider.gpuTypes.join(", "),
    regions: provider.regions.join(", "),
    // Token Factory revenue share (empty = use default)
    tokenRevenueSharePercent: provider.tokenRevenueSharePercent?.toString() || "",
  });

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        companyName: editForm.companyName,
        contactName: editForm.contactName,
        email: editForm.email,
        phone: editForm.phone || null,
        website: editForm.website || null,
        supportEmail: editForm.supportEmail || null,
        supportPhone: editForm.supportPhone || null,
        commercialEmail: editForm.commercialEmail || null,
        commercialPhone: editForm.commercialPhone || null,
        generalEmail: editForm.generalEmail || null,
        estimatedGpuCount: editForm.estimatedGpuCount ? parseInt(editForm.estimatedGpuCount, 10) : null,
        gpuTypes: editForm.gpuTypes.split(",").map(s => s.trim()).filter(Boolean),
        regions: editForm.regions.split(",").map(s => s.trim()).filter(Boolean),
        // Token Factory revenue share (empty string = use default/null)
        tokenRevenueSharePercent: editForm.tokenRevenueSharePercent
          ? parseFloat(editForm.tokenRevenueSharePercent)
          : null,
      };

      const success = await onUpdate(provider.id, updates);
      if (success) {
        setIsEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#e4e7ef] px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-[#0b0f1c]">
              {isEditing ? "Edit Provider" : provider.companyName}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-1 rounded-full ${getStatusBadge(provider.status)}`}>
                {provider.status}
              </span>
              {provider.verified && (
                <span className="text-xs text-green-600">Verified</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded-lg"
              >
                Edit
              </button>
            )}
            <button onClick={onClose} className="text-[#5b6476] hover:text-[#0b0f1c]">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {isEditing ? (
            /* Edit Form */
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Company Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Company Name *</label>
                    <input
                      type="text"
                      value={editForm.companyName}
                      onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Contact Name *</label>
                    <input
                      type="text"
                      value={editForm.contactName}
                      onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Email *</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Phone</label>
                    <input
                      type="text"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-[#5b6476] mb-1">Website</label>
                    <input
                      type="url"
                      value={editForm.website}
                      onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      placeholder="https://example.com"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Contact Points</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Support Email</label>
                    <input
                      type="email"
                      value={editForm.supportEmail}
                      onChange={(e) => setEditForm({ ...editForm, supportEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Support Phone</label>
                    <input
                      type="text"
                      value={editForm.supportPhone}
                      onChange={(e) => setEditForm({ ...editForm, supportPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Commercial Email</label>
                    <input
                      type="email"
                      value={editForm.commercialEmail}
                      onChange={(e) => setEditForm({ ...editForm, commercialEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Commercial Phone</label>
                    <input
                      type="text"
                      value={editForm.commercialPhone}
                      onChange={(e) => setEditForm({ ...editForm, commercialPhone: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-[#5b6476] mb-1">General Email</label>
                    <input
                      type="email"
                      value={editForm.generalEmail}
                      onChange={(e) => setEditForm({ ...editForm, generalEmail: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Infrastructure Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">Estimated GPU Count</label>
                    <input
                      type="number"
                      value={editForm.estimatedGpuCount}
                      onChange={(e) => setEditForm({ ...editForm, estimatedGpuCount: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">GPU Types (comma-separated)</label>
                    <input
                      type="text"
                      value={editForm.gpuTypes}
                      onChange={(e) => setEditForm({ ...editForm, gpuTypes: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      placeholder="H100, A100"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-[#5b6476] mb-1">Regions (comma-separated)</label>
                    <input
                      type="text"
                      value={editForm.regions}
                      onChange={(e) => setEditForm({ ...editForm, regions: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      placeholder="US, EU, APAC"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Token Factory Revenue</h3>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div>
                    <label className="block text-xs text-[#5b6476] mb-1">
                      Revenue Share % (leave empty for default: {provider.tokenRevenueShareDefault}%)
                    </label>
                    <input
                      type="number"
                      value={editForm.tokenRevenueSharePercent}
                      onChange={(e) => setEditForm({ ...editForm, tokenRevenueSharePercent: e.target.value })}
                      className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder={`Default: ${provider.tokenRevenueShareDefault}%`}
                    />
                    <p className="text-xs text-[#5b6476] mt-1">
                      The percentage of Token Factory token revenue this provider receives.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* View Mode */
            <>
              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-[#f7f8fb] rounded-lg p-3">
                  <p className="text-xs text-[#5b6476]">Total Nodes</p>
                  <p className="text-xl font-bold text-[#0b0f1c]">{provider.stats.totalNodes}</p>
                </div>
                <div className="bg-[#f7f8fb] rounded-lg p-3">
                  <p className="text-xs text-[#5b6476]">Active Nodes</p>
                  <p className="text-xl font-bold text-[#0b0f1c]">{provider.stats.activeNodes}</p>
                </div>
                <div className="bg-[#f7f8fb] rounded-lg p-3">
                  <p className="text-xs text-[#5b6476]">Total GPUs</p>
                  <p className="text-xl font-bold text-[#0b0f1c]">{provider.stats.totalGpus}</p>
                </div>
                <div className="bg-[#f7f8fb] rounded-lg p-3">
                  <p className="text-xs text-[#5b6476]">Total Paid</p>
                  <p className="text-xl font-bold text-[#0b0f1c]">${provider.stats.totalPaid.toFixed(2)}</p>
                </div>
              </div>

              {/* Company Details */}
              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Company Information</h3>
                <div className="grid grid-cols-2 gap-4 bg-[#f7f8fb] rounded-lg p-4">
                  <div>
                    <p className="text-xs text-[#5b6476]">Contact Name</p>
                    <p className="text-sm text-[#0b0f1c]">{provider.contactName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5b6476]">Email</p>
                    <p className="text-sm text-[#0b0f1c]">{provider.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5b6476]">Phone</p>
                    <p className="text-sm text-[#0b0f1c]">{provider.phone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5b6476]">Website</p>
                    <p className="text-sm text-[#0b0f1c]">
                      {provider.website ? (
                        <a href={provider.website} target="_blank" rel="noopener noreferrer" className="text-[#1a4fff] hover:underline">
                          {provider.website}
                        </a>
                      ) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#5b6476]">Applied</p>
                    <p className="text-sm text-[#0b0f1c]">{new Date(provider.createdAt).toLocaleString()}</p>
                  </div>
                  {provider.verifiedAt && (
                    <div>
                      <p className="text-xs text-[#5b6476]">Verified</p>
                      <p className="text-sm text-[#0b0f1c]">
                        {new Date(provider.verifiedAt).toLocaleString()} by {provider.verifiedBy}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Points */}
              {(provider.supportEmail || provider.commercialEmail || provider.generalEmail) && (
                <div>
                  <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Contact Points</h3>
                  <div className="grid grid-cols-3 gap-4 bg-[#f7f8fb] rounded-lg p-4">
                    <div>
                      <p className="text-xs text-[#5b6476]">Support</p>
                      <p className="text-sm text-[#0b0f1c]">{provider.supportEmail || "—"}</p>
                      <p className="text-xs text-[#5b6476]">{provider.supportPhone || ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#5b6476]">Commercial/Billing</p>
                      <p className="text-sm text-[#0b0f1c]">{provider.commercialEmail || "—"}</p>
                      <p className="text-xs text-[#5b6476]">{provider.commercialPhone || ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#5b6476]">General</p>
                      <p className="text-sm text-[#0b0f1c]">{provider.generalEmail || "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Infrastructure Details */}
              <div>
                <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Infrastructure Details</h3>
                <div className="bg-[#f7f8fb] rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-[#5b6476]">Estimated GPU Count</p>
                      <p className="text-sm text-[#0b0f1c]">{provider.estimatedGpuCount || "Not specified"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#5b6476]">GPU Types</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {provider.gpuTypes.length > 0 ? (
                          provider.gpuTypes.map((gpu, i) => (
                            <span key={i} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                              {gpu}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-[#5b6476]">Not specified</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-[#5b6476]">Regions</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {provider.regions.length > 0 ? (
                        provider.regions.map((region, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-800 px-2 py-0.5 rounded">
                            {region}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-[#5b6476]">Not specified</span>
                      )}
                    </div>
                  </div>
                  {provider.additionalInfo && (
                    <div>
                      <p className="text-xs text-[#5b6476]">Additional Information</p>
                      <p className="text-sm text-[#0b0f1c] whitespace-pre-wrap">{provider.additionalInfo}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Nodes List */}
              {provider.nodes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Nodes ({provider.nodes.length})</h3>
                  <div className="border border-[#e4e7ef] rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-[#f7f8fb]">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs text-[#5b6476]">Server</th>
                          <th className="text-left px-3 py-2 text-xs text-[#5b6476]">GPU</th>
                          <th className="text-left px-3 py-2 text-xs text-[#5b6476]">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4e7ef]">
                        {provider.nodes.map((node) => (
                          <tr key={node.id}>
                            <td className="px-3 py-2">
                              <div className="text-[#0b0f1c]">{node.hostname || node.ipAddress}</div>
                            </td>
                            <td className="px-3 py-2 text-[#5b6476]">
                              {node.gpuModel ? `${node.gpuCount}x ${node.gpuModel}` : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${getStatusBadge(node.status)}`}>
                                {node.status.replace("_", " ")}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions Footer */}
        <div className="sticky bottom-0 bg-white border-t border-[#e4e7ef] px-6 py-4 flex justify-between">
          {isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="px-4 py-2 border border-[#e4e7ef] rounded-lg text-[#5b6476] hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editForm.companyName || !editForm.contactName || !editForm.email}
                className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-[#e4e7ef] rounded-lg text-[#5b6476] hover:bg-gray-50"
              >
                Close
              </button>
              <div className="space-x-2">
                {provider.status === "pending" && (
                  <>
                    <button
                      onClick={() => {
                        const reason = prompt("Rejection reason:");
                        if (reason) onAction("rejected", reason);
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => onAction("active")}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                    >
                      Approve
                    </button>
                  </>
                )}
                {provider.status === "active" && (
                  <>
                    <button
                      onClick={onLoginAs}
                      className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg"
                    >
                      Login As Provider
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt("Suspension reason:");
                        if (reason) onAction("suspended", reason);
                      }}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg"
                    >
                      Suspend
                    </button>
                  </>
                )}
                {provider.status === "suspended" && (
                  <button
                    onClick={() => onAction("active")}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
