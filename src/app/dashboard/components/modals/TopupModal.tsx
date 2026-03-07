/**
 * Topup Modal Component
 *
 * Modal for adding funds to wallet with optional voucher code.
 * Vouchers without a minimum top-up requirement can be redeemed directly.
 *
 * @module dashboard/modals/TopupModal
 */

"use client";

import React from "react";

interface ValidatedVoucher {
  code: string;
  name: string;
  creditCents: number;
  minTopupCents: number | null;
}

interface TopupModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  topupLoading: boolean;
  onTopup: (amount: number, voucherCode?: string) => void;
  onVoucherRedeemed?: () => void;
}

export function TopupModal({
  isOpen,
  onClose,
  token,
  topupLoading,
  onTopup,
  onVoucherRedeemed,
}: TopupModalProps) {
  const [voucherCode, setVoucherCode] = React.useState("");
  const [voucherValidating, setVoucherValidating] = React.useState(false);
  const [validatedVoucher, setValidatedVoucher] = React.useState<ValidatedVoucher | null>(null);
  const [voucherError, setVoucherError] = React.useState<string | null>(null);
  const [redeeming, setRedeeming] = React.useState(false);
  const [redeemSuccess, setRedeemSuccess] = React.useState<number | null>(null); // credited cents

  // Reset state when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setVoucherCode("");
      setValidatedVoucher(null);
      setVoucherError(null);
      setRedeeming(false);
      setRedeemSuccess(null);
    }
  }, [isOpen]);

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

  // Whether this voucher can be redeemed without a payment
  const isFreeVoucher = validatedVoucher && !validatedVoucher.minTopupCents;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--ink)]">Top Up Wallet</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Success state after voucher-only redemption */}
        {redeemSuccess !== null ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-[var(--ink)] mb-1">
              ${(redeemSuccess / 100).toFixed(0)} added to your wallet
            </p>
            <p className="text-sm text-zinc-500 mb-6">Your voucher has been redeemed successfully.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-[var(--ink)] text-white text-sm rounded-lg hover:bg-violet-600 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {!isFreeVoucher && (
              <p className="text-sm text-zinc-600 mb-6">
                Add funds to your wallet for GPU usage. Your card will be charged immediately.
              </p>
            )}

            {/* Voucher Code Input */}
            <div className={isFreeVoucher ? "mb-2" : "mb-4 pt-2 border-t border-[var(--line)]"}>
              {!voucherCode && !validatedVoucher ? (
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById("voucher-input");
                    if (input) input.focus();
                  }}
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  Have a voucher code?
                </button>
              ) : null}
              <div className={`flex gap-2 mt-1 ${!voucherCode && !validatedVoucher ? "opacity-0 h-0 overflow-hidden focus-within:opacity-100 focus-within:h-auto" : ""}`}>
                <input
                  id="voucher-input"
                  type="text"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                  placeholder="Enter voucher code"
                  className="flex-1 px-2 py-1.5 border border-[var(--line)] rounded text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 uppercase"
                  onFocus={(e) => e.target.parentElement?.classList.remove("opacity-0", "h-0", "overflow-hidden")}
                />
                <button
                  onClick={() => validateVoucherCode(voucherCode)}
                  disabled={!voucherCode.trim() || voucherValidating}
                  className="px-2 py-1.5 bg-[var(--ink)] text-white text-xs rounded hover:bg-violet-600 disabled:opacity-50 transition-colors"
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
                  {isFreeVoucher ? (
                    <p className="text-green-600 mt-1">Click redeem to add this credit to your wallet.</p>
                  ) : (
                    <p className="text-green-600 mt-1">Select an amount below to apply this bonus.</p>
                  )}
                </div>
              )}
            </div>

            {/* Free voucher: show Redeem button */}
            {isFreeVoucher ? (
              <div className="pt-2">
                <button
                  onClick={handleRedeemVoucher}
                  disabled={redeeming}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {redeeming ? "Redeeming..." : `Redeem $${(validatedVoucher.creditCents / 100).toFixed(0)} Credit`}
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {[
                    { value: 2500, label: "$25", hours: "~12h" },
                    { value: 5000, label: "$50", hours: "~25h" },
                    { value: 10000, label: "$100", hours: "~50h" },
                    { value: 25000, label: "$250", hours: "~125h" },
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
                        className="flex flex-col items-center p-4 border border-[var(--line)] rounded-xl hover:border-violet-500 hover:bg-violet-50 transition-colors disabled:opacity-50"
                      >
                        <span className="text-xl font-bold text-[var(--ink)]">{option.label}</span>
                        {validatedVoucher ? (
                          <span className="text-xs text-green-600 font-medium">
                            ~{totalHours}h GPU time (+{bonusHours}h bonus)
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">{option.hours} GPU time</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-zinc-400 text-center">
                  You&apos;ll be redirected to Stripe to complete payment securely.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
