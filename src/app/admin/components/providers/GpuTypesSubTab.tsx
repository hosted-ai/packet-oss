/**
 * GpuTypesSubTab Component
 *
 * Admin interface for managing GPU type configurations.
 * Extracted from ProvidersTab.tsx for maintainability.
 *
 * Features:
 * - GPU type listing with pricing information
 * - Add/edit GPU types via modal
 * - Toggle accepting submissions status
 * - Support for fixed rate and revenue share payout models
 *
 * @module admin/components/providers/GpuTypesSubTab
 */

"use client";

import { useState } from "react";
import type { GpuType } from "../../types";

/** Props for the GpuTypesSubTab component */
interface GpuTypesSubTabProps {
  gpuTypes: GpuType[];
  actionLoading: string | null;
  onToggleSubmissions: (gpuType: GpuType) => void;
  onRefresh: () => void;
}

export function GpuTypesSubTab({
  gpuTypes,
  actionLoading,
  onToggleSubmissions,
  onRefresh,
}: GpuTypesSubTabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGpu, setEditingGpu] = useState<GpuType | null>(null);

  const getPayoutModelLabel = (model: string) => {
    switch (model) {
      case "fixed_only":
        return "Fixed Rate Only";
      case "revenue_share_only":
        return "Revenue Share Only";
      case "provider_choice":
        return "Provider Choice";
      default:
        return model;
    }
  };

  return (
    <div>
      <div className="mb-4">
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-[#1a4fff] text-white hover:bg-[#1238c9] rounded-lg font-medium text-sm"
        >
          + Add GPU Type
        </button>
      </div>

      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">GPU Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Provider Rate</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Customer Rate</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Payout Model</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {gpuTypes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#5b6476]">
                  No GPU types configured
                </td>
              </tr>
            ) : (
              gpuTypes.map((gpu) => (
                <tr key={gpu.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0b0f1c]">{gpu.name}</div>
                    <div className="text-xs text-[#5b6476]">{gpu.shortName} • {gpu.manufacturer}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0b0f1c]">
                    ${(gpu.defaultProviderRateCents / 100).toFixed(2)}/hr
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0b0f1c]">
                    ${(gpu.defaultCustomerRateCents / 100).toFixed(2)}/hr
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                      {getPayoutModelLabel(gpu.payoutModelChoice)}
                    </span>
                    {gpu.payoutModelChoice !== "fixed_only" && gpu.defaultRevenueSharePercent && (
                      <div className="text-xs text-[#5b6476] mt-1">
                        {gpu.defaultRevenueSharePercent}% rev share
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        gpu.acceptingSubmissions
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {gpu.acceptingSubmissions ? "Active" : "Paused"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => setEditingGpu(gpu)}
                      className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onToggleSubmissions(gpu)}
                      disabled={actionLoading === gpu.id}
                      className={`text-xs px-2 py-1 rounded disabled:opacity-50 ${
                        gpu.acceptingSubmissions
                          ? "bg-orange-100 hover:bg-orange-200 text-orange-800"
                          : "bg-green-100 hover:bg-green-200 text-green-800"
                      }`}
                    >
                      {gpu.acceptingSubmissions ? "Pause" : "Resume"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit GPU Type Modal */}
      {(showAddModal || editingGpu) && (
        <GpuTypeModal
          gpuType={editingGpu}
          onClose={() => {
            setShowAddModal(false);
            setEditingGpu(null);
          }}
          onSave={() => {
            setShowAddModal(false);
            setEditingGpu(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

// GPU Type Modal
function GpuTypeModal({
  gpuType,
  onClose,
  onSave,
}: {
  gpuType: GpuType | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: gpuType?.name || "",
    shortName: gpuType?.shortName || "",
    manufacturer: gpuType?.manufacturer || "NVIDIA",
    matchPatterns: gpuType?.matchPatterns?.join(", ") || "",
    defaultProviderRateCents: gpuType?.defaultProviderRateCents || 100,
    defaultCustomerRateCents: gpuType?.defaultCustomerRateCents || 150,
    defaultTermsType: gpuType?.defaultTermsType || "fixed",
    defaultRevenueSharePercent: gpuType?.defaultRevenueSharePercent || 70,
    payoutModelChoice: gpuType?.payoutModelChoice || "fixed_only",
    minVramGb: gpuType?.minVramGb || 0,
    displayOrder: gpuType?.displayOrder || 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const data = {
        ...form,
        matchPatterns: form.matchPatterns.split(",").map((p) => p.trim()).filter(Boolean),
        defaultRevenueSharePercent:
          form.payoutModelChoice === "fixed_only" ? null : form.defaultRevenueSharePercent,
        minVramGb: form.minVramGb || null,
      };

      const res = await fetch("/api/admin/providers/gpu-types", {
        method: gpuType ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gpuType ? { ...data, id: gpuType.id } : data),
      });

      if (res.ok) {
        onSave();
      } else {
        const result = await res.json();
        console.error("GPU Type save error:", result);
        const errorMsg = result.details
          ? `${result.error}: ${JSON.stringify(result.details)}`
          : result.error || "Failed to save GPU type";
        alert(errorMsg);
      }
    } catch (err) {
      console.error("Save GPU type error:", err);
      alert("Failed to save GPU type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-[#0b0f1c] mb-4">
          {gpuType ? "Edit GPU Type" : "Add GPU Type"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#5b6476] mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="NVIDIA H100 80GB"
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">Short Name</label>
              <input
                type="text"
                value={form.shortName}
                onChange={(e) => setForm({ ...form, shortName: e.target.value })}
                required
                placeholder="H100"
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">Manufacturer</label>
              <select
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              >
                <option value="NVIDIA">NVIDIA</option>
                <option value="AMD">AMD</option>
                <option value="Intel">Intel</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#5b6476] mb-1">
              Match Patterns (comma-separated)
            </label>
            <input
              type="text"
              value={form.matchPatterns}
              onChange={(e) => setForm({ ...form, matchPatterns: e.target.value })}
              required
              placeholder="H100, A100"
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
            />
            <p className="text-xs text-[#5b6476] mt-1">
              Used to match GPU names from validation
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">
                Provider Rate ($/hr)
              </label>
              <input
                type="number"
                value={(form.defaultProviderRateCents / 100).toFixed(2)}
                onChange={(e) =>
                  setForm({ ...form, defaultProviderRateCents: Math.round(parseFloat(e.target.value) * 100) })
                }
                step="0.01"
                min="0"
                required
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">
                Customer Rate ($/hr)
              </label>
              <input
                type="number"
                value={(form.defaultCustomerRateCents / 100).toFixed(2)}
                onChange={(e) =>
                  setForm({ ...form, defaultCustomerRateCents: Math.round(parseFloat(e.target.value) * 100) })
                }
                step="0.01"
                min="0"
                required
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#5b6476] mb-1">
              Payout Model Option
            </label>
            <select
              value={form.payoutModelChoice}
              onChange={(e) => setForm({ ...form, payoutModelChoice: e.target.value })}
              className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
            >
              <option value="fixed_only">Fixed Rate Only (providers must use $/hr)</option>
              <option value="revenue_share_only">Revenue Share Only (providers must use %)</option>
              <option value="provider_choice">Provider Choice (let provider decide)</option>
            </select>
          </div>

          {form.payoutModelChoice !== "fixed_only" && (
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">
                Default Revenue Share %
              </label>
              <input
                type="number"
                value={form.defaultRevenueSharePercent}
                onChange={(e) =>
                  setForm({ ...form, defaultRevenueSharePercent: parseInt(e.target.value) })
                }
                min="0"
                max="100"
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
              <p className="text-xs text-[#5b6476] mt-1">
                Percentage of revenue paid to provider
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">Min VRAM (GB)</label>
              <input
                type="number"
                value={form.minVramGb}
                onChange={(e) => setForm({ ...form, minVramGb: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#5b6476] mb-1">Display Order</label>
              <input
                type="number"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                min="0"
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#e4e7ef] rounded-lg text-[#5b6476] hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1238c9] disabled:opacity-50"
            >
              {saving ? "Saving..." : gpuType ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
