"use client";

import React from "react";

interface MonthlyProduct {
  id: string;
  name: string;
  billingType: string;
  pricePerMonthCents: number | null;
  pricePerHourCents: number;
  stripePriceId: string | null;
}

interface BillingTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHourly: () => void;
  customerEmail?: string;
}

export function BillingTypeModal({
  isOpen,
  onClose,
  onSelectHourly,
  customerEmail,
}: BillingTypeModalProps) {
  const [subscribing, setSubscribing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [monthlyProduct, setMonthlyProduct] = React.useState<MonthlyProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = React.useState(false);

  // Fetch monthly product when modal opens
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function fetchProduct() {
      setLoadingProduct(true);
      try {
        const res = await fetch("/api/products");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const products = json.data || json;
        const found = (Array.isArray(products) ? products : []).find(
          (p: MonthlyProduct) =>
            p.billingType === "monthly" &&
            p.stripePriceId
        );
        setMonthlyProduct(found || null);
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoadingProduct(false);
      }
    }

    fetchProduct();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Reset state when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setError(null);
      setSubscribing(false);
    }
  }, [isOpen]);

  const handleMonthly = async () => {
    if (!monthlyProduct || !customerEmail) return;

    setSubscribing(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: monthlyProduct.id,
          email: customerEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start checkout");
        return;
      }

      if (data.isPortal) {
        setError(data.message || "You already have this subscription. Redirecting...");
        setTimeout(() => {
          if (data.url) window.location.href = data.url;
        }, 1500);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubscribing(false);
    }
  };

  if (!isOpen) return null;

  const monthlyPrice = monthlyProduct?.pricePerMonthCents
    ? (monthlyProduct.pricePerMonthCents / 100).toFixed(0)
    : "199";

  const hourlyEquivalent = monthlyProduct?.pricePerMonthCents
    ? (monthlyProduct.pricePerMonthCents / 100 / 730).toFixed(2)
    : "0.27";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-6 pb-2">
          <h2 className="text-lg font-semibold text-zinc-900">Choose your billing plan</h2>
          <p className="text-sm text-zinc-500 mt-1">Select how you'd like to pay for GPU compute</p>
        </div>

        <div className="px-6 pb-6 space-y-3">
          {/* Monthly option */}
          <button
            onClick={handleMonthly}
            disabled={subscribing || loadingProduct || !monthlyProduct}
            className="w-full text-left p-5 rounded-xl border-2 border-teal-200 bg-teal-50/50 hover:border-teal-400 hover:bg-teal-50 transition-all relative disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="absolute top-3 right-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-500 text-white">
                Best value
              </span>
            </div>

            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-2xl font-bold text-zinc-900">${monthlyPrice}</span>
              <span className="text-sm text-zinc-500">/month</span>
            </div>
            <div className="text-xs text-teal-600 font-medium mb-3">
              ${hourlyEquivalent}/hr effective · 60% less than hourly
            </div>

            <div className="space-y-1.5">
              {["Fixed monthly cost — no surprises", "Cancel or pause anytime", "GPU ready immediately after payment"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-zinc-600">
                  <svg className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {item}
                </div>
              ))}
            </div>

            {subscribing && (
              <div className="mt-3 text-xs text-teal-600 font-medium flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                Redirecting to payment...
              </div>
            )}
          </button>

          {/* Hourly option */}
          <button
            onClick={() => {
              onClose();
              onSelectHourly();
            }}
            disabled={subscribing}
            className="w-full text-left p-5 rounded-xl border-2 border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-2xl font-bold text-zinc-900">$0.66</span>
              <span className="text-sm text-zinc-500">/hour</span>
            </div>
            <div className="text-xs text-zinc-500 font-medium mb-3">
              Pay per second · Billed from prepaid wallet
            </div>

            <div className="space-y-1.5">
              {["No commitment — stop anytime", "Pay only for what you use", "Top up your wallet to get started"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-zinc-600">
                  <svg className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {item}
                </div>
              ))}
            </div>
          </button>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          <p className="text-[11px] text-zinc-400 text-center pt-1">
            Both plans include full root SSH access, CUDA, and 24/7 support
          </p>
        </div>
      </div>
    </div>
  );
}
