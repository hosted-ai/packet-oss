"use client";

import { useEffect } from "react";

export default function ProviderDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Provider dashboard error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 max-w-lg text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-[#0b0f1c] mb-2">
          Something went wrong
        </h2>
        <p className="text-[#5b6476] mb-4">
          We encountered an error loading the dashboard.
        </p>

        {/* Show error details for debugging */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 text-left">
          <p className="text-red-800 text-sm font-mono break-all">
            {error.message || "Unknown error"}
          </p>
          {error.stack && (
            <details className="mt-2">
              <summary className="text-red-600 text-xs cursor-pointer">Stack trace</summary>
              <pre className="text-red-700 text-xs mt-2 overflow-auto max-h-40 whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1a4fff]/90"
          >
            Try Again
          </button>
          <a
            href="/providers"
            className="px-4 py-2 bg-white border border-[#e4e7ef] text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-50"
          >
            Back to Login
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-xs text-[#5b6476]">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
