"use client";

import { useState, useEffect } from "react";
import {
  Cloud,
  Download,
  RefreshCw,
  Check,
  X,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Globe,
  DollarSign,
  Cpu,
  Info,
} from "lucide-react";

interface SkyPilotGpuEntry {
  id: string;
  instanceType: string;
  acceleratorName: string;
  acceleratorCount: number;
  vCPUs: number;
  memoryGiB: number;
  pricePerHour: number;
  region: string;
  vramGb: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SkyPilotConfig {
  apiEndpoint: string;
  defaultRegion: string;
  enabledRegions: string[];
  catalogLastGenerated: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const AVAILABLE_REGIONS = [
  { id: "eu-north-1", name: "Europe (North)", location: "Stockholm" },
  { id: "us-east-1", name: "US East", location: "Virginia" },
  { id: "us-west-1", name: "US West", location: "California" },
  { id: "ap-southeast-1", name: "Asia Pacific", location: "Singapore" },
];

const GPU_TYPES = [
  { name: "NVIDIA H100 80GB HBM3", shortName: "H100", vram: 80 },
  { name: "NVIDIA H200", shortName: "H200", vram: 141 },
  { name: "NVIDIA B200", shortName: "B200", vram: 180 },
  { name: "NVIDIA A100 80GB", shortName: "A100-80GB", vram: 80 },
  { name: "NVIDIA A100 40GB", shortName: "A100-40GB", vram: 40 },
  { name: "NVIDIA RTX 4090", shortName: "RTX4090", vram: 24 },
  { name: "NVIDIA RTX 5090", shortName: "RTX5090", vram: 32 },
  { name: "NVIDIA RTX 6000 Ada 48GB", shortName: "RTX6000-Ada", vram: 48 },
  { name: "NVIDIA RTX 6000 Pro 96GB", shortName: "RTX6000-Pro", vram: 96 },
  { name: "NVIDIA L40S", shortName: "L40S", vram: 48 },
  { name: "NVIDIA L40", shortName: "L40", vram: 48 },
  { name: "NVIDIA A6000", shortName: "A6000", vram: 48 },
  { name: "NVIDIA RTX 3090", shortName: "RTX3090", vram: 24 },
];

export function SkyPilotTab() {
  const [entries, setEntries] = useState<SkyPilotGpuEntry[]>([]);
  const [config, setConfig] = useState<SkyPilotConfig>({
    apiEndpoint: "https://your-domain.com",
    defaultRegion: "eu-north-1",
    enabledRegions: ["eu-north-1"],
    catalogLastGenerated: null,
    updatedAt: null,
    updatedBy: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    acceleratorName: "",
    acceleratorCount: 1,
    vCPUs: 32,
    memoryGiB: 128,
    pricePerHour: "",
    region: "eu-north-1",
    vramGb: "",
    active: true,
  });

  // Load data
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/skypilot");
      const data = await res.json();

      if (data.success) {
        setEntries(data.data.entries || []);
        if (data.data.config) {
          setConfig(data.data.config);
        }
      }
    } catch (error) {
      console.error("Failed to load SkyPilot data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setFormData({
      acceleratorName: "",
      acceleratorCount: 1,
      vCPUs: 32,
      memoryGiB: 128,
      pricePerHour: "",
      region: config.defaultRegion || "eu-north-1",
      vramGb: "",
      active: true,
    });
  };

  const openEditModal = (entry: SkyPilotGpuEntry) => {
    setFormData({
      acceleratorName: entry.acceleratorName,
      acceleratorCount: entry.acceleratorCount,
      vCPUs: entry.vCPUs,
      memoryGiB: entry.memoryGiB,
      pricePerHour: entry.pricePerHour.toFixed(2),
      region: entry.region,
      vramGb: entry.vramGb?.toString() || "",
      active: entry.active,
    });
    setEditingId(entry.id);
    setShowCreateModal(true);
  };

  // Generate instance type from GPU name and count
  const generateInstanceType = (gpuName: string, count: number) => {
    const gpuType = GPU_TYPES.find(
      (g) => g.name === gpuName || g.shortName === gpuName
    );
    const shortName = gpuType?.shortName || gpuName.toLowerCase().replace(/\s+/g, "-");
    return `packet-${shortName.toLowerCase()}-${count}x`;
  };

  const handleSave = async () => {
    if (!formData.acceleratorName || !formData.pricePerHour) {
      alert("GPU type and price are required");
      return;
    }

    setSaving(true);
    try {
      const instanceType = generateInstanceType(
        formData.acceleratorName,
        formData.acceleratorCount
      );

      const payload = {
        action: editingId ? "updateEntry" : "createEntry",
        id: editingId,
        instanceType,
        acceleratorName: formData.acceleratorName,
        acceleratorCount: formData.acceleratorCount,
        vCPUs: formData.vCPUs,
        memoryGiB: formData.memoryGiB,
        pricePerHour: parseFloat(formData.pricePerHour),
        region: formData.region,
        vramGb: formData.vramGb ? parseInt(formData.vramGb) : null,
        active: formData.active,
      };

      const res = await fetch("/api/admin/skypilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        setEditingId(null);
        resetForm();
        loadData();
      } else {
        alert(data.error || "Failed to save entry");
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this catalog entry?")) return;

    try {
      const res = await fetch("/api/admin/skypilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteEntry", id }),
      });

      const data = await res.json();
      if (data.success) {
        loadData();
      } else {
        alert(data.error || "Failed to delete entry");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete entry");
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/skypilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateConfig",
          config: {
            apiEndpoint: config.apiEndpoint,
            defaultRegion: config.defaultRegion,
            enabledRegions: config.enabledRegions,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setConfig(data.data.config);
      } else {
        alert(data.error || "Failed to save config");
      }
    } catch (error) {
      console.error("Save config error:", error);
      alert("Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateCatalog = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/skypilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generateCatalog" }),
      });

      const data = await res.json();
      if (data.success && data.data.csv) {
        // Download CSV file
        const blob = new Blob([data.data.csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "packet_vms.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        // Reload to update last generated timestamp
        loadData();
      } else {
        alert(data.error || "Failed to generate catalog");
      }
    } catch (error) {
      console.error("Generate catalog error:", error);
      alert("Failed to generate catalog");
    } finally {
      setGenerating(false);
    }
  };

  const handleSyncFromProducts = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/admin/skypilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncFromProducts" }),
      });

      const data = await res.json();
      if (data.success) {
        setSyncMessage(data.data.message);
        setEntries(data.data.entries || []);
        // Clear message after 5 seconds
        setTimeout(() => setSyncMessage(null), 5000);
      } else {
        alert(data.error || "Failed to sync from products");
      }
    } catch (error) {
      console.error("Sync error:", error);
      alert("Failed to sync from products");
    } finally {
      setSyncing(false);
    }
  };

  const toggleRegion = (regionId: string) => {
    setConfig((prev) => ({
      ...prev,
      enabledRegions: prev.enabledRegions.includes(regionId)
        ? prev.enabledRegions.filter((r) => r !== regionId)
        : [...prev.enabledRegions, regionId],
    }));
  };

  const handleGpuTypeSelect = (gpuName: string) => {
    const gpuType = GPU_TYPES.find((g) => g.name === gpuName);
    setFormData((prev) => ({
      ...prev,
      acceleratorName: gpuName,
      vramGb: gpuType?.vram?.toString() || prev.vramGb,
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[#1a4fff]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0b0f1c]">
            SkyPilot Integration
          </h2>
          <p className="text-sm text-[#5b6476]">
            Configure GPU pricing and regions for SkyPilot cloud provider integration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSyncFromProducts}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 border border-[#e4e7ef] rounded-lg hover:bg-[#f7f8fb] transition-colors disabled:opacity-50"
            title="Import GPU catalog entries from GPU Products"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Sync from Products
          </button>
          <button
            onClick={handleGenerateCatalog}
            disabled={generating || entries.length === 0}
            className="flex items-center gap-2 px-4 py-2 border border-[#e4e7ef] rounded-lg hover:bg-[#f7f8fb] transition-colors disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Export Catalog CSV
          </button>
          <button
            onClick={() => {
              resetForm();
              setEditingId(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add GPU Entry
          </button>
        </div>
      </div>

      {/* Sync Success Message */}
      {syncMessage && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-800 font-medium">{syncMessage}</span>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">About SkyPilot Integration</p>
          <p>
            SkyPilot is an open-source framework for running ML workloads on any cloud.
            Configure your GPU pricing here to generate the catalog CSV file that SkyPilot
            uses to find and launch GPU Cloud GPUs. The catalog format follows SkyPilot&apos;s
            standard VM catalog schema.
          </p>
          <p className="mt-2">
            <strong>Tip:</strong> Click &quot;Sync from Products&quot; to automatically import entries from your GPU Products.
          </p>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#f7f8fb] rounded-lg">
            <Globe className="w-6 h-6 text-[#1a4fff]" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[#0b0f1c] mb-1">
              Region Configuration
            </h3>
            <p className="text-sm text-[#5b6476] mb-4">
              Select which regions are available for SkyPilot deployments
            </p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              {AVAILABLE_REGIONS.map((region) => (
                <label
                  key={region.id}
                  className="flex items-center gap-3 p-3 border border-[#e4e7ef] rounded-lg cursor-pointer hover:bg-[#f7f8fb]"
                >
                  <input
                    type="checkbox"
                    checked={config.enabledRegions.includes(region.id)}
                    onChange={() => toggleRegion(region.id)}
                    className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                  />
                  <div>
                    <span className="text-sm font-medium text-[#0b0f1c]">
                      {region.name}
                    </span>
                    <span className="text-xs text-[#5b6476] ml-2">
                      ({region.location})
                    </span>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 max-w-xs">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Default Region
                </label>
                <select
                  value={config.defaultRegion}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, defaultRegion: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                >
                  {config.enabledRegions.map((regionId) => {
                    const region = AVAILABLE_REGIONS.find((r) => r.id === regionId);
                    return (
                      <option key={regionId} value={regionId}>
                        {region?.name || regionId}
                      </option>
                    );
                  })}
                </select>
              </div>
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors disabled:opacity-50 mt-6"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Config
              </button>
            </div>

            {config.catalogLastGenerated && (
              <p className="text-xs text-[#5b6476] mt-4">
                Catalog last generated:{" "}
                {new Date(config.catalogLastGenerated).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* GPU Catalog Entries */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#e4e7ef] bg-[#f7f8fb]">
          <h3 className="text-sm font-semibold text-[#0b0f1c]">
            GPU Catalog Entries
          </h3>
          <p className="text-xs text-[#5b6476]">
            Define GPU types and pricing for the SkyPilot catalog
          </p>
        </div>

        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Instance Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                GPU
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Specs
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Region
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Price/Hour
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[#5b6476] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                  No GPU entries yet. Click &quot;Add GPU Entry&quot; to create one.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-[#f7f8fb]/50">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-[#0b0f1c]">
                      {entry.instanceType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-[#5b6476]" />
                      <span className="text-sm font-medium text-[#0b0f1c]">
                        {entry.acceleratorName}
                      </span>
                      <span className="text-xs text-[#5b6476]">
                        x{entry.acceleratorCount}
                      </span>
                    </div>
                    {entry.vramGb && (
                      <span className="text-xs text-[#5b6476]">
                        {entry.vramGb}GB VRAM
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {entry.vCPUs} vCPUs / {entry.memoryGiB}GB RAM
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[#0b0f1c]">{entry.region}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[#0b0f1c]">
                      ${entry.pricePerHour.toFixed(2)}/hr
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
                        entry.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {entry.active ? (
                        <>
                          <Check className="w-3 h-3" /> Active
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3" /> Inactive
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditModal(entry)}
                        className="p-1.5 text-[#5b6476] hover:text-[#1a4fff] hover:bg-[#1a4fff]/10 rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="p-1.5 text-[#5b6476] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-[#e4e7ef]">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">
                {editingId ? "Edit GPU Entry" : "Add GPU Entry"}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              {/* GPU Type */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  GPU Type *
                </label>
                <select
                  value={formData.acceleratorName}
                  onChange={(e) => handleGpuTypeSelect(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                >
                  <option value="">Select GPU type...</option>
                  {GPU_TYPES.map((gpu) => (
                    <option key={gpu.name} value={gpu.name}>
                      {gpu.name} ({gpu.vram}GB VRAM)
                    </option>
                  ))}
                </select>
              </div>

              {/* GPU Count and Price */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    GPU Count *
                  </label>
                  <select
                    value={formData.acceleratorCount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        acceleratorCount: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  >
                    {[1, 2, 4, 8].map((count) => (
                      <option key={count} value={count}>
                        {count}x GPU
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    Price per Hour ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.pricePerHour}
                    onChange={(e) =>
                      setFormData({ ...formData, pricePerHour: e.target.value })
                    }
                    placeholder="e.g., 2.50"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
              </div>

              {/* vCPUs and Memory */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    vCPUs
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.vCPUs}
                    onChange={(e) =>
                      setFormData({ ...formData, vCPUs: parseInt(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                    Memory (GiB)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.memoryGiB}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        memoryGiB: parseInt(e.target.value) || 1,
                      })
                    }
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Region
                </label>
                <select
                  value={formData.region}
                  onChange={(e) =>
                    setFormData({ ...formData, region: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                >
                  {AVAILABLE_REGIONS.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name} ({region.location})
                    </option>
                  ))}
                </select>
              </div>

              {/* Active Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) =>
                    setFormData({ ...formData, active: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
                />
                <span className="text-sm text-[#0b0f1c]">Active in catalog</span>
              </label>

              {/* Preview */}
              {formData.acceleratorName && (
                <div className="bg-[#f7f8fb] rounded-lg p-3">
                  <p className="text-xs font-medium text-[#5b6476] mb-1">
                    Instance Type Preview
                  </p>
                  <p className="font-mono text-sm text-[#0b0f1c]">
                    {generateInstanceType(
                      formData.acceleratorName,
                      formData.acceleratorCount
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-[#e4e7ef] flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingId(null);
                  resetForm();
                }}
                className="px-4 py-2 text-[#5b6476] hover:bg-[#f7f8fb] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a4fff] text-white rounded-lg hover:bg-[#1a4fff]/90 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? "Save Changes" : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
