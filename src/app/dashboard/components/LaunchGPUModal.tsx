"use client";

import { useState, useEffect } from "react";
import { STARTUP_SCRIPT_PRESETS, type StartupScriptPreset } from "@/lib/startup-scripts";

// MAINTENANCE MODE — set to false when hosted.ai instance creation is fixed
const DEPLOY_MAINTENANCE = false;

// Types matching the new launch-options API response
interface LaunchProduct {
  id: string;
  name: string;
  description: string | null;
  pricePerHourCents: number;
  pricePerMonthCents: number | null;
  billingType: string;
  stripePriceId: string | null;
  serviceId: string | null;
  displayOrder: number;
  active: boolean;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  cudaCores: number | null;
  available: boolean;
  regions: Array<{ id: number; region_name: string; name?: string }>;
}

interface SharedVolume {
  id: number;
  name: string;
  size_in_gb: number;
  region_id: number;
  status: string;
  mount_point: string;
  cost: string | number;
}

interface LaunchOptionsData {
  products: LaunchProduct[];
  existingSharedVolumes: SharedVolume[];
  teamId: string;
  walletBalanceCents: number;
}

interface LaunchGPUModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  customerEmail?: string;
  onSuccess: (launchInfo: { name: string; poolName: string }) => void;
  onError?: (message: string) => void;
  gpuDashboardUrl?: string | null;
  onTopup?: (amount: number, voucherCode?: string, launchProductId?: string) => void;
  topupLoading?: boolean;
  initialProductId?: string;
}

export function LaunchGPUModal({
  isOpen,
  onClose,
  token,
  customerEmail,
  onSuccess,
  onError,
  gpuDashboardUrl,
  onTopup,
  topupLoading,
  initialProductId,
}: LaunchGPUModalProps) {
  const [loading, setLoading] = useState(true);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [launchSeconds, setLaunchSeconds] = useState(0);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<LaunchOptionsData | null>(null);

  // Form state
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [storageMode, setStorageMode] = useState<"auto" | "existing">("auto");
  const [selectedExistingVolume, setSelectedExistingVolume] = useState<number | null>(null);
  const [selectedStartupScript, setSelectedStartupScript] = useState<string>("");
  const [customScript, setCustomScript] = useState("");
  const [showCustomScript, setShowCustomScript] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFundWallet, setShowFundWallet] = useState(false);

  const selectedProductDetails = options?.products?.find((p) => p.id === selectedProduct);

  // Auto-select first region when product changes
  useEffect(() => {
    if (selectedProductDetails?.regions?.length) {
      setSelectedRegion(selectedProductDetails.regions[0].id);
    } else {
      setSelectedRegion(null);
    }
  }, [selectedProduct, selectedProductDetails?.regions]);

  // Countdown timer while loading GPU options
  useEffect(() => {
    if (!loading) {
      setLoadingSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  // Track elapsed time during launch
  useEffect(() => {
    if (!launching) {
      setLaunchSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setLaunchSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [launching]);

  // Fetch launch options when modal opens
  useEffect(() => {
    if (!isOpen) return;
    async function fetchOptions() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/instances/launch-options", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data: LaunchOptionsData = await response.json();
          setOptions(data);

          // Auto-select product
          if (data.products?.length > 0) {
            if (initialProductId) {
              const target = data.products.find((p) => p.id === initialProductId);
              if (target) {
                setSelectedProduct(target.id);
              }
            }

            if (!initialProductId || !data.products.find((p) => p.id === initialProductId)) {
              // Pick first available product, preferring featured
              const featured = data.products.find((p) => p.available && p.featured);
              const firstAvailable = data.products.find((p) => p.available);
              const pick = featured || firstAvailable || data.products[0];
              if (pick) setSelectedProduct(pick.id);
            }
          }
        } else {
          const errData = await response.json();
          setError(errData.error || "Failed to load GPU options");
        }
      } catch {
        setError("Failed to load GPU options");
      } finally {
        setLoading(false);
      }
    }
    fetchOptions();
  }, [isOpen, token]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInstanceName("");
      setError("");
      setLaunching(false);
      setSelectedProduct("");
      setSelectedStartupScript("");
      setCustomScript("");
      setShowCustomScript(false);
      setShowAdvanced(false);
      setShowFundWallet(false);
      setStorageMode("auto");
      setSelectedExistingVolume(null);
    }
  }, [isOpen]);

  // Wallet balance check — returns true if sufficient (or monthly billing)
  const checkWalletBalance = (): boolean => {
    if (!selectedProductDetails) return false;

    // Monthly products are billed via Stripe subscription, no wallet check needed
    if (selectedProductDetails.billingType === "monthly") return true;

    const MINIMUM_BILLING_MINUTES = 30;
    const hourlyRateCents = selectedProductDetails.pricePerHourCents;
    const requiredCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * 1);
    const walletCents = options?.walletBalanceCents ?? 0;

    return requiredCents <= 0 || walletCents >= requiredCents;
  };

  const getMinimumRequired = (): string => {
    const MINIMUM_BILLING_MINUTES = 30;
    const hourlyRateCents = selectedProductDetails?.pricePerHourCents ?? 0;
    const requiredCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * 1);
    return (requiredCents / 100).toFixed(2);
  };

  const handleLaunch = async () => {
    if (!options || !selectedProduct || !instanceName.trim()) {
      setError("Please select a GPU and enter a name");
      return;
    }

    if (!selectedProductDetails?.available) {
      setError("This GPU is not currently available");
      return;
    }

    // Wallet balance gate (skip for monthly billing)
    if (!checkWalletBalance()) {
      setShowFundWallet(true);
      return;
    }

    const productName = selectedProductDetails?.name || "GPU";

    // Determine startup script
    let startupScript: string | undefined;
    let startupScriptPresetId: string | undefined;
    if (selectedStartupScript === "custom" && customScript.trim()) {
      startupScript = customScript.trim();
    } else if (selectedStartupScript) {
      const preset = STARTUP_SCRIPT_PRESETS.find((p) => p.id === selectedStartupScript);
      startupScript = preset?.script;
      startupScriptPresetId = preset?.id;
    }

    // Optimistic close — modal closes immediately, API fires in background
    import("@/lib/plerdy")
      .then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.GPU_DEPLOYED))
      .catch(() => {});
    if (typeof (window as any).my_analytics !== "undefined") {
      (window as any).my_analytics.goal("dc2zgi7efaqu6o3h");
    }
    if (typeof (window as any).lintrk === "function") {
      (window as any).lintrk("track", { conversion_id: 24436340 });
    }
    onSuccess({ name: instanceName.trim(), poolName: productName });
    onClose();

    // Fire the API call in the background
    try {
      const response = await fetch("/api/instances", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: instanceName.trim(),
          product_id: selectedProduct,
          region_id: selectedRegion,
          startup_script: startupScript || undefined,
          startup_script_preset_id: startupScriptPresetId || undefined,
          existing_shared_volume_id: storageMode === "existing" ? selectedExistingVolume : undefined,
          skip_auto_storage: storageMode === "auto" ? undefined : true,
          billingType: selectedProductDetails?.billingType || undefined,
          vgpus: 1,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        onError?.(data.error || "Failed to launch GPU");
      }
    } catch (err) {
      // Network timeout — the server likely processed the request (GPU spins up)
      // but the response took longer than the proxy timeout. Don't alarm the user.
      console.warn("Launch request network error (GPU likely provisioning):", err);
    }
  };

  if (!isOpen) return null;

  const walletBalanceDollars = ((options?.walletBalanceCents ?? 0) / 100).toFixed(2);
  const canLaunch =
    !!selectedProduct &&
    !!selectedRegion &&
    !!instanceName.trim() &&
    !!selectedProductDetails?.available &&
    !launching;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--ink)]">New GPU</h2>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {DEPLOY_MAINTENANCE ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[var(--ink)] mb-2">Scheduled Maintenance</h3>
              <p className="text-sm text-[var(--muted)] mb-4">
                New GPU deployments are temporarily unavailable while we perform infrastructure
                upgrades. Your existing GPUs are not affected.
              </p>
              <p className="text-xs text-zinc-400">Please check back shortly.</p>
              <button
                onClick={onClose}
                className="mt-4 px-6 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors text-sm"
              >
                Close
              </button>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-900"></div>
              <p className="text-sm text-[var(--muted)]">Checking GPU availability...</p>
              <p className="text-xs text-zinc-400">
                This can take up to 15 seconds ({Math.max(0, 15 - loadingSeconds)}s)
              </p>
            </div>
          ) : error && !options ? (
            <div className="text-center py-8">
              {error.includes("No team") ? (
                <>
                  <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-amber-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-[var(--ink)] mb-2">Unlock GPU Access</h3>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Add funds to deploy GPU instances.
                    <br />
                    Your free account includes 10,000 tokens for Token Factory.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[50, 100, 250, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        disabled={topupLoading}
                        onClick={() =>
                          onTopup?.(amount * 100, undefined, selectedProduct || undefined)
                        }
                        className="px-4 py-3 border-2 border-[var(--line)] rounded-xl text-center font-semibold text-[var(--ink)] hover:border-teal-500 hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {topupLoading ? "..." : `$${amount}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--muted)]">Minimum $50 deposit required</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--muted)] mb-4">{error}</p>
                  <button
                    onClick={onClose}
                    className="text-sm text-zinc-600 hover:text-[var(--ink)]"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          ) : showFundWallet ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-[var(--ink)] mb-2">Fund Your Wallet</h3>
              <p className="text-sm text-[var(--muted)] mb-1">
                You need at least{" "}
                <span className="font-semibold text-[var(--ink)]">${getMinimumRequired()}</span> to
                launch this GPU.
              </p>
              <p className="text-sm text-[var(--muted)] mb-5">
                Your current balance is{" "}
                <span className="font-semibold text-[var(--ink)]">${walletBalanceDollars}</span>.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[50, 100, 250, 500].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    disabled={topupLoading}
                    onClick={() =>
                      onTopup?.(amount * 100, undefined, selectedProduct || undefined)
                    }
                    className="px-4 py-3 border-2 border-[var(--line)] rounded-xl text-center font-semibold text-[var(--ink)] hover:border-teal-500 hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {topupLoading ? "..." : `$${amount}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--muted)]">Minimum $50 deposit required</p>
            </div>
          ) : (
            <>
              {/* GPU Product Selection */}
              {options?.products && options.products.length > 0 ? (
                <div className="mb-5">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-3 uppercase tracking-wide">
                    Select a GPU
                  </label>
                  <div className="space-y-2">
                    {options.products.map((product) => {
                      const isSelected = selectedProduct === product.id;
                      const isAvailable = product.available;
                      const pricePerHour = (product.pricePerHourCents / 100).toFixed(2);
                      const hasMonthly =
                        product.pricePerMonthCents && product.pricePerMonthCents > 0;
                      const monthlyHourlyRate = hasMonthly
                        ? (product.pricePerMonthCents! / 100 / 730).toFixed(2)
                        : null;
                      const savingsPercent = hasMonthly
                        ? Math.round(
                            (1 -
                              product.pricePerMonthCents! /
                                100 /
                                730 /
                                (product.pricePerHourCents / 100)) *
                              100
                          )
                        : 0;

                      return (
                        <button
                          key={product.id}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => {
                            if (isAvailable) setSelectedProduct(product.id);
                          }}
                          className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                            !isAvailable
                              ? "border-[var(--line)] bg-zinc-50 opacity-60 cursor-not-allowed"
                              : isSelected
                                ? "border-teal-500 bg-teal-50"
                                : "border-[var(--line)] hover:border-teal-300 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {product.featured && (
                                  <svg
                                    className="w-4 h-4 text-amber-500 flex-shrink-0"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                  </svg>
                                )}
                                <span className="font-medium text-[var(--ink)]">
                                  {product.name}
                                </span>
                                {product.badgeText && (
                                  <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                                    {product.badgeText}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-[var(--muted)] mt-1">
                                {product.vramGb && `${product.vramGb}GB VRAM`}
                                {product.description && ` · ${product.description}`}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-3">
                              {!isAvailable ? (
                                <span className="text-xs font-medium text-zinc-400">
                                  No GPUs available
                                </span>
                              ) : hasMonthly ? (
                                <>
                                  <div className="flex items-baseline gap-1.5 justify-end">
                                    <span className="text-lg font-bold text-teal-600">
                                      ${monthlyHourlyRate}
                                    </span>
                                    <span className="text-xs text-[var(--muted)]">eff/hr</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <span className="text-xs text-[var(--muted)] line-through">
                                      ${pricePerHour}/hr
                                    </span>
                                    <span className="text-xs font-medium text-teal-600">
                                      Save {savingsPercent}%
                                    </span>
                                  </div>
                                  <div className="text-xs text-[var(--muted)] mt-0.5">
                                    ${(product.pricePerMonthCents! / 100).toFixed(0)}/mo commitment
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-lg font-bold text-[var(--ink)]">
                                    ${pricePerHour}
                                  </div>
                                  <div className="text-xs text-[var(--muted)]">per hour</div>
                                </>
                              )}
                            </div>
                            {isSelected && isAvailable && (
                              <div className="ml-3 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <svg
                                  className="w-4 h-4 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mb-5">
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <svg
                        className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <div>
                        <p className="font-medium text-amber-800">No GPUs Available</p>
                        <p className="text-sm text-amber-700 mt-1">
                          There are currently no GPU products configured. Please contact support.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Region Picker */}
              {selectedProductDetails && selectedProductDetails.regions.length > 0 && (
                <div className="mb-5">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                    Region
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selectedProductDetails.regions.map((region) => (
                      <button
                        key={region.id}
                        type="button"
                        onClick={() => setSelectedRegion(region.id)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          selectedRegion === region.id
                            ? "border-teal-500 bg-teal-50 text-teal-700 font-medium"
                            : "border-[var(--line)] text-[var(--muted)] hover:border-zinc-300"
                        }`}
                      >
                        {region.region_name || region.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Instance Name */}
              <div className="mb-5">
                <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                  Name
                </label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="my-gpu-workspace"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--line)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-sm"
                />
              </div>

              {/* Advanced Options (collapsible) */}
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-teal-600 hover:text-teal-700 transition-colors group"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  <span>Advanced options</span>
                  {/* Badges showing active selections when collapsed */}
                  {!showAdvanced && (
                    <div className="flex gap-1.5">
                      {selectedStartupScript && (
                        <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-700 rounded-full">
                          {STARTUP_SCRIPT_PRESETS.find((p) => p.id === selectedStartupScript)
                            ?.name || "Custom script"}
                        </span>
                      )}
                      {storageMode === "existing" && selectedExistingVolume && (
                        <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-700 rounded-full">
                          Storage attached
                        </span>
                      )}
                    </div>
                  )}
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    {/* Startup Script */}
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-2">
                        Startup script
                      </label>
                      <div className="space-y-1">
                        {/* None option */}
                        <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-zinc-50 cursor-pointer transition-colors">
                          <input
                            type="radio"
                            name="startup-script"
                            checked={!selectedStartupScript}
                            onChange={() => {
                              setSelectedStartupScript("");
                              setShowCustomScript(false);
                            }}
                            className="w-4 h-4 accent-teal-500"
                          />
                          <span className="text-sm text-[var(--muted)]">None (bare GPU)</span>
                        </label>

                        {/* Preset options */}
                        {STARTUP_SCRIPT_PRESETS.map((preset) => (
                          <label
                            key={preset.id}
                            className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                              selectedStartupScript === preset.id
                                ? "bg-teal-50"
                                : "hover:bg-zinc-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="startup-script"
                              checked={selectedStartupScript === preset.id}
                              onChange={() => {
                                setSelectedStartupScript(preset.id);
                                setShowCustomScript(false);
                              }}
                              className="w-4 h-4 mt-0.5 accent-teal-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span>{preset.icon}</span>
                                <span className="text-sm font-medium text-[var(--ink)]">
                                  {preset.name}
                                </span>
                                <span className="text-xs text-[var(--muted)]">
                                  ~{preset.estimatedMinutes}m
                                </span>
                              </div>
                              <p className="text-xs text-[var(--muted)] mt-0.5">
                                {preset.description}
                              </p>
                            </div>
                          </label>
                        ))}

                        {/* Custom script option */}
                        <label
                          className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                            showCustomScript ? "bg-teal-50" : "hover:bg-zinc-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="startup-script"
                            checked={showCustomScript}
                            onChange={() => {
                              setShowCustomScript(true);
                              setSelectedStartupScript("custom");
                            }}
                            className="w-4 h-4 mt-0.5 accent-teal-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span>📝</span>
                              <span className="text-sm font-medium text-[var(--ink)]">
                                Custom script
                              </span>
                            </div>
                            <p className="text-xs text-[var(--muted)] mt-0.5">
                              Run your own bash script on startup
                            </p>
                          </div>
                        </label>

                        {showCustomScript && (
                          <div className="ml-7 mt-2">
                            <textarea
                              value={customScript}
                              onChange={(e) => setCustomScript(e.target.value)}
                              placeholder="#!/bin/bash&#10;# Your startup script..."
                              className="w-full px-3 py-2 rounded-lg border border-[var(--line)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none text-sm font-mono h-20 resize-none"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Persistent Storage */}
                    {options?.existingSharedVolumes && options.existingSharedVolumes.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-[var(--muted)] mb-2">
                          Storage
                        </label>
                        <div className="space-y-2">
                          <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] cursor-pointer hover:border-teal-300 transition-colors">
                            <input
                              type="radio"
                              name="storage-mode"
                              checked={storageMode === "auto"}
                              onChange={() => {
                                setStorageMode("auto");
                                setSelectedExistingVolume(null);
                              }}
                              className="w-4 h-4 accent-teal-500"
                            />
                            <div>
                              <span className="text-sm font-medium text-[var(--ink)]">Auto</span>
                              <p className="text-xs text-[var(--muted)]">
                                Default storage configuration
                              </p>
                            </div>
                          </label>

                          <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] cursor-pointer hover:border-teal-300 transition-colors">
                            <input
                              type="radio"
                              name="storage-mode"
                              checked={storageMode === "existing"}
                              onChange={() => {
                                setStorageMode("existing");
                                if (
                                  options.existingSharedVolumes &&
                                  options.existingSharedVolumes.length > 0
                                ) {
                                  setSelectedExistingVolume(options.existingSharedVolumes[0].id);
                                }
                              }}
                              className="w-4 h-4 accent-teal-500"
                            />
                            <div className="flex-1">
                              <span className="text-sm font-medium text-[var(--ink)]">
                                Use existing storage
                              </span>
                              <p className="text-xs text-[var(--muted)]">
                                Attach a volume you already own
                              </p>
                            </div>
                            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                              {options.existingSharedVolumes.length} available
                            </span>
                          </label>
                        </div>

                        {storageMode === "existing" && (
                          <select
                            value={selectedExistingVolume || ""}
                            onChange={(e) => setSelectedExistingVolume(Number(e.target.value))}
                            className="w-full mt-2 px-4 py-3 rounded-xl border border-[var(--line)] bg-white text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                          >
                            {options.existingSharedVolumes.map((vol) => (
                              <option key={vol.id} value={vol.id}>
                                {vol.name} ({vol.size_in_gb}GB) - {vol.status}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Wallet + Cost Summary */}
              {selectedProductDetails?.available && (
                <div className="p-4 bg-zinc-50 border border-[var(--line)] rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-[var(--muted)]">
                      Wallet:{" "}
                      <span className="font-medium text-[var(--ink)]">${walletBalanceDollars}</span>
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      Est:{" "}
                      <span className="font-bold text-[var(--ink)]">
                        ${(selectedProductDetails.pricePerHourCents / 100).toFixed(2)}/hr
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-4">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!DEPLOY_MAINTENANCE && !loading && options && !showFundWallet && !(error && !options) && (
          <div className="border-t border-[var(--line)] p-6 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleLaunch}
              disabled={!canLaunch}
              className="flex-1 py-3 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Launch GPU
            </button>
          </div>
        )}

        {/* Footer for fund wallet state */}
        {showFundWallet && (
          <div className="border-t border-[var(--line)] p-6 flex gap-3">
            <button
              onClick={() => setShowFundWallet(false)}
              className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors"
            >
              Back
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
