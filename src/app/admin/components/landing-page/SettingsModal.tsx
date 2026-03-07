"use client";

import { X } from "lucide-react";
import type { ProofSection, CarouselSettings } from "../../types";

interface SettingsModalProps {
  proofSection: ProofSection;
  setProofSection: React.Dispatch<React.SetStateAction<ProofSection>>;
  carouselSettings: CarouselSettings;
  setCarouselSettings: React.Dispatch<React.SetStateAction<CarouselSettings>>;
  onClose: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function SettingsModal({
  proofSection,
  setProofSection,
  carouselSettings,
  setCarouselSettings,
  onClose,
  onSave,
  saving,
}: SettingsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#e4e7ef] px-6 py-4 flex justify-between items-center">
          <h3 className="text-lg font-medium text-[#0b0f1c]">Carousel & Proof Section Settings</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Carousel Settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[#0b0f1c] border-b pb-2">Carousel Settings</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Auto-rotate (ms)
                </label>
                <input
                  type="number"
                  value={carouselSettings.autoRotateMs}
                  onChange={(e) =>
                    setCarouselSettings({
                      ...carouselSettings,
                      autoRotateMs: parseInt(e.target.value) || 5000,
                    })
                  }
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="pauseOnHover"
                  checked={carouselSettings.pauseOnHover}
                  onChange={(e) =>
                    setCarouselSettings({
                      ...carouselSettings,
                      pauseOnHover: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded border-[#e4e7ef]"
                />
                <label htmlFor="pauseOnHover" className="text-sm text-[#0b0f1c]">
                  Pause on hover
                </label>
              </div>
            </div>
          </div>

          {/* Proof Section Stats */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-[#0b0f1c] border-b pb-2">Proof Section Stats</h4>
            {proofSection.stats.map((stat, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 p-3 bg-gray-50 rounded-lg">
                <div>
                  <label className="block text-xs text-[#5b6476] mb-1">Value</label>
                  <input
                    type="text"
                    value={stat.value}
                    onChange={(e) => {
                      const newStats = [...proofSection.stats];
                      newStats[i] = { ...newStats[i], value: e.target.value };
                      setProofSection({ stats: newStats });
                    }}
                    className="w-full px-2 py-1 border border-[#e4e7ef] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#5b6476] mb-1">Label</label>
                  <input
                    type="text"
                    value={stat.label}
                    onChange={(e) => {
                      const newStats = [...proofSection.stats];
                      newStats[i] = { ...newStats[i], label: e.target.value };
                      setProofSection({ stats: newStats });
                    }}
                    className="w-full px-2 py-1 border border-[#e4e7ef] rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#5b6476] mb-1">Note</label>
                  <input
                    type="text"
                    value={stat.note}
                    onChange={(e) => {
                      const newStats = [...proofSection.stats];
                      newStats[i] = { ...newStats[i], note: e.target.value };
                      setProofSection({ stats: newStats });
                    }}
                    className="w-full px-2 py-1 border border-[#e4e7ef] rounded text-sm"
                  />
                </div>
              </div>
            ))}
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
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
