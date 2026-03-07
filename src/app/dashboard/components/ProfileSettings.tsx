"use client";

import { useState, useEffect, useCallback } from "react";

interface ProfileData {
  name: string;
  email: string;
  company: string;
  phone: string;
  jobTitle: string;
  website: string;
  timezone: string;
  useCase: string;
}

interface ProfileSettingsProps {
  token: string;
}

export function ProfileSettings({ token }: ProfileSettingsProps) {
  const [profile, setProfile] = useState<ProfileData>({
    name: "",
    email: "",
    company: "",
    phone: "",
    jobTitle: "",
    website: "",
    timezone: "",
    useCase: "",
  });
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
        setProfile(data.profile);
        setMessage({ type: "success", text: "Profile updated successfully!" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update profile" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update profile" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Profile</h2>
        <p className="text-sm text-[var(--muted)]">
          Your personal information and preferences
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name and Company row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Your name"
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Company
            </label>
            <input
              type="text"
              value={profile.company}
              onChange={(e) => setProfile({ ...profile, company: e.target.value })}
              placeholder="Your company"
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
            />
          </div>
        </div>

        {/* Email (read-only) and Phone row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Email
            </label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg bg-gray-50 text-[var(--muted)] cursor-not-allowed"
            />
            <p className="text-xs text-[var(--muted)] mt-1">Contact support to change your email</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
            />
          </div>
        </div>

        {/* Job Title and Website row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Job Title
            </label>
            <input
              type="text"
              value={profile.jobTitle}
              onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })}
              placeholder="e.g. ML Engineer"
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ink)] mb-1">
              Website
            </label>
            <input
              type="url"
              value={profile.website}
              onChange={(e) => setProfile({ ...profile, website: e.target.value })}
              placeholder="https://yourcompany.com"
              className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
            />
          </div>
        </div>

        {/* Use Case */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1">
            Primary Use Case
          </label>
          <select
            value={profile.useCase}
            onChange={(e) => setProfile({ ...profile, useCase: e.target.value })}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            <option value="">Select your primary use case</option>
            <option value="ml-training">Machine Learning Training</option>
            <option value="inference">AI Inference</option>
            <option value="fine-tuning">Model Fine-tuning</option>
            <option value="research">Research & Development</option>
            <option value="rendering">3D Rendering / Video</option>
            <option value="gaming">Gaming / Streaming</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-sm font-medium text-[var(--ink)] mb-1">
            Timezone
          </label>
          <select
            value={profile.timezone}
            onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
            className="w-full px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
          >
            <option value="">Select your timezone</option>
            <option value="America/Los_Angeles">Pacific Time (PT)</option>
            <option value="America/Denver">Mountain Time (MT)</option>
            <option value="America/Chicago">Central Time (CT)</option>
            <option value="America/New_York">Eastern Time (ET)</option>
            <option value="Europe/London">London (GMT/BST)</option>
            <option value="Europe/Paris">Central European (CET)</option>
            <option value="Europe/Copenhagen">Copenhagen (CET)</option>
            <option value="Asia/Tokyo">Japan (JST)</option>
            <option value="Asia/Singapore">Singapore (SGT)</option>
            <option value="Australia/Sydney">Sydney (AEST)</option>
          </select>
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
    </div>
  );
}
