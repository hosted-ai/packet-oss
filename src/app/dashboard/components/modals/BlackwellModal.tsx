"use client";

import React from "react";

interface BlackwellProduct {
  id: string;
  name: string;
  billingType: string;
  pricePerMonthCents: number | null;
  pricePerHourCents: number;
  stripePriceId: string | null;
}

interface BlackwellModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerEmail?: string;
}

export function BlackwellModal({
  isOpen,
  onClose,
  customerEmail,
}: BlackwellModalProps) {
  const [subscribing, setSubscribing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [blackwellProduct, setBlackwellProduct] = React.useState<BlackwellProduct | null>(null);
  const [loadingProduct, setLoadingProduct] = React.useState(false);

  // Fetch Blackwell product when modal opens
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
        // API returns { success, data: [...] }
        const products = json.data || json;
        const found = (Array.isArray(products) ? products : []).find(
          (p: BlackwellProduct) =>
            p.billingType === "monthly" &&
            p.stripePriceId &&
            (p.name.toLowerCase().includes("blackwell") ||
              p.name.toLowerCase().includes("rtx pro 6000"))
        );
        setBlackwellProduct(found || null);
      } catch {
        // Silently fail — product will show as unavailable
      } finally {
        if (!cancelled) setLoadingProduct(false);
      }
    }

    fetchProduct();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSubscribe = async () => {
    if (!blackwellProduct || !customerEmail) return;

    setSubscribing(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: blackwellProduct.id,
          email: customerEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start checkout");
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
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubscribing(false);
    }
  };

  if (!isOpen) return null;

  const monthlyPrice = blackwellProduct?.pricePerMonthCents
    ? (blackwellProduct.pricePerMonthCents / 100).toFixed(0)
    : "199";

  // Compute hourly from monthly (730 hours/month) since the monthly product has pricePerHourCents=0
  const hourlyEquivalent = blackwellProduct?.pricePerMonthCents
    ? (blackwellProduct.pricePerMonthCents / 100 / 730).toFixed(2)
    : "0.27";

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    }}>
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.70)",
          backdropFilter: "blur(8px)",
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: "relative",
        width: "100%",
        maxWidth: "540px",
        maxHeight: "90vh",
        overflowY: "auto",
        borderRadius: "20px",
        border: "1px solid rgba(255,255,255,0.1)",
        background: "linear-gradient(180deg, #0a0a0a 0%, #111827 100%)",
        color: "white",
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Radial glow effect — matches landing page */}
        <div style={{
          position: "absolute",
          top: "-100px",
          right: "-100px",
          width: "300px",
          height: "300px",
          background: "radial-gradient(circle, rgba(20, 184, 166, 0.15) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(40px)",
          pointerEvents: "none",
        }} />

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            zIndex: 10,
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div style={{ position: "relative", zIndex: 1, padding: "32px 28px" }}>
          {/* Urgency badge — matches landing page red urgency badge */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "100px",
            padding: "5px 14px",
            marginBottom: "12px",
            fontSize: "13px",
            color: "#ef4444",
          }}>
            <span style={{
              width: "7px",
              height: "7px",
              background: "#ef4444",
              borderRadius: "50%",
              animation: "bw-pulse 1.5s infinite",
            }} />
            Limited availability
          </div>

          {/* Title */}
          <h2 style={{
            fontSize: "28px",
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: "4px",
          }}>
            NVIDIA RTX PRO 6000
          </h2>
          <p style={{
            fontSize: "15px",
            color: "rgba(255,255,255,0.5)",
            marginBottom: "20px",
          }}>
            Server Edition &middot; Blackwell Architecture &middot; 96 GB GDDR7 ECC
          </p>

          {/* Price box — matches landing page gpu-price-box */}
          <div style={{
            background: "rgba(20, 184, 166, 0.1)",
            border: "1px solid rgba(20, 184, 166, 0.2)",
            borderRadius: "12px",
            padding: "18px 20px",
            marginBottom: "24px",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontSize: "40px", fontWeight: 700 }}>${monthlyPrice}</span>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "16px" }}>/month</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span style={{
                background: "#14b8a6",
                color: "white",
                padding: "3px 10px",
                borderRadius: "100px",
                fontSize: "12px",
                fontWeight: 600,
              }}>
                ${hourlyEquivalent}/hr effective
              </span>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
                Cancel or pause anytime
              </span>
            </div>
          </div>

          {/* Specs grid — matches landing page quick specs */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "10px",
            marginBottom: "24px",
          }}>
            {[
              ["96 GB", "GDDR7 ECC"],
              ["1,597 GB/s", "Bandwidth"],
              ["120 TF", "FP32"],
              ["4 PF", "FP4 AI"],
            ].map(([value, label]) => (
              <div key={label} style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: "10px",
                padding: "12px 8px",
                textAlign: "center",
                border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "white", lineHeight: 1.2 }}>{value}</div>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Features — matches landing page feature checkmarks */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 16px",
            }}>
              {[
                "Full root SSH access",
                "CUDA, PyTorch, vLLM",
                "1-click HuggingFace deploy",
                "Persistent storage",
                "24,064 CUDA cores",
                "24/7 priority support",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.5">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Trust badges — matches landing page TrustBadges */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "20px",
            flexWrap: "wrap",
            padding: "14px 0",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            marginBottom: "24px",
          }}>
            {[
              { label: "No contracts", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
              { label: "Cancel anytime", icon: "M6 18L18 6M6 6l12 12" },
              { label: "99.9% uptime", icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" },
            ].map((badge) => (
              <div key={badge.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2">
                  <path d={badge.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {badge.label}
              </div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: "16px",
              padding: "12px 14px",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "10px",
              fontSize: "13px",
              color: "#f87171",
            }}>
              {error}
            </div>
          )}

          {/* CTA button — matches landing page gradient CTA */}
          <button
            onClick={handleSubscribe}
            disabled={subscribing || loadingProduct || !blackwellProduct}
            style={{
              width: "100%",
              padding: "14px 0",
              background: subscribing || loadingProduct || !blackwellProduct
                ? "rgba(255,255,255,0.1)"
                : "linear-gradient(135deg, #14b8a6, #0d9488)",
              color: subscribing || loadingProduct || !blackwellProduct
                ? "rgba(255,255,255,0.4)"
                : "white",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: 600,
              cursor: subscribing || loadingProduct || !blackwellProduct ? "not-allowed" : "pointer",
              boxShadow: subscribing || loadingProduct || !blackwellProduct
                ? "none"
                : "0 4px 20px rgba(20, 184, 166, 0.3)",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {subscribing
              ? "Redirecting to payment..."
              : loadingProduct
                ? "Loading..."
                : !blackwellProduct
                  ? "Product unavailable"
                  : `Subscribe — $${monthlyPrice}/mo`}
            {!subscribing && !loadingProduct && blackwellProduct && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <p style={{
            textAlign: "center",
            fontSize: "12px",
            color: "rgba(255,255,255,0.35)",
            marginTop: "12px",
          }}>
            Redirects to Stripe &middot; GPU ready to deploy immediately after payment
          </p>
        </div>

        {/* Pulse animation for urgency dot */}
        <style>{`
          @keyframes bw-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      </div>
    </div>
  );
}
