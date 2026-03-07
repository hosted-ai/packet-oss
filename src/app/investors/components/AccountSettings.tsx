"use client";

import { TwoFactorSettings } from "@/components/two-factor";
import { SectionHeader } from "./SectionHeader";

export function AccountSettings() {
  return (
    <section className="border-t border-[#e4e7ef] pt-8 mb-8">
      <SectionHeader title="Account Settings" />
      <div className="max-w-2xl">
        <TwoFactorSettings
          userType="investor"
          apiEndpoint="/api/investor/two-factor"
          onStatusChange={() => {
            // Optionally reload data or show notification
          }}
        />
      </div>
    </section>
  );
}
