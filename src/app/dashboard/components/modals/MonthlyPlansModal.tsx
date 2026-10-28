"use client";

import React from "react";
import { trackEvent } from "@/lib/analytics/track-event";
import {
  groupMonthlyByCategory,
  shouldShowCategoryStep,
  findBucketBySlug,
  type PlanCategory,
} from "../monthly-plans";

interface MonthlyProduct {
  id: string;
  name: string;
  description: string | null;
  billingType: string;
  pricePerMonthCents: number | null;
  pricePerHourCents: number;
  stripePriceId: string | null;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  cudaCores: number | null;
  categories?: PlanCategory[];
}

interface MonthlyPlansModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerEmail?: string;
  /** Pre-select a GPU category by slug (deep-link ?gpu=<slug>&plan=monthly). */
  initialCategorySlug?: string;
}

const HOURS_PER_MONTH = 730;

export function MonthlyPlansModal({
  isOpen,
  onClose,
  customerEmail,
  initialCategorySlug,
}: MonthlyPlansModalProps) {
  const [products, setProducts] = React.useState<MonthlyProduct[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [subscribingId, setSubscribingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedBucketKey, setSelectedBucketKey] = React.useState<string | null>(null);

  // Group plans by GPU type. Two+ buckets shows a GPU-Type step (mirrors the
  // on-demand stepper); a single bucket (nothing tagged yet) stays a flat list.
  const buckets = React.useMemo(() => groupMonthlyByCategory(products), [products]);
  const showCategoryStep = shouldShowCategoryStep(buckets);
  const selectedBucket = buckets.find((b) => b.key === selectedBucketKey) ?? null;
  const visibleProducts = selectedBucket ? selectedBucket.products : showCategoryStep ? [] : products;

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function fetchProducts(isBackgroundRefresh = false) {
      if (!isBackgroundRefresh) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch("/api/products");
        if (!res.ok) throw new Error("Failed to load plans");
        const json = await res.json();
        if (cancelled) return;
        const all: MonthlyProduct[] = json.data || json || [];
        const monthly = (Array.isArray(all) ? all : []).filter(
          (p) => p.billingType === "monthly" && p.stripePriceId
        );
        setProducts(monthly);

        // GA4: user views monthly plans/pricing page
        if (!isBackgroundRefresh) {
          trackEvent("plan_page_view");
          // Monthly flow: modal opened
          trackEvent("monthly_gpu_browse");
        }
      } catch {
        // A background refresh failing silently is fine — the visible
        // prices just stay at their last-known value until the next tick.
        if (!cancelled && !isBackgroundRefresh) setError("Could not load plans. Please try again.");
      } finally {
        if (!cancelled && !isBackgroundRefresh) setLoading(false);
      }
    }

    fetchProducts();
    // PA-349: an admin price edit elsewhere shouldn't require the customer
    // to close and reopen this modal to see it — keep prices live while
    // it's open, matching the dashboard's own 30s poll cadence.
    const interval = setInterval(() => fetchProducts(true), 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      setError(null);
      setSubscribingId(null);
      setSelectedBucketKey(null);
    }
  }, [isOpen]);

  // Resolve which bucket to show once plans load: a deep-linked category wins;
  // otherwise show the GPU-Type step (2+ buckets) or the single flat bucket.
  React.useEffect(() => {
    if (!buckets.length) {
      setSelectedBucketKey(null);
      return;
    }
    // PA-349: `buckets` gets a new array identity on every background price
    // refetch even when its contents are unchanged. Keep whatever bucket the
    // user already drilled into instead of bouncing them back to the
    // category step underneath their cursor.
    setSelectedBucketKey((current) => {
      if (current && buckets.some((b) => b.key === current)) return current;
      if (initialCategorySlug) {
        const match = findBucketBySlug(buckets, initialCategorySlug);
        if (match) return match.key;
      }
      return shouldShowCategoryStep(buckets) ? null : buckets[0].key;
    });
  }, [buckets, initialCategorySlug]);

  const handleSubscribe = async (product: MonthlyProduct) => {
    if (!customerEmail) {
      setError("Missing account email. Please refresh and try again.");
      return;
    }

    // GA4: user selects a plan
    const planType = product.badgeText?.toLowerCase().includes("dedicated")
      ? "dedicated"
      : product.badgeText?.toLowerCase().includes("dynamic")
        ? "dynamic"
        : product.name.toLowerCase().includes("dedicated")
          ? "dedicated"
          : "dynamic";
    trackEvent("plan_selected", {
      plan_type: planType,
      price_monthly: (product.pricePerMonthCents ?? 0) / 100,
    });

    // Funnel step 2: product selected (monthly flow)
    trackEvent("product_selected", {
      flow: "monthly",
      gpu_type: selectedBucket?.name || "",
      product_name: product.name,
      price_monthly: (product.pricePerMonthCents ?? 0) / 100,
    });
    trackEvent("monthly_plan_selected", {
      gpu_type: selectedBucket?.name || "",
      product_name: product.name,
      plan_type: planType,
      price_monthly: (product.pricePerMonthCents ?? 0) / 100,
      vram_gb: product.vramGb ?? undefined,
    });

    setSubscribingId(product.id);
    setError(null);

    // GA4: checkout flow initiated
    trackEvent("plan_checkout_start");

    // Funnel step 3: checkout reached (monthly flow — redirects to Stripe)
    trackEvent("checkout_reached", {
      flow: "monthly",
      gpu_type: selectedBucket?.name || "",
      product_name: product.name,
      price_monthly: (product.pricePerMonthCents ?? 0) / 100,
    });
    trackEvent("monthly_checkout_started", {
      gpu_type: selectedBucket?.name || "",
      product_name: product.name,
      plan_type: planType,
      price_monthly: (product.pricePerMonthCents ?? 0) / 100,
    });

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          email: customerEmail,
          termsAccepted: true,
          source: "dashboard",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start checkout");
        setSubscribingId(null);
        return;
      }

      if (data.isPortal) {
        setError(data.message || "You already have this subscription. Redirecting to manage it...");
        setTimeout(() => {
          if (data.url) window.location.href = data.url;
        }, 1500);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setSubscribingId(null);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSubscribingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between p-6 border-b border-[var(--line)]">
          <div>
            <h3 className="text-lg font-semibold text-[var(--ink)]">Monthly plans</h3>
            <p className="text-sm text-[var(--muted)] mt-0.5">
              Commit to a GPU monthly for a lower effective hourly rate.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 p-1 shrink-0"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="w-6 h-6 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[var(--muted)]">No monthly plans are available right now.</p>
            </div>
          ) : showCategoryStep && !selectedBucket ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[var(--muted)] mb-1 uppercase tracking-wide">
                Select GPU Type
              </label>
              {buckets.map((bucket) => (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => {
                    // Funnel step 1: GPU type selected (monthly flow)
                    trackEvent("gpu_type_selected", {
                      flow: "monthly",
                      gpu_type: bucket.name,
                    });
                    trackEvent("monthly_gpu_type_selected", {
                      gpu_type: bucket.name,
                    });
                    setSelectedBucketKey(bucket.key);
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-[var(--line)] hover:border-teal-400 hover:bg-teal-50/50 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--ink)]">{bucket.name}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {bucket.products.length} plan{bucket.products.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {showCategoryStep && selectedBucket && (
                <button
                  type="button"
                  onClick={() => setSelectedBucketKey(null)}
                  className="flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
                >
                  <span aria-hidden>←</span> All GPU types
                </button>
              )}
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
                <span className="font-semibold">Dedicated GPU</span> is the whole card, yours alone. <span className="font-semibold">Dynamic GPU</span> is shared infrastructure that delivers the same peak performance and VRAM capacity.
              </div>
              {visibleProducts.map((product) => {
                const monthlyCents = product.pricePerMonthCents ?? 0;
                const monthlyPrice = (monthlyCents / 100).toFixed(0);
                const hasListHourly = product.pricePerHourCents > 0;
                const effectiveHourly = (monthlyCents / 100 / HOURS_PER_MONTH).toFixed(2);
                const savings = hasListHourly
                  ? Math.round(
                      (1 - monthlyCents / 100 / HOURS_PER_MONTH / (product.pricePerHourCents / 100)) * 100
                    )
                  : 0;
                const isSubscribingThis = subscribingId === product.id;
                const isAnySubscribing = subscribingId !== null;

                return (
                  <div
                    key={product.id}
                    className={`rounded-xl border p-4 ${
                      product.featured
                        ? "border-teal-300 bg-teal-50/40"
                        : "border-[var(--line)] bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="font-semibold text-[var(--ink)]">{product.name}</h4>
                          {product.badgeText && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
                              {product.badgeText}
                            </span>
                          )}
                          {product.featured && !product.badgeText && (
                            <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-700 rounded-full">
                              Featured
                            </span>
                          )}
                        </div>
                        {product.description && (
                          <p className="text-sm text-[var(--muted)] mb-2">{product.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                          {product.vramGb && <span>{product.vramGb}GB VRAM</span>}
                          {product.cudaCores && <span>{product.cudaCores.toLocaleString()} CUDA cores</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-[var(--ink)] leading-none">
                          ${monthlyPrice}
                          <span className="text-sm font-normal text-[var(--muted)]">/mo</span>
                        </div>
                        {monthlyCents > 0 && (
                          <div className="text-xs text-teal-600 font-medium mt-1">
                            ${effectiveHourly}/hr effective
                          </div>
                        )}
                        {hasListHourly && savings > 0 && (
                          <div className="text-xs text-zinc-400 mt-0.5">
                            <span className="line-through">${(product.pricePerHourCents / 100).toFixed(2)}/hr</span>
                            <span className="ml-1 text-teal-600">Save {savings}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSubscribe(product)}
                      disabled={isAnySubscribing}
                      className="mt-3 w-full px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      {isSubscribingThis ? "Redirecting to checkout..." : `Subscribe — $${monthlyPrice}/mo`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[var(--line)] text-xs text-zinc-400 text-center">
          Redirects to Stripe · Cancel or pause anytime · GPU ready to deploy after payment
        </div>
      </div>
    </div>
  );
}
