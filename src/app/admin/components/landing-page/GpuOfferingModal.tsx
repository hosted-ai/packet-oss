"use client";

import Image from "next/image";
import { useState } from "react";
import { X, Upload } from "lucide-react";
import type { GpuOffering, GpuOfferingFormData } from "../../types";

interface GpuOfferingModalProps {
  editingOffering: GpuOffering | null;
  form: GpuOfferingFormData;
  setForm: React.Dispatch<React.SetStateAction<GpuOfferingFormData>>;
  onClose: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function GpuOfferingModal({
  editingOffering,
  form,
  setForm,
  onClose,
  onSave,
  saving,
}: GpuOfferingModalProps) {
  const [imageUploading, setImageUploading] = useState(false);
  const [newSignal, setNewSignal] = useState("");
  const [newFeature, setNewFeature] = useState("");

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      if (editingOffering?.id) {
        formData.append("gpuId", editingOffering.id);
      }

      const res = await fetch("/api/admin/gpu-offerings/upload-image", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (json.success && json.imageUrl) {
        setForm((prev) => ({ ...prev, image: json.imageUrl }));
      } else {
        alert(json.error || "Failed to upload image");
      }
    } catch (error) {
      console.error("Failed to upload image:", error);
      alert("Failed to upload image");
    } finally {
      setImageUploading(false);
    }
  };

  const addSignal = () => {
    if (newSignal.trim()) {
      setForm((prev) => ({
        ...prev,
        hero: {
          ...prev.hero,
          signals: [...prev.hero.signals, newSignal.trim()],
        },
      }));
      setNewSignal("");
    }
  };

  const removeSignal = (index: number) => {
    setForm((prev) => ({
      ...prev,
      hero: {
        ...prev.hero,
        signals: prev.hero.signals.filter((_, i) => i !== index),
      },
    }));
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setForm((prev) => ({
        ...prev,
        pricing: {
          ...prev.pricing,
          features: [...prev.pricing.features, newFeature.trim()],
        },
      }));
      setNewFeature("");
    }
  };

  const removeFeature = (index: number) => {
    setForm((prev) => ({
      ...prev,
      pricing: {
        ...prev.pricing,
        features: prev.pricing.features.filter((_, i) => i !== index),
      },
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#e4e7ef] px-6 py-4 flex justify-between items-center">
          <h3 className="text-lg font-medium text-[#0b0f1c]">
            {editingOffering ? "Edit GPU Offering" : "Add GPU Offering"}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[#0b0f1c] border-b pb-2">Basic Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Short Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., B200"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="e.g., NVIDIA B200s"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Hourly Price ($) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.hourlyPrice}
                  onChange={(e) => setForm({ ...form, hourlyPrice: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Memory</label>
                <input
                  type="text"
                  value={form.memory}
                  onChange={(e) => setForm({ ...form, memory: e.target.value })}
                  placeholder="e.g., 192GB HBM3e"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g., US East"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Hero Image</label>
              <div className="flex items-start gap-4">
                {form.image && (
                  <div className="w-24 h-24 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                    <Image
                      src={form.image}
                      alt="Preview"
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <div className="flex-1">
                  <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-[#e4e7ef] rounded-lg cursor-pointer hover:bg-gray-50">
                    <Upload className="w-4 h-4 text-[#5b6476]" />
                    <span className="text-sm text-[#5b6476]">
                      {imageUploading ? "Uploading..." : "Upload Image"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={imageUploading}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-[#8b95a8] mt-1">Recommended: 800x600px</p>
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 rounded border-[#e4e7ef]"
                />
                <label htmlFor="active" className="text-sm text-[#0b0f1c]">
                  Active
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="popular"
                  checked={form.popular}
                  onChange={(e) => setForm({ ...form, popular: e.target.checked })}
                  className="w-4 h-4 rounded border-[#e4e7ef]"
                />
                <label htmlFor="popular" className="text-sm text-[#0b0f1c]">
                  Most Popular
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="soldOut"
                  checked={form.soldOut}
                  onChange={(e) => setForm({ ...form, soldOut: e.target.checked })}
                  className="w-4 h-4 rounded border-[#e4e7ef]"
                />
                <label htmlFor="soldOut" className="text-sm text-[#0b0f1c]">
                  Sold Out
                </label>
              </div>
            </div>
          </div>

          {/* Hero Content */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[#0b0f1c] border-b pb-2">Hero Section</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Pill Text</label>
                <input
                  type="text"
                  value={form.hero.pill}
                  onChange={(e) =>
                    setForm({ ...form, hero: { ...form.hero, pill: e.target.value } })
                  }
                  placeholder="e.g., Available now"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Headline</label>
                <input
                  type="text"
                  value={form.hero.headline}
                  onChange={(e) =>
                    setForm({ ...form, hero: { ...form.hero, headline: e.target.value } })
                  }
                  placeholder="e.g., NVIDIA B200s"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Subhead</label>
              <input
                type="text"
                value={form.hero.subhead}
                onChange={(e) =>
                  setForm({ ...form, hero: { ...form.hero, subhead: e.target.value } })
                }
                placeholder="e.g., $2.25/hour, on demand."
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Description</label>
              <textarea
                value={form.hero.description}
                onChange={(e) =>
                  setForm({ ...form, hero: { ...form.hero, description: e.target.value } })
                }
                rows={3}
                className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Hourly Note</label>
                <input
                  type="text"
                  value={form.hero.hourlyNote}
                  onChange={(e) =>
                    setForm({ ...form, hero: { ...form.hero, hourlyNote: e.target.value } })
                  }
                  placeholder="e.g., $2.25/hour per GPU"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Monthly Note</label>
                <input
                  type="text"
                  value={form.hero.monthlyNote}
                  onChange={(e) =>
                    setForm({ ...form, hero: { ...form.hero, monthlyNote: e.target.value } })
                  }
                  placeholder="e.g., $1,642.50/month"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
            </div>

            {/* Signals */}
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                Signals (bullet points)
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.hero.signals.map((signal, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                  >
                    {signal}
                    <button
                      onClick={() => removeSignal(i)}
                      className="p-0.5 hover:bg-blue-100 rounded-full"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSignal}
                  onChange={(e) => setNewSignal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSignal())}
                  placeholder="Add signal..."
                  className="flex-1 px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
                <button
                  onClick={addSignal}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Pricing Card Content */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[#0b0f1c] border-b pb-2">Pricing Card</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Title</label>
                <input
                  type="text"
                  value={form.pricing.title}
                  onChange={(e) =>
                    setForm({ ...form, pricing: { ...form.pricing, title: e.target.value } })
                  }
                  placeholder="e.g., B200"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Subtitle</label>
                <input
                  type="text"
                  value={form.pricing.subtitle}
                  onChange={(e) =>
                    setForm({ ...form, pricing: { ...form.pricing, subtitle: e.target.value } })
                  }
                  placeholder="e.g., 192GB HBM3e"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
            </div>

            {/* Features */}
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Features</label>
              <div className="space-y-2 mb-2">
                {form.pricing.features.map((feature, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg"
                  >
                    <span className="flex-1 text-sm">{feature}</span>
                    <button
                      onClick={() => removeFeature(i)}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFeature())}
                  placeholder="Add feature..."
                  className="flex-1 px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
                <button
                  onClick={addFeature}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="sticky bottom-0 bg-white border-t border-[#e4e7ef] px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#e4e7ef] rounded-lg text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : editingOffering ? "Save Changes" : "Create Offering"}
          </button>
        </div>
      </div>
    </div>
  );
}
