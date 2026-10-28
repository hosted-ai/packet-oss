"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { isOSS } from "@/lib/edition";

interface ServiceConfig {
  label: string;
  configured: boolean;
  settings: Record<string, string | null>;
}

interface EmailBlocklistData {
  enabled: boolean;
  domains: string[];
  defaultDomains: string[];
}

interface EmbargoData {
  enabled: boolean;
  countries: string[];
  defaultCountries: string[];
}

interface InternalExclusionsData {
  domains: string[];
  emails: string[];
  defaultDomains: string[];
  defaultEmails: string[];
}

interface PlatformSettingsData {
  services: Record<string, ServiceConfig>;
  emailBlocklist?: EmailBlocklistData;
  embargo?: EmbargoData;
  internalExclusions?: InternalExclusionsData;
}

const SERVICE_KEY_LABELS: Record<string, string> = {
  // Branding — Appearance
  NEXT_PUBLIC_BRAND_NAME: "Brand Name",
  NEXT_PUBLIC_APP_URL: "Application URL",
  NEXT_PUBLIC_LOGO_URL: "Logo URL",
  NEXT_PUBLIC_PRIMARY_COLOR: "Primary Color",
  NEXT_PUBLIC_ACCENT_COLOR: "Accent Color",
  NEXT_PUBLIC_BACKGROUND_COLOR: "Background Color",
  NEXT_PUBLIC_TEXT_COLOR: "Text Color",
  NEXT_PUBLIC_FAVICON_URL: "Favicon URL",
  SUPPORT_EMAIL: "Support Email",
  // GPU Backend
  HOSTEDAI_API_URL: "API URL",
  HOSTEDAI_API_KEY: "API Key",
  // Stripe
  STRIPE_SECRET_KEY: "Secret Key",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "Publishable Key",
  STRIPE_WEBHOOK_SECRET: "Webhook Secret",
  // Email Delivery — SMTP
  SMTP_HOST: "SMTP Host",
  SMTP_PORT: "SMTP Port",
  SMTP_USER: "SMTP Username",
  SMTP_PASSWORD: "SMTP Password",
  ADMIN_BCC_EMAIL: "Admin BCC Email",
  // Zammad
  ZAMMAD_API_URL: "API URL",
  ZAMMAD_API_TOKEN: "API Token",
  // Pipedrive
  PIPEDRIVE_API_TOKEN: "API Token",
};

const SENSITIVE_KEYS = new Set([
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "HOSTEDAI_API_KEY",
  "SMTP_PASSWORD", "ZAMMAD_API_TOKEN", "PIPEDRIVE_API_TOKEN",
]);

const COLOR_KEYS = new Set([
  "NEXT_PUBLIC_PRIMARY_COLOR", "NEXT_PUBLIC_ACCENT_COLOR",
  "NEXT_PUBLIC_BACKGROUND_COLOR", "NEXT_PUBLIC_TEXT_COLOR",
]);

// ── Pre-defined color themes ───────────────────────────────────────────────
interface ThemePreset {
  name: string;
  primary: string;
  accent: string;
  background: string;
  text: string;
}

const THEME_PRESETS: ThemePreset[] = [
  { name: "Default",     primary: "#1a4fff", accent: "#18b6a8", background: "#f7f8fb", text: "#0b0f1c" },
  { name: "Ocean",       primary: "#0077b6", accent: "#00b4d8", background: "#f0f7fa", text: "#03045e" },
  { name: "Emerald",     primary: "#059669", accent: "#34d399", background: "#f0fdf4", text: "#052e16" },
  { name: "Sunset",      primary: "#e04e18", accent: "#f59e0b", background: "#fef7f0", text: "#1c1109" },
  { name: "Purple",      primary: "#7c3aed", accent: "#a78bfa", background: "#f5f3ff", text: "#1e1048" },
  { name: "Rose",        primary: "#e11d48", accent: "#fb7185", background: "#fff1f2", text: "#1a0610" },
  { name: "Slate",       primary: "#475569", accent: "#64748b", background: "#f8fafc", text: "#0f172a" },
  { name: "Midnight",    primary: "#3b82f6", accent: "#06b6d4", background: "#0f172a", text: "#e2e8f0" },
  { name: "Forest",      primary: "#16a34a", accent: "#84cc16", background: "#0a1f0d", text: "#dcfce7" },
  { name: "Amber",       primary: "#d97706", accent: "#fbbf24", background: "#fffbeb", text: "#1c1309" },
];

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  branding: "Configure your platform's brand identity — name, colors, logo, and support contact.",
  hostedai: "Connect to hosted.ai for GPU pod management. Required for GPU features.",
  stripe: "Enable Stripe for customer billing, wallets, and subscriptions. Optional - platform works without it.",
  smtp: "Configure email delivery via SMTP. Works with any mail server (Gmail, AWS SES, Postfix, Mailgun, etc.). Optional — password login works without it.",
  zammad: "Connect to Zammad for customer support ticket management. Optional.",
  pipedrive: "Connect to Pipedrive CRM for sales pipeline tracking. Optional.",
};

// Pro-only services are hidden from the OSS Platform Settings UI
const PRO_ONLY_SERVICES = new Set(["zammad", "pipedrive"]);
const SERVICE_ORDER = ["branding", "hostedai", "stripe", "smtp", "zammad", "pipedrive"]
  .filter((s) => !(isOSS() && PRO_ONLY_SERVICES.has(s)));

// ── Sub-sections for branding ─────────────────────────────────────────────
const BRANDING_SECTIONS: { label: string; keys: string[] }[] = [
  {
    label: "Appearance",
    keys: [
      "NEXT_PUBLIC_BRAND_NAME", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_LOGO_URL",
      "NEXT_PUBLIC_PRIMARY_COLOR", "NEXT_PUBLIC_ACCENT_COLOR",
      "NEXT_PUBLIC_BACKGROUND_COLOR", "NEXT_PUBLIC_TEXT_COLOR",
      "NEXT_PUBLIC_FAVICON_URL", "SUPPORT_EMAIL",
    ],
  },
];

function LogoUploadField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/admin/branding/upload-logo", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const { logoUrl } = await res.json();
        onChange(logoUrl);
      } else {
        const err = await res.json();
        setError(err.error || "Upload failed");
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
        Logo
      </label>
      {/* Preview */}
      {value && (
        <div className="mb-2 p-3 bg-white border border-[#e4e7ef] rounded-lg inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Logo preview"
            className="h-10 w-auto max-w-50 object-contain"
          />
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/logo.png or https://..."
          className="flex-1 px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-3 py-2 bg-white border border-[#e4e7ef] hover:bg-zinc-50 text-[#0b0f1c] rounded-lg text-sm whitespace-nowrap disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function FaviconUploadField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("favicon", file);
      const res = await fetch("/api/admin/branding/upload-favicon", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const { faviconUrl } = await res.json();
        onChange(faviconUrl);
      } else {
        const err = await res.json();
        setError(err.error || "Upload failed");
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
        Favicon
      </label>
      {value && (
        <div className="mb-2 p-3 bg-white border border-[#e4e7ef] rounded-lg inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Favicon preview"
            className="h-6 w-6 object-contain"
          />
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/favicon.ico or https://..."
          className="flex-1 px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-3 py-2 bg-white border border-[#e4e7ef] hover:bg-zinc-50 text-[#0b0f1c] rounded-lg text-sm whitespace-nowrap disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
        {label}
      </label>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 p-0.5 bg-white border border-[#e4e7ef] rounded-lg cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff] font-mono"
        />
      </div>
    </div>
  );
}

function ThemePresetPicker({
  onSelect,
}: {
  onSelect: (preset: ThemePreset) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
        Theme Presets
      </label>
      <p className="text-xs text-[#5b6476] mb-3">
        Pick a preset to auto-fill colors, then customise individual values below.
      </p>
      <div className="grid grid-cols-5 gap-2">
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => onSelect(preset)}
            className="group flex flex-col items-center gap-1.5 p-2 rounded-lg border border-[#e4e7ef] hover:border-[#1a4fff] hover:bg-white transition-colors"
            title={preset.name}
          >
            <div className="flex gap-0.5">
              <div
                className="w-4 h-4 rounded-full border border-black/10"
                style={{ backgroundColor: preset.primary }}
              />
              <div
                className="w-4 h-4 rounded-full border border-black/10"
                style={{ backgroundColor: preset.accent }}
              />
            </div>
            <div
              className="w-full h-3 rounded-sm border border-black/5"
              style={{ backgroundColor: preset.background }}
            />
            <span className="text-[10px] font-medium text-[#5b6476] group-hover:text-[#0b0f1c] leading-none">
              {preset.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BrandingPreview({ values }: { values: Record<string, string> }) {
  const primary = values.NEXT_PUBLIC_PRIMARY_COLOR || "#1a4fff";
  const accent = values.NEXT_PUBLIC_ACCENT_COLOR || "#18b6a8";
  const bg = values.NEXT_PUBLIC_BACKGROUND_COLOR || "#f7f8fb";
  const text = values.NEXT_PUBLIC_TEXT_COLOR || "#0b0f1c";
  const brand = values.NEXT_PUBLIC_BRAND_NAME || "Your Brand";

  return (
    <div className="mt-4 p-4 border border-[#e4e7ef] rounded-lg" style={{ backgroundColor: bg }}>
      <p className="text-xs text-[#5b6476] mb-2 font-medium">Preview</p>
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold" style={{ color: text }}>{brand}</span>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white"
          style={{ backgroundColor: primary }}
        >
          Primary
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white"
          style={{ backgroundColor: accent }}
        >
          Accent
        </button>
      </div>
    </div>
  );
}

// ── SMTP TLS indicator ──────────────────────────────────────────────────────
function SmtpTlsIndicator({ port }: { port: string }) {
  const portNum = parseInt(port, 10);
  if (!port || isNaN(portNum)) return null;

  if (portNum === 465) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">🔒 TLS (implicit)</span>;
  }
  if (portNum === 587) {
    return <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">🔒 STARTTLS</span>;
  }
  if (portNum === 25) {
    return <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">⚠️ Unencrypted — use 587 or 465 for TLS</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs text-zinc-500 bg-zinc-50 px-2 py-0.5 rounded-full">Port {portNum}</span>;
}

// ── Country name resolver (uses built-in Intl API, no hardcoded map) ────────
function getCountryName(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

// ── All ISO 3166-1 alpha-2 country codes for the search dropdown ────────────
const ALL_COUNTRY_CODES = [
  "AF","AL","DZ","AS","AD","AO","AG","AR","AM","AU","AT","AZ","BS","BH","BD",
  "BB","BY","BE","BZ","BJ","BT","BO","BA","BW","BR","BN","BG","BF","BI","KH",
  "CM","CA","CV","CF","TD","CL","CN","CO","KM","CG","CD","CR","CI","HR","CU",
  "CY","CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","SZ","ET","FJ",
  "FI","FR","GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN",
  "HU","IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI",
  "KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MG","MW",
  "MY","MV","ML","MT","MH","MR","MU","MX","FM","MD","MC","MN","ME","MA","MZ",
  "MM","NA","NR","NP","NL","NZ","NI","NE","NG","MK","NO","OM","PK","PW","PA",
  "PG","PY","PE","PH","PL","PT","QA","RO","RU","RW","KN","LC","VC","WS","SM",
  "ST","SA","SN","RS","SC","SL","SG","SK","SI","SB","SO","ZA","SS","ES","LK",
  "SD","SR","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TO","TT","TN","TR",
  "TM","TV","UG","UA","AE","GB","US","UY","UZ","VU","VE","VN","YE","ZM","ZW",
];

// ── Confirmation Dialog ─────────────────────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h4 className="font-semibold text-[#0b0f1c] text-sm mb-2">{title}</h4>
        <p className="text-sm text-[#5b6476] mb-4">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-[#5b6476] hover:text-[#0b0f1c] rounded-lg border border-[#e4e7ef] hover:bg-zinc-50">
            Cancel
          </button>
          <button onClick={onConfirm} className={`px-3 py-1.5 text-sm text-white rounded-lg font-medium ${confirmColor || "bg-[#1a4fff] hover:bg-[#1a4fff]/90"}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Embargo Screening Section ───────────────────────────────────────────────
function EmbargoScreeningSection({ enabled, countries, defaultCountries, message, saving, onToggle, onUpdate }: {
  enabled: boolean;
  countries: string[];
  defaultCountries: string[];
  message: { type: "success" | "error"; text: string } | null;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onUpdate: (countries: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: "add" | "remove" | "reset"; code?: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Filter countries for dropdown: match on code or name, exclude already added
  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_COUNTRY_CODES.filter(c => !countries.includes(c)).slice(0, 20);
    return ALL_COUNTRY_CODES.filter(c => {
      if (countries.includes(c)) return false;
      if (c.toLowerCase().includes(q)) return true;
      const name = getCountryName(c).toLowerCase();
      return name.includes(q);
    }).slice(0, 20);
  }, [search, countries]);

  function handleAdd(code: string) {
    setConfirmAction({ type: "add", code });
  }

  function handleRemove(code: string) {
    setConfirmAction({ type: "remove", code });
  }

  function handleReset() {
    setConfirmAction({ type: "reset" });
  }

  function executeConfirm() {
    if (!confirmAction) return;
    if (confirmAction.type === "add" && confirmAction.code) {
      onUpdate([...countries, confirmAction.code].sort());
    } else if (confirmAction.type === "remove" && confirmAction.code) {
      onUpdate(countries.filter(c => c !== confirmAction.code));
    } else if (confirmAction.type === "reset") {
      onUpdate([...defaultCountries].sort());
    }
    setConfirmAction(null);
    setSearch("");
    setShowDropdown(false);
  }

  return (
    <>
      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction.type === "add" ? "Add Country to Embargo List" :
            confirmAction.type === "remove" ? "Remove Country from Embargo List" :
            "Reset to OFAC Defaults"
          }
          message={
            confirmAction.type === "add"
              ? `Block all signups, checkouts, and API requests from ${getCountryName(confirmAction.code!)} (${confirmAction.code})?`
              : confirmAction.type === "remove"
              ? `Remove ${getCountryName(confirmAction.code!)} (${confirmAction.code}) from the embargo list? Requests from this country will be allowed.`
              : `Replace the current list with the ${defaultCountries.length} default OFAC-sanctioned countries?`
          }
          confirmLabel={confirmAction.type === "remove" ? "Remove" : confirmAction.type === "reset" ? "Reset" : "Add"}
          confirmColor={confirmAction.type === "remove" ? "bg-red-600 hover:bg-red-700" : undefined}
          onConfirm={executeConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${enabled ? "bg-green-500" : "bg-zinc-300"}`} />
              <div>
                <h3 className="font-semibold text-[#0b0f1c]">Embargo Country Screening</h3>
                <p className="text-xs text-[#5b6476] mt-0.5">
                  Block signups, checkout, and API access from sanctioned countries (OFAC)
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} className="sr-only peer" disabled={saving} />
              <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1a4fff]" />
            </label>
          </div>

          {message && (
            <div className={`mt-3 p-2 rounded text-xs ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {message.text}
            </div>
          )}

          {enabled && (
            <div className="mt-4 border-t border-[#e4e7ef] pt-4">
              {/* Search + add country */}
              <div className="relative" ref={dropdownRef}>
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search by country name or code..."
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1a4fff]/20 focus:border-[#1a4fff]"
                />
                {showDropdown && filteredCountries.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-[#e4e7ef] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredCountries.map((code: string) => (
                      <button
                        key={code}
                        onClick={() => handleAdd(code)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#f0f4ff] flex items-center justify-between"
                      >
                        <span>
                          <span className="text-[#0b0f1c]">{getCountryName(code)}</span>
                          <span className="text-[#5b6476] ml-2 font-mono text-xs">{code}</span>
                        </span>
                        <span className="text-xs text-[#1a4fff] font-medium">+ Add</span>
                      </button>
                    ))}
                    {search.trim() && filteredCountries.length === 0 && (
                      <div className="px-3 py-2 text-sm text-[#5b6476]">No matching countries found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Country list */}
              <div className="flex items-center justify-between mt-4 mb-2">
                <div className="text-xs text-[#5b6476]">
                  {countries.length} countr{countries.length !== 1 ? "ies" : "y"} blocked
                </div>
                {countries.length > 0 && (
                  <button onClick={handleReset} className="text-xs text-[#5b6476] hover:text-[#0b0f1c] underline">
                    Reset to OFAC defaults ({defaultCountries.length})
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto border border-[#e4e7ef] rounded-lg divide-y divide-[#e4e7ef]">
                {countries.length === 0 ? (
                  <div className="p-4 text-sm text-[#5b6476] text-center">
                    No countries blocked. Search above to add countries, or the default OFAC list will be loaded when you enable screening.
                  </div>
                ) : (
                  countries.map(code => (
                    <div key={code} className="flex items-center justify-between px-3 py-2 hover:bg-zinc-50 group">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-5 bg-zinc-100 rounded text-xs font-mono font-medium text-[#0b0f1c]">{code}</span>
                        <span className="text-sm text-[#0b0f1c]">{getCountryName(code)}</span>
                      </div>
                      <button
                        onClick={() => handleRemove(code)}
                        className="text-xs text-red-400 hover:text-red-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Internal / Test Account Exclusion Section (PA-410) ──────────────────────
// A small add/remove list editor, reused for both the domain and email lists.
function ListEditor({ label, help, mono, items, placeholder, validate, onChange }: {
  label: string;
  help: string;
  mono?: boolean;
  items: string[];
  placeholder: string;
  validate: (v: string) => boolean;
  onChange: (items: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const valid = validate(input.toLowerCase().trim());

  function add() {
    const v = input.toLowerCase().trim();
    if (!validate(v) || items.includes(v)) return;
    onChange([...items, v].sort());
    setInput("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-[#0b0f1c]">{label}</label>
        <span className="text-xs text-[#5b6476]">{items.length} entr{items.length !== 1 ? "ies" : "y"}</span>
      </div>
      <p className="text-xs text-[#5b6476] mb-2">{help}</p>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <button
          onClick={add}
          disabled={!valid || items.includes(input.toLowerCase().trim())}
          className="px-3 py-1.5 bg-[#1a4fff] hover:bg-[#1a4fff]/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      <div className="max-h-52 overflow-y-auto border border-[#e4e7ef] rounded-lg divide-y divide-[#e4e7ef]">
        {items.length === 0 ? (
          <div className="p-3 text-sm text-[#5b6476] text-center">None — nothing is excluded on this list.</div>
        ) : (
          items.map((it) => (
            <div key={it} className="flex items-center justify-between px-3 py-1.5 hover:bg-zinc-50">
              <span className={`text-sm text-[#0b0f1c] ${mono ? "font-mono" : ""}`}>{it}</span>
              <button
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InternalExclusionsSection({ domains, emails, defaultDomains, defaultEmails, message, onSave }: {
  domains: string[];
  emails: string[];
  defaultDomains: string[];
  defaultEmails: string[];
  message: { type: "success" | "error"; text: string } | null;
  onSave: (patch: { domains?: string[]; emails?: string[] }) => void;
}) {
  const isDomain = (v: string) => /^[a-z0-9.-]+$/.test(v) && v.includes(".");
  const isEmail = (v: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z0-9]{2,}$/.test(v);

  return (
    <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <div>
            <h3 className="font-semibold text-[#0b0f1c]">Internal / Test Account Exclusion</h3>
            <p className="text-xs text-[#5b6476] mt-0.5">
              Accounts matching these are kept out of signups, customer, revenue, and investor metrics,
              and are <strong>billed at $0.00</strong> (GPU usage, storage, stopped reservations, deploy pre-charge).
              Editing these lists changes who gets billed, not just who appears in reports.
            </p>
          </div>
        </div>

        {message && (
          <div className={`mt-3 p-2 rounded text-xs ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {message.text}
          </div>
        )}

        <div className="mt-4 border-t border-[#e4e7ef] pt-4 space-y-5">
          <ListEditor
            label="Email domains"
            help="Any account whose email ends in @domain is treated as internal (e.g. hosted.ai)."
            mono
            items={domains}
            placeholder="Add domain (e.g., hosted.ai)"
            validate={isDomain}
            onChange={(d) => onSave({ domains: d })}
          />
          <ListEditor
            label="Individual emails"
            help="Specific addresses to exclude (staff or test accounts on external domains)."
            mono
            items={emails}
            placeholder="Add email (e.g., test@example.com)"
            validate={isEmail}
            onChange={(e) => onSave({ emails: e })}
          />
          <button
            onClick={() => onSave({ domains: [...defaultDomains].sort(), emails: [...defaultEmails].sort() })}
            className="text-xs text-[#5b6476] hover:text-[#0b0f1c] underline"
          >
            Reset to defaults ({defaultDomains.length} domain{defaultDomains.length !== 1 ? "s" : ""}, {defaultEmails.length} email{defaultEmails.length !== 1 ? "s" : ""})
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlatformSettingsTab() {
  const [data, setData] = useState<PlatformSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [blocklistEnabled, setBlocklistEnabled] = useState(false);
  const [blocklistDomains, setBlocklistDomains] = useState<string[]>([]);
  const [blocklistNewDomain, setBlocklistNewDomain] = useState("");
  const [, setBlocklistSaving] = useState(false);
  const [blocklistMessage, setBlocklistMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [embargoEnabled, setEmbargoEnabled] = useState(false);
  const [embargoCountries, setEmbargoCountries] = useState<string[]>([]);
  const [embargoSaving, setEmbargoSaving] = useState(false);
  const [embargoMessage, setEmbargoMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [internalDomains, setInternalDomains] = useState<string[]>([]);
  const [internalEmails, setInternalEmails] = useState<string[]>([]);
  const [internalMessage, setInternalMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  // Sync blocklist state when data loads
  useEffect(() => {
    if (data?.emailBlocklist) {
      setBlocklistEnabled(data.emailBlocklist.enabled);
      setBlocklistDomains(data.emailBlocklist.domains);
    }
    if (data?.embargo) {
      setEmbargoEnabled(data.embargo.enabled);
      setEmbargoCountries(data.embargo.countries);
    }
    if (data?.internalExclusions) {
      setInternalDomains(data.internalExclusions.domains);
      setInternalEmails(data.internalExclusions.emails);
    }
  }, [data]);

  function saveInternalExclusions(patch: { domains?: string[]; emails?: string[] }) {
    if (patch.domains) setInternalDomains(patch.domains);
    if (patch.emails) setInternalEmails(patch.emails);
    fetch("/api/admin/platform-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ internalExclusions: patch }),
    }).then((res) => {
      setInternalMessage(res.ok
        ? { type: "success", text: "Exclusion list updated" }
        : { type: "error", text: "Failed to save" });
      setTimeout(() => setInternalMessage(null), 3000);
    }).catch(() => {
      setInternalMessage({ type: "error", text: "Failed to save" });
      setTimeout(() => setInternalMessage(null), 3000);
    });
  }

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

  function updateFormValue(key: string, value: string) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  function renderField(key: string) {
    if (key === "NEXT_PUBLIC_LOGO_URL") {
      return (
        <LogoUploadField
          key={key}
          value={formValues[key] || ""}
          onChange={(url) => updateFormValue(key, url)}
        />
      );
    }

    if (key === "NEXT_PUBLIC_FAVICON_URL") {
      return (
        <FaviconUploadField
          key={key}
          value={formValues[key] || ""}
          onChange={(url) => updateFormValue(key, url)}
        />
      );
    }

    if (COLOR_KEYS.has(key)) {
      return (
        <ColorField
          key={key}
          label={SERVICE_KEY_LABELS[key] || key}
          value={formValues[key] || ""}
          onChange={(val) => updateFormValue(key, val)}
        />
      );
    }

    return (
      <div key={key}>
        <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
          {SERVICE_KEY_LABELS[key] || key}
        </label>
        <input
          type={SENSITIVE_KEYS.has(key) ? "password" : "text"}
          value={formValues[key] || ""}
          onChange={(e) => updateFormValue(key, e.target.value)}
          placeholder={key}
          className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
      </div>
    );
  }

  function applyThemePreset(preset: ThemePreset) {
    setFormValues((prev) => ({
      ...prev,
      NEXT_PUBLIC_PRIMARY_COLOR: preset.primary,
      NEXT_PUBLIC_ACCENT_COLOR: preset.accent,
      NEXT_PUBLIC_BACKGROUND_COLOR: preset.background,
      NEXT_PUBLIC_TEXT_COLOR: preset.text,
    }));
  }

  function renderBrandingForm() {
    return (
      <div className="space-y-6">
        {BRANDING_SECTIONS.map((section) => {
          const sectionKeys = section.keys.filter((k) => k in formValues);
          if (sectionKeys.length === 0) return null;
          return (
            <div key={section.label}>
              <h4 className="text-sm font-semibold text-[#0b0f1c] mb-3 border-b border-[#e4e7ef] pb-1">
                {section.label}
              </h4>
              {section.label === "Appearance" && (
                <div className="mb-4">
                  <ThemePresetPicker onSelect={applyThemePreset} />
                </div>
              )}
              <div className="space-y-4">
                {sectionKeys.map((key) => renderField(key))}
              </div>
            </div>
          );
        })}
        <BrandingPreview values={formValues} />
        <p className="text-xs text-[#5b6476] flex items-center gap-1 pt-2">
          <span className="inline-block w-3.5 h-3.5 text-[#5b6476]">&#9432;</span>
          Email sender settings have moved to the Email Templates tab.
        </p>
      </div>
    );
  }

  async function handleSmtpTest() {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch("/api/admin/smtp/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: formValues["SMTP_HOST"],
          port: formValues["SMTP_PORT"],
          user: formValues["SMTP_USER"],
          password: formValues["SMTP_PASSWORD"],
        }),
      });
      const json = await res.json();
      setSmtpTestResult({ ok: json.ok, error: json.error });
    } catch {
      setSmtpTestResult({ ok: false, error: "Failed to reach server" });
    } finally {
      setSmtpTesting(false);
    }
  }

  function renderSmtpForm() {
    const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"];
    const otherKeys = ["ADMIN_BCC_EMAIL"];

    return (
      <div className="space-y-6">
        {/* SMTP Settings */}
        <div>
          <h4 className="text-sm font-semibold text-[#0b0f1c] mb-1 border-b border-[#e4e7ef] pb-1">
            SMTP Settings
          </h4>
          <p className="text-xs text-[#5b6476] mb-3">
            Connect to any SMTP server — Gmail, AWS SES, Postfix, Mailgun, etc.
          </p>
          <div className="space-y-4">
            {smtpKeys.filter((k) => k in formValues).map((key) => (
              <div key={key}>
                {renderField(key)}
                {key === "SMTP_PORT" && formValues["SMTP_PORT"] && (
                  <div className="mt-1">
                    <SmtpTlsIndicator port={formValues["SMTP_PORT"]} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Test Connection button */}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={handleSmtpTest}
              disabled={smtpTesting || !formValues["SMTP_HOST"]}
              className="px-3 py-1.5 text-sm border border-[#e4e7ef] rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {smtpTesting ? "Testing..." : "Test Connection"}
            </button>
            {smtpTestResult && (
              <span className={`text-sm ${smtpTestResult.ok ? "text-green-600" : "text-red-600"}`}>
                {smtpTestResult.ok ? "✅ Connected" : `❌ ${smtpTestResult.error}`}
              </span>
            )}
          </div>
        </div>

        {/* General */}
        <div>
          <h4 className="text-sm font-semibold text-[#0b0f1c] mb-1 border-b border-[#e4e7ef] pb-1">
            General
          </h4>
          <div className="space-y-4">
            {otherKeys.filter((k) => k in formValues).map((key) => renderField(key))}
          </div>
        </div>
      </div>
    );
  }

  function renderDefaultForm() {
    return (
      <div className="space-y-4">
        {Object.keys(formValues).map((key) => renderField(key))}
      </div>
    );
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

      {/* ── Email Domain Blocklist ── */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${blocklistEnabled ? "bg-green-500" : "bg-zinc-300"}`} />
              <div>
                <h3 className="font-semibold text-[#0b0f1c]">Email Domain Blocklist</h3>
                <p className="text-xs text-[#5b6476] mt-0.5">
                  Block signups from disposable/temporary email domains
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={blocklistEnabled}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setBlocklistEnabled(enabled);
                  setBlocklistSaving(true);
                  setBlocklistMessage(null);
                  try {
                    // If enabling for the first time and no domains exist, seed with defaults
                    const domainsToSave = enabled && blocklistDomains.length === 0
                      ? (data?.emailBlocklist?.defaultDomains || [])
                      : undefined;
                    if (domainsToSave) setBlocklistDomains(domainsToSave);

                    const res = await fetch("/api/admin/platform-settings", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        emailBlocklist: {
                          enabled,
                          ...(domainsToSave ? { domains: domainsToSave } : {}),
                        },
                      }),
                    });
                    if (res.ok) {
                      setBlocklistMessage({ type: "success", text: enabled ? "Blocklist enabled" : "Blocklist disabled" });
                    } else {
                      setBlocklistMessage({ type: "error", text: "Failed to update" });
                      setBlocklistEnabled(!enabled);
                    }
                  } catch {
                    setBlocklistMessage({ type: "error", text: "Failed to update" });
                    setBlocklistEnabled(!enabled);
                  } finally {
                    setBlocklistSaving(false);
                    setTimeout(() => setBlocklistMessage(null), 3000);
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-200 peer-focus:ring-2 peer-focus:ring-[#1a4fff]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1a4fff]" />
            </label>
          </div>

          {blocklistMessage && (
            <div className={`mt-3 p-2 rounded text-xs ${
              blocklistMessage.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>
              {blocklistMessage.text}
            </div>
          )}

          {blocklistEnabled && (
            <div className="mt-4 border-t border-[#e4e7ef] pt-4">
              {/* Add domain input */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={blocklistNewDomain}
                  onChange={(e) => setBlocklistNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const domain = blocklistNewDomain.toLowerCase().trim();
                      if (domain && domain.includes(".") && !blocklistDomains.includes(domain)) {
                        const updated = [...blocklistDomains, domain].sort();
                        setBlocklistDomains(updated);
                        setBlocklistNewDomain("");
                        // Auto-save
                        fetch("/api/admin/platform-settings", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ emailBlocklist: { domains: updated } }),
                        }).catch(() => {});
                      }
                    }
                  }}
                  placeholder="Add domain (e.g., tempmail.com)"
                  className="flex-1 px-3 py-1.5 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
                <button
                  onClick={() => {
                    const domain = blocklistNewDomain.toLowerCase().trim();
                    if (domain && domain.includes(".") && !blocklistDomains.includes(domain)) {
                      const updated = [...blocklistDomains, domain].sort();
                      setBlocklistDomains(updated);
                      setBlocklistNewDomain("");
                      fetch("/api/admin/platform-settings", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ emailBlocklist: { domains: updated } }),
                      }).catch(() => {});
                    }
                  }}
                  disabled={!blocklistNewDomain.trim() || !blocklistNewDomain.includes(".")}
                  className="px-3 py-1.5 bg-[#1a4fff] hover:bg-[#1a4fff]/90 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>

              {/* Domain list */}
              <div className="text-xs text-[#5b6476] mb-2">
                {blocklistDomains.length} domain{blocklistDomains.length !== 1 ? "s" : ""} blocked
              </div>
              <div className="max-h-60 overflow-y-auto border border-[#e4e7ef] rounded-lg divide-y divide-[#e4e7ef]">
                {blocklistDomains.length === 0 ? (
                  <div className="p-3 text-sm text-[#5b6476] text-center">
                    No domains blocked. Add one above or the default list will be loaded when you enable the blocklist.
                  </div>
                ) : (
                  blocklistDomains.map((domain) => (
                    <div key={domain} className="flex items-center justify-between px-3 py-1.5 hover:bg-zinc-50">
                      <span className="text-sm text-[#0b0f1c] font-mono">{domain}</span>
                      <button
                        onClick={() => {
                          const updated = blocklistDomains.filter(d => d !== domain);
                          setBlocklistDomains(updated);
                          fetch("/api/admin/platform-settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ emailBlocklist: { domains: updated } }),
                          }).catch(() => {});
                        }}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Reset to defaults */}
              <button
                onClick={() => {
                  const defaults = data?.emailBlocklist?.defaultDomains || [];
                  setBlocklistDomains(defaults);
                  fetch("/api/admin/platform-settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ emailBlocklist: { domains: defaults } }),
                  }).then(() => {
                    setBlocklistMessage({ type: "success", text: "Reset to default list" });
                    setTimeout(() => setBlocklistMessage(null), 3000);
                  }).catch(() => {});
                }}
                className="mt-2 text-xs text-[#5b6476] hover:text-[#0b0f1c] underline"
              >
                Reset to default list ({data?.emailBlocklist?.defaultDomains?.length || 0} domains)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Embargo Country Screening ── */}
      <EmbargoScreeningSection
        enabled={embargoEnabled}
        countries={embargoCountries}
        defaultCountries={data?.embargo?.defaultCountries || []}
        message={embargoMessage}
        saving={embargoSaving}
        onToggle={async (enabled) => {
          setEmbargoEnabled(enabled);
          setEmbargoSaving(true);
          setEmbargoMessage(null);
          try {
            const countriesToSave = enabled && embargoCountries.length === 0
              ? (data?.embargo?.defaultCountries || []) : undefined;
            if (countriesToSave) setEmbargoCountries(countriesToSave);
            const res = await fetch("/api/admin/platform-settings", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ embargo: { enabled, ...(countriesToSave ? { countries: countriesToSave } : {}) } }),
            });
            if (res.ok) {
              setEmbargoMessage({ type: "success", text: enabled ? "Embargo screening enabled" : "Embargo screening disabled" });
            } else {
              setEmbargoMessage({ type: "error", text: "Failed to update" });
              setEmbargoEnabled(!enabled);
            }
          } catch {
            setEmbargoMessage({ type: "error", text: "Failed to update" });
            setEmbargoEnabled(!enabled);
          } finally {
            setEmbargoSaving(false);
            setTimeout(() => setEmbargoMessage(null), 3000);
          }
        }}
        onUpdate={(countries) => {
          setEmbargoCountries(countries);
          fetch("/api/admin/platform-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embargo: { countries } }),
          }).then(() => {
            setEmbargoMessage({ type: "success", text: "Country list updated" });
            setTimeout(() => setEmbargoMessage(null), 3000);
          }).catch(() => {
            setEmbargoMessage({ type: "error", text: "Failed to save" });
            setTimeout(() => setEmbargoMessage(null), 3000);
          });
        }}
      />

      {/* ── Internal / Test Account Exclusion ── */}
      <InternalExclusionsSection
        domains={internalDomains}
        emails={internalEmails}
        defaultDomains={data?.internalExclusions?.defaultDomains || []}
        defaultEmails={data?.internalExclusions?.defaultEmails || []}
        message={internalMessage}
        onSave={saveInternalExclusions}
      />

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
              <div className="border-t border-[#e4e7ef] p-5 bg-zinc-50/50">
                {serviceName === "branding" ? renderBrandingForm() : serviceName === "smtp" ? renderSmtpForm() : renderDefaultForm()}

                <div className="flex gap-2 pt-4 mt-4 border-t border-[#e4e7ef]">
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
