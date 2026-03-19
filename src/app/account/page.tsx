"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { captureUtm, getUtmData, clearUtmData } from "@/lib/utm";
import { getSessionId } from "@/lib/tracker";
import { getBrandName } from "@/lib/branding";

// MAINTENANCE MODE — set to false when hosted.ai team creation is fixed
const SIGNUP_MAINTENANCE = false;

const IS_OSS = process.env.NEXT_PUBLIC_EDITION === "oss";
const LOGO_URL = process.env.NEXT_PUBLIC_LOGO_URL || (IS_OSS ? "/logo.png" : "/packet-logo.png");

type Mode = "signin" | "signup";

const GPU_NAMES: Record<string, string> = {
  b200: "NVIDIA B200",
  h200: "NVIDIA H200",
  h100: "NVIDIA H100",
  "rtx-pro-6000": "NVIDIA RTX PRO 6000",
  rtx6000: "NVIDIA RTX PRO 6000",
};

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL params from marketing pages
  const urlEmail = searchParams.get("email") || "";
  const urlGpu = searchParams.get("gpu") || "";
  const urlPlan = searchParams.get("plan") || "";
  const hasGpuContext = !!urlGpu;
  const gpuName = GPU_NAMES[urlGpu] || (urlGpu ? urlGpu.replace(/-/g, " ").toUpperCase() : "");

  // Capture UTM if visitor lands directly on /account with utm params
  useEffect(() => { captureUtm(); }, []);

  // Default to signup — this is a conversion page, not a login page
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState(urlEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitted(false);
    setLoading(true);

    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Terms of Service and Privacy Policy");
      setLoading(false);
      return;
    }

    try {
      const endpoint = mode === "signup" ? "/api/account/signup" : "/api/account";
      const utm = mode === "signup" ? getUtmData() : null;
      const sid = mode === "signup" ? getSessionId() : null;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(mode === "signup" && {
            termsAccepted,
            gpu: urlGpu || undefined,
            plan: urlPlan || undefined,
            ...(utm ? { utm } : {}),
            ...(sid ? { sessionId: sid } : {}),
          }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      // Signup success — redirect to success page
      if (mode === "signup" && data.redirect) {
        clearUtmData();
        if (!IS_OSS) {
          import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.SIGNUP)).catch(() => {});
          if (typeof window !== "undefined" && typeof (window as any).my_analytics !== "undefined") {
            (window as any).my_analytics.goal("keo2bt1sqibntima");
          }
          if (typeof window !== "undefined" && typeof (window as any).lintrk === "function") {
            (window as any).lintrk("track", { conversion_id: 24436340 });
          }
        }
        router.push(data.redirect);
        return;
      }

      // Sign-in success — show "check your email"
      if (!IS_OSS) {
        import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.LOGIN)).catch(() => {});
      }
      setSubmitted(true);
    } catch {
      setError("Failed to process request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="account-page">
      {/* Minimal header — logo + one link, nothing more */}
      <header className="account-header">
        <div className="account-header-inner">
          <Link href="/">
            <Image
              src={LOGO_URL}
              alt={getBrandName()}
              width={120}
              height={40}
              style={{ height: "32px", width: "auto" }}
            />
          </Link>
          <div className="account-header-nav">
            {process.env.NEXT_PUBLIC_EDITION !== "oss" && (
              <Link href="/#pricing" className="account-header-link">
                Pricing
              </Link>
            )}
            {mode === "signup" && (
              <button
                onClick={() => { setMode("signin"); setError(""); setSubmitted(false); }}
                className="account-header-signin"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Two-column layout: sell left, convert right */}
      <div className="account-layout">

        {/* ─── Left panel: value proposition ─── */}
        <div className="account-left">
          <div className="account-left-glow-1" />
          <div className="account-left-glow-2" />

          <div className="account-left-content">
            <h1 className="account-headline">
              {hasGpuContext ? (
                <>Deploy {gpuName}<br />in minutes.</>
              ) : IS_OSS ? (
                <>{getBrandName()}</>
              ) : (
                <>GPU cloud.<br />No credit card required.</>
              )}
            </h1>

            <p className="account-subheadline">
              {hasGpuContext
                ? "Create your free account to browse live inventory, compare pricing, and deploy when you\u2019re ready."
                : IS_OSS
                  ? "Your GPU cloud platform. Deploy, manage, and scale."
                  : "Browse GPU inventory, run AI inference with 10K free tokens, and deploy in under 5 minutes."}
            </p>

            {/* What you get — immediate value, no payment */}
            <div className="account-benefits">
              {(IS_OSS ? [
                "Browse GPU inventory with live pricing",
                "Deploy and manage GPU pods",
                "SSH access in minutes",
              ] : [
                "Full GPU inventory with live pricing",
                "10,000 free Token Factory tokens",
                hasGpuContext ? "Fund your wallet and deploy when ready" : "SSH access in under 5 minutes",
                "No credit card required",
              ]).map((text) => (
                <div key={text} className="account-benefit">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.5">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            {/* Trust stats — real numbers, no fluff (Pro only) */}
            {!IS_OSS && (
              <div className="account-trust-bar">
                {[
                  { value: "500+", label: "GPUs" },
                  { value: "99.9%", label: "Uptime" },
                  { value: "<5 min", label: "Setup" },
                  { value: "24/7", label: "Support" },
                ].map((stat) => (
                  <div key={stat.label} className="account-trust-stat">
                    <div className="account-trust-value">{stat.value}</div>
                    <div className="account-trust-label">{stat.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right panel: the form ─── */}
        <div className="account-right">
          <div className="account-form-container">
            {!submitted ? (
              <>
                <div className="account-form-header">
                  <h2 className="account-form-title">
                    {mode === "signup" ? "Create free account" : "Welcome back"}
                  </h2>
                  <p className="account-form-subtitle">
                    {mode === "signup"
                      ? IS_OSS
                        ? "Enter your email to get started."
                        : "Get started in 30 seconds. No credit card needed."
                      : "Enter your email to receive a sign-in link."}
                  </p>
                </div>

                {SIGNUP_MAINTENANCE && mode === "signup" ? (
                  <div style={{ padding: "24px", background: "#FEF3C7", borderRadius: "12px", border: "1px solid #F59E0B", marginBottom: "16px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>
                        <p style={{ fontWeight: 600, color: "#92400E", margin: "0 0 6px", fontSize: "15px" }}>
                          Scheduled maintenance
                        </p>
                        <p style={{ color: "#78350F", margin: 0, fontSize: "14px", lineHeight: 1.5 }}>
                          New account creation is temporarily unavailable while we perform infrastructure upgrades. Please check back shortly.
                        </p>
                        <p style={{ color: "#92400E", margin: "12px 0 0", fontSize: "13px" }}>
                          Existing users can still <button onClick={() => { setMode("signin"); setError(""); }} style={{ color: "#1a4fff", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", font: "inherit", padding: 0 }}>sign in</button>.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                <form onSubmit={handleSubmit}>
                  <div className="account-field">
                    <label htmlFor="account-email" className="account-label">
                      {IS_OSS ? "Email" : "Work email"}
                    </label>
                    <input
                      type="email"
                      id="account-email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus={!urlEmail}
                      className="account-input"
                    />
                  </div>

                  {mode === "signup" && (
                    <>
                      <label className="account-terms">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="account-checkbox"
                        />
                        <span className="account-terms-text">
                          I agree to the{" "}
                          <a href="/terms" target="_blank">Terms of Service</a>
                          {" "}and{" "}
                          <a href="/privacy" target="_blank">Privacy Policy</a>
                        </span>
                      </label>
                      <p className="account-consent-note">
                        By signing up you agree to receive service updates and product announcements. We will never share your information with third parties.
                      </p>
                    </>
                  )}

                  {error && (
                    <p className="account-error">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || (mode === "signup" && !termsAccepted)}
                    className="account-submit"
                  >
                    {loading ? (
                      <span className="account-loading">
                        <span className="account-spinner" />
                        {mode === "signup" ? "Creating..." : "Sending..."}
                      </span>
                    ) : mode === "signup" ? (
                      "Create Free Account"
                    ) : (
                      "Send Sign-In Link"
                    )}
                  </button>
                </form>
                )}

                {/* Secondary mode switch — not a tab, just a text link */}
                <p className="account-mode-switch">
                  {mode === "signup" ? (
                    <>
                      Already have an account?{" "}
                      <button onClick={() => { setMode("signin"); setError(""); }}>
                        Sign in
                      </button>
                    </>
                  ) : (
                    <>
                      Don&apos;t have an account?{" "}
                      <button onClick={() => { setMode("signup"); setError(""); }}>
                        Create one free
                      </button>
                    </>
                  )}
                </p>

                {/* Security reassurance right at the point of action */}
                {mode === "signup" && (
                  <div className="account-security-note">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>256-bit SSL encrypted</span>
                  </div>
                )}
              </>
            ) : (
              /* ─── Magic link sent ─── */
              <div className="account-sent">
                <div className="account-sent-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>

                <h2 className="account-sent-title">Check your email</h2>
                <p className="account-sent-text">
                  We&apos;ve sent a sign-in link to{" "}
                  <strong>{email}</strong>
                </p>

                <div className="account-sent-note">
                  Link expires in 1 hour. Check spam if you don&apos;t see it.
                </div>

                <div className="account-sent-hint">
                  <strong>Don&apos;t have an account?</strong>{" "}
                  <button
                    onClick={() => { setSubmitted(false); setMode("signup"); setEmail(""); }}
                  >
                    Create one for free
                  </button>
                </div>

                <button
                  onClick={() => { setSubmitted(false); setEmail(""); }}
                  className="account-sent-retry"
                >
                  Use a different email
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        /* ═══ Page shell ═══ */
        .account-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* ═══ Header ═══ */
        .account-header {
          position: sticky;
          top: 0;
          z-index: 50;
          border-bottom: 1px solid var(--line);
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(12px);
        }
        .account-header-inner {
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 24px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .account-header-nav {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .account-header-link {
          font-size: 14px;
          color: var(--muted);
          text-decoration: none;
          transition: color 0.15s;
        }
        .account-header-link:hover {
          color: var(--ink);
        }
        .account-header-signin {
          font-size: 14px;
          color: var(--ink);
          font-weight: 500;
          background: none;
          border: none;
          cursor: pointer;
        }

        /* ═══ Layout ═══ */
        .account-layout {
          flex: 1;
          display: flex;
        }

        /* ═══ Left panel — dark, sells ═══ */
        .account-left {
          flex: 1 1 50%;
          background: linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0f172a 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px 48px;
          position: relative;
          overflow: hidden;
        }
        .account-left-glow-1 {
          position: absolute;
          top: -120px;
          right: -80px;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(26, 79, 255, 0.12) 0%, transparent 70%);
          border-radius: 50%;
          filter: blur(60px);
          pointer-events: none;
        }
        .account-left-glow-2 {
          position: absolute;
          bottom: -60px;
          left: -60px;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(20, 184, 166, 0.08) 0%, transparent 70%);
          border-radius: 50%;
          filter: blur(40px);
          pointer-events: none;
        }
        .account-left-content {
          position: relative;
          z-index: 1;
          max-width: 440px;
          width: 100%;
        }

        /* ═══ Left panel typography ═══ */
        .account-headline {
          font-size: clamp(1.8rem, 3vw, 2.4rem);
          font-weight: 700;
          line-height: 1.15;
          margin: 0 0 16px;
          font-family: var(--font-display);
        }
        .account-subheadline {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.6;
          margin: 0 0 32px;
        }

        /* ═══ Benefits ═══ */
        .account-benefits {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 36px;
        }
        .account-benefit {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .account-benefit svg {
          flex-shrink: 0;
        }
        .account-benefit span {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.8);
        }

        /* ═══ Trust bar ═══ */
        .account-trust-bar {
          display: flex;
          gap: 28px;
          padding-top: 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          flex-wrap: wrap;
        }
        .account-trust-value {
          font-size: 17px;
          font-weight: 700;
          color: white;
        }
        .account-trust-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* ═══ Right panel — white, converts ═══ */
        .account-right {
          flex: 1 1 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px 48px;
          background: white;
        }
        .account-form-container {
          max-width: 380px;
          width: 100%;
        }

        /* ═══ Form header ═══ */
        .account-form-header {
          margin-bottom: 28px;
        }
        .account-form-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--ink);
          margin: 0 0 6px;
        }
        .account-form-subtitle {
          font-size: 14px;
          color: var(--muted);
          margin: 0;
        }

        /* ═══ Form fields ═══ */
        .account-field {
          margin-bottom: 16px;
        }
        .account-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
          margin-bottom: 6px;
        }
        .account-input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid var(--line);
          border-radius: 10px;
          font-size: 15px;
          color: var(--ink);
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
          background: white;
        }
        .account-input:focus {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(26, 79, 255, 0.1);
        }

        /* ═══ Terms ═══ */
        .account-terms {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 16px;
          cursor: pointer;
        }
        .account-checkbox {
          margin-top: 2px;
          width: 16px;
          height: 16px;
          accent-color: var(--blue);
          flex-shrink: 0;
        }
        .account-terms-text {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.5;
        }
        .account-terms-text a {
          color: var(--blue);
          text-decoration: none;
        }
        .account-terms-text a:hover {
          text-decoration: underline;
        }
        .account-consent-note {
          font-size: 11px;
          color: var(--muted);
          margin: -8px 0 16px;
          line-height: 1.5;
          opacity: 0.7;
        }

        /* ═══ Error ═══ */
        .account-error {
          color: #ef4444;
          font-size: 13px;
          margin: 0 0 12px;
        }

        /* ═══ Submit button ═══ */
        .account-submit {
          width: 100%;
          padding: 13px;
          background: var(--blue);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          box-shadow: 0 4px 14px rgba(26, 79, 255, 0.25);
        }
        .account-submit:hover:not(:disabled) {
          opacity: 0.92;
        }
        .account-submit:active:not(:disabled) {
          transform: scale(0.99);
        }
        .account-submit:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        /* ═══ Loading state ═══ */
        .account-loading {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .account-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: account-spin 0.6s linear infinite;
          display: inline-block;
        }

        /* ═══ Mode switch ═══ */
        .account-mode-switch {
          text-align: center;
          font-size: 14px;
          color: var(--muted);
          margin: 24px 0 0;
        }
        .account-mode-switch button {
          color: var(--blue);
          background: none;
          border: none;
          cursor: pointer;
          font-weight: 500;
          font-size: 14px;
        }
        .account-mode-switch button:hover {
          text-decoration: underline;
        }

        /* ═══ Security note ═══ */
        .account-security-note {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 12px;
          color: var(--muted);
          font-size: 12px;
        }

        /* ═══ Magic link sent state ═══ */
        .account-sent {
          text-align: center;
        }
        .account-sent-icon {
          width: 56px;
          height: 56px;
          background: var(--blue);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .account-sent-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--ink);
          margin: 0 0 8px;
        }
        .account-sent-text {
          font-size: 14px;
          color: var(--muted);
          margin: 0 0 20px;
        }
        .account-sent-text strong {
          color: var(--ink);
        }
        .account-sent-note {
          padding: 12px;
          background: var(--background);
          border-radius: 8px;
          border: 1px solid var(--line);
          font-size: 13px;
          color: var(--muted);
          margin-bottom: 12px;
        }
        .account-sent-hint {
          padding: 12px;
          background: #FFFBEB;
          border-radius: 8px;
          border: 1px solid #FDE68A;
          font-size: 13px;
          color: #92400E;
          margin-bottom: 20px;
        }
        .account-sent-hint button {
          color: var(--blue);
          background: none;
          border: none;
          cursor: pointer;
          font-weight: 500;
          font-size: 13px;
        }
        .account-sent-retry {
          font-size: 14px;
          color: var(--muted);
          background: none;
          border: none;
          cursor: pointer;
        }
        .account-sent-retry:hover {
          color: var(--blue);
        }

        /* ═══ Animation ═══ */
        @keyframes account-spin {
          to { transform: rotate(360deg); }
        }

        /* ═══ Responsive ═══ */
        @media (max-width: 768px) {
          .account-layout {
            flex-direction: column;
          }
          .account-left {
            flex: none;
            padding: 32px 24px;
          }
          .account-headline {
            font-size: 1.5rem;
          }
          .account-subheadline {
            font-size: 14px;
            margin-bottom: 24px;
          }
          .account-benefits {
            gap: 10px;
            margin-bottom: 24px;
          }
          .account-benefit span {
            font-size: 14px;
          }
          .account-trust-bar {
            gap: 20px;
          }
          .account-right {
            flex: none;
            padding: 32px 24px 48px;
          }
        }
      `}</style>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="loading-spinner" style={{ width: 32, height: 32 }} />
      </div>
    }>
      <AccountContent />
    </Suspense>
  );
}
