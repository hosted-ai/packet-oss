"use client";

import dynamic from "next/dynamic";

// Use dynamic import to prevent SSR issues
const ProviderDashboard = dynamic(
  () =>
    import("./components/ProviderDashboard").then((mod) => mod.ProviderDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <p className="text-xl text-[#0b0f1c]">Loading...</p>
      </div>
    ),
  }
);

export default function ProviderDashboardPage() {
  return <ProviderDashboard />;
}
