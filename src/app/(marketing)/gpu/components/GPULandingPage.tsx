"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// GPU data type
export interface GPUData {
  id: string;
  name: string;
  fullName: string;
  tagline: string;
  architecture: string;
  memory: string;
  memoryType: string;
  hourlyPrice: number;
  monthlyPrice: number;
  location: string;
  image: string;
  specs: {
    label: string;
    value: string;
  }[];
  useCases: {
    title: string;
    description: string;
    icon: string;
  }[];
  features: string[];
  comparisons: {
    provider: string;
    price: number;
    note?: string;
  }[];
  faqs: {
    q: string;
    a: string;
  }[];
  ctaText: string;
  urgencyText?: string;
  socialProof: string;
  soldOut?: boolean;
  /** Short benefit bullets for the hero, e.g. ["96GB GDDR7 ECC", "Full root SSH", "Deploy in minutes"] */
  heroBullets?: string[];
  /** Lines to display in the terminal-style card on the right */
  terminalLines?: { prompt?: string; cmd: string; dim?: boolean }[];
  /** Which billing plan this landing page promotes. Defaults to "hourly". */
  billingPlan?: "hourly" | "monthly";
}

// Animated counter hook
function useAnimatedCounter(target: number, duration: number = 1500) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const steps = 60;
    const increment = target / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [target, duration]);

  return count;
}

// FAQ Item component
function FAQItem({ q, a, isOpen, onClick }: { q: string; a: string; isOpen: boolean; onClick: () => void }) {
  return (
    <div style={{
      borderBottom: "1px solid var(--line)",
      padding: "20px 0"
    }}>
      <button
        onClick={onClick}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: 0
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "16px" }}>{q}</span>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s"
          }}
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div style={{
        maxHeight: isOpen ? "500px" : "0",
        overflow: "hidden",
        transition: "max-height 0.3s ease-out"
      }}>
        <p style={{ color: "var(--muted)", marginTop: "12px", lineHeight: 1.6 }}>{a}</p>
      </div>
    </div>
  );
}

export default function GPULandingPage({ gpu }: { gpu: GPUData }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const savingsPercent = useAnimatedCounter(
    Math.round((1 - gpu.hourlyPrice / gpu.comparisons[0].price) * 100)
  );

  const plan = gpu.billingPlan || "hourly";
  const isMonthly = plan === "monthly";

  // H200 is "coming soon", sold-out GPUs still go to account signup
  const isComingSoon = gpu.id === "h200";
  const isSoldOut = !!gpu.soldOut;
  const ctaUrl = isComingSoon
    ? `/gpu/waitlist?gpu=${gpu.id}`
    : `/account?gpu=${gpu.id}&plan=${plan}`;

  // Default terminal lines if not provided
  const terminalLines = gpu.terminalLines || [
    { prompt: "$", cmd: `ssh root@${gpu.id}.the platform` },
    { cmd: "nvidia-smi", dim: true },
    { cmd: `${gpu.fullName} | ${gpu.memory} ${gpu.memoryType}`, dim: true },
    { cmd: `CUDA Version: 12.8  |  Driver: 570.86`, dim: true },
    { prompt: "$", cmd: "vllm serve meta-llama/Llama-3.1-70B" },
    { cmd: "INFO:     Started server on 0.0.0.0:8000", dim: true },
  ];

  return (
    <>
      {/* Sticky CTA Bar - Mobile */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "12px 16px",
        background: "rgba(0,0,0,0.95)",
        backdropFilter: "blur(10px)",
        borderTop: "1px solid rgba(255,255,255,0.1)",
        zIndex: 100,
        display: "none"
      }} className="mobile-sticky-cta">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: "18px" }}>{isMonthly ? `$${gpu.monthlyPrice}/mo` : `$${gpu.hourlyPrice}/hr`}</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "12px" }}>{gpu.name}</div>
          </div>
          <Link
            href={isComingSoon ? `/gpu/waitlist?gpu=${gpu.id}` : `/account?gpu=${gpu.id}&plan=monthly`}
            style={{
              background: "linear-gradient(135deg, #14b8a6, #0d9488)",
              color: "white",
              padding: "12px 24px",
              borderRadius: "8px",
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap"
            }}
          >
            {gpu.ctaText}
          </Link>
        </div>
      </div>

      {/* Hero Section — clean, conversion-focused */}
      <section className="gpu-hero-section" style={{
        padding: "64px 0 56px",
        background: "linear-gradient(180deg, #0a0a0a 0%, #111827 100%)",
        color: "white",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Subtle background glow */}
        <div style={{
          position: "absolute",
          top: "-200px",
          right: "-200px",
          width: "600px",
          height: "600px",
          background: "radial-gradient(circle, rgba(20, 184, 166, 0.12) 0%, transparent 70%)",
          borderRadius: "50%",
          filter: "blur(60px)",
          pointerEvents: "none"
        }} />

        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "48px",
            alignItems: "center",
            maxWidth: "1200px",
            margin: "0 auto"
          }} className="hero-grid">

            {/* Left: Clear value proposition */}
            <div className="gpu-hero-left">
              {/* Single status badge */}
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: isSoldOut ? "rgba(239, 68, 68, 0.1)" : "rgba(20, 184, 166, 0.1)",
                border: `1px solid ${isSoldOut ? "rgba(239, 68, 68, 0.3)" : "rgba(20, 184, 166, 0.3)"}`,
                borderRadius: "100px",
                padding: "6px 16px",
                marginBottom: "20px",
                fontSize: "13px",
                color: isSoldOut ? "#ef4444" : "#14b8a6"
              }}>
                <span style={{ width: "7px", height: "7px", background: isSoldOut ? "#ef4444" : "#14b8a6", borderRadius: "50%", animation: "pulse 2s infinite" }} />
                {isSoldOut ? `Sold out in ${gpu.location} — Join waitlist for availability` : `Available now in ${gpu.location}${gpu.urgencyText ? ` — ${gpu.urgencyText.toLowerCase()}` : ""}`}
              </div>

              <h1 style={{
                fontSize: "clamp(2.2rem, 4.5vw, 3.2rem)",
                fontWeight: 700,
                lineHeight: 1.08,
                marginBottom: "16px",
                fontFamily: "var(--font-display)"
              }}>
                {gpu.fullName}
              </h1>

              {/* Benefit bullets — scannable */}
              <div className="gpu-hero-bullets" style={{
                display: "flex",
                gap: "16px",
                flexWrap: "wrap",
                marginBottom: "28px",
                fontSize: "15px",
                color: "rgba(255,255,255,0.6)"
              }}>
                {(gpu.heroBullets || [`${gpu.memory} ${gpu.memoryType}`, "Full root SSH", "Deploy in minutes"]).map((bullet, i, arr) => (
                  <span key={bullet} style={{ display: "inline-flex", alignItems: "center", gap: "16px" }}>
                    {bullet}
                    {i < arr.length - 1 && <span style={{ color: "rgba(255,255,255,0.2)" }}>/</span>}
                  </span>
                ))}
              </div>

              {/* Price — lead with the plan's primary price */}
              <div style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "6px" }}>
                  <span className="gpu-price-value" style={{ fontSize: "44px", fontWeight: 700, letterSpacing: "-0.02em" }}>
                    {isMonthly ? `$${gpu.monthlyPrice}` : `$${gpu.hourlyPrice.toFixed(2)}`}
                  </span>
                  <span className="gpu-price-unit" style={{ color: "rgba(255,255,255,0.5)", fontSize: "18px" }}>
                    {isMonthly ? "/month" : "/hour"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "14px" }}>
                    {isMonthly ? `$${gpu.hourlyPrice.toFixed(2)}/hr effective` : `$${gpu.monthlyPrice.toFixed(0)}/mo if running 24/7`}
                  </span>
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
                  <span style={{
                    color: "#14b8a6",
                    fontSize: "14px",
                    fontWeight: 500
                  }}>
                    {savingsPercent}% less than {gpu.comparisons[0].provider}
                  </span>
                </div>
              </div>

              {/* Primary CTA — no email gate */}
              <div style={{ marginBottom: "20px" }}>
                <Link
                  href={ctaUrl}
                  className="gpu-hero-cta"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "linear-gradient(135deg, #14b8a6, #0d9488)",
                    color: "white",
                    padding: "14px 36px",
                    borderRadius: "10px",
                    fontSize: "16px",
                    fontWeight: 600,
                    textDecoration: "none",
                    transition: "transform 0.15s, box-shadow 0.15s",
                    boxShadow: "0 4px 24px rgba(20, 184, 166, 0.3)"
                  }}
                >
                  {isComingSoon ? "Join Waitlist" : gpu.ctaText}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>

              {/* Inline trust signals */}
              <div style={{
                display: "flex",
                gap: "20px",
                flexWrap: "wrap",
                fontSize: "13px",
                color: "rgba(255,255,255,0.4)"
              }}>
                {["No contracts", "Cancel anytime", "24/7 support"].map((signal) => (
                  <span key={signal} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {signal}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: Terminal-style card — developer-native */}
            <div style={{ position: "relative" }}>
              <div className="gpu-terminal-card" style={{
                background: "#0d1117",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.1)",
                overflow: "hidden",
                boxShadow: "0 24px 48px rgba(0,0,0,0.4)"
              }}>
                {/* Terminal title bar */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 16px",
                  background: "rgba(255,255,255,0.03)",
                  borderBottom: "1px solid rgba(255,255,255,0.06)"
                }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ff5f57" }} />
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#febc2e" }} />
                    <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#28c840" }} />
                  </div>
                  <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginLeft: "8px", fontFamily: "monospace" }}>
                    {gpu.id}.the platform
                  </span>
                </div>

                {/* Terminal content */}
                <div style={{
                  padding: "20px",
                  fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  color: "#e6edf3",
                  minHeight: "220px"
                }}>
                  {terminalLines.map((line, i) => (
                    <div key={i} style={{ color: line.dim ? "rgba(255,255,255,0.35)" : "#e6edf3" }}>
                      {line.prompt && (
                        <span style={{ color: "#14b8a6", marginRight: "8px" }}>{line.prompt}</span>
                      )}
                      {line.cmd}
                    </div>
                  ))}
                  <div style={{ marginTop: "4px" }}>
                    <span style={{ color: "#14b8a6", marginRight: "8px" }}>$</span>
                    <span style={{
                      display: "inline-block",
                      width: "8px",
                      height: "16px",
                      background: "#14b8a6",
                      animation: "pulse 1s infinite",
                      verticalAlign: "text-bottom",
                      borderRadius: "1px"
                    }} />
                  </div>
                </div>

                {/* Spec bar at bottom */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)"
                }}>
                  {gpu.specs.slice(0, 3).map((spec, i) => (
                    <div key={spec.label} style={{
                      padding: "12px 16px",
                      borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      textAlign: "center"
                    }}>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{spec.label}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "white" }}>{spec.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Price Comparison Section */}
      <section style={{ padding: "80px 0", background: "white" }}>
        <div className="container">
          <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
            <h2 className="gpu-section-title" style={{ fontSize: "32px", fontWeight: 700, marginBottom: "16px" }}>
              Compare {gpu.name} Pricing
            </h2>
            <p className="gpu-section-subtitle" style={{ color: "var(--muted)", marginBottom: "48px", fontSize: "18px" }}>
              See how much you save with GPU Cloud vs other cloud providers
            </p>

            <div style={{
              background: "var(--background)",
              borderRadius: "16px",
              overflow: "hidden",
              border: "1px solid var(--line)"
            }}>
              {gpu.comparisons.map((comp, i) => (
                <div
                  key={comp.provider}
                  className="gpu-comparison-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "20px 24px",
                    borderBottom: i < gpu.comparisons.length - 1 ? "1px solid var(--line)" : "none",
                    background: comp.provider === "GPU Cloud" ? "rgba(20, 184, 166, 0.05)" : "transparent"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {comp.provider === "GPU Cloud" && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <span style={{ fontWeight: comp.provider === "GPU Cloud" ? 700 : 400 }}>
                      {comp.provider}
                    </span>
                    {comp.note && (
                      <span style={{ color: "var(--muted)", fontSize: "14px" }}>({comp.note})</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span className="gpu-comp-price" style={{
                      fontSize: "20px",
                      fontWeight: 700,
                      color: comp.provider === "GPU Cloud" ? "#14b8a6" : "inherit"
                    }}>
                      ${comp.price.toFixed(2)}/hr
                    </span>
                    {comp.provider !== "GPU Cloud" && (
                      <span className="gpu-comp-badge" style={{
                        background: "#fee2e2",
                        color: "#dc2626",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600
                      }}>
                        {Math.round((comp.price / gpu.hourlyPrice - 1) * 100)}% more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Monthly savings calculator */}
            <div className="gpu-savings-box" style={{
              marginTop: "32px",
              padding: "24px",
              background: "linear-gradient(135deg, #0f172a, #1e293b)",
              borderRadius: "12px",
              color: "white"
            }}>
              <p style={{ marginBottom: "8px", opacity: 0.7 }}>Running 24/7 for a month?</p>
              <p className="gpu-savings-amount" style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
                Save ${((gpu.comparisons[0].price - gpu.hourlyPrice) * 730).toFixed(0)}/month
              </p>
              <p style={{ opacity: 0.5, fontSize: "14px" }}>
                vs {gpu.comparisons[0].provider} ({gpu.comparisons[0].price.toFixed(2)} × 730 hours)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section style={{ padding: "80px 0", background: "var(--background)" }}>
        <div className="container">
          <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <h2 className="gpu-section-title" style={{ fontSize: "32px", fontWeight: 700, marginBottom: "16px", textAlign: "center" }}>
              Built for {gpu.name} Workloads
            </h2>
            <p className="gpu-section-subtitle" style={{ color: "var(--muted)", marginBottom: "48px", textAlign: "center", fontSize: "18px" }}>
              Optimized for the most demanding AI and compute tasks
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "24px"
            }} className="use-cases-grid">
              {gpu.useCases.slice(0, 4).map((useCase) => (
                <div
                  key={useCase.title}
                  style={{
                    background: "white",
                    borderRadius: "12px",
                    padding: "24px",
                    border: "1px solid var(--line)"
                  }}
                >
                  <div style={{
                    width: "48px",
                    height: "48px",
                    background: "rgba(20, 184, 166, 0.1)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "16px"
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2">
                      <path d={useCase.icon} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>{useCase.title}</h3>
                  <p style={{ color: "var(--muted)", fontSize: "14px", lineHeight: 1.6 }}>{useCase.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Full Specs Section */}
      <section style={{ padding: "80px 0", background: "white" }}>
        <div className="container">
          <div style={{ maxWidth: "900px", margin: "0 auto" }}>
            <h2 className="gpu-section-title" style={{ fontSize: "32px", fontWeight: 700, marginBottom: "48px", textAlign: "center" }}>
              {gpu.name} Specifications
            </h2>

            <div className="gpu-specs-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "24px"
            }}>
              {gpu.specs.map((spec) => (
                <div
                  key={spec.label}
                  style={{
                    padding: "20px",
                    background: "var(--background)",
                    borderRadius: "8px",
                    border: "1px solid var(--line)"
                  }}
                >
                  <div style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "4px" }}>{spec.label}</div>
                  <div style={{ fontWeight: 600, fontSize: "18px" }}>{spec.value}</div>
                </div>
              ))}
            </div>

            {/* Features list */}
            <div style={{ marginTop: "48px" }}>
              <h3 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "24px" }}>Included with every {gpu.name}</h3>
              <div className="gpu-features-grid" style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: "12px"
              }}>
                {gpu.features.map((feature) => (
                  <div key={feature} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section style={{ padding: "80px 0", background: "var(--background)" }}>
        <div className="container">
          <div style={{ maxWidth: "700px", margin: "0 auto" }}>
            <h2 className="gpu-section-title" style={{ fontSize: "32px", fontWeight: 700, marginBottom: "48px", textAlign: "center" }}>
              Frequently Asked Questions
            </h2>

            <div>
              {gpu.faqs.map((faq, i) => (
                <FAQItem
                  key={i}
                  q={faq.q}
                  a={faq.a}
                  isOpen={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="gpu-final-cta" style={{
        padding: "80px 0",
        background: "linear-gradient(135deg, #0f172a, #1e293b)",
        color: "white",
        textAlign: "center"
      }}>
        <div className="container">
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <h2 style={{ fontSize: "36px", fontWeight: 700, marginBottom: "16px" }}>
              {`Ready to Deploy Your ${gpu.name}?`}
            </h2>
            <p style={{ fontSize: "18px", opacity: 0.7, marginBottom: "28px" }}>
              {"From signup to SSH in under 5 minutes. No contracts, cancel anytime."}
            </p>

            <div style={{ marginBottom: "24px" }}>
              <span className="gpu-final-price" style={{ fontSize: "56px", fontWeight: 700 }}>
                {isMonthly ? `$${gpu.monthlyPrice}` : `$${gpu.hourlyPrice.toFixed(2)}`}
              </span>
              <span style={{ fontSize: "20px", opacity: 0.7 }}>{isMonthly ? "/month" : "/hour"}</span>
            </div>

            <Link
              href={ctaUrl}
              className="gpu-final-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "linear-gradient(135deg, #14b8a6, #0d9488)",
                color: "white",
                padding: "16px 48px",
                borderRadius: "8px",
                fontSize: "18px",
                fontWeight: 600,
                textDecoration: "none",
                boxShadow: "0 4px 20px rgba(20, 184, 166, 0.4)"
              }}
            >
              {isComingSoon ? "Join Waitlist" : gpu.ctaText}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <p style={{ marginTop: "16px", fontSize: "14px", opacity: 0.5 }}>
              {"Free to sign up · No credit card required"}
            </p>
          </div>
        </div>
      </section>

      {/* Bottom spacer for mobile sticky CTA bar */}
      <div className="gpu-mobile-spacer" style={{ display: "none" }} />

      {/* Mobile styles */}
      <style jsx global>{`
        @media (max-width: 768px) {
          .mobile-sticky-cta {
            display: block !important;
          }
          .hero-grid {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
          }
          .use-cases-grid {
            grid-template-columns: 1fr !important;
          }
          .gpu-hero-section {
            padding: 40px 0 32px !important;
          }
          .gpu-hero-left h1 {
            font-size: 1.8rem !important;
          }
          .gpu-hero-bullets {
            font-size: 13px !important;
            gap: 10px !important;
          }
          .gpu-price-value {
            font-size: 36px !important;
          }
          .gpu-price-unit {
            font-size: 15px !important;
          }
          .gpu-hero-cta {
            width: 100% !important;
            justify-content: center !important;
          }
          .gpu-terminal-card {
            font-size: 11px !important;
          }
          .gpu-terminal-card > div:last-child {
            grid-template-columns: 1fr !important;
          }
          .gpu-comparison-row {
            padding: 14px 16px !important;
          }
          .gpu-comparison-row .gpu-comp-price {
            font-size: 16px !important;
          }
          .gpu-comparison-row .gpu-comp-badge {
            display: none !important;
          }
          .gpu-savings-box {
            padding: 20px !important;
          }
          .gpu-savings-box .gpu-savings-amount {
            font-size: 20px !important;
          }
          .gpu-specs-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .gpu-features-grid {
            grid-template-columns: 1fr !important;
          }
          .gpu-final-cta {
            padding: 60px 0 80px !important;
          }
          .gpu-final-cta h2 {
            font-size: 24px !important;
          }
          .gpu-final-cta .gpu-final-price {
            font-size: 40px !important;
          }
          .gpu-final-cta .gpu-final-link {
            padding: 14px 32px !important;
            font-size: 16px !important;
          }
          .gpu-section-title {
            font-size: 24px !important;
          }
          .gpu-section-subtitle {
            font-size: 15px !important;
          }
          .gpu-mobile-spacer {
            display: block !important;
            height: 72px;
          }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}
