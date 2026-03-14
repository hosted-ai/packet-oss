"use client";

import { useState, useEffect, useCallback } from "react";
import type { PricingConfig } from "../types";
import TwoFactorSettings from "@/components/two-factor/TwoFactorSettings";
import { PoolSettingsSection } from "./PoolSettingsSection";

interface SettingsTabProps {
  pricing: PricingConfig | null;
  pricingForm: {
    hourlyRate: string;
    refillThreshold: string;
    refillAmount: string;
    stoppedInstanceRate: string;
  };
  pricingSaving: boolean;
  onPricingFormChange: (form: {
    hourlyRate: string;
    refillThreshold: string;
    refillAmount: string;
    stoppedInstanceRate: string;
  }) => void;
  onSavePricing: (e: React.FormEvent) => void;
}

export function SettingsTab({
  pricing,
  pricingForm,
  pricingSaving,
  onPricingFormChange,
  onSavePricing,
}: SettingsTabProps) {
  return (
    <div className="max-w-3xl space-y-8">
      {/* Pricing Settings */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 text-[#0b0f1c]">Billing Settings</h3>
        <p className="text-sm text-[#5b6476] mb-6">
          Configure wallet auto-refill settings. GPU hourly rates and storage pricing are set in the Products tab.
        </p>

        <form onSubmit={onSavePricing} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Auto-Refill Threshold</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6476]">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={pricingForm.refillThreshold}
                  onChange={(e) => onPricingFormChange({ ...pricingForm, refillThreshold: e.target.value })}
                  placeholder="20.00"
                  className="w-full pl-7 pr-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
              <p className="text-xs text-[#5b6476] mt-1">Refill when balance drops below</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Auto-Refill Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6476]">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={pricingForm.refillAmount}
                  onChange={(e) => onPricingFormChange({ ...pricingForm, refillAmount: e.target.value })}
                  placeholder="100.00"
                  className="w-full pl-7 pr-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
              <p className="text-xs text-[#5b6476] mt-1">Amount to add when refilling</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Stopped Instance Rate</label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  value={pricingForm.stoppedInstanceRate}
                  onChange={(e) => onPricingFormChange({ ...pricingForm, stoppedInstanceRate: e.target.value })}
                  placeholder="25"
                  className="w-full pl-4 pr-8 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5b6476]">%</span>
              </div>
              <p className="text-xs text-[#5b6476] mt-1">Rate charged for stopped/reserved instances (% of hourly rate)</p>
            </div>
          </div>

          {pricing?.updatedAt && (
            <p className="text-xs text-[#5b6476]">
              Last updated: {new Date(pricing.updatedAt).toLocaleString()}
              {pricing.updatedBy && ` by ${pricing.updatedBy}`}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={pricingSaving}
              className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {pricingSaving ? "Saving..." : "Save Pricing"}
            </button>
          </div>
        </form>
      </div>

      {/* API Rate Limits */}
      <RateLimitCapSection />

      {/* GPU Pool Settings */}
      <PoolSettingsSection />

      {/* Two-Factor Authentication */}
      <TwoFactorSettings
        userType="admin"
        apiEndpoint="/api/admin/two-factor"
        onStatusChange={() => {
          // Optionally reload data or show notification
        }}
      />
    </div>
  );
}

// ── Self-contained Rate Limit Cap Section ──

function RateLimitCapSection() {
  const [imageRpm, setImageRpm] = useState("");
  const [videoRpm, setVideoRpm] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/rate-limits");
      if (res.ok) {
        const data = await res.json();
        setImageRpm(String(data.pixelFactoryMaxRpm ?? 60));
        setVideoRpm(String(data.pixelFactoryVideoMaxRpm ?? 10));
        setUpdatedAt(data.updatedAt ?? null);
        setUpdatedBy(data.updatedBy ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/rate-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pixelFactoryMaxRpm: parseInt(imageRpm) || 60,
          pixelFactoryVideoMaxRpm: parseInt(videoRpm) || 10,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUpdatedAt(data.updatedAt ?? null);
        setUpdatedBy(data.updatedBy ?? null);
        setMessage({ type: "success", text: "Rate limits saved" });
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-1 text-[#0b0f1c]">API Rate Limits</h3>
      <p className="text-sm text-[#5b6476] mb-6">
        Maximum requests per minute that customers can configure for Pixel Factory. Customers can set their own limits up to these caps.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Max RPM (Images)</label>
            <input
              type="number"
              min="1"
              value={imageRpm}
              onChange={(e) => setImageRpm(e.target.value)}
              placeholder="60"
              className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
            />
            <p className="text-xs text-[#5b6476] mt-1">Maximum image generation requests per minute per customer</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Max RPM (Videos)</label>
            <input
              type="number"
              min="1"
              value={videoRpm}
              onChange={(e) => setVideoRpm(e.target.value)}
              placeholder="10"
              className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
            />
            <p className="text-xs text-[#5b6476] mt-1">Maximum video generation requests per minute per customer</p>
          </div>
        </div>

        {updatedAt && (
          <p className="text-xs text-[#5b6476]">
            Last updated: {new Date(updatedAt).toLocaleString()}
            {updatedBy && ` by ${updatedBy}`}
          </p>
        )}

        {message && (
          <p className={`text-xs ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </p>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Rate Limits"}
          </button>
        </div>
      </form>
    </div>
  );
}
