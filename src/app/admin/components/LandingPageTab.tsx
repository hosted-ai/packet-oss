"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import type {
  GpuOfferingsData,
  GpuOffering,
  GpuOfferingFormData,
  ProofSection,
  CarouselSettings,
} from "../types";
import { Plus, Edit2, Trash2, Eye, EyeOff, Settings, ArrowUp, ArrowDown } from "lucide-react";
import { GpuOfferingModal } from "./landing-page/GpuOfferingModal";
import { SettingsModal } from "./landing-page/SettingsModal";

const EMPTY_FORM: GpuOfferingFormData = {
  name: "",
  fullName: "",
  image: "",
  hourlyPrice: 0,
  memory: "",
  hero: {
    pill: "Available now",
    headline: "",
    subhead: "",
    description: "",
    hourlyNote: "",
    monthlyNote: "",
    signals: [],
  },
  pricing: {
    title: "",
    subtitle: "",
    features: [],
  },
  location: "",
  sortOrder: 0,
  active: true,
  soldOut: false,
  popular: false,
};

export function LandingPageTab() {
  const [data, setData] = useState<GpuOfferingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingOffering, setEditingOffering] = useState<GpuOffering | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [form, setForm] = useState<GpuOfferingFormData>(EMPTY_FORM);

  // Proof section editing
  const [proofSection, setProofSection] = useState<ProofSection>({ stats: [] });
  const [carouselSettings, setCarouselSettings] = useState<CarouselSettings>({
    autoRotateMs: 5000,
    pauseOnHover: true,
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gpu-offerings");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setProofSection(json.proofSection);
        setCarouselSettings(json.carouselSettings);
      }
    } catch (error) {
      console.error("Failed to load GPU offerings:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openModal = (offering?: GpuOffering) => {
    if (offering) {
      setEditingOffering(offering);
      setForm({
        name: offering.name,
        fullName: offering.fullName,
        image: offering.image,
        hourlyPrice: offering.hourlyPrice,
        memory: offering.memory,
        hero: { ...offering.hero },
        pricing: { ...offering.pricing },
        location: offering.location,
        sortOrder: offering.sortOrder,
        active: offering.active,
        soldOut: !!offering.soldOut,
        popular: !!offering.popular,
      });
    } else {
      setEditingOffering(null);
      setForm(EMPTY_FORM);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingOffering(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name || !form.fullName || !form.hourlyPrice) {
      alert("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      const method = editingOffering ? "PUT" : "POST";
      const body = editingOffering
        ? { id: editingOffering.id, ...form }
        : form;

      const res = await fetch("/api/admin/gpu-offerings", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        closeModal();
        loadData();
      } else {
        alert(json.error || "Failed to save");
      }
    } catch (error) {
      console.error("Failed to save:", error);
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this GPU offering?")) return;

    try {
      const res = await fetch("/api/admin/gpu-offerings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        loadData();
      } else {
        const json = await res.json();
        alert(json.error || "Failed to delete");
      }
    } catch (error) {
      console.error("Failed to delete:", error);
      alert("Failed to delete");
    }
  };

  const handleToggleActive = async (offering: GpuOffering) => {
    try {
      const res = await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: offering.id, active: !offering.active }),
      });

      if (res.ok) {
        loadData();
      }
    } catch (error) {
      console.error("Failed to toggle active:", error);
    }
  };

  const handleMoveUp = async (offering: GpuOffering) => {
    if (!data?.offerings) return;
    const sortedOfferings = [...data.offerings].sort((a, b) => a.sortOrder - b.sortOrder);
    const currentIndex = sortedOfferings.findIndex((o) => o.id === offering.id);
    if (currentIndex <= 0) return;

    const aboveOffering = sortedOfferings[currentIndex - 1];

    // Swap sort orders
    try {
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: offering.id, sortOrder: aboveOffering.sortOrder }),
      });
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: aboveOffering.id, sortOrder: offering.sortOrder }),
      });
      loadData();
    } catch (error) {
      console.error("Failed to reorder:", error);
    }
  };

  const handleMoveDown = async (offering: GpuOffering) => {
    if (!data?.offerings) return;
    const sortedOfferings = [...data.offerings].sort((a, b) => a.sortOrder - b.sortOrder);
    const currentIndex = sortedOfferings.findIndex((o) => o.id === offering.id);
    if (currentIndex >= sortedOfferings.length - 1) return;

    const belowOffering = sortedOfferings[currentIndex + 1];

    // Swap sort orders
    try {
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: offering.id, sortOrder: belowOffering.sortOrder }),
      });
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: belowOffering.id, sortOrder: offering.sortOrder }),
      });
      loadData();
    } catch (error) {
      console.error("Failed to reorder:", error);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      // Save proof section
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateType: "proofSection", proofSection }),
      });

      // Save carousel settings
      await fetch("/api/admin/gpu-offerings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateType: "carouselSettings", carouselSettings }),
      });

      setShowSettingsModal(false);
      loadData();
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[#5b6476]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-[#0b0f1c]">Landing Page Carousel</h3>
          <p className="text-sm text-[#5b6476]">
            Manage GPU offerings displayed on the homepage carousel
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded-lg font-medium text-sm flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={() => openModal()}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add GPU
          </button>
        </div>
      </div>

      {/* Offerings Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-center px-2 py-3 text-sm font-medium text-[#5b6476] w-20">Order</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">GPU</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Price</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Location</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Status</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {!data?.offerings?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#5b6476]">
                  No GPU offerings yet. Click &quot;Add GPU&quot; to create one.
                </td>
              </tr>
            ) : (
              [...data.offerings].sort((a, b) => a.sortOrder - b.sortOrder).map((offering, index, sortedArray) => (
                <tr key={offering.id} className={`hover:bg-gray-50 ${!offering.active ? "opacity-50" : ""}`}>
                  <td className="px-2 py-3">
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => handleMoveUp(offering)}
                        disabled={index === 0}
                        className={`p-1 rounded ${index === 0 ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-100"}`}
                        title="Move up"
                      >
                        <ArrowUp className="w-4 h-4 text-[#5b6476]" />
                      </button>
                      <span className="text-xs font-medium text-[#5b6476] w-6 text-center">{index + 1}</span>
                      <button
                        onClick={() => handleMoveDown(offering)}
                        disabled={index === sortedArray.length - 1}
                        className={`p-1 rounded ${index === sortedArray.length - 1 ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-100"}`}
                        title="Move down"
                      >
                        <ArrowDown className="w-4 h-4 text-[#5b6476]" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {offering.image && (
                        <div className="w-12 h-12 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                          <Image
                            src={offering.image}
                            alt={offering.name}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-[#0b0f1c]">{offering.name}</p>
                        <p className="text-sm text-[#5b6476]">{offering.memory}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[#0b0f1c] font-medium">${offering.hourlyPrice}/hr</p>
                    <p className="text-sm text-[#5b6476]">${(offering.hourlyPrice * 730).toFixed(2)}/mo</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#0b0f1c]">{offering.location}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        offering.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-[#5b6476]"
                      }`}
                    >
                      {offering.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleToggleActive(offering)}
                        className="p-1.5 hover:bg-gray-100 rounded"
                        title={offering.active ? "Hide" : "Show"}
                      >
                        {offering.active ? (
                          <EyeOff className="w-4 h-4 text-[#5b6476]" />
                        ) : (
                          <Eye className="w-4 h-4 text-[#5b6476]" />
                        )}
                      </button>
                      <button
                        onClick={() => openModal(offering)}
                        className="p-1.5 hover:bg-gray-100 rounded"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4 text-[#5b6476]" />
                      </button>
                      <button
                        onClick={() => handleDelete(offering.id)}
                        className="p-1.5 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Proof Section Preview */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h4 className="text-sm font-medium text-[#0b0f1c] mb-4">Proof Section Stats</h4>
        <div className="grid grid-cols-4 gap-4">
          {data?.proofSection?.stats?.map((stat, i) => (
            <div key={i} className="bg-[#f7f8fb] rounded-lg p-4">
              <p className="text-2xl font-bold text-[#0b0f1c]">{stat.value}</p>
              <p className="text-sm text-[#5b6476]">{stat.label}</p>
              <p className="text-xs text-[#8b95a8]">{stat.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {showModal && (
        <GpuOfferingModal
          editingOffering={editingOffering}
          form={form}
          setForm={setForm}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          proofSection={proofSection}
          setProofSection={setProofSection}
          carouselSettings={carouselSettings}
          setCarouselSettings={setCarouselSettings}
          onClose={() => setShowSettingsModal(false)}
          onSave={saveSettings}
          saving={saving}
        />
      )}
    </div>
  );
}
