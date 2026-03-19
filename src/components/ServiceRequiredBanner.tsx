"use client";

interface ServiceRequiredBannerProps {
  serviceName: string;
  serviceLabel: string;
  configured: boolean;
}

/**
 * Shows an informational banner when a required service is not configured.
 * Tabs are NOT disabled — the banner is informational only.
 */
export function ServiceRequiredBanner({
  serviceName,
  serviceLabel,
  configured,
}: ServiceRequiredBannerProps) {
  if (configured) return null;

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
      <svg
        className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <div>
        <p className="text-sm font-medium text-amber-800">
          {serviceLabel} is not configured
        </p>
        <p className="text-sm text-amber-600 mt-0.5">
          Some features on this page require {serviceLabel} to be set up.{" "}
          <a
            href="/admin?tab=platform-settings"
            className="underline hover:text-amber-800"
          >
            Go to Platform Settings
          </a>{" "}
          to configure it.
        </p>
      </div>
    </div>
  );
}
