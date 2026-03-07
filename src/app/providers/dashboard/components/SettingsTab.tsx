"use client";

import { useState, useEffect } from "react";
import type { ProviderProfile } from "../types";

interface SettingsTabProps {
  profile: ProviderProfile;
  actionLoading: boolean;
  onUpdateProfile: (updates: Partial<ProviderProfile>) => Promise<boolean>;
}

export function SettingsTab({
  profile,
  actionLoading,
  onUpdateProfile,
}: SettingsTabProps) {
  const [formData, setFormData] = useState({
    companyName: profile.companyName,
    contactName: profile.contactName,
    phone: profile.phone || "",
    website: profile.website || "",
    supportEmail: profile.supportEmail || "",
    supportPhone: profile.supportPhone || "",
    commercialEmail: profile.commercialEmail || "",
    commercialPhone: profile.commercialPhone || "",
    generalEmail: profile.generalEmail || "",
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const changed =
      formData.companyName !== profile.companyName ||
      formData.contactName !== profile.contactName ||
      formData.phone !== (profile.phone || "") ||
      formData.website !== (profile.website || "") ||
      formData.supportEmail !== (profile.supportEmail || "") ||
      formData.supportPhone !== (profile.supportPhone || "") ||
      formData.commercialEmail !== (profile.commercialEmail || "") ||
      formData.commercialPhone !== (profile.commercialPhone || "") ||
      formData.generalEmail !== (profile.generalEmail || "");

    setHasChanges(changed);
    if (changed) {
      setSaved(false);
    }
  }, [formData, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await onUpdateProfile({
      companyName: formData.companyName,
      contactName: formData.contactName,
      phone: formData.phone || null,
      website: formData.website || null,
      supportEmail: formData.supportEmail || null,
      supportPhone: formData.supportPhone || null,
      commercialEmail: formData.commercialEmail || null,
      commercialPhone: formData.commercialPhone || null,
      generalEmail: formData.generalEmail || null,
    });

    if (success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-[#0b0f1c]">Settings</h2>

      {/* Account Info */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
          Account Information
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-[#5b6476]">Email</p>
            <p className="text-[#0b0f1c] font-medium">{profile.email}</p>
          </div>
          <div>
            <p className="text-sm text-[#5b6476]">Status</p>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                profile.status === "active"
                  ? "bg-green-100 text-green-800"
                  : profile.status === "pending"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-800"
              }`}
            >
              {profile.status.charAt(0).toUpperCase() + profile.status.slice(1)}
            </span>
          </div>
          <div>
            <p className="text-sm text-[#5b6476]">Member Since</p>
            <p className="text-[#0b0f1c]">
              {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>
          {profile.verifiedAt && (
            <div>
              <p className="text-sm text-[#5b6476]">Verified</p>
              <p className="text-[#0b0f1c]">
                {new Date(profile.verifiedAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Profile Form */}
      <form onSubmit={handleSubmit}>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
            Company Profile
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Company Name *
              </label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) =>
                  setFormData({ ...formData, companyName: e.target.value })
                }
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Contact Name *
              </label>
              <input
                type="text"
                value={formData.contactName}
                onChange={(e) =>
                  setFormData({ ...formData, contactName: e.target.value })
                }
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) =>
                  setFormData({ ...formData, website: e.target.value })
                }
                placeholder="https://"
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
          </div>

          <h4 className="font-medium text-[#0b0f1c] mb-3">Contact Points</h4>
          <p className="text-sm text-[#5b6476] mb-4">
            Provide contact information for different departments
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Technical Support Email
              </label>
              <input
                type="email"
                value={formData.supportEmail}
                onChange={(e) =>
                  setFormData({ ...formData, supportEmail: e.target.value })
                }
                placeholder="support@company.com"
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Technical Support Phone
              </label>
              <input
                type="tel"
                value={formData.supportPhone}
                onChange={(e) =>
                  setFormData({ ...formData, supportPhone: e.target.value })
                }
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Commercial/Billing Email
              </label>
              <input
                type="email"
                value={formData.commercialEmail}
                onChange={(e) =>
                  setFormData({ ...formData, commercialEmail: e.target.value })
                }
                placeholder="billing@company.com"
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Commercial/Billing Phone
              </label>
              <input
                type="tel"
                value={formData.commercialPhone}
                onChange={(e) =>
                  setFormData({ ...formData, commercialPhone: e.target.value })
                }
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                General Inquiries Email
              </label>
              <input
                type="email"
                value={formData.generalEmail}
                onChange={(e) =>
                  setFormData({ ...formData, generalEmail: e.target.value })
                }
                placeholder="info@company.com"
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#e4e7ef]">
            <div>
              {saved && (
                <span className="text-green-600 text-sm flex items-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Changes saved
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={!hasChanges || actionLoading}
              className="px-6 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </form>

      {/* Support Section */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
          Need Help?
        </h3>
        <p className="text-[#5b6476] mb-4">
          If you have questions about your account, payouts, or need technical
          support, please contact us.
        </p>
        <div className="flex gap-4">
          <a
            href="mailto:support@example.com"
            className="px-4 py-2 bg-white border border-[#e4e7ef] text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-50"
          >
            Email Support
          </a>
          <a
            href="https://example.com/docs/providers"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-white border border-[#e4e7ef] text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-50"
          >
            View Documentation
          </a>
        </div>
      </div>
    </div>
  );
}
