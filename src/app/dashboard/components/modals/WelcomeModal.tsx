"use client";

import React from "react";

interface ValidatedVoucher {
  code: string;
  name: string;
  creditCents: number;
  minTopupCents: number | null;
}

interface MonthlyProduct {
  id: string;
  name: string;
  billingType: string;
  pricePerMonthCents: number | null;
  pricePerHourCents: number;
  stripePriceId: string | null;
}

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  topupLoading: boolean;
  onTopup: (amount: number, voucherCode?: string) => void;
  onVoucherRedeemed?: () => void;
  customerEmail?: string;
}

export function WelcomeModal({
  isOpen,
  onClose,
  token,
  topupLoading,
  onTopup,
  onVoucherRedeemed,
  customerEmail,
}: WelcomeModalProps) {
  const [voucherCode, setVoucherCode] = React.useState("");
  const [voucherValidating, setVoucherValidating] = React.useState(false);
  const [validatedVoucher, setValidatedVoucher] = React.useState<ValidatedVoucher | null>(null);
  const [voucherError, setVoucherError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [redeeming, setRedeeming] = React.useState(false);
  const [redeemSuccess, setRedeemSuccess] = React.useState<number | null>(null);

  // Monthly product state
  const [monthlyProduct, setMonthlyProduct] = React.useState<MonthlyProduct | null>(null);
  const [subscribing, setSubscribing] = React.useState(false);
  const [subscribeError, setSubscribeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setMounted(true));
    } else {
      setMounted(false);
      setVoucherCode("");
      setValidatedVoucher(null);
      setVoucherError(null);
      setRedeeming(false);
      setRedeemSuccess(null);
      setSubscribing(false);
      setSubscribeError(null);
    }
  }, [isOpen]);

  // Fetch monthly product when modal opens
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function fetchProduct() {
      try {
        const res = await fetch("/api/products");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const products = json.data || json;
        const found = (Array.isArray(products) ? products : []).find(
          (p: MonthlyProduct) =>
            p.billingType === "monthly" &&
            p.stripePriceId &&
            (p.name.toLowerCase().includes("blackwell") ||
              p.name.toLowerCase().includes("rtx pro 6000"))
        );
        setMonthlyProduct(found || null);
      } catch {
        // Silently fail
      }
    }

    fetchProduct();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleMonthlyCheckout = async () => {
    if (!monthlyProduct || !customerEmail) return;

    setSubscribing(true);
    setSubscribeError(null);

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
        setSubscribeError(data.error || "Failed to start checkout");
        return;
      }

      if (data.isPortal) {
        setSubscribeError(data.message || "You already have this subscription. Redirecting...");
        setTimeout(() => {
          if (data.url) window.location.href = data.url;
        }, 1500);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setSubscribeError("Something went wrong. Please try again.");
    } finally {
      setSubscribing(false);
    }
  };

  const validateVoucherCode = React.useCallback(async (code: string) => {
    if (!code.trim() || !token) {
      setValidatedVoucher(null);
      setVoucherError(null);
      return;
    }
    setVoucherValidating(true);
    setVoucherError(null);
    try {
      const res = await fetch("/api/account/voucher/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });
      const result = await res.json();
      if (result.success && result.voucher) {
        setValidatedVoucher(result.voucher);
        setVoucherError(null);
      } else {
        setValidatedVoucher(null);
        setVoucherError(result.error || "Invalid voucher code");
      }
    } catch {
      setValidatedVoucher(null);
      setVoucherError("Failed to validate voucher");
    } finally {
      setVoucherValidating(false);
    }
  }, [token]);

  const handleRedeemVoucher = React.useCallback(async () => {
    if (!validatedVoucher || !token || redeeming) return;

    setRedeeming(true);
    setVoucherError(null);

    try {
      const res = await fetch("/api/account/voucher/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: validatedVoucher.code }),
      });
      const result = await res.json();

      if (result.success) {
        setRedeemSuccess(result.creditCents);
        onVoucherRedeemed?.();
      } else {
        setVoucherError(result.error || "Failed to redeem voucher");
      }
    } catch {
      setVoucherError("Failed to redeem voucher");
    } finally {
      setRedeeming(false);
    }
  }, [validatedVoucher, token, redeeming, onVoucherRedeemed]);

  const handleTopupWithVoucher = React.useCallback((amount: number) => {
    onTopup(amount, validatedVoucher?.code);
  }, [onTopup, validatedVoucher]);

  const isFreeVoucher = validatedVoucher && !validatedVoucher.minTopupCents;

  const monthlyPrice = monthlyProduct?.pricePerMonthCents
    ? (monthlyProduct.pricePerMonthCents / 100).toFixed(0)
    : "199";

  const hourlyEquivalent = monthlyProduct?.pricePerMonthCents
    ? (monthlyProduct.pricePerMonthCents / 100 / 730).toFixed(2)
    : "0.27";

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center transition-all duration-300 ${
        mounted ? "bg-black/60 backdrop-blur-sm" : "bg-black/0"
      }`}
    >
      <div
        className={`w-full max-w-lg mx-4 transition-all duration-300 ${
          mounted ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        }`}
      >
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
          {/* Hero header */}
          <div className="bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 px-8 pt-10 pb-8 relative overflow-hidden flex-shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(20,184,166,0.15),transparent_60%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(26,79,255,0.08),transparent_50%)]" />
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors z-10 p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
                  <svg className="w-4.5 h-4.5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <span className="text-xs font-medium text-teal-400 uppercase tracking-wider">Welcome to Packet</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {redeemSuccess !== null
                  ? "You\u2019re all set!"
                  : "You\u2019re in. Let\u2019s get you running."}
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {redeemSuccess !== null
                  ? "Your wallet has been funded. You can now deploy a GPU."
                  : "Choose your payment type and deploy a GPU in minutes. Full SSH access, no contracts, cancel anytime."}
              </p>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto flex-1">
            {/* Success state after voucher-only redemption */}
            {redeemSuccess !== null ? (
              <div className="px-8 py-10 text-center">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-xl font-bold text-[var(--ink)] mb-1">
                  ${(redeemSuccess / 100).toFixed(0)} added to your wallet
                </p>
                <p className="text-sm text-zinc-500 mb-6">Your voucher has been redeemed successfully.</p>
                <button
                  onClick={onClose}
                  className="px-8 py-2.5 bg-teal-500 text-white text-sm font-medium rounded-xl hover:bg-teal-600 transition-colors"
                >
                  Start deploying
                </button>
              </div>
            ) : (
              <>
                {/* Monthly flat rate option */}
                {monthlyProduct && !isFreeVoucher && (
                  <div className="px-8 pt-6 pb-2">
                    <button
                      onClick={handleMonthlyCheckout}
                      disabled={subscribing || !customerEmail}
                      className="w-full p-4 rounded-xl border border-[var(--line)] bg-zinc-50 hover:border-teal-400 hover:bg-teal-50/50 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide bg-teal-500 text-white rounded-full flex-shrink-0">
                          New!
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[var(--ink)]">Flat Rate Blackwell</p>
                          <p className="text-sm text-[var(--muted)]">
                            RTX 6000 Pro at ${monthlyPrice}/month (${hourlyEquivalent}/hr equivalent)
                          </p>
                        </div>
                        {subscribing && (
                          <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                        )}
                      </div>
                    </button>
                    {subscribeError && (
                      <p className="mt-2 text-xs text-red-600">{subscribeError}</p>
                    )}
                  </div>
                )}

                {/* PAYG wallet section — hidden when free voucher is validated */}
                {!isFreeVoucher && (
                  <div className="px-8 pt-5 pb-4">
                    <p className="text-sm font-semibold text-[var(--ink)] mb-1">PAYG, on-demand GPU wallet</p>
                    <p className="text-xs text-[var(--muted)] mb-5">Choose an amount. RTX Pro 6000 from $0.66/hr</p>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: 2500, label: "$25", hours: "~12h", tag: null },
                        { value: 5000, label: "$50", hours: "~25h", tag: "Popular" },
                        { value: 10000, label: "$100", hours: "~50h", tag: null },
                        { value: 25000, label: "$250", hours: "~125h", tag: "Best value" },
                      ].map((option) => {
                        const bonusHours = validatedVoucher
                          ? Math.round((validatedVoucher.creditCents / 100) / 2)
                          : 0;
                        const totalHours = parseInt(option.hours.replace("~", "").replace("h", "")) + bonusHours;
                        return (
                          <button
                            key={option.value}
                            onClick={() => handleTopupWithVoucher(option.value)}
                            disabled={topupLoading}
                            className="relative flex flex-col items-center p-5 border border-[var(--line)] rounded-xl hover:border-teal-400 hover:bg-teal-50/50 transition-all duration-150 disabled:opacity-50 group"
                          >
                            {option.tag && (
                              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-teal-500 text-white text-[10px] font-semibold rounded-full whitespace-nowrap">
                                {option.tag}
                              </span>
                            )}
                            <span className="text-2xl font-bold text-[var(--ink)] group-hover:text-teal-600 transition-colors">{option.label}</span>
                            {validatedVoucher ? (
                              <span className="text-xs text-green-600 font-medium mt-1">
                                ~{totalHours}h GPU time (+{bonusHours}h bonus)
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--muted)] mt-1">{option.hours} GPU time</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Voucher section */}
                <div className="px-8 pb-3">
                  {!voucherCode && !validatedVoucher ? (
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById("welcome-voucher-input");
                        if (input) input.focus();
                      }}
                      className="text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                    >
                      Have a voucher code?
                    </button>
                  ) : null}
                  <div className={`flex gap-2 mt-1 ${!voucherCode && !validatedVoucher ? "opacity-0 h-0 overflow-hidden focus-within:opacity-100 focus-within:h-auto" : ""}`}>
                    <input
                      id="welcome-voucher-input"
                      type="text"
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                      placeholder="Enter voucher code"
                      className="flex-1 px-2 py-1.5 border border-[var(--line)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-teal-500 uppercase"
                      onFocus={(e) => e.target.parentElement?.classList.remove("opacity-0", "h-0", "overflow-hidden")}
                    />
                    <button
                      onClick={() => validateVoucherCode(voucherCode)}
                      disabled={!voucherCode.trim() || voucherValidating}
                      className="px-2 py-1.5 bg-[var(--ink)] text-white text-xs rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                    >
                      {voucherValidating ? "..." : "Apply"}
                    </button>
                  </div>
                  {voucherError && (
                    <p className="mt-1 text-xs text-red-600">{voucherError}</p>
                  )}
                  {validatedVoucher && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                      <div className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-green-700 font-medium">{validatedVoucher.name}</span>
                        <span className="text-green-600">+${(validatedVoucher.creditCents / 100).toFixed(0)} credit</span>
                      </div>
                      {isFreeVoucher && (
                        <p className="text-green-600 mt-1">Click redeem to add this credit to your wallet.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Free voucher: Redeem button */}
                {isFreeVoucher && (
                  <div className="px-8 pb-4">
                    <button
                      onClick={handleRedeemVoucher}
                      disabled={redeeming}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
                    >
                      {redeeming ? "Redeeming..." : `Redeem $${(validatedVoucher.creditCents / 100).toFixed(0)} Credit`}
                    </button>
                  </div>
                )}

                {/* Footer */}
                <div className="px-8 pb-6 pt-2 flex flex-col items-center gap-3">
                  {!isFreeVoucher && (
                    <p className="text-[11px] text-zinc-400">
                      Secure payment via Stripe. Funds are added instantly.
                    </p>
                  )}
                  <button
                    onClick={onClose}
                    className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    Skip for now, just looking around
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
