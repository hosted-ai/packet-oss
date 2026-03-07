"use client";

import { useState, useEffect, useCallback } from "react";

interface ServiceConfig {
  label: string;
  configured: boolean;
  settings: Record<string, string | null>;
}

interface PlatformSettingsData {
  services: Record<string, ServiceConfig>;
}

const SERVICE_KEY_LABELS: Record<string, string> = {
  // Branding
  NEXT_PUBLIC_BRAND_NAME: "Brand Name",
  NEXT_PUBLIC_APP_URL: "Application URL",
  NEXT_PUBLIC_LOGO_URL: "Logo URL",
  NEXT_PUBLIC_PRIMARY_COLOR: "Primary Color",
  NEXT_PUBLIC_ACCENT_COLOR: "Accent Color",
  SUPPORT_EMAIL: "Support Email",
  // GPU Backend
  HOSTEDAI_API_URL: "API URL",
  HOSTEDAI_API_KEY: "API Key",
  // Stripe
  STRIPE_SECRET_KEY: "Secret Key",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "Publishable Key",
  STRIPE_WEBHOOK_SECRET: "Webhook Secret",
  // Email
  EMAILIT_API_KEY: "API Key",
  ADMIN_BCC_EMAIL: "Admin BCC Email",
  // Zammad
  ZAMMAD_API_URL: "API URL",
  ZAMMAD_API_TOKEN: "API Token",
  // Pipedrive
  PIPEDRIVE_API_TOKEN: "API Token",
};

const SENSITIVE_KEYS = new Set([
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "HOSTEDAI_API_KEY",
  "EMAILIT_API_KEY", "ZAMMAD_API_TOKEN", "PIPEDRIVE_API_TOKEN",
]);

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  branding: "Configure your platform's brand identity - name, colors, and contact information.",
  hostedai: "Connect to hosted.ai for GPU pod management. Required for GPU features.",
  stripe: "Enable Stripe for customer billing, wallets, and subscriptions. Optional - platform works without it.",
  emailit: "Configure email delivery for login links, notifications, and alerts. Optional - password login works without it.",
  zammad: "Connect to Zammad for customer support ticket management. Optional.",
  pipedrive: "Connect to Pipedrive CRM for sales pipeline tracking. Optional.",
};

const SERVICE_ORDER = ["branding", "hostedai", "stripe", "emailit", "zammad", "pipedrive"];

export function PlatformSettingsTab() {
  const [data, setData] = useState<PlatformSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/platform-settings");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  function startEditing(serviceName: string) {
    if (!data) return;
    const service = data.services[serviceName];
    if (!service) return;

    const initial: Record<string, string> = {};
    for (const [key, val] of Object.entries(service.settings)) {
      initial[key] = val || "";
    }
    setFormValues(initial);
    setEditingService(serviceName);
    setSaveMessage(null);
  }

  async function handleSave() {
    if (!editingService) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: formValues }),
      });

      if (res.ok) {
        setSaveMessage({ type: "success", text: "Settings saved successfully!" });
        setEditingService(null);
        await fetchSettings();
      } else {
        const err = await res.json();
        setSaveMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } catch {
      setSaveMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-[#5b6476]">Loading settings...</div>;
  }

  if (!data) {
    return <div className="text-red-500">Failed to load settings</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#0b0f1c] mb-1">Platform Settings</h2>
        <p className="text-sm text-[#5b6476]">
          Configure your platform&apos;s integrations and API keys. Settings are stored encrypted in the database.
        </p>
      </div>

      {saveMessage && (
        <div className={`p-3 rounded-lg text-sm ${
          saveMessage.type === "success"
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {saveMessage.text}
        </div>
      )}

      {SERVICE_ORDER.map((serviceName) => {
        const service = data.services[serviceName];
        if (!service) return null;
        const isEditing = editingService === serviceName;
        const description = SERVICE_DESCRIPTIONS[serviceName] || "";

        return (
          <div key={serviceName} className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${service.configured ? "bg-green-500" : "bg-zinc-300"}`} />
                <div>
                  <h3 className="font-semibold text-[#0b0f1c]">{service.label}</h3>
                  <p className="text-xs text-[#5b6476] mt-0.5">{description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  service.configured
                    ? "bg-green-50 text-green-700"
                    : "bg-zinc-100 text-zinc-500"
                }`}>
                  {service.configured ? "Connected" : "Not configured"}
                </span>
                {!isEditing && (
                  <button
                    onClick={() => startEditing(serviceName)}
                    className="text-sm text-[#1a4fff] hover:text-[#1a4fff]/80 font-medium"
                  >
                    {service.configured ? "Edit" : "Configure"}
                  </button>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="border-t border-[#e4e7ef] p-5 space-y-4 bg-zinc-50/50">
                {Object.keys(formValues).map((key) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                      {SERVICE_KEY_LABELS[key] || key}
                    </label>
                    <input
                      type={SENSITIVE_KEYS.has(key) ? "password" : "text"}
                      value={formValues[key]}
                      onChange={(e) => setFormValues({ ...formValues, [key]: e.target.value })}
                      placeholder={key}
                      className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                    />
                  </div>
                ))}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1a4fff]/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => { setEditingService(null); setSaveMessage(null); }}
                    className="px-4 py-2 bg-white border border-[#e4e7ef] hover:bg-zinc-50 text-[#0b0f1c] rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
