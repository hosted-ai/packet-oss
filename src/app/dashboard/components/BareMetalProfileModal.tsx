"use client";

/**
 * Bare Metal "Complete your profile" gate modal.
 *
 * Shown when a customer initiates a bare-metal order (clicks the CTA) with an
 * incomplete billing/KYC profile — so the demand lands up front, not after they
 * configure an order and hit Generate Invoice. Reuses the existing ProfileSettings
 * form (single source of fields) in embedded mode; the KYC completeness rule is
 * the shared isBareMetalProfileComplete (same rule the server enforces via 422).
 * Soft-dismissible: closing just hides it — the order POST still 422-gates on the
 * server, so this is UX, not the security boundary.
 */

import { useState } from "react";
import { ProfileSettings, type ProfileData } from "./ProfileSettings";
import {
  isBareMetalProfileComplete,
  missingBareMetalProfileFields,
} from "@/lib/baremetal/profile";

// Human labels for the required KYC keys (drives the "still required" hint).
const FIELD_LABELS: Record<string, string> = {
  name: "Full Name",
  personalAddress: "Personal Address",
  country: "Country",
  zipCode: "Postal / ZIP Code",
  companyName: "Company",
  companyAddress: "Company Address",
};

// The profile form/API uses `company`; the KYC rule keys on `companyName`.
function toKycInput(p: ProfileData) {
  return {
    name: p.name,
    personalAddress: p.personalAddress,
    country: p.country,
    zipCode: p.zipCode,
    companyName: p.company,
    companyAddress: p.companyAddress,
  };
}

interface Props {
  token: string;
  /** Fired once the saved profile satisfies the KYC rule — modal should close + proceed. */
  onComplete: () => void;
  /** Soft-dismiss — the customer can finish later from Settings. */
  onClose: () => void;
}

export function BareMetalProfileModal({ token, onComplete, onClose }: Props) {
  const [missing, setMissing] = useState<string[] | null>(null);

  const handleSaved = (p: ProfileData) => {
    const input = toKycInput(p);
    if (isBareMetalProfileComplete(input)) {
      onComplete();
    } else {
      setMissing(missingBareMetalProfileFields(input).map((k) => FIELD_LABELS[k] ?? k));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-6 pb-4 border-b border-[var(--line)]">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ink)]">Complete your profile</h3>
              <p className="text-sm text-[var(--muted)] mt-0.5">
                Bare metal orders require billing details for invoicing. Fill in the required
                fields below, then save to continue. Type <span className="font-medium">N/A</span>{" "}
                for company fields if not applicable.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close — you can finish this later in Settings"
            className="text-zinc-400 hover:text-zinc-600 font-bold shrink-0 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body (scrolls) */}
        <div className="overflow-y-auto px-6 py-4">
          {missing && missing.length > 0 && (
            <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
              Still required before you can order: {missing.join(", ")}.
            </div>
          )}
          <ProfileSettings token={token} embedded highlightBilling onSaved={handleSaved} />
        </div>
      </div>
    </div>
  );
}
