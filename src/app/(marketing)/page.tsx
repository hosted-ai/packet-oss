"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { GPUSelector, GPUPricingCards, PriceComparison } from "./components";
import type { GpuOffering, ProofSection } from "@/app/admin/types";

// Toast notification component
function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm ${
          type === "success"
            ? "bg-white/90 border border-zinc-200 text-zinc-900"
            : "bg-white/90 border border-red-200 text-red-600"
        }`}
      >
        {type === "success" ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="text-sm">{message}</span>
        <button onClick={onClose} className="ml-2 hover:opacity-70">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // GPU offerings data
  const [offerings, setOfferings] = useState<GpuOffering[]>([]);
  const [proofSection, setProofSection] = useState<ProofSection | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [barsAnimated, setBarsAnimated] = useState(false);

  // Load GPU offerings data
  useEffect(() => {
    async function loadOfferings() {
      try {
        const res = await fetch("/api/gpu-offerings?active=true");
        const data = await res.json();
        if (data.success) {
          setOfferings(data.data.offerings || []);
          setProofSection(data.data.proofSection || null);
        }
      } catch (error) {
        console.error("Failed to load GPU offerings:", error);
      } finally {
        setDataLoaded(true);
      }
    }
    loadOfferings();
  }, []);

  // Handle hash navigation (e.g., /#pricing from another page)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);
    }
  }, []);

  // Scroll-triggered entrance animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -30px 0px" }
    );

    requestAnimationFrame(() => {
      document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    });

    return () => observer.disconnect();
  }, [dataLoaded]);

  // "How It Works" bar animation on scroll
  const barsRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setBarsAnimated(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(node);
  }, []);

  // Get the first active GPU for fallback displays
  const activeOfferings = offerings.filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* ─── 1. HERO — Headline + GPU selector + CTA ─── */}
      {offerings.length > 0 ? (
        <GPUSelector offerings={offerings} />
      ) : (
        <section className="hero">
          <div className="container hero-split">
            <div className="hero-left">
              <h1 className="display hero-headline">
                NVIDIA Blackwell GPUs.{" "}
                <span className="hero-headline-accent">Deployed in Minutes.</span>
              </h1>
              <p className="hero-sub">96 GB GDDR7. Full root SSH. No contracts.</p>
              <div className="hero-cta-group">
                <div className="hero-cta-row">
                  <a href="/account" className="btn primary hero-btn">
                    Start Building
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </a>
                </div>
                <span className="hero-note">Typically 50%+ below market &middot; No contracts &middot; Pay per second</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── 2. SOCIAL PROOF BAR — trust signals right after hero ─── */}
      <section className="social-proof-bar reveal">
        <div className="container">
          <div className="proof-stats-row">
            <div className="proof-stat-item">
              <span className="proof-stat-number display">{proofSection?.stats?.[0]?.value || "500+"}</span>
              <span className="proof-stat-label">{proofSection?.stats?.[0]?.note || "GPUs across clusters"}</span>
            </div>
            <div className="proof-stat-divider"></div>
            <div className="proof-stat-item">
              <span className="proof-stat-number display">{proofSection?.stats?.[1]?.value || "<5 min"}</span>
              <span className="proof-stat-label">{proofSection?.stats?.[1]?.note || "From signup to SSH"}</span>
            </div>
            <div className="proof-stat-divider"></div>
            <div className="proof-stat-item">
              <span className="proof-stat-number display">{proofSection?.stats?.[2]?.value || "99.9%"}</span>
              <span className="proof-stat-label">{proofSection?.stats?.[2]?.note || "Uptime SLA"}</span>
            </div>
            <div className="proof-stat-divider"></div>
            <div className="proof-stat-item">
              <span className="proof-stat-number display">{proofSection?.stats?.[3]?.value || "24/7"}</span>
              <span className="proof-stat-label">{proofSection?.stats?.[3]?.note || "Human support"}</span>
            </div>
          </div>
          <div className="trust-badges">
            <span className="trust-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Real 99.9% SLA
            </span>
            <span className="trust-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              On-demand, not spot
            </span>
            <span className="trust-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Pay as you go
            </span>
          </div>
        </div>
      </section>

      {/* ─── 3. PRICE COMPARISON — strongest conversion tool, moved up ─── */}
      <PriceComparison />

      {/* ─── 4. HOW IT WORKS — value explanation (objection handling) ─── */}
      <section id="how-it-works" className="reveal">
        <div className="container why-grid">
          <div className="why-copy">
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "16px" }}>
              How we do it
            </h2>
            <p>Traditional GPU clouds assume one customer per card, even though most workloads only use a fraction of it at any moment. The rest sits idle&mdash;and you still pay for it.</p>
            <ul className="list">
              <li>Your job gets full GPU resources when it needs them.</li>
              <li>Capacity is continuously balanced to stay productive.</li>
              <li>When your job pauses or scales, you stop paying.</li>
              <li>Higher utilisation keeps operating costs low — savings we pass to you.</li>
            </ul>
            <Link href="/technology" style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "16px", fontSize: "14px", fontWeight: 500, color: "var(--blue)" }}>
              Read more about our technology
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>
          <div className="why-visual" ref={barsRef}>
            <div className="cost-bars">
              <div className="bar">
                <div className="bar-label">Typical cloud</div>
                <div className="bar-track">
                  <div className={`bar-fill full${barsAnimated ? " animate" : ""}`}></div>
                </div>
                <div className="bar-note">Paying for 100% of the time</div>
              </div>
              <div className="bar">
                <div className="bar-label">the platform</div>
                <div className="bar-track">
                  <div className={`bar-fill trimmed${barsAnimated ? " animate" : ""}`}></div>
                </div>
                <div className="bar-note">Paying only for execution</div>
              </div>
            </div>
            <div className="savings-callout">Save up to 38% on the same workload</div>
            <div className="why-punch display">Same performance. Less waste. Lower bill.</div>
          </div>
        </div>
      </section>

      {/* ─── 5. PRICING CARDS ─── */}
      <div className="reveal">
        {offerings.length > 0 ? (
          <GPUPricingCards
            offerings={offerings}
            onGetStarted={() => {}}
            cardLoading={false}
          />
        ) : (
          <section id="pricing">
            <div className="container">
              <div className="section-title">
                <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
                  Simple, transparent pricing
                </h2>
                <p>On-demand, not spot. No hidden fees, no interruptions.</p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ─── 6. ACCESS METHODS — clearer heading ─── */}
      <section id="access" className="reveal">
        <div className="container">
          <div className="section-title">
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Deploy your way
            </h2>
            <p>SSH, web UI, CLI, or API. Instant setup, any method.</p>
          </div>
          <div className="access-grid">
            <div className="access-card">
              <div className="access-icon icon-ssh">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              </div>
              <h3 className="display">Full root SSH</h3>
              <p>Spin up a node and get a shell in under 5 minutes. Native performance, full control.</p>
            </div>
            <div className="access-card">
              <div className="access-icon icon-ui">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </div>
              <h3 className="display">Web dashboard</h3>
              <p>Launch and manage GPUs from the browser. Monitor usage, costs, and performance in real time.</p>
            </div>
            <Link href="/docs/api-reference" className="access-card" style={{ textDecoration: "none", color: "inherit", border: "2px solid var(--blue)" }}>
              <div className="access-icon icon-api">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 18l2-2-2-2"/><path d="M8 6L6 8l2 2"/><path d="M14.5 4l-5 16"/></svg>
              </div>
              <h3 className="display">REST API</h3>
              <p>Full API access. Launch, manage, and monitor GPUs programmatically.</p>
            </Link>
            <div className="access-card">
              <div className="access-icon icon-setup">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </div>
              <h3 className="display">Instant setup</h3>
              <p>Minutes, not days. No procurement cycle, no contracts, no waiting in queues.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 7. FAQ — objection handling ─── */}
      <section id="faq" className="reveal">
        <div className="container">
          <div className="section-title">
            <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px" }}>
              Common questions
            </h2>
            <p>Short answers, no fine print.</p>
          </div>
          <div className="faq-grid">
            <div className="card">
              <h3 className="display">How do you keep prices so low?</h3>
              <p>We use smart scheduling to keep GPUs productive across customers. You get full hardware performance — the savings come from eliminating idle waste, not from reducing capability.</p>
            </div>
            <div className="card">
              <h3 className="display">Does this affect performance?</h3>
              <p>No. Your workload runs on real NVIDIA silicon with full compute capability and memory bandwidth. We publish a real 99.9% SLA — rare in this space.</p>
            </div>
            <div className="card">
              <h3 className="display">What GPUs are available?</h3>
              <p>
                {activeOfferings.length > 0
                  ? `We offer ${activeOfferings.map((o) => o.fullName).join(", ")}. All with full performance and latest generation silicon.`
                  : "NVIDIA B200, H200, and RTX PRO 6000 Blackwell (96GB) GPUs. Latest generation silicon, full performance."}
              </p>
            </div>
            <div className="card">
              <h3 className="display">Is it really on-demand?</h3>
              <p>Yes. On-demand GPUs, not spot instances. No preemption, no interruptions. Cancel anytime — no commitments.</p>
            </div>
            <div className="card">
              <h3 className="display">Is my data secure?</h3>
              <p>Each workload runs in isolated containers with dedicated GPU memory. Your data is never shared with other tenants, and all connections are encrypted.</p>
            </div>
            <div className="card">
              <h3 className="display">How fast is setup?</h3>
              <p>Under 5 minutes from signup to SSH. No contracts, no waiting lists, no credit card required to start.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 8. ABOUT — moved after FAQ, before final CTA ─── */}
      <section id="about" className="section-dark reveal">
        <div className="container">
          <div className="about-grid">
            <div className="about-content">
              <div className="label">About us</div>
              <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", margin: "12px 0 16px" }}>
                Same silicon. Smarter economics.
              </h2>
              <p className="about-intro">
                We built the platform because we saw an opportunity: deliver top-tier GPU performance at a fraction of the typical cost by eliminating inefficiency, not by compromising capability.
              </p>
              <p className="muted">
                Backed by 40+ engineers. Well-funded. Infrastructure roots going back to 1996.
              </p>
            </div>
            <div className="about-team">
              <div className="label">The team</div>
              <p className="muted" style={{ marginBottom: "20px" }}>
                Built by infrastructure veterans with decades of experience in cloud computing and GPU infrastructure.
              </p>
              <div className="team-grid">
                <div className="team-member">
                  <div className="team-name">Your Team</div>
                  <div className="team-role">Customize in about page</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 9. FINAL CTA — consistent copy ─── */}
      <section className="final-cta-wrapper reveal">
        <div className="cta-section">
          <h2 className="display" style={{ fontSize: "clamp(1.8rem, 3vw, 2.4rem)", marginBottom: "12px", position: "relative" }}>
            Your GPU is waiting.
          </h2>
          <p className="cta-sub" style={{ position: "relative" }}>
            Sign up in seconds. Deploy in under 5 minutes. Pay only for what you use.
          </p>
          <div className="cta-row" style={{ justifyContent: "center", position: "relative" }}>
            <Link href="/account" className="btn primary" style={{ padding: "14px 32px", fontSize: "15px" }}>
              Start Building
            </Link>
          </div>
          <p className="cta-contact" style={{ position: "relative" }}>
            Need help choosing? <Link href="/contact">Talk to our team</Link> — we respond in minutes, not days.
          </p>
        </div>
      </section>

      <style jsx global>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }

      `}</style>
    </>
  );
}
