"use client";

import { useState, useEffect } from "react";
import type { GpuType } from "../types";

export function RatesTab() {
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGpuTypes = async () => {
      try {
        const response = await fetch("/api/providers/gpu-types");
        const data = await response.json();
        if (data.success && data.data?.gpuTypes) {
          setGpuTypes(data.data.gpuTypes);
        } else {
          setError(data.error || "Failed to load rates");
        }
      } catch (err) {
        console.error("Failed to load GPU types:", err);
        setError("Failed to load rates");
      } finally {
        setLoading(false);
      }
    };
    fetchGpuTypes();
  }, []);

  if (loading) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
        <p className="text-[#5b6476]">Loading payout rates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-[#0b0f1c]">Payout Rates</h2>
        <p className="text-[#5b6476] mt-1">
          View the hourly payout rates for each GPU type. These are the rates
          you&apos;ll earn per GPU per hour when your servers are active.
        </p>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-blue-800 font-medium">How earnings work</p>
            <p className="text-blue-700 text-sm mt-1">
              You earn the provider rate for each GPU per hour while your server
              is active and available for customers. Earnings are calculated
              based on utilization and paid out monthly.
            </p>
          </div>
        </div>
      </div>

      {/* GPU Types Grid */}
      {gpuTypes.length === 0 ? (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
          <p className="text-[#5b6476]">No GPU types available at this time.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gpuTypes.map((gpu) => (
            <div
              key={gpu.id}
              className="bg-white border border-[#e4e7ef] rounded-lg p-6 hover:border-[#1a4fff]/30 transition-colors"
            >
              {/* GPU Header */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-[#0b0f1c]">{gpu.name}</h3>
                  <p className="text-sm text-[#5b6476]">{gpu.manufacturer}</p>
                </div>
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                  Active
                </span>
              </div>

              {/* Provider Rate */}
              <div className="bg-[#f7f8fb] rounded-lg p-4 mb-4">
                <p className="text-sm text-[#5b6476] mb-1">Your Payout Rate</p>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  {gpu.providerRate.formatted}
                </p>
                <p className="text-xs text-[#5b6476]">per GPU per hour</p>
              </div>

              {/* Estimated Monthly */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-[#0b0f1c]">
                  Estimated Monthly (per GPU)
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#f7f8fb] rounded p-2">
                    <p className="text-xs text-[#5b6476]">100%</p>
                    <p className="font-semibold text-green-600">
                      {gpu.estimatedMonthly.at100}
                    </p>
                  </div>
                  <div className="bg-[#f7f8fb] rounded p-2">
                    <p className="text-xs text-[#5b6476]">80%</p>
                    <p className="font-semibold text-green-600">
                      {gpu.estimatedMonthly.at80}
                    </p>
                  </div>
                  <div className="bg-[#f7f8fb] rounded p-2">
                    <p className="text-xs text-[#5b6476]">60%</p>
                    <p className="font-semibold text-[#0b0f1c]">
                      {gpu.estimatedMonthly.at60}
                    </p>
                  </div>
                </div>
              </div>

              {/* Terms Type */}
              {gpu.termsType === "revenue_share" && gpu.revenueSharePercent && (
                <div className="mt-4 pt-4 border-t border-[#e4e7ef]">
                  <p className="text-sm text-[#5b6476]">
                    Revenue Share: {gpu.revenueSharePercent}%
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* FAQ Section */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
        <h3 className="font-semibold text-[#0b0f1c] mb-4">
          Frequently Asked Questions
        </h3>
        <div className="space-y-4">
          <div>
            <p className="font-medium text-[#0b0f1c]">
              When do I get paid?
            </p>
            <p className="text-sm text-[#5b6476] mt-1">
              Payouts are processed monthly, typically within the first week of
              the following month. You&apos;ll receive payment for all utilization
              hours from the previous month.
            </p>
          </div>
          <div>
            <p className="font-medium text-[#0b0f1c]">
              What is utilization?
            </p>
            <p className="text-sm text-[#5b6476] mt-1">
              Utilization is the percentage of time your GPU is actively being
              used by a customer. Higher utilization means higher earnings.
            </p>
          </div>
          <div>
            <p className="font-medium text-[#0b0f1c]">
              Can I negotiate custom rates?
            </p>
            <p className="text-sm text-[#5b6476] mt-1">
              Yes, custom rates may be available for providers with larger
              infrastructure. Contact us at support@example.com to discuss.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
