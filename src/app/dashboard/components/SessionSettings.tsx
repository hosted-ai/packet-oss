"use client";

import { useState, useEffect, useCallback } from "react";

interface SessionSettingsProps {
  token: string;
  onSessionTimeoutChange?: (hours: number) => void;
}

const TIMEOUT_OPTIONS = [
  { value: 1, label: "1 hour (default)" },
  { value: 2, label: "2 hours" },
  { value: 4, label: "4 hours" },
  { value: 8, label: "8 hours" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
];

export function SessionSettings({ token, onSessionTimeoutChange }: SessionSettingsProps) {
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/account/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSessionTimeoutHours(data.settings.sessionTimeoutHours);
        onSessionTimeoutChange?.(data.settings.sessionTimeoutHours);
      }
    } catch (error) {
      console.error("Failed to fetch settings:", error);
    } finally {
      setLoading(false);
    }
  }, [token, onSessionTimeoutChange]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/account/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionTimeoutHours }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({
          type: "success",
          text: "Session timeout updated. Changes will apply on your next login."
        });
        onSessionTimeoutChange?.(sessionTimeoutHours);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update settings" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-40 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Session Settings</h2>
        <p className="text-sm text-[var(--muted)]">
          Configure how long you stay logged in before being automatically signed out
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1">
            Auto-logout after
          </label>
          <select
            value={sessionTimeoutHours}
            onChange={(e) => setSessionTimeoutHours(Number(e.target.value))}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            {TIMEOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)] mt-1">
            For security, you&apos;ll be automatically logged out after this period of inactivity
          </p>
        </div>

        {message && (
          <div
            className={`p-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
