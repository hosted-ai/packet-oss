"use client";

import { useState } from "react";
import type { GpuOffering } from "@/app/admin/types";

interface GPUPricingCardsProps {
  offerings: GpuOffering[];
  onGetStarted: (gpuId: string, plan: "hourly" | "monthly", email: string) => void;
  cardLoading: boolean;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function GPUPricingCards({ offerings, onGetStarted, cardLoading }: GPUPricingCardsProps) {
  const [billingType, setBillingType] = useState<"hourly" | "monthly">("hourly");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState<string | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  const activeOfferings = offerings.filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder);

  const handleWaitlistSubmit = async (gpuName: string) => {
    if (!waitlistEmail || !isValidEmail(waitlistEmail)) {
      setWaitlistError("Please enter a valid email");
      return;
    }
    setWaitlistLoading(true);
    setWaitlistError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: waitlistEmail, gpu: gpuName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to join waitlist");
      }
      setWaitlistSuccess(gpuName);
      setWaitlistEmail("");
    } catch (err) {
      setWaitlistError(err instanceof Error ? err.message : "Failed to join waitlist");
    } finally {
      setWaitlistLoading(false);
    }
  };

  return (
    <section id="pricing">
      <div className="container">
        <div className="section-title">
          <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
            Simple, transparent pricing
          </h2>
          <p>On-demand GPUs, not spot instances. No hidden fees, no interruptions, cancel anytime.</p>
        </div>

        {/* GPU Cards Grid */}
        <div className="gpu-pricing-grid">
          {activeOfferings.map((offering) => {
            const hourlyPrice = offering.hourlyPrice;
            const monthlyPrice = Math.round(hourlyPrice * 730);
            const isExpanded = false;
            // H200 is coming soon
            const isWaitlist = false;
            const isComingSoon = offering.name.includes("H200");
            const isSoldOut = !!offering.soldOut;
            const isPopular = !!offering.popular;
            const hasJoinedWaitlist = waitlistSuccess === offering.name;
            return (
              <div key={offering.id} className={`gpu-pricing-card ${isWaitlist ? "waitlist" : ""} ${isComingSoon ? "coming-soon" : ""} ${isSoldOut ? "sold-out" : ""} ${isPopular && !isSoldOut && !isComingSoon ? "popular" : ""}`}>
                {isWaitlist && <div className="waitlist-badge">Waitlist</div>}
                {isComingSoon && <div className="coming-soon-badge">Coming Soon</div>}
                {isSoldOut && <div className="sold-out-badge">Sold Out</div>}
                {isPopular && !isSoldOut && !isComingSoon && <div className="popular-badge">Most Popular</div>}
                <div className="gpu-card-header">
                  <h3 className="display">{offering.fullName}</h3>
                  <span className="gpu-memory">{offering.memory}</span>
                </div>

                <div className="gpu-card-price">
                  <span className="price-value">${hourlyPrice.toFixed(2)}</span>
                  <span className="price-unit">/hour per GPU</span>
                </div>

                <div className="gpu-card-subtitle">
                  Pay as you go. No minimum commitment.
                </div>

                <ul className="gpu-card-features">
                  {offering.pricing.features.map((feature, index) => (
                    <li key={index}>{feature}</li>
                  ))}
                </ul>

                {isWaitlist ? (
                  hasJoinedWaitlist ? (
                    <div className="waitlist-success">
                      <svg className="checkmark" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>You&apos;re on the list!</span>
                    </div>
                  ) : (
                    <div className="waitlist-form">
                      <input
                        type="email"
                        placeholder="you@company.com"
                        value={waitlistEmail}
                        onChange={(e) => {
                          setWaitlistEmail(e.target.value);
                          setWaitlistError(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && handleWaitlistSubmit(offering.name)}
                        className={waitlistError ? "error" : ""}
                      />
                      <button
                        type="button"
                        onClick={() => handleWaitlistSubmit(offering.name)}
                        disabled={waitlistLoading}
                        className="btn primary"
                      >
                        {waitlistLoading ? <span className="loading-spinner"></span> : "48h Waitlist"}
                      </button>
                      {waitlistError && <p className="waitlist-error">{waitlistError}</p>}
                    </div>
                  )
                ) : isComingSoon || isSoldOut ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled
                  >
                    {isSoldOut ? "Sold Out" : "Coming Soon"}
                  </button>
                ) : (
                  <>
                    <a
                      href={`/account?gpu=${offering.id}&plan=hourly`}
                      className="btn primary"
                      style={{ display: "block", textAlign: "center", textDecoration: "none" }}
                    >
                      Deploy Now
                    </a>
                    <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", margin: "8px 0 0", opacity: 0.7 }}>
                      Pay as you go &middot; Cancel anytime
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
            Need dedicated hardware? <a href="/contact" style={{ color: "var(--blue)", textDecoration: "underline" }}>Contact us</a>
          </p>
        </div>
      </div>

      <style jsx>{`
        .pricing-billing-toggle {
          display: flex;
          justify-content: center;
          gap: 0;
          margin-bottom: 32px;
        }

        .pricing-billing-toggle button {
          padding: 10px 24px;
          font-size: 14px;
          font-weight: 500;
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: white;
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--muted);
        }

        .pricing-billing-toggle button:first-child {
          border-radius: 8px 0 0 8px;
          border-right: none;
        }

        .pricing-billing-toggle button:last-child {
          border-radius: 0 8px 8px 0;
        }

        .pricing-billing-toggle button.active {
          background: var(--blue);
          border-color: var(--blue);
          color: white;
        }

        .pricing-billing-toggle button:not(.active):hover {
          background: rgba(0, 0, 0, 0.02);
        }

        .gpu-pricing-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 24px;
          max-width: 1000px;
          margin: 0 auto;
        }

        .gpu-pricing-card {
          background: white;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          padding: 28px;
          display: flex;
          flex-direction: column;
          transition: all 0.2s ease;
        }

        .gpu-pricing-card:hover {
          border-color: var(--blue);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }

        .gpu-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }

        .gpu-card-header h3 {
          font-size: 1.25rem;
          margin: 0;
        }

        .gpu-memory {
          font-size: 12px;
          font-weight: 500;
          color: var(--blue);
          background: rgba(26, 79, 255, 0.08);
          padding: 4px 8px;
          border-radius: 4px;
        }

        .gpu-card-price {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-bottom: 4px;
        }

        .price-value {
          font-size: 2rem;
          font-weight: 700;
          color: var(--ink);
        }

        .price-unit {
          font-size: 14px;
          color: var(--muted);
        }

        .gpu-card-subtitle {
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 20px;
        }

        .gpu-card-features {
          list-style: none;
          padding: 0;
          margin: 0 0 24px 0;
          flex: 1;
        }

        .gpu-card-features li {
          padding: 8px 0;
          padding-left: 24px;
          position: relative;
          font-size: 14px;
          color: var(--ink);
          border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        }

        .gpu-card-features li:last-child {
          border-bottom: none;
        }

        .gpu-card-features li::before {
          content: "✓";
          position: absolute;
          left: 0;
          color: var(--blue);
          font-weight: 600;
        }

        .gpu-pricing-card .btn {
          width: 100%;
        }

        .card-email-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .card-email-form input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 8px;
          font-size: 14px;
          transition: border-color 0.2s ease;
        }

        .card-email-form input:focus {
          outline: none;
          border-color: var(--blue);
        }

        .card-email-form input.error {
          border-color: #ef4444;
        }

        .card-email-error {
          font-size: 12px;
          color: #ef4444;
          margin: 0;
        }

        .gpu-pricing-card.popular {
          position: relative;
          overflow: hidden;
          border-color: var(--teal);
          box-shadow: 0 0 0 1px var(--teal), 0 4px 20px rgba(20, 184, 166, 0.1);
        }

        .gpu-pricing-card.popular:hover {
          border-color: var(--teal);
          box-shadow: 0 0 0 1px var(--teal), 0 8px 30px rgba(20, 184, 166, 0.15);
        }

        .popular-badge {
          position: absolute;
          top: 24px;
          right: -35px;
          background: linear-gradient(135deg, #14b8a6, #0d9488);
          color: white;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 6px 40px;
          transform: rotate(45deg);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 10;
        }

        .gpu-pricing-card.coming-soon,
        .gpu-pricing-card.waitlist,
        .gpu-pricing-card.sold-out {
          position: relative;
          overflow: hidden;
        }

        .gpu-pricing-card.sold-out {
          opacity: 0.75;
        }

        .gpu-pricing-card.sold-out .btn.primary {
          background: #94a3b8;
          cursor: default;
          pointer-events: none;
        }

        .sold-out-badge {
          position: absolute;
          top: 24px;
          right: -35px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 6px 40px;
          transform: rotate(45deg);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 10;
        }

        .coming-soon-badge {
          position: absolute;
          top: 24px;
          right: -35px;
          background: linear-gradient(135deg, #94a3b8, #64748b);
          color: white;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 6px 40px;
          transform: rotate(45deg);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 10;
        }

        .waitlist-badge {
          position: absolute;
          top: 24px;
          right: -35px;
          background: linear-gradient(135deg, #0ea5e9, #0284c7);
          color: white;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          padding: 6px 40px;
          transform: rotate(45deg);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 10;
        }

        .gpu-pricing-card.coming-soon .btn.primary {
          background: #94a3b8;
          cursor: default;
          pointer-events: none;
        }

        .waitlist-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .waitlist-form input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 8px;
          font-size: 14px;
          transition: border-color 0.2s ease;
        }

        .waitlist-form input:focus {
          outline: none;
          border-color: #0ea5e9;
        }

        .waitlist-form input.error {
          border-color: #ef4444;
        }

        .waitlist-error {
          font-size: 12px;
          color: #ef4444;
          margin: 0;
        }

        .waitlist-success {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          background: #ecfdf5;
          border: 1px solid #10b981;
          border-radius: 8px;
          color: #059669;
          font-weight: 500;
          font-size: 14px;
        }

        .waitlist-success .checkmark {
          width: 20px;
          height: 20px;
        }

        @media (max-width: 768px) {
          .gpu-pricing-grid {
            grid-template-columns: 1fr;
          }

          .gpu-pricing-card {
            padding: 24px;
          }
        }
      `}</style>
    </section>
  );
}
