"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getBrandName, getLogoUrl } from "@/lib/branding";
import { useBranding } from "@/hooks/useBranding";

const IS_OSS = process.env.NEXT_PUBLIC_EDITION === "oss";

interface GpuProduct {
  id: string;
  name: string;
  description: string | null;
  billingType: string;
  pricePerHourCents: number;
  pricePerMonthCents: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  featured: boolean;
  badgeText: string | null;
  vramGb: number | null;
  cudaCores: number | null;
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const branding = useBranding();
  const LOGO_URL = branding?.logoUrl || getLogoUrl();
  const initialEmail = searchParams.get("email") || "";
  // Support both "product" and "gpu" URL parameters for backwards compatibility
  const initialProductId = searchParams.get("product") || searchParams.get("gpu") || "";

  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Products from database
  const [products, setProducts] = useState<GpuProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<GpuProduct | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);

  // Voucher state
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherValidating, setVoucherValidating] = useState(false);
  const [validatedVoucher, setValidatedVoucher] = useState<{
    code: string;
    name: string;
    creditCents: number;
    minTopupCents: number | null;
  } | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  // Terms acceptance
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Voucher section visibility
  const [showVoucherInput, setShowVoucherInput] = useState(false);

  // Fetch products from database
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch("/api/products");
        const result = await res.json();
        if (result.success && result.data) {
          setProducts(result.data);
          // Find product by ID (try exact match first, then partial match on name)
          const productFromUrl = result.data.find((p: GpuProduct) =>
            p.id === initialProductId ||
            p.id.toLowerCase().includes(initialProductId.toLowerCase()) ||
            p.name.toLowerCase().includes(initialProductId.toLowerCase())
          );
          const featuredProduct = result.data.find((p: GpuProduct) => p.featured);
          setSelectedProduct(productFromUrl || featuredProduct || result.data[0] || null);
        }
      } catch (err) {
        console.error("Failed to fetch products:", err);
      } finally {
        setProductsLoading(false);
      }
    };
    fetchProducts();
  }, [initialProductId]);

  // Validate voucher code
  const validateVoucher = async (code: string) => {
    if (!code.trim()) {
      setValidatedVoucher(null);
      setVoucherError(null);
      return;
    }

    setVoucherValidating(true);
    setVoucherError(null);

    try {
      const res = await fetch("/api/voucher/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result = await res.json();

      if (result.success && result.voucher) {
        import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.VOUCHER_REDEEMED)).catch(() => {});
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address");
      setStatus("error");
      return;
    }

    if (!selectedProduct) {
      setErrorMessage("Please select a GPU product");
      setStatus("error");
      return;
    }

    if (!termsAccepted) {
      setErrorMessage("Please accept the Terms of Service and Privacy Policy");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          productId: selectedProduct.id,
          voucherCode: validatedVoucher?.code,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout");
      }

      if (data.url) {
        import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.DEPOSIT_STARTED, { revenue: getDepositAmount() })).catch(() => {});
        window.location.href = data.url;
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  };

  // Calculate deposit amount based on voucher
  const getDepositAmount = () => {
    const baseDeposit = 50;

    if (validatedVoucher) {
      // If voucher requires a minimum deposit, use the higher of base or minimum
      const minDeposit = validatedVoucher.minTopupCents
        ? validatedVoucher.minTopupCents / 100
        : baseDeposit;
      const deposit = Math.max(baseDeposit, minDeposit);
      const voucherAmount = validatedVoucher.creditCents / 100;
      return Math.max(0, deposit - voucherAmount);
    }

    return baseDeposit;
  };

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-[#0b0f1c] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-8 text-center">
        <Link href="/" className="inline-flex items-center justify-center gap-2 mb-6">
          <Image
            src={LOGO_URL}
            alt={getBrandName()}
            width={180}
            height={64}
            className="h-12 w-auto"
          />
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gradient-to-r from-teal-500 to-teal-600 text-white">Beta</span>
        </Link>

        <h1 className="text-2xl font-bold mb-2">
          {selectedProduct?.billingType === "monthly" ? "Subscribe" : "Add Funds"}
        </h1>
        <p className="text-[#5b6476] mb-4">
          {selectedProduct?.billingType === "monthly"
            ? "Start your monthly GPU subscription — cancel anytime."
            : "Select your GPU and make an initial deposit to start using cloud GPUs."}
        </p>
        {!IS_OSS && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 mb-6 text-sm text-zinc-600">
            New here? <Link href={`/account${initialEmail ? `?email=${encodeURIComponent(initialEmail)}` : ""}${initialProductId ? `${initialEmail ? "&" : "?"}gpu=${encodeURIComponent(initialProductId)}` : ""}`} className="text-[#1a4fff] font-medium hover:underline">Create a free account</Link> — no credit card required.
          </div>
        )}

        {/* Product Selection */}
        {productsLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-[#1a4fff] border-t-transparent rounded-full"></div>
          </div>
        ) : products.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800 text-sm">No products available. Please check back later.</p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {products.map((product) => (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all relative ${
                    selectedProduct?.id === product.id
                      ? "border-[#1a4fff] bg-blue-50"
                      : "border-[#e4e7ef] hover:border-[#1a4fff]/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{product.name}</span>
                        {product.badgeText && (
                          <span className="text-xs bg-[#1a4fff] text-white px-2 py-0.5 rounded-full">
                            {product.badgeText}
                          </span>
                        )}
                      </div>
                      {product.description && (
                        <p className="text-sm text-[#5b6476] mt-1">{product.description}</p>
                      )}
                      <div className="flex gap-3 mt-2 text-xs text-[#5b6476]">
                        {product.vramGb && <span>{product.vramGb} GB VRAM</span>}
                        {product.cudaCores && <span>{product.cudaCores.toLocaleString()} CUDA Cores</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      {product.billingType === "monthly" && product.pricePerMonthCents ? (
                        <>
                          <span className="font-bold text-[#1a4fff]">
                            ${(product.pricePerMonthCents / 100).toFixed(0)}
                          </span>
                          <span className="text-sm text-[#5b6476]">/month</span>
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-[#1a4fff]">
                            ${(product.pricePerHourCents / 100).toFixed(2)}
                          </span>
                          <span className="text-sm text-[#5b6476]">/hour</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}

        {selectedProduct && (
          <div className="bg-[#f7f8fb] rounded-lg p-4 mb-6">
            {selectedProduct.billingType === "monthly" && selectedProduct.pricePerMonthCents ? (
              <>
                <p className="text-sm text-[#5b6476] mb-1">Monthly subscription:</p>
                <p className="text-[#1a4fff] font-bold text-xl">
                  ${(selectedProduct.pricePerMonthCents / 100).toFixed(0)}/month
                </p>
                <p className="text-xs text-[#5b6476] mt-1">
                  Billed monthly. Cancel anytime from your dashboard.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-[#5b6476] mb-1">
                  {validatedVoucher ? "Amount to pay:" : "Initial deposit:"}
                </p>
                {validatedVoucher ? (
                  <>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-[#5b6476] line-through text-lg">
                        $50
                      </span>
                      <span className="text-[#1a4fff] font-bold text-xl">
                        {getDepositAmount() === 0 ? "Free!" : `$${getDepositAmount().toFixed(0)}`}
                      </span>
                    </div>
                    <p className="text-xs text-green-600 mt-1">
                      Voucher applied: -${(validatedVoucher.creditCents / 100).toFixed(0)}
                    </p>
                  </>
                ) : (
                  <p className="text-[#1a4fff] font-bold text-xl">${getDepositAmount().toFixed(0)}</p>
                )}
                <p className="text-xs text-[#5b6476] mt-1">
                  Pay-as-you-go at ${(selectedProduct.pricePerHourCents / 100).toFixed(2)}/hour
                </p>
              </>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "loading"}
            className="w-full px-4 py-3 bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder:text-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff] focus:border-transparent transition-all disabled:opacity-50"
          />

          {/* Voucher code - only for hourly products */}
          {selectedProduct?.billingType !== "monthly" && (
            <>
              {!showVoucherInput && !validatedVoucher ? (
                <button
                  type="button"
                  onClick={() => setShowVoucherInput(true)}
                  className="text-xs text-[#5b6476] hover:text-[#1a4fff] transition-colors"
                >
                  Have a voucher code?
                </button>
              ) : (
                <>
                  {!validatedVoucher && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter code"
                        value={voucherCode}
                        onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                        disabled={status === "loading"}
                        autoFocus
                        className="flex-1 px-3 py-2 text-sm bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder:text-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff] focus:border-transparent transition-all disabled:opacity-50 uppercase"
                      />
                      <button
                        type="button"
                        onClick={() => validateVoucher(voucherCode)}
                        disabled={!voucherCode.trim() || voucherValidating || status === "loading"}
                        className="px-3 py-2 text-sm bg-[#e4e7ef] hover:bg-[#d1d5e0] disabled:opacity-50 text-[#5b6476] font-medium rounded-lg transition-colors"
                      >
                        {voucherValidating ? "..." : "Apply"}
                      </button>
                    </div>
                  )}
                  {voucherError && (
                    <p className="text-red-500 text-xs">{voucherError}</p>
                  )}
                  {validatedVoucher && (
                    <div className="p-2 bg-green-50 border border-green-200 rounded-lg text-left text-sm">
                      <p className="text-green-700 font-medium">{validatedVoucher.name}</p>
                      <p className="text-green-600 text-xs">
                        ${(validatedVoucher.creditCents / 100).toFixed(0)} credit applied
                        {getDepositAmount() === 0 && " - No payment required!"}
                      </p>
                      {validatedVoucher.minTopupCents && (
                        <p className="text-amber-600 text-xs mt-1">
                          Requires a minimum ${(validatedVoucher.minTopupCents / 100).toFixed(0)} deposit
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Terms and Privacy acceptance */}
          <label className="flex items-start gap-3 text-left cursor-pointer">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-[#e4e7ef] text-[#1a4fff] focus:ring-[#1a4fff]"
            />
            <span className="text-sm text-[#5b6476]">
              I agree to the{" "}
              <a href="/terms" target="_blank" className="text-[#1a4fff] hover:underline">Terms of Service</a>
              {" "}and{" "}
              <a href="/privacy" target="_blank" className="text-[#1a4fff] hover:underline">Privacy Policy</a>
            </span>
          </label>

          <button
            type="submit"
            disabled={status === "loading" || !selectedProduct || !termsAccepted}
            className="w-full px-6 py-3 bg-[#1a4fff] hover:bg-[#1238c9] disabled:bg-[#e4e7ef] text-white font-medium rounded-lg transition-colors"
          >
            {status === "loading" ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : selectedProduct?.billingType === "monthly" ? (
              "Start Subscription"
            ) : validatedVoucher && getDepositAmount() === 0 ? (
              "Activate Account"
            ) : (
              "Continue to Payment"
            )}
          </button>
          {status === "error" && errorMessage && (
            <p className="text-red-500 text-sm">{errorMessage}</p>
          )}
        </form>

        <p className="text-xs text-[#5b6476] mt-6">
          {selectedProduct?.billingType === "monthly"
            ? "Cancel anytime from your dashboard. No long-term commitment."
            : "Cancel anytime. Unused balance can be withdrawn."}
        </p>

        <Link href="/" className="inline-block mt-4 text-sm text-[#5b6476] hover:text-[#0b0f1c] transition-colors">
          &larr; Back to home
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <div className="animate-spin h-5 w-5 border-2 border-[#1a4fff] border-t-transparent rounded-full"></div>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
