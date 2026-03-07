"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface GpuType {
  id: string;
  name: string;
  shortName: string;
  manufacturer: string;
  providerRate: {
    cents: number;
    formatted: string;
  };
  estimatedMonthly: {
    at100: string;
    at80: string;
    at60: string;
  };
}

// Default GPU types when none are configured in the database
const DEFAULT_GPU_TYPES: GpuType[] = [
  {
    id: "a100",
    name: "NVIDIA A100",
    shortName: "A100",
    manufacturer: "NVIDIA",
    providerRate: { cents: 200, formatted: "$2.00/hr" },
    estimatedMonthly: { at100: "$1440", at80: "$1152", at60: "$864" },
  },
  {
    id: "h100",
    name: "NVIDIA H100",
    shortName: "H100",
    manufacturer: "NVIDIA",
    providerRate: { cents: 350, formatted: "$3.50/hr" },
    estimatedMonthly: { at100: "$2520", at80: "$2016", at60: "$1512" },
  },
  {
    id: "h200",
    name: "NVIDIA H200",
    shortName: "H200",
    manufacturer: "NVIDIA",
    providerRate: { cents: 450, formatted: "$4.50/hr" },
    estimatedMonthly: { at100: "$3240", at80: "$2592", at60: "$1944" },
  },
  {
    id: "b200",
    name: "NVIDIA B200",
    shortName: "B200",
    manufacturer: "NVIDIA",
    providerRate: { cents: 550, formatted: "$5.50/hr" },
    estimatedMonthly: { at100: "$3960", at80: "$3168", at60: "$2376" },
  },
  {
    id: "b300",
    name: "NVIDIA B300",
    shortName: "B300",
    manufacturer: "NVIDIA",
    providerRate: { cents: 650, formatted: "$6.50/hr" },
    estimatedMonthly: { at100: "$4680", at80: "$3744", at60: "$2808" },
  },
  {
    id: "rtx-pro-6000",
    name: "NVIDIA RTX PRO 6000 Blackwell (96GB)",
    shortName: "RTX PRO 6000",
    manufacturer: "NVIDIA",
    providerRate: { cents: 150, formatted: "$1.50/hr" },
    estimatedMonthly: { at100: "$1080", at80: "$864", at60: "$648" },
  },
];

export default function ProviderApplyPage() {
  const [applicationType, setApplicationType] = useState<"gpu_provider" | "white_label">(() => {
    if (typeof window !== "undefined" && window.location.hash === "#whitelabel") return "white_label";
    return "gpu_provider";
  });
  const [formData, setFormData] = useState({
    email: "",
    companyName: "",
    contactName: "",
    phone: "",
    website: "",
    supportEmail: "",
    supportPhone: "",
    commercialEmail: "",
    commercialPhone: "",
    generalEmail: "",
    estimatedGpuCount: "",
    selectedGpuTypes: [] as string[],
    selectedRegions: [] as string[],
    additionalInfo: "",
    // White label fields
    desiredDomain: "",
    expectedCustomers: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [gpuTypes, setGpuTypes] = useState<GpuType[]>([]);
  const [loadingGpuTypes, setLoadingGpuTypes] = useState(true);

  const regions = [
    { id: "us-east", name: "US East (Virginia)" },
    { id: "us-west", name: "US West (California)" },
    { id: "eu-west", name: "EU West (Ireland)" },
    { id: "eu-central", name: "EU Central (Frankfurt)" },
    { id: "asia-east", name: "Asia East (Singapore)" },
    { id: "asia-south", name: "Asia South (Mumbai)" },
    { id: "other", name: "Other" },
  ];

  useEffect(() => {
    const fetchGpuTypes = async () => {
      try {
        const response = await fetch("/api/providers/gpu-types");
        const data = await response.json();
        if (data.success && data.data.gpuTypes.length > 0) {
          setGpuTypes(data.data.gpuTypes);
        } else {
          // Use default GPU types if none configured in database
          setGpuTypes(DEFAULT_GPU_TYPES);
        }
      } catch (error) {
        console.error("Failed to fetch GPU types:", error);
        // Use default GPU types on error
        setGpuTypes(DEFAULT_GPU_TYPES);
      } finally {
        setLoadingGpuTypes(false);
      }
    };
    fetchGpuTypes();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/providers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationType,
          email: formData.email,
          companyName: formData.companyName,
          contactName: formData.contactName,
          phone: formData.phone || undefined,
          website: formData.website || undefined,
          supportEmail: formData.supportEmail || undefined,
          supportPhone: formData.supportPhone || undefined,
          commercialEmail: formData.commercialEmail || undefined,
          commercialPhone: formData.commercialPhone || undefined,
          generalEmail: formData.generalEmail || undefined,
          estimatedGpuCount: formData.estimatedGpuCount
            ? parseInt(formData.estimatedGpuCount)
            : undefined,
          gpuTypes: formData.selectedGpuTypes,
          regions: formData.selectedRegions,
          additionalInfo: formData.additionalInfo || undefined,
          desiredDomain: formData.desiredDomain || undefined,
          expectedCustomers: formData.expectedCustomers || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to submit application. Please try again.",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleGpuType = (gpuId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedGpuTypes: prev.selectedGpuTypes.includes(gpuId)
        ? prev.selectedGpuTypes.filter((id) => id !== gpuId)
        : [...prev.selectedGpuTypes, gpuId],
    }));
  };

  const toggleRegion = (regionId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedRegions: prev.selectedRegions.includes(regionId)
        ? prev.selectedRegions.filter((id) => id !== regionId)
        : [...prev.selectedRegions, regionId],
    }));
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[#0b0f1c] mb-2">
              Application Submitted
            </h2>
            <p className="text-[#5b6476] mb-6">
              {applicationType === "white_label"
                ? "Thank you for your interest in a GPU Cloud White Label platform. We've sent a confirmation email to "
                : "Thank you for your interest in becoming a GPU Cloud provider. We've sent a confirmation email to "}
              {formData.email}. Our team will review your application and get back to you within 2-3 business days.
            </p>
            <Link
              href="/providers"
              className="inline-block bg-[#1a4fff] text-white py-3 px-6 rounded-lg font-medium hover:bg-[#1a4fff]/90"
            >
              Return to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb] py-12 px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0b0f1c]">
            {applicationType === "white_label" ? "Launch Your Own GPU Cloud" : "Become a GPU Cloud Provider"}
          </h1>
          <p className="text-[#5b6476] mt-2">
            {applicationType === "white_label"
              ? "White-label our platform under your brand — fully managed by GPU Cloud"
              : "Monetize your GPU infrastructure by joining our provider network"}
          </p>
        </div>

        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8">
          <form onSubmit={handleSubmit}>
            {/* Application Type Selector */}
            <div className="mb-8">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setApplicationType("gpu_provider")}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    applicationType === "gpu_provider"
                      ? "border-[#1a4fff] bg-[#1a4fff]/5"
                      : "border-[#e4e7ef] hover:border-[#1a4fff]/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5 text-[#1a4fff]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                    <span className="font-semibold text-[#0b0f1c]">GPU Provider</span>
                  </div>
                  <p className="text-xs text-[#5b6476]">I have GPUs and want to earn revenue by renting them out on the platform</p>
                </button>
                <button
                  type="button"
                  onClick={() => setApplicationType("white_label")}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    applicationType === "white_label"
                      ? "border-[#18b6a8] bg-[#18b6a8]/5"
                      : "border-[#e4e7ef] hover:border-[#18b6a8]/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5 text-[#18b6a8]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                    <span className="font-semibold text-[#0b0f1c]">White Label Platform</span>
                  </div>
                  <p className="text-xs text-[#5b6476]">I want to run my own GPU cloud under my brand, powered by GPU Cloud</p>
                </button>
              </div>
            </div>

            {/* Company Information */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                Company Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
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
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
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
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Website *
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) =>
                      setFormData({ ...formData, website: e.target.value })
                    }
                    placeholder="https://"
                    required
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                  />
                </div>
              </div>
            </div>

            {/* Contact Points — GPU Provider only */}
            {applicationType === "gpu_provider" && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                Contact Points
              </h3>
              <p className="text-[#5b6476] text-sm mb-4">
                Provide contact information for different departments (optional)
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
            </div>
            )}

            {/* Infrastructure Details — GPU Provider only */}
            {applicationType === "gpu_provider" && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                Infrastructure Details
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  Estimated GPU Count
                </label>
                <input
                  type="number"
                  value={formData.estimatedGpuCount}
                  onChange={(e) =>
                    setFormData({ ...formData, estimatedGpuCount: e.target.value })
                  }
                  placeholder="e.g. 10"
                  min="1"
                  className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  GPU Types Available
                </label>
                {loadingGpuTypes ? (
                  <p className="text-[#5b6476] text-sm">Loading GPU types...</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {gpuTypes.map((gpu) => (
                      <label
                        key={gpu.id}
                        className={`flex items-center p-3 border rounded-lg cursor-pointer ${
                          formData.selectedGpuTypes.includes(gpu.id)
                            ? "border-[#1a4fff] bg-[#1a4fff]/5"
                            : "border-[#e4e7ef] hover:border-[#1a4fff]/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.selectedGpuTypes.includes(gpu.id)}
                          onChange={() => toggleGpuType(gpu.id)}
                          className="sr-only"
                        />
                        <div className="flex-1">
                          <span className="text-[#0b0f1c] font-medium text-sm">
                            {gpu.name}
                          </span>
                          <p className="text-[#5b6476] text-xs">
                            {gpu.providerRate.formatted} • ~{gpu.estimatedMonthly.at80}/mo
                          </p>
                        </div>
                        {formData.selectedGpuTypes.includes(gpu.id) && (
                          <svg
                            className="w-5 h-5 text-[#1a4fff]"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                  Datacenter Regions
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {regions.map((region) => (
                    <label
                      key={region.id}
                      className={`flex items-center p-3 border rounded-lg cursor-pointer ${
                        formData.selectedRegions.includes(region.id)
                          ? "border-[#1a4fff] bg-[#1a4fff]/5"
                          : "border-[#e4e7ef] hover:border-[#1a4fff]/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.selectedRegions.includes(region.id)}
                        onChange={() => toggleRegion(region.id)}
                        className="sr-only"
                      />
                      <span className="flex-1 text-[#0b0f1c] text-sm">
                        {region.name}
                      </span>
                      {formData.selectedRegions.includes(region.id) && (
                        <svg
                          className="w-5 h-5 text-[#1a4fff]"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            )}

            {/* White Label Details */}
            {applicationType === "white_label" && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
                Platform Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Desired Domain
                  </label>
                  <input
                    type="text"
                    value={formData.desiredDomain}
                    onChange={(e) =>
                      setFormData({ ...formData, desiredDomain: e.target.value })
                    }
                    placeholder="e.g. gpu.yourcompany.com"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#18b6a8] text-[#0b0f1c]"
                  />
                  <p className="text-xs text-[#5b6476] mt-1">The domain your customers will use to access your GPU cloud platform</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                    Expected Number of Customers
                  </label>
                  <input
                    type="text"
                    value={formData.expectedCustomers}
                    onChange={(e) =>
                      setFormData({ ...formData, expectedCustomers: e.target.value })
                    }
                    placeholder="e.g. 50-100 in first year"
                    className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#18b6a8] text-[#0b0f1c]"
                  />
                </div>
              </div>
            </div>
            )}

            {/* Additional Information */}
            <div className="mb-8">
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Additional Information
              </label>
              <textarea
                value={formData.additionalInfo}
                onChange={(e) =>
                  setFormData({ ...formData, additionalInfo: e.target.value })
                }
                placeholder="Tell us more about your infrastructure, requirements, or any questions..."
                rows={4}
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-[#0b0f1c]"
              />
            </div>

            {message && (
              <div
                className={`mb-6 p-4 rounded-lg ${
                  message.type === "success"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={
                isSubmitting ||
                !formData.email ||
                !formData.companyName ||
                !formData.contactName ||
                !formData.website
              }
              className={`w-full text-white py-3 px-4 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                applicationType === "white_label"
                  ? "bg-[#18b6a8] hover:bg-[#18b6a8]/90"
                  : "bg-[#1a4fff] hover:bg-[#1a4fff]/90"
              }`}
            >
              {isSubmitting ? "Submitting..." : "Submit Application"}
            </button>
          </form>
        </div>

        <div className="text-center mt-6">
          <Link
            href="/providers"
            className="text-[#5b6476] text-sm hover:text-[#0b0f1c]"
          >
            ← Already a provider? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
