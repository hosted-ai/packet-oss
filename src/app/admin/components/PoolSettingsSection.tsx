"use client";

import { useState, useEffect } from "react";
import type { PoolSettingsDefaults, PoolSettingsOverride, AvailablePool } from "../types";

interface PoolSettingsData {
  defaults: PoolSettingsDefaults;
  overrides: PoolSettingsOverride[];
  availablePools: AvailablePool[];
}

export function PoolSettingsSection() {
  const [data, setData] = useState<PoolSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default settings form
  const [defaultsForm, setDefaultsForm] = useState({
    timeQuantumSec: "90",
    overcommitRatio: "1.0",
    securityMode: "low",
  });

  // Override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [editingOverride, setEditingOverride] = useState<PoolSettingsOverride | null>(null);
  const [overrideForm, setOverrideForm] = useState({
    gpuaasPoolId: "",
    poolName: "",
    timeQuantumSec: "",
    overcommitRatio: "",
    securityMode: "",
    priority: "",
    maintenance: false,
    notes: "",
  });

  // Fetch pool settings
  useEffect(() => {
    fetchPoolSettings();
  }, []);

  const fetchPoolSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/pool-settings");
      if (!res.ok) throw new Error("Failed to fetch pool settings");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setDefaultsForm({
          timeQuantumSec: String(json.data.defaults.timeQuantumSec),
          overcommitRatio: String(json.data.defaults.overcommitRatio),
          securityMode: json.data.defaults.securityMode,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pool settings");
    } finally {
      setLoading(false);
    }
  };

  // Save default settings
  const handleSaveDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/pool-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeQuantumSec: parseInt(defaultsForm.timeQuantumSec),
          overcommitRatio: parseInt(defaultsForm.overcommitRatio),
          securityMode: defaultsForm.securityMode,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to save defaults");
      }

      await fetchPoolSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save defaults");
    } finally {
      setSaving(false);
    }
  };

  // Open override modal for new or edit
  const openOverrideModal = (override?: PoolSettingsOverride) => {
    if (override) {
      setEditingOverride(override);
      setOverrideForm({
        gpuaasPoolId: String(override.gpuaasPoolId),
        poolName: override.poolName || "",
        timeQuantumSec: override.timeQuantumSec !== null ? String(override.timeQuantumSec) : "",
        overcommitRatio: override.overcommitRatio !== null ? String(override.overcommitRatio) : "",
        securityMode: override.securityMode || "",
        priority: override.priority !== null ? String(override.priority) : "",
        maintenance: override.maintenance || false,
        notes: override.notes || "",
      });
    } else {
      setEditingOverride(null);
      setOverrideForm({
        gpuaasPoolId: "",
        poolName: "",
        timeQuantumSec: "",
        overcommitRatio: "",
        securityMode: "",
        priority: "",
        maintenance: false,
        notes: "",
      });
    }
    setShowOverrideModal(true);
  };

  // Save override (create or update)
  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {};

      if (!editingOverride) {
        body.gpuaasPoolId = parseInt(overrideForm.gpuaasPoolId);
      }

      if (overrideForm.poolName) body.poolName = overrideForm.poolName;
      if (overrideForm.timeQuantumSec) body.timeQuantumSec = parseInt(overrideForm.timeQuantumSec);
      if (overrideForm.overcommitRatio) body.overcommitRatio = parseInt(overrideForm.overcommitRatio);
      if (overrideForm.securityMode) body.securityMode = overrideForm.securityMode;
      if (overrideForm.priority) body.priority = parseInt(overrideForm.priority);
      body.maintenance = overrideForm.maintenance;
      if (overrideForm.notes) body.notes = overrideForm.notes;

      const url = editingOverride
        ? `/api/admin/pool-settings/${editingOverride.id}`
        : "/api/admin/pool-settings";

      const res = await fetch(url, {
        method: editingOverride ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to save override");
      }

      setShowOverrideModal(false);
      await fetchPoolSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setSaving(false);
    }
  };

  // Delete override
  const handleDeleteOverride = async (id: string) => {
    if (!confirm("Are you sure you want to delete this override?")) return;

    try {
      const res = await fetch(`/api/admin/pool-settings/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to delete override");
      }

      await fetchPoolSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete override");
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-10 bg-gray-200 rounded"></div>
            <div className="h-10 bg-gray-200 rounded"></div>
            <div className="h-10 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Default Pool Settings */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-2 text-[#0b0f1c]">Default Pool Settings</h3>
        <p className="text-sm text-[#5b6476] mb-6">
          These defaults are applied when creating new GPU pools. Individual pools can override these settings below.
        </p>

        <form onSubmit={handleSaveDefaults} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Time Quantum</label>
              <div className="relative">
                <input
                  type="number"
                  min="10"
                  max="300"
                  step="10"
                  value={defaultsForm.timeQuantumSec}
                  onChange={(e) => setDefaultsForm({ ...defaultsForm, timeQuantumSec: e.target.value })}
                  className="w-full pl-4 pr-12 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5b6476] text-xs">sec</span>
              </div>
              <p className="text-xs text-[#5b6476] mt-1">GPU time-slice rotation (10-300s)</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Overcommit Ratio</label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={defaultsForm.overcommitRatio}
                  onChange={(e) => setDefaultsForm({ ...defaultsForm, overcommitRatio: e.target.value })}
                  className="w-full pl-4 pr-8 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5b6476] text-xs">x</span>
              </div>
              <p className="text-xs text-[#5b6476] mt-1">GPU memory oversubscription (1-10x)</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Security Mode</label>
              <select
                value={defaultsForm.securityMode}
                onChange={(e) => setDefaultsForm({ ...defaultsForm, securityMode: e.target.value })}
                className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
              >
                <option value="low">Low (Basic isolation)</option>
                <option value="medium">Medium (Namespace isolation)</option>
                <option value="high">High (Full isolation)</option>
              </select>
              <p className="text-xs text-[#5b6476] mt-1">Pod isolation level</p>
            </div>
          </div>

          {data?.defaults?.updatedAt && (
            <p className="text-xs text-[#5b6476]">
              Last updated: {new Date(data.defaults.updatedAt).toLocaleString()}
              {data.defaults.updatedBy && ` by ${data.defaults.updatedBy}`}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Defaults"}
            </button>
          </div>
        </form>
      </div>

      {/* Pool-Specific Overrides */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[#0b0f1c]">Pool-Specific Overrides</h3>
            <p className="text-sm text-[#5b6476]">
              Override settings for individual pools. Leave fields empty to use defaults.
            </p>
          </div>
          <button
            onClick={() => openOverrideModal()}
            className="px-4 py-2 bg-[#0b0f1c] hover:bg-[#1a1f2e] text-white rounded-lg font-medium text-sm"
          >
            + Add Override
          </button>
        </div>

        {data?.overrides && data.overrides.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e4e7ef]">
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Pool</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Time Quantum</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Overcommit</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Security</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Priority</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Status</th>
                  <th className="text-left py-3 px-2 text-[#5b6476] font-medium">Notes</th>
                  <th className="text-right py-3 px-2 text-[#5b6476] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.overrides.map((override) => (
                  <tr key={override.id} className="border-b border-[#e4e7ef] hover:bg-gray-50">
                    <td className="py-3 px-2">
                      <div className="font-medium text-[#0b0f1c]">
                        {override.poolName || `Pool ${override.gpuaasPoolId}`}
                      </div>
                      {override.node && (
                        <div className="text-xs text-[#5b6476]">
                          {override.node.hostname} ({override.node.gpuModel})
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2 text-[#0b0f1c]">
                      {override.timeQuantumSec !== null ? `${override.timeQuantumSec}s` : <span className="text-[#5b6476] italic">default</span>}
                    </td>
                    <td className="py-3 px-2 text-[#0b0f1c]">
                      {override.overcommitRatio !== null ? `${override.overcommitRatio}x` : <span className="text-[#5b6476] italic">default</span>}
                    </td>
                    <td className="py-3 px-2 text-[#0b0f1c]">
                      {override.securityMode || <span className="text-[#5b6476] italic">default</span>}
                    </td>
                    <td className="py-3 px-2 text-[#0b0f1c]">
                      {override.priority != null ? override.priority : <span className="text-[#5b6476] italic">-</span>}
                    </td>
                    <td className="py-3 px-2">
                      {override.maintenance ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          Maintenance
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-[#5b6476] max-w-[200px] truncate">
                      {override.notes || "-"}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <button
                        onClick={() => openOverrideModal(override)}
                        className="text-[#1a4fff] hover:text-[#1238c9] mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteOverride(override.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-[#5b6476]">
            <p>No pool-specific overrides configured.</p>
            <p className="text-sm mt-1">All pools will use the default settings above.</p>
          </div>
        )}
      </div>

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4 text-[#0b0f1c]">
              {editingOverride ? "Edit Pool Override" : "Add Pool Override"}
            </h3>

            <form onSubmit={handleSaveOverride} className="space-y-4">
              {!editingOverride && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Pool</label>
                  <select
                    value={overrideForm.gpuaasPoolId}
                    onChange={(e) => setOverrideForm({ ...overrideForm, gpuaasPoolId: e.target.value })}
                    required
                    className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  >
                    <option value="">Select a pool...</option>
                    {data?.availablePools
                      .filter((p) => !p.hasOverride)
                      .map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.name} (ID: {pool.id}) {pool.gpuModel && `- ${pool.gpuModel}`}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Display Name (optional)</label>
                <input
                  type="text"
                  value={overrideForm.poolName}
                  onChange={(e) => setOverrideForm({ ...overrideForm, poolName: e.target.value })}
                  placeholder="Custom pool name"
                  className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Time Quantum</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="10"
                      max="300"
                      step="10"
                      value={overrideForm.timeQuantumSec}
                      onChange={(e) => setOverrideForm({ ...overrideForm, timeQuantumSec: e.target.value })}
                      placeholder="Use default"
                      className="w-full pl-4 pr-12 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5b6476] text-xs">sec</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Overcommit</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="1"
                      value={overrideForm.overcommitRatio}
                      onChange={(e) => setOverrideForm({ ...overrideForm, overcommitRatio: e.target.value })}
                      placeholder="Use default"
                      className="w-full pl-4 pr-8 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5b6476] text-xs">x</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Security Mode</label>
                <select
                  value={overrideForm.securityMode}
                  onChange={(e) => setOverrideForm({ ...overrideForm, securityMode: e.target.value })}
                  className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                >
                  <option value="">Use default</option>
                  <option value="low">Low (Basic isolation)</option>
                  <option value="medium">Medium (Namespace isolation)</option>
                  <option value="high">High (Full isolation)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Priority</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={overrideForm.priority}
                  onChange={(e) => setOverrideForm({ ...overrideForm, priority: e.target.value })}
                  placeholder="0"
                  className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <p className="text-xs text-[#5b6476] mt-1">Higher = fill first. 0 = no preference.</p>
              </div>

              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={overrideForm.maintenance}
                      onChange={(e) => setOverrideForm({ ...overrideForm, maintenance: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-200 rounded-full peer-checked:bg-orange-500 transition-colors"></div>
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"></div>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-[#0b0f1c]">Maintenance Mode</span>
                    <p className="text-xs text-[#5b6476]">No new pods will be placed on this pool. Existing pods stay active.</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Notes</label>
                <textarea
                  value={overrideForm.notes}
                  onChange={(e) => setOverrideForm({ ...overrideForm, notes: e.target.value })}
                  placeholder="Optional notes about this override"
                  rows={2}
                  className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 border border-[#e4e7ef] text-[#5b6476] rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingOverride ? "Update Override" : "Create Override"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
