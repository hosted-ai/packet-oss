"use client";

/**
 * GPUPicker — Shared GPU selection component
 *
 * 2-step category-based GPU selection:
 *   Step 1: Pick a GPU category (type)
 *   Step 2: Pick a product + region (with on-demand HAI compatibility check)
 *
 * Used by LaunchGPUModal and HuggingFace DeployModal.
 */

import { useState, useEffect, useCallback } from "react";

// ============================================
// Types
// ============================================

export interface GPUPickerCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  icon: string | null;
  scenarioConfigured: boolean;
  products: GPUPickerProduct[];
}

export interface GPUPickerProduct {
  id: string;
  name: string;
  description: string | null;
  pricePerHourCents: number;
  pricePerMonthCents?: number | null;
  billingType?: string;
  serviceId?: string | null;
  displayOrder?: number;
  featured?: boolean;
  badgeText?: string | null;
  vramGb: number | null;
  cudaCores?: number | null;
  categoryIds?: string[];
  gpuFamily?: string | null;
  available: boolean | null;
  regions?: GPUPickerRegion[];
}

export interface GPUPickerRegion {
  id: number;
  region_name: string;
  city?: string;
  country?: string;
  country_code?: string;
  // Stamped by /api/instances/category-check: region is in maintenance, so the
  // picker disables it. The server 503 is the real enforcement; this is UX.
  underMaintenance?: boolean;
}

export interface GPUPickerSelection {
  product: GPUPickerProduct | null;
  region: GPUPickerRegion | null;
  productAvailable: boolean;
  regions: GPUPickerRegion[];
}

interface GPUPickerProps {
  token: string;
  categories: GPUPickerCategory[];
  products: GPUPickerProduct[];
  onSelectionChange: (selection: GPUPickerSelection) => void;
  initialProductId?: string;
  compact?: boolean; // Smaller cards for embedded use (e.g. HF modal)
}

// ============================================
// Component
// ============================================

export function GPUPicker({
  token,
  categories,
  products,
  onSelectionChange,
  initialProductId,
  compact = false,
}: GPUPickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  const [categoryCheckLoading, setCategoryCheckLoading] = useState(false);
  const [categoryCheckResult, setCategoryCheckResult] = useState<{
    categoryId: string;
    compatibleServiceIds: string[];
    serviceRegions: Record<string, GPUPickerRegion[]>;
    // PA-407: true when the HAI compat check failed transiently (timeout /
    // network / 5xx) rather than genuinely returning zero inventory.
    checkFailed?: boolean;
  } | null>(null);

  const hasCategories = categories.length > 0;

  // Derive families from categories or gpuFamily fallback
  const gpuFamilies = hasCategories
    ? categories.map(c => c.name)
    : [...new Set(products.map(p => p.gpuFamily).filter((f): f is string => !!f))];

  // Get product availability from category check
  const getProductAvailability = useCallback((product: GPUPickerProduct): boolean => {
    if (!categoryCheckResult) return product.available ?? false;
    return product.serviceId ? categoryCheckResult.compatibleServiceIds.includes(product.serviceId) : false;
  }, [categoryCheckResult]);

  // Get product regions from category check
  const getProductRegions = useCallback((product: GPUPickerProduct): GPUPickerRegion[] => {
    if (!categoryCheckResult || !product.serviceId) return product.regions || [];
    return categoryCheckResult.serviceRegions[product.serviceId] || [];
  }, [categoryCheckResult]);

  // Filter products by selected category
  const filteredProducts = (() => {
    if (!selectedCategory) return hasCategories ? [] : products;
    if (hasCategories) {
      const cat = categories.find(c => c.name === selectedCategory);
      return cat ? cat.products : [];
    }
    return products.filter(p => p.gpuFamily === selectedCategory);
  })();

  // Selected product details
  const selectedProductDetails = products.find(p => p.id === selectedProduct) || null;
  const selectedProductRegions = selectedProductDetails ? getProductRegions(selectedProductDetails) : [];

  // PA-407: a transient compat-check failure (HAI timeout / network / 5xx) is
  // distinct from genuine zero inventory — offer a retry instead of the
  // misleading "no GPUs available". Shared across both layouts below.
  const availabilityCheckFailed = categoryCheckResult?.checkFailed === true;
  const retryNotice = (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-sm font-medium text-amber-700">
        We couldn&apos;t check GPU availability just now
      </p>
      <p className="text-xs text-gray-500">This is usually temporary — please try again.</p>
      <button
        type="button"
        onClick={() => categoryCheckResult && checkCategoryAvailability(categoryCheckResult.categoryId)}
        className="px-3 py-1.5 rounded-lg border border-teal-500 text-teal-600 text-sm font-medium hover:bg-teal-50 transition-colors"
      >
        Retry
      </button>
    </div>
  );

  // Check category compatibility
  const checkCategoryAvailability = async (categoryId: string) => {
    setCategoryCheckLoading(true);
    setCategoryCheckResult(null);
    try {
      const res = await fetch(`/api/instances/category-check?categoryId=${categoryId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCategoryCheckResult(data);
        // Auto-select first available product
        const cat = categories.find(c => c.id === categoryId);
        if (cat) {
          const firstAvailable = cat.products
            .filter(p => data.compatibleServiceIds.includes(p.serviceId))
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0];
          if (firstAvailable) {
            setSelectedProduct(firstAvailable.id);
          }
        }
      }
    } catch (err) {
      console.error("Category check failed:", err);
    } finally {
      setCategoryCheckLoading(false);
    }
  };

  // Auto-select region when product changes — prefer one that isn't in
  // maintenance so we don't pre-select a region the user can't deploy into.
  useEffect(() => {
    if (selectedProductRegions.length > 0) {
      const firstAvailable = selectedProductRegions.find(r => !r.underMaintenance);
      setSelectedRegion((firstAvailable ?? selectedProductRegions[0]).id);
    } else {
      setSelectedRegion(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, categoryCheckResult]);

  // Notify parent of selection changes
  useEffect(() => {
    const region = selectedProductRegions.find(r => r.id === selectedRegion) || null;
    onSelectionChange({
      product: selectedProductDetails,
      region,
      productAvailable: selectedProductDetails ? getProductAvailability(selectedProductDetails) : false,
      regions: selectedProductRegions,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, selectedRegion, categoryCheckResult]);

  // Handle initialProductId
  useEffect(() => {
    if (initialProductId && hasCategories) {
      const target = products.find(p => p.id === initialProductId);
      if (target?.categoryIds?.length) {
        const cat = categories.find(c => c.id === target.categoryIds![0]);
        if (cat) {
          setSelectedCategory(cat.name);
          setSelectedProduct(initialProductId);
          checkCategoryAvailability(cat.id);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId]);

  // Country code → flag emoji
  const getFlag = (cc?: string) => {
    if (!cc) return "";
    return String.fromCodePoint(...[...cc.toLowerCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 97));
  };

  // ============================================
  // Compact layout: dropdowns (for HF modal, embedded contexts)
  // ============================================
  if (compact) {
    return (
      <div className="space-y-3">
        {/* Category dropdown */}
        {gpuFamilies.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              GPU Type
            </label>
            <select
              value={selectedCategory || ""}
              onChange={e => {
                const family = e.target.value || null;
                setSelectedCategory(family);
                setSelectedProduct("");
                setCategoryCheckResult(null);
                setSelectedRegion(null);
                if (family && hasCategories) {
                  const cat = categories.find(c => c.name === family);
                  if (cat) checkCategoryAvailability(cat.id);
                }
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-teal-500"
            >
              <option value="">Select GPU type...</option>
              {gpuFamilies.map(family => {
                const cat = hasCategories ? categories.find(c => c.name === family) : null;
                const isPending = cat && !cat.scenarioConfigured;
                return (
                  <option key={family} value={family} disabled={!!isPending}>
                    {family}{isPending ? " (pending)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Loading */}
        {categoryCheckLoading && (
          <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            Checking availability...
          </div>
        )}

        {/* PA-407: transient compat-check failure — offer retry, not "unavailable" */}
        {!categoryCheckLoading && availabilityCheckFailed && retryNotice}

        {/* Product dropdown */}
        {!categoryCheckLoading && !availabilityCheckFailed && selectedCategory && filteredProducts.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              GPU
            </label>
            <select
              value={selectedProduct}
              onChange={e => {
                if (e.target.value) setSelectedProduct(e.target.value);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-teal-500"
            >
              <option value="">Select a GPU...</option>
              {filteredProducts.map(product => {
                const isAvailable = getProductAvailability(product);
                const price = (product.pricePerHourCents / 100).toFixed(2);
                return (
                  <option key={product.id} value={product.id} disabled={!isAvailable}>
                    {product.name}{product.vramGb ? ` (${product.vramGb}GB)` : ""} — ${price}/hr{!isAvailable ? " (unavailable)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Region — auto-selected, show as text if only one, dropdown if multiple */}
        {selectedProductDetails && selectedProductRegions.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              Region
            </label>
            <select
              value={selectedRegion || ""}
              onChange={e => setSelectedRegion(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-teal-500"
            >
              {selectedProductRegions.map(region => {
                const flag = getFlag(region.country_code);
                return (
                  <option key={region.id} value={region.id} disabled={region.underMaintenance}>
                    {flag} {region.city || region.region_name}{region.country ? `, ${region.country}` : ""} ({region.region_name}){region.underMaintenance ? " — under maintenance" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        {selectedProductDetails && selectedProductRegions.length === 1 && (
          <div className="text-xs text-gray-500">
            Region: <span className="font-medium text-gray-700">{getFlag(selectedProductRegions[0].country_code)} {selectedProductRegions[0].city || selectedProductRegions[0].region_name}{selectedProductRegions[0].country ? `, ${selectedProductRegions[0].country}` : ""}</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================
  // Full layout: cards (for LaunchGPUModal, standalone contexts)
  // ============================================
  return (
    <div className="space-y-4">
      {/* Category Selection — cards */}
      {gpuFamilies.length > 0 && !selectedCategory && (
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
            Select GPU Type
          </label>
          <div className="space-y-2">
            {gpuFamilies.map(family => {
              const cat = hasCategories ? categories.find(c => c.name === family) : null;
              const isPending = cat && !cat.scenarioConfigured;
              const productCount = cat?.products?.length ?? products.filter(p => p.gpuFamily === family).length;
              return (
                <button
                  key={family}
                  type="button"
                  disabled={!!isPending}
                  onClick={() => {
                    setSelectedCategory(family);
                    setSelectedProduct("");
                    setCategoryCheckResult(null);
                    if (cat) checkCategoryAvailability(cat.id);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                    isPending
                      ? "border-dashed border-gray-200 text-gray-400 cursor-not-allowed"
                      : "border-[var(--line)] hover:border-teal-400 hover:bg-teal-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--ink)]">{family}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {isPending ? "Pending setup" : `${productCount} product${productCount !== 1 ? "s" : ""}`}
                    </span>
                  </div>
                  {cat?.description && (
                    <p className="text-xs text-[var(--muted)] mt-0.5">{cat.description}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category selected: show back link + products */}
      {selectedCategory && (
        <>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory(null);
              setSelectedProduct("");
              setCategoryCheckResult(null);
              setSelectedRegion(null);
            }}
            className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 mb-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            {selectedCategory}
          </button>

          {/* Loading */}
          {categoryCheckLoading && (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                Checking GPU availability...
              </div>
              <p className="text-xs text-zinc-400">This can take a few seconds</p>
            </div>
          )}

          {/* PA-407: transient compat-check failure — offer retry, not "unavailable" */}
          {!categoryCheckLoading && availabilityCheckFailed && retryNotice}

          {/* Product Cards */}
          {!categoryCheckLoading && !availabilityCheckFailed && filteredProducts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                Select a GPU
              </label>
              <div className="space-y-2">
                {filteredProducts.map(product => {
                  const isSelected = selectedProduct === product.id;
                  const isAvailable = getProductAvailability(product);
                  const pricePerHour = (product.pricePerHourCents / 100).toFixed(2);

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
                            <span className="font-medium text-[var(--ink)]">{product.name}</span>
                            {product.featured && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded font-medium">Popular</span>
                            )}
                            {product.badgeText && (
                              <span className="px-1.5 py-0.5 text-[10px] bg-violet-100 text-violet-700 rounded font-medium">{product.badgeText}</span>
                            )}
                          </div>
                          {product.vramGb && (
                            <div className="text-xs text-[var(--muted)] mt-0.5">
                              {product.vramGb}GB VRAM{product.description ? ` · ${product.description}` : ""}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          {!isAvailable ? (
                            <span className="text-xs font-medium text-zinc-400">Unavailable</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div>
                                <span className="text-lg font-bold text-[var(--ink)]">${pricePerHour}</span>
                                <span className="text-xs text-[var(--muted)]">/hr</span>
                              </div>
                              {isSelected && (
                                <svg className="w-5 h-5 text-teal-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No products */}
          {!categoryCheckLoading && !availabilityCheckFailed && filteredProducts.length === 0 && (
            <div className="text-center py-6 text-[var(--muted)] text-sm">
              No GPUs available in this category.
            </div>
          )}

          {/* Region Picker — cards */}
          {selectedProductDetails && selectedProductRegions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                Region
              </label>
              <div className="space-y-2">
                {selectedProductRegions.map(region => {
                  const flag = getFlag(region.country_code);
                  return (
                    <button
                      key={region.id}
                      type="button"
                      disabled={region.underMaintenance}
                      aria-disabled={region.underMaintenance}
                      onClick={() => { if (!region.underMaintenance) setSelectedRegion(region.id); }}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        region.underMaintenance
                          ? "border-[var(--line)] bg-zinc-50 opacity-60 cursor-not-allowed"
                          : selectedRegion === region.id
                          ? "border-teal-500 bg-teal-50"
                          : "border-[var(--line)] hover:border-teal-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {flag && <span className="text-xl">{flag}</span>}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--ink)]">
                            {region.city || region.region_name}
                            {region.country && <span className="text-[var(--muted)] font-normal">, {region.country}</span>}
                          </div>
                          <div className="text-xs text-[var(--muted)]">{region.region_name}</div>
                          {region.underMaintenance && (
                            <div className="text-xs font-medium text-amber-600 mt-0.5">Under maintenance</div>
                          )}
                        </div>
                        {!region.underMaintenance && selectedRegion === region.id && (
                          <svg className="w-5 h-5 text-teal-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
