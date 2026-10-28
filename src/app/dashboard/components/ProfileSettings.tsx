"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ALL_COUNTRIES, DEFAULT_EMBARGOED_COUNTRIES } from "@/lib/countries";

export interface ProfileData {
  name: string;
  email: string;
  company: string;
  phone: string;
  jobTitle: string;
  website: string;
  timezone: string;
  useCase: string;
  // KYC / billing (required to order bare metal — legal/finance mandate)
  personalAddress: string;
  country: string;
  zipCode: string;
  companyAddress: string;
  companyRegNumber: string;
  companyCountry: string;
  companyZipCode: string;
  companyWebsite: string;
}

interface ProfileSettingsProps {
  token: string;
  /** When true, mark the bare-metal-required (*) fields and show the KYC hints. */
  highlightBilling?: boolean;
  /** When true, render only the form (no card chrome / heading) for embedding in a modal. */
  embedded?: boolean;
  /** Called after a successful save with the persisted profile (e.g. to detect KYC completeness). */
  onSaved?: (profile: ProfileData) => void;
}


const INPUT_CLS =
  "w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent";
const LABEL_CLS = "block text-sm font-medium text-[var(--ink)] mb-1";
const SECTION_TITLE_CLS = "text-sm font-semibold text-[var(--ink)]";
// The UI is English-only — the postal-code label stays English for every
// country (was localised per-country, which surfaced "Postleitzahl" for DE — PA-312).
const ZIP_CODE_LABEL = "Postal / ZIP Code";

// Full IANA timezone list (value = canonical IANA name, matching stored data),
// each labelled with its current UTC offset. Built once from the platform's
// Intl data; falls back to a small set on older runtimes.
const TIMEZONES: { value: string; label: string }[] = (() => {
  let zones: string[];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = [
      "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago",
      "America/New_York", "Europe/London", "Europe/Paris", "Asia/Kolkata",
      "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
    ];
  }
  const part = (tz: string, style: "shortOffset" | "long"): string => {
    try {
      return (
        new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: style })
          .formatToParts()
          .find((p) => p.type === "timeZoneName")?.value ?? ""
      );
    } catch {
      return "";
    }
  };
  return zones
    .map((tz) => {
      const offset = part(tz, "shortOffset"); // e.g. "GMT+5:30"
      const longName = part(tz, "long"); // e.g. "India Standard Time"
      const iana = tz.replace(/_/g, " ");
      // Lead with the descriptive name so zones are findable by what people
      // actually call them (e.g. "India Standard Time"), not just the IANA region
      // ("Asia/Kolkata"). Keep IANA + current offset for precision.
      const named = longName && !longName.startsWith("GMT");
      const label = named
        ? `${longName} — ${iana} (${offset})`
        : offset
          ? `${iana} (${offset})`
          : iana;
      return { value: tz, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
})();

export function ProfileSettings({ token, highlightBilling = false, embedded = false, onSaved }: ProfileSettingsProps) {
  const [profile, setProfile] = useState<ProfileData>({
    name: "",
    email: "",
    company: "",
    phone: "",
    jobTitle: "",
    website: "",
    timezone: "",
    useCase: "",
    personalAddress: "",
    country: "",
    zipCode: "",
    companyAddress: "",
    companyRegNumber: "",
    companyCountry: "",
    companyZipCode: "",
    companyWebsite: "",
  });
  // Live embargo set (from the profile API) drives which countries are
  // selectable; seed with the static default so the dropdown is correct even
  // before the fetch resolves / if it fails.
  const [embargoed, setEmbargoed] = useState<Set<string>>(
    () => new Set(DEFAULT_EMBARGOED_COUNTRIES),
  );
  const countries = useMemo(
    () => ALL_COUNTRIES.filter((c) => !embargoed.has(c.code)),
    [embargoed],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/account/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setProfile(data.profile);
        if (Array.isArray(data.embargoedCountries)) {
          setEmbargoed(new Set<string>(data.embargoedCountries));
        }
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/account/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(profile),
      });

      const data = await res.json();
      if (data.success) {
        import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.PROFILE_UPDATED)).catch(() => {});
        setProfile(data.profile);
        setMessage({ type: "success", text: "Profile updated successfully!" });
        onSaved?.(data.profile);
        // Notify CrispUserSync to re-fetch profile so Crisp sidebar reflects the change immediately
        window.dispatchEvent(new Event("crisp:profile-updated"));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update profile" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    const skeleton = (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-32 bg-gray-200 rounded"></div>
        <div className="h-10 bg-gray-200 rounded"></div>
        <div className="h-10 bg-gray-200 rounded"></div>
      </div>
    );
    return embedded ? (
      skeleton
    ) : (
      <div className="bg-white border border-[var(--line)] rounded-xl p-6">{skeleton}</div>
    );
  }

  // Required-field marker — only shown in the bare-metal/KYC context so a plain
  // profile edit doesn't look over-required.
  const star = highlightBilling ? <span className="text-red-500">*</span> : null;

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* KYC hint — surfaced on the Settings page; the modal has its own header. */}
      {highlightBilling && !embedded && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          Fields marked <span className="text-red-500">*</span> are required to order bare metal
          servers. Use <span className="font-medium">N/A</span> for company fields if you&apos;re an
          individual.
        </div>
      )}

      {/* ── Your details ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className={SECTION_TITLE_CLS}>Your details</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Full Name {star}</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Your name"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg bg-gray-50 text-[var(--muted)] cursor-not-allowed"
            />
            <p className="text-xs text-[var(--muted)] mt-1">Contact support to change your email</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Phone</label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+1 (555) 123-4567"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Website</label>
            <input
              type="url"
              value={profile.website}
              onChange={(e) => setProfile({ ...profile, website: e.target.value })}
              placeholder="https://yourcompany.com"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Job Title</label>
          <input
            type="text"
            value={profile.jobTitle}
            onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })}
            placeholder="e.g. ML Engineer"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Personal Address {star}</label>
          <input
            type="text"
            value={profile.personalAddress}
            onChange={(e) => setProfile({ ...profile, personalAddress: e.target.value })}
            placeholder="Street, city, state"
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Country {star}</label>
            <select
              value={profile.country}
              onChange={(e) => setProfile({ ...profile, country: e.target.value })}
              className={INPUT_CLS}
            >
              <option value="">Select country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>
              {ZIP_CODE_LABEL} {star}
            </label>
            <input
              type="text"
              value={profile.zipCode}
              onChange={(e) => setProfile({ ...profile, zipCode: e.target.value })}
              placeholder={ZIP_CODE_LABEL}
              className={INPUT_CLS}
            />
          </div>
        </div>
      </div>

      {/* ── Company details ────────────────────────────────────────── */}
      <div className="space-y-4 pt-4 border-t border-[var(--line)]">
        <div>
          <h3 className={SECTION_TITLE_CLS}>Company details</h3>
          {highlightBilling && (
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Use <span className="font-medium">N/A</span> in these fields if you&apos;re an
              individual with no company.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Company {star}</label>
            <input
              type="text"
              value={profile.company}
              onChange={(e) => setProfile({ ...profile, company: e.target.value })}
              placeholder='Company name, or "N/A"'
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Company Registration Number</label>
            <input
              type="text"
              value={profile.companyRegNumber}
              onChange={(e) => setProfile({ ...profile, companyRegNumber: e.target.value })}
              placeholder='Registration / VAT number, or "N/A"'
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Company Address {star}</label>
          <input
            type="text"
            value={profile.companyAddress}
            onChange={(e) => setProfile({ ...profile, companyAddress: e.target.value })}
            placeholder='Company HQ address, or "N/A"'
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLS}>Country</label>
            <select
              value={profile.companyCountry}
              onChange={(e) => setProfile({ ...profile, companyCountry: e.target.value })}
              className={INPUT_CLS}
            >
              <option value="">Select country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>{ZIP_CODE_LABEL}</label>
            <input
              type="text"
              value={profile.companyZipCode}
              onChange={(e) => setProfile({ ...profile, companyZipCode: e.target.value })}
              placeholder={ZIP_CODE_LABEL}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Company Website</label>
          <input
            type="url"
            value={profile.companyWebsite}
            onChange={(e) => setProfile({ ...profile, companyWebsite: e.target.value })}
            placeholder="https://company.com"
            className={INPUT_CLS}
          />
        </div>
      </div>

      {/* ── Preferences ────────────────────────────────────────────── */}
      <div className="space-y-4 pt-4 border-t border-[var(--line)]">
        <h3 className={SECTION_TITLE_CLS}>Preferences</h3>

        <div>
          <label className={LABEL_CLS}>Primary Use Case</label>
          <select
            value={profile.useCase}
            onChange={(e) => setProfile({ ...profile, useCase: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="">Select your primary use case</option>
            <option value="ml-training">Machine Learning Training</option>
            <option value="inference">AI Inference</option>
            <option value="fine-tuning">Model Fine-tuning</option>
            <option value="research">Research &amp; Development</option>
            <option value="rendering">3D Rendering / Video</option>
            <option value="gaming">Gaming / Streaming</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className={LABEL_CLS}>Timezone</label>
          <select
            value={profile.timezone}
            onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="">Select your timezone</option>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Message */}
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

      {/* Submit Button */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );

  if (embedded) return formContent;

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Profile</h2>
        <p className="text-sm text-[var(--muted)]">Your personal information and preferences</p>
      </div>
      {formContent}
    </div>
  );
}
