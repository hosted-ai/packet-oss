"use client";

import { useState, useEffect } from "react";
import type { LaunchOptions, GpuProduct } from "./types";
import { STARTUP_SCRIPT_PRESETS, type StartupScriptPreset } from "@/lib/startup-scripts";

// MAINTENANCE MODE — set to false when hosted.ai instance creation is fixed
const DEPLOY_MAINTENANCE = false;

interface CostEstimate {
  hourly_cost: number;
  currency: string;
  gpu_count: number;
  breakdown?: {
    gpu_cost: number;
    storage_cost: number;
  };
  packet_rate: number;
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
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [launchSeconds, setLaunchSeconds] = useState(0);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<LaunchOptions | null>(null);

  const [instanceName, setInstanceName] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<string>(""); // Product ID
  const [selectedPool, setSelectedPool] = useState("");
  const [selectedInstanceType, setSelectedInstanceType] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [selectedStorage, setSelectedStorage] = useState("");
  const [selectedEphemeralStorage, setSelectedEphemeralStorage] = useState("");
  const [selectedPersistentStorage, setSelectedPersistentStorage] = useState("");
  const [selectedExistingVolume, setSelectedExistingVolume] = useState<number | null>(null);
  const [storageMode, setStorageMode] = useState<"none" | "new" | "existing">("none");
  const [selectedStartupScript, setSelectedStartupScript] = useState<string>("");
  const [customScript, setCustomScript] = useState("");
  const [showCustomScript, setShowCustomScript] = useState(false);
  const [showAutoSetup, setShowAutoSetup] = useState(false);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [showFundWallet, setShowFundWallet] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);

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

  // Get selected product details
  const selectedProductDetails = options?.products?.find((p) => p.id === selectedProduct);

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

  // When product changes, auto-select first available pool from that product
  useEffect(() => {
    if (selectedProductDetails && selectedProductDetails.availablePools.length > 0) {
      const existingPoolIds = options?.existingPoolIds || [];
      // Find first pool from this product that user doesn't already have
      const availablePool = selectedProductDetails.availablePools.find(
        (p) => !existingPoolIds.includes(String(p.id))
      );
      if (availablePool) {
        setSelectedPool(String(availablePool.id));
      } else if (selectedProductDetails.availablePools.length > 0) {
        // Fallback to first pool if all are subscribed
        setSelectedPool(String(selectedProductDetails.availablePools[0].id));
      }
    }
  }, [selectedProduct, selectedProductDetails, options?.existingPoolIds]);

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
          const data = await response.json();
          setOptions(data);

          // Auto-select product: use initialProductId if provided, otherwise first available
          if (data.products?.length > 0) {
            const existingPoolIds = data.existingPoolIds || [];

            // If returning from top-up with a specific product, pre-select it
            if (initialProductId) {
              const targetProduct = data.products.find((p: GpuProduct) => p.id === initialProductId);
              if (targetProduct) {
                setSelectedProduct(targetProduct.id);
              }
            }

            if (!initialProductId || !data.products.find((p: GpuProduct) => p.id === initialProductId)) {
              // Find first product with available pools that user doesn't already have
              const availableProduct = data.products.find((p: GpuProduct) => {
                const hasAvailablePool = p.availablePools.some(
                  (pool) => !existingPoolIds.includes(String(pool.id))
                );
                return hasAvailablePool && p.totalAvailableGpus > 0;
              });

              if (availableProduct) {
                setSelectedProduct(availableProduct.id);
              } else if (data.products.length > 0) {
                // Fallback to first product
                setSelectedProduct(data.products[0].id);
              }
            }
          } else if (data.pools?.length > 0) {
            // Fallback to pool-based selection if no products
            const existingPoolIds = data.existingPoolIds || [];
            const availablePool = data.pools.find(
              (p: { id: string }) => !existingPoolIds.includes(String(p.id))
            );
            if (availablePool) {
              setSelectedPool(availablePool.id);
            }
          }

          if (data.instanceTypes?.length > 0) setSelectedInstanceType(data.instanceTypes[0].id);
          if (data.images?.length > 0) setSelectedImage(data.images[0].id);
          if (data.storageBlocks?.length > 0) setSelectedStorage(data.storageBlocks[0].id);
          if (data.ephemeralStorageBlocks?.length > 0) setSelectedEphemeralStorage(data.ephemeralStorageBlocks[0].id);

          // Default to no persistent storage — user must opt in
          setStorageMode("none");
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

  useEffect(() => {
    if (!selectedPool || !options?.teamId) return;
    async function fetchCostEstimate() {
      setLoadingCost(true);
      try {
        const response = await fetch("/api/instances/calculate-cost", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ pool_id: selectedPool, gpu_count: 1 }),
        });
        if (response.ok) {
          const data = await response.json();
          setCostEstimate(data);
        }
      } catch (err) {
        console.error("Failed to fetch cost estimate:", err);
      } finally {
        setLoadingCost(false);
      }
    }
    fetchCostEstimate();
  }, [selectedPool, options?.teamId, token]);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setInstanceName("");
      setError("");
      setLaunching(false);
      setCostEstimate(null);
      setSelectedEphemeralStorage("");
      setSelectedPersistentStorage("");
      setSelectedExistingVolume(null);
      setStorageMode("none");
      setSelectedProduct("");
      setSelectedPool("");
      setSelectedStartupScript("");
      setCustomScript("");
      setShowCustomScript(false);
      setShowAutoSetup(false);
      setShowFundWallet(false);
    }
  }, [isOpen]);

  // Check wallet balance before advancing to step 2
  // Monthly products (e.g. Blackwell) don't need wallet balance — they're billed via Stripe subscription
  const handleContinue = () => {
    if (selectedProductDetails?.billingType === "monthly") {
      setStep(2);
      return;
    }
    const MINIMUM_BILLING_MINUTES = 30;
    const hourlyRateCents = selectedProductDetails?.pricePerHourCents
      || (costEstimate?.packet_rate ? Math.round(costEstimate.packet_rate * 100) : 0);
    const requiredCents = Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * 1); // 1 GPU
    const walletCents = options?.walletBalanceCents ?? 0;

    if (requiredCents > 0 && walletCents < requiredCents) {
      setShowFundWallet(true);
      return;
    }
    setStep(2);
  };

  const handleLaunch = async () => {
    if (!options || !selectedPool || !instanceName.trim()) {
      setError("Please fill in all fields");
      return;
    }

    // Use product name if available, otherwise fall back to pool details
    const poolName = selectedProductDetails?.name || selectedPoolDetails?.gpu_model || selectedPoolDetails?.name || selectedTypeDetails?.gpu_model || selectedTypeDetails?.name || "GPU";

    // Determine startup script to use
    let startupScript: string | undefined;
    let startupScriptPresetId: string | undefined;
    if (selectedStartupScript === "custom" && customScript.trim()) {
      startupScript = customScript.trim();
    } else if (selectedStartupScript) {
      const preset = STARTUP_SCRIPT_PRESETS.find(p => p.id === selectedStartupScript);
      startupScript = preset?.script;
      startupScriptPresetId = preset?.id;
    }

    // Close modal immediately — provisioning happens in the background
    import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.GPU_DEPLOYED)).catch(() => {});
    if (typeof (window as any).my_analytics !== "undefined") {
      (window as any).my_analytics.goal("dc2zgi7efaqu6o3h");
    }
    if (typeof (window as any).lintrk === "function") {
      (window as any).lintrk("track", { conversion_id: 24436340 });
    }
    onSuccess({ name: instanceName.trim(), poolName });
    onClose();

    // Fire the API call in the background
    try {
      const response = await fetch("/api/instances", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: instanceName.trim(),
          pool_id: selectedPool,
          product_id: selectedProduct || undefined,
          instance_type_id: selectedInstanceType || undefined,
          image_uuid: selectedImage || undefined,
          image_hash_id: selectedImage,
          storage_block_id: selectedStorage || undefined,
          ephemeral_storage_block_id: selectedEphemeralStorage || undefined,
          persistent_storage_block_id: storageMode === "new" ? selectedPersistentStorage : undefined,
          existing_shared_volume_id: storageMode === "existing" ? selectedExistingVolume : undefined,
          skip_auto_storage: storageMode === "none" ? true : undefined,
          startup_script: startupScript || undefined,
          startup_script_preset_id: startupScriptPresetId || undefined,
          region_id: options.selectedRegionId,
          team_id: options.teamId,
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

  const selectedPoolDetails = options?.pools?.find((p) => p.id === selectedPool);
  const selectedTypeDetails = options?.instanceTypes?.find((t) => t.id === selectedInstanceType);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden">
        <div className="border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">New GPU</h2>
              <p className="text-xs text-[var(--muted)]">Step {step} of 2</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {DEPLOY_MAINTENANCE ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[var(--ink)] mb-2">Scheduled Maintenance</h3>
              <p className="text-sm text-[var(--muted)] mb-4">
                New GPU deployments are temporarily unavailable while we perform infrastructure upgrades. Your existing GPUs are not affected.
              </p>
              <p className="text-xs text-zinc-400">Please check back shortly.</p>
              <button onClick={onClose} className="mt-4 px-6 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors text-sm">
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
                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-[var(--ink)] mb-2">Unlock GPU Access</h3>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    Add funds to deploy GPU instances.<br />
                    Your free account includes 10,000 tokens for Token Factory.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[50, 100, 250, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        disabled={topupLoading}
                        onClick={() => onTopup?.(amount * 100, undefined, selectedProduct || undefined)}
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
                  <button onClick={onClose} className="text-sm text-zinc-600 hover:text-[var(--ink)]">Close</button>
                </>
              )}
            </div>
          ) : showFundWallet ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[var(--ink)] mb-2">Fund Your Wallet</h3>
              <p className="text-sm text-[var(--muted)] mb-1">
                You need at least <span className="font-semibold text-[var(--ink)]">${(() => {
                  const MINIMUM_BILLING_MINUTES = 30;
                  const hourlyRateCents = selectedProductDetails?.pricePerHourCents
                    || (costEstimate?.packet_rate ? Math.round(costEstimate.packet_rate * 100) : 0);
                  return (Math.round((MINIMUM_BILLING_MINUTES / 60) * hourlyRateCents * 1) / 100).toFixed(2);
                })()}</span> to launch this GPU.
              </p>
              <p className="text-sm text-[var(--muted)] mb-5">
                Your current balance is <span className="font-semibold text-[var(--ink)]">${((options?.walletBalanceCents ?? 0) / 100).toFixed(2)}</span>.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[50, 100, 250, 500].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    disabled={topupLoading}
                    onClick={() => onTopup?.(amount * 100, undefined, selectedProduct || undefined)}
                    className="px-4 py-3 border-2 border-[var(--line)] rounded-xl text-center font-semibold text-[var(--ink)] hover:border-teal-500 hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {topupLoading ? "..." : `$${amount}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--muted)]">Minimum $50 deposit required</p>
            </div>
          ) : step === 1 ? (
            <>
              {/* GPU Product Selection */}
              {options?.products && options.products.length > 0 ? (
                <div className="mb-6">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-3 uppercase tracking-wide">Select GPU</label>
                  <div className="space-y-2">
                    {options.products.map((product) => {
                      const isSelected = selectedProduct === product.id;
                      const pricePerHour = (product.pricePerHourCents / 100).toFixed(2);
                      const hasMonthly = product.pricePerMonthCents && product.pricePerMonthCents > 0;
                      const monthlyHourlyRate = hasMonthly ? (product.pricePerMonthCents! / 100 / 730).toFixed(2) : null;
                      const savingsPercent = hasMonthly ? Math.round((1 - (product.pricePerMonthCents! / 100 / 730) / (product.pricePerHourCents / 100)) * 100) : 0;

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => setSelectedProduct(product.id)}
                          className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                            isSelected
                              ? "border-teal-500 bg-teal-50"
                              : "border-[var(--line)] hover:border-teal-300 hover:bg-zinc-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-[var(--ink)]">{product.name}</span>
                                {product.featured && (
                                  <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">Popular</span>
                                )}
                                {product.badgeText && (
                                  <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">{product.badgeText}</span>
                                )}
                              </div>
                              <div className="text-sm text-[var(--muted)] mt-1">
                                {product.vramGb && `${product.vramGb}GB VRAM`}
                                {product.description && ` · ${product.description}`}
                              </div>
                            </div>
                            <div className="text-right">
                              {hasMonthly ? (
                                <>
                                  <div className="flex items-baseline gap-1.5 justify-end">
                                    <span className="text-lg font-bold text-teal-600">${monthlyHourlyRate}</span>
                                    <span className="text-xs text-[var(--muted)]">eff/hr</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <span className="text-xs text-[var(--muted)] line-through">${pricePerHour}/hr</span>
                                    <span className="text-xs font-medium text-teal-600">Save {savingsPercent}%</span>
                                  </div>
                                  <div className="text-xs text-[var(--muted)] mt-0.5">${(product.pricePerMonthCents! / 100).toFixed(0)}/mo commitment</div>
                                </>
                              ) : (
                                <>
                                  <div className="text-lg font-bold text-[var(--ink)]">${pricePerHour}</div>
                                  <div className="text-xs text-[var(--muted)]">per hour</div>
                                </>
                              )}
                            </div>
                            {isSelected && (
                              <div className="ml-3 w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center flex-shrink-0">
                                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* No products available */}
              {!options?.products?.length && (
                <div className="mb-6">
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="font-medium text-amber-800">No GPUs Available</p>
                        <p className="text-sm text-amber-700 mt-1">There are currently no GPU products configured. Please contact support.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Persistent Storage Section */}
              {(options?.persistentStorageBlocks?.length || options?.existingSharedVolumes?.length) ? (
                <div className="mb-6">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-3 uppercase tracking-wide">Persistent Workspace</label>

                  {/* Storage Mode Selection */}
                  <div className="space-y-2 mb-3">
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] cursor-pointer hover:border-teal-300 transition-colors">
                      <input
                        type="radio"
                        name="storage-mode"
                        checked={storageMode === "none"}
                        onChange={() => {
                          setStorageMode("none");
                          setSelectedPersistentStorage("");
                          setSelectedExistingVolume(null);
                        }}
                        className="w-4 h-4 accent-teal-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-[var(--ink)]">No persistent storage</span>
                        <p className="text-xs text-[var(--muted)]">Data is lost when the GPU is terminated</p>
                      </div>
                    </label>

                    {options?.existingSharedVolumes && options.existingSharedVolumes.length > 0 && (
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] cursor-pointer hover:border-teal-300 transition-colors">
                        <input
                          type="radio"
                          name="storage-mode"
                          checked={storageMode === "existing"}
                          onChange={() => {
                            setStorageMode("existing");
                            setSelectedPersistentStorage("");
                            // Auto-select first volume
                            if (options.existingSharedVolumes && options.existingSharedVolumes.length > 0) {
                              setSelectedExistingVolume(options.existingSharedVolumes[0].id);
                            }
                          }}
                          className="w-4 h-4 accent-teal-500"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-[var(--ink)]">Use existing storage</span>
                          <p className="text-xs text-[var(--muted)]">Attach a volume you already own</p>
                        </div>
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                          {options.existingSharedVolumes.length} available
                        </span>
                      </label>
                    )}

                    {options?.persistentStorageBlocks && options.persistentStorageBlocks.length > 0 && (
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--line)] cursor-pointer hover:border-teal-300 transition-colors">
                        <input
                          type="radio"
                          name="storage-mode"
                          checked={storageMode === "new"}
                          onChange={() => {
                            setStorageMode("new");
                            setSelectedExistingVolume(null);
                            // Auto-select first block
                            if (options.persistentStorageBlocks && options.persistentStorageBlocks.length > 0) {
                              setSelectedPersistentStorage(options.persistentStorageBlocks[0].id);
                            }
                          }}
                          className="w-4 h-4 accent-teal-500"
                        />
                        <div>
                          <span className="text-sm font-medium text-[var(--ink)]">Create new storage</span>
                          <p className="text-xs text-[var(--muted)]">Provision a new persistent volume</p>
                        </div>
                      </label>
                    )}
                  </div>

                  {/* Existing Volume Selector */}
                  {storageMode === "existing" && options?.existingSharedVolumes && (
                    <select
                      value={selectedExistingVolume || ""}
                      onChange={(e) => setSelectedExistingVolume(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-xl border border-[var(--line)] bg-white text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                    >
                      {options.existingSharedVolumes.map((vol) => (
                        <option key={vol.id} value={vol.id}>
                          {vol.name} ({vol.size_in_gb}GB) - {vol.status}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* New Storage Selector */}
                  {storageMode === "new" && options?.persistentStorageBlocks && (
                    <select
                      value={selectedPersistentStorage}
                      onChange={(e) => setSelectedPersistentStorage(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-[var(--line)] bg-white text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                    >
                      {options.persistentStorageBlocks.filter((block) => !block.size_gb || block.size_gb <= 100).map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.name} {block.size_gb && `(${block.size_gb}GB)`}
                        </option>
                      ))}
                    </select>
                  )}

                  <p className="text-xs text-zinc-400 mt-2">
                    {storageMode === "none" && "Your /workspace will use ephemeral storage only. You can add persistent storage later."}
                    {storageMode === "existing" && "Your workspace will be preserved. Reattach this volume when you launch again."}
                    {storageMode === "new" && "Creates a new persistent volume. Your /workspace persists across terminate + relaunch."}
                  </p>
                </div>
              ) : null}

              {(selectedProduct || selectedPool) && (
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-teal-700">Estimated Cost</span>
                    {loadingCost ? (
                      <span className="text-sm text-teal-600 animate-pulse">Calculating...</span>
                    ) : (
                      <span className="text-lg font-bold text-teal-700">
                        ${selectedProductDetails
                          ? (selectedProductDetails.pricePerHourCents / 100).toFixed(2)
                          : costEstimate?.packet_rate?.toFixed(2) || "--"}/hr
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-6">
                <label className="block text-sm font-medium text-zinc-700 mb-2">Instance Name</label>
                <input
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="my-gpu-instance"
                  className="w-full px-4 py-3 rounded-xl border border-[var(--line)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                  autoFocus
                />
              </div>

              {/* Startup Script Selection - Collapsible */}
              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => setShowAutoSetup(!showAutoSetup)}
                  className="flex items-center gap-2 text-sm text-teal-600 hover:text-teal-700 transition-colors group"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showAutoSetup ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span>Add development tools</span>
                  {selectedStartupScript && !showAutoSetup && (
                    <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-700 rounded-full">
                      {STARTUP_SCRIPT_PRESETS.find(p => p.id === selectedStartupScript)?.name || 'Custom'}
                    </span>
                  )}
                </button>

                {showAutoSetup && (
                  <div className="mt-3 space-y-1 animate-in slide-in-from-top-2 duration-200">
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
                          selectedStartupScript === preset.id ? 'bg-teal-50' : 'hover:bg-zinc-50'
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
                            <span className="text-sm font-medium text-[var(--ink)]">{preset.name}</span>
                            <span className="text-xs text-[var(--muted)]">~{preset.estimatedMinutes}m</span>
                          </div>
                          <p className="text-xs text-[var(--muted)] mt-0.5">{preset.description}</p>
                        </div>
                      </label>
                    ))}

                    {/* Custom script option */}
                    <label className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      showCustomScript ? 'bg-teal-50' : 'hover:bg-zinc-50'
                    }`}>
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
                          <span className="text-sm font-medium text-[var(--ink)]">Custom script</span>
                        </div>
                        <p className="text-xs text-[var(--muted)] mt-0.5">Run your own bash script on startup</p>
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
                )}

                {selectedStartupScript && selectedStartupScript !== "custom" && !showAutoSetup && (
                  <p className="text-xs text-teal-600 mt-2 ml-6">
                    ✓ Will be installed automatically
                  </p>
                )}
              </div>

              <div className="bg-zinc-50 rounded-xl p-4 mb-6">
                <h4 className="text-sm font-medium text-zinc-700 mb-3">Summary</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">GPU</span>
                    <span className="font-medium text-[var(--ink)]">
                      1x {selectedProductDetails?.name || selectedPoolDetails?.gpu_model || selectedPoolDetails?.name || selectedTypeDetails?.gpu_model || selectedTypeDetails?.name || "GPU"}
                    </span>
                  </div>
                  <div className="border-t border-[var(--line)] pt-2 mt-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--muted)]">Estimated Cost</span>
                      <span className="font-bold text-[var(--ink)]">
                        ${selectedProductDetails
                          ? (selectedProductDetails.pricePerHourCents / 100).toFixed(2)
                          : costEstimate?.packet_rate?.toFixed(2) || "--"}/hr
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[var(--line)] p-6 flex gap-3">
          {showFundWallet ? (
            <>
              <button onClick={() => setShowFundWallet(false)} className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors">
                Back
              </button>
              <button onClick={onClose} className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors">
                Cancel
              </button>
            </>
          ) : step === 1 ? (
            <>
              <button onClick={onClose} className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors">
                Cancel
              </button>
              <button
                onClick={handleContinue}
                disabled={!selectedPool && !selectedProduct}
                className="flex-1 py-3 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors">
                Back
              </button>
              <button
                onClick={handleLaunch}
                disabled={!instanceName.trim()}
                className="flex-1 py-3 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Launch GPU
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
