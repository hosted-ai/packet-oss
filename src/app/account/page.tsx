"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Space_Grotesk } from "next/font/google";
import Image from "next/image";
import { BrandLogo } from "@/components/BrandLogo";
import { captureUtm, getUtmData, clearUtmData } from "@/lib/utm";
import { getSessionId } from "@/lib/tracker";
import { getBrandName, getAppUrl } from "@/lib/branding-client";
import { trackEvent } from "@/lib/analytics/track-event";
import dynamic from "next/dynamic";

// Single typeface for the whole page — headline, body, italic accent, and
// the trust/proof microcopy all use Space Grotesk. Declared HERE, not in the
// root layout — next/font preloads its woff2 on every page that mounts the
// declaring module, and only /account uses it.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// MAINTENANCE MODE — set to false when hosted.ai team creation is fixed
const SIGNUP_MAINTENANCE = false;

const IS_OSS = process.env.NEXT_PUBLIC_EDITION === "oss";

// "AI teams that ship" logo cloud (Pro only). The component file and its
// trademark logo assets are OSS-export-excluded — edition-gated dynamic
// import so the OSS bundle never references them.
const AccountLogoCloud = !IS_OSS
  ? dynamic(() =>
      import("./AccountLogoCloud").then((m) => ({ default: m.AccountLogoCloud }))
    )
  : () => null;

type Mode = "signin" | "signup";

// Bottom proof marquee content — rendered twice back-to-back in the JSX so
// the CSS animation can loop seamlessly via translateX(-50%).
const MARQUEE_STATS = [
  {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>,
    text: "50%+ below AWS, GCP, and Azure equivalents",
  },
  {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
    text: "Developers in 50+ countries",
  },
  {
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    text: "4 min avg. signup → SSH",
  },
];

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
  // PA-175: when arriving from /invite/<token>, the invitation token rides
  // along here so we can carry it through signup/signin → /dashboard. The
  // dashboard surfaces an Accept modal when ?invite= is present.
  const urlInviteToken = searchParams.get("invite") || "";
  const urlNext = searchParams.get("next") || "";
  const hasGpuContext = !!urlGpu;
  const gpuName = GPU_NAMES[urlGpu] || (urlGpu ? urlGpu.replace(/-/g, " ").toUpperCase() : "");

  // PA-266: where to land after login. An explicit ?next= wins; otherwise derive
  // it from the GPU deep-link params so a "Deploy <GPU>" CTA survives the login
  // round-trip. The server re-sanitizes this before signing it into the token.
  const nextDest =
    urlNext ||
    (urlGpu
      ? `/dashboard?gpu=${encodeURIComponent(urlGpu)}${urlPlan ? `&plan=${encodeURIComponent(urlPlan)}` : ""}`
      : "");

  // Capture UTM if visitor lands directly on /account with utm params
  useEffect(() => { captureUtm(); }, []);

  // Session-expired bounce: SessionGuard sends users here with ?reason=session_expired
  // when an authenticated dashboard fetch returns 401. Flip to signin and show a banner.
  const sessionExpired = searchParams.get("reason") === "session_expired";

  // PA-266/267: logged-in fast path for deep-link CTAs. If the visitor already
  // has a live session cookie and the URL carries deploy intent, skip the signup
  // form and send them straight to the in-product stepper. Logged-out visitors
  // (no cookie → /session 401s) stay on the form; bare /account is untouched.
  useEffect(() => {
    if (!nextDest || sessionExpired) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/account/session", { method: "POST" });
        if (!cancelled && r.ok) router.replace(nextDest);
      } catch {
        /* not logged in / offline — stay on the form */
      }
    })();
    return () => { cancelled = true; };
  }, [nextDest, sessionExpired, router]);

  // Default to signup — this is a conversion page, not a login page.
  // If the user is returning after their session expired, start in signin mode.
  const [mode, setMode] = useState<Mode>(sessionExpired ? "signin" : "signup");
  const [email, setEmail] = useState(urlEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Prevent FOUC: styled-jsx styles aren't applied until hydration completes,
  // so the raw HTML flashes unstyled for a frame. Hide the page until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitted(false);
    setLoading(true);

    // GA4: track sign_up_start when user submits the signup form
    if (mode === "signup") {
      trackEvent("sign_up_start");
    }

    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Legal Policies and Privacy Policies");
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
          ...(urlInviteToken ? { inviteToken: urlInviteToken } : {}),
          ...(nextDest ? { next: nextDest } : {}),
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
          if (typeof window !== "undefined" && typeof window.my_analytics !== "undefined") {
            window.my_analytics.goal("keo2bt1sqibntima");
          }
          if (typeof window !== "undefined" && typeof window.lintrk === "function") {
            window.lintrk("track", { conversion_id: 24436340 });
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
    <div
      className={`account-page ${spaceGrotesk.variable}`}
      style={{ opacity: mounted ? 1 : 0, transition: "opacity 0.15s ease-in" }}
    >
      {/* Minimal header — logo + one link, nothing more */}
      <header className="account-header">
        <div className="account-header-inner">
          <a href={getAppUrl()} suppressHydrationWarning>
            {/* Pre-styled white wordmark for this page's dark header —
                intentionally NOT the tenant-branded LOGO_URL, since white-label
                tenants' logos aren't guaranteed to work knocked-out on black. */}
            <BrandLogo
              src="/images/packet-logo-white.png"
              alt={getBrandName()}
              width={120}
              height={40}
              style={{ height: "32px", width: "auto" }}
            />
          </a>
          <div className="account-header-nav">
            {process.env.NEXT_PUBLIC_EDITION !== "oss" && (
              <a href={`${getAppUrl()}/pricing`} className="account-header-link">
                Pricing
              </a>
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

        {/* ─── Left panel: sell + convert ─── */}
        <div className="account-left">
          <div className="account-left-inner">
            <h1 className="account-headline">
              {hasGpuContext ? (
                <>Deploy {gpuName}<br />in minutes.</>
              ) : IS_OSS ? (
                <>{getBrandName()}</>
              ) : (
                <>The GPU cloud that<br /><span className="account-headline-em">eliminates</span> idle charges.</>
              )}
            </h1>

            {/* PA-393 trust proof — one line directly under the headline so the
                skeptical visitor reads it before the form asks for anything.
                The rest of the proof points live in the bottom strip below. */}
            {!IS_OSS && (
              <div className="account-trust-line">
                <span className="account-trust-icon">
                  {/* Verified-style checkmark badge, replacing the globe */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span>Trusted by AI/ML teams and developers across 50+ countries</span>
              </div>
            )}

          <div className="account-form-container">
            {!submitted ? (
              <>
                {sessionExpired && (
                  <div
                    style={{
                      padding: "12px 16px",
                      marginBottom: "16px",
                      background: "#FEF3C7",
                      border: "1px solid #F59E0B",
                      borderRadius: "8px",
                      color: "#78350F",
                      fontSize: "14px",
                      textAlign: "center",
                    }}
                  >
                    Your session expired. Please sign in again.
                  </div>
                )}
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
                      Email
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

                  {/* Terms + consent note stay hidden until the visitor starts
                      typing an email — they're real estate that isn't useful
                      before there's anything to submit. */}
                  {mode === "signup" && email.trim() !== "" && (
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
                          <a href="/terms" target="_blank">Legal Policies</a>
                          {" "}and{" "}
                          <a href="/privacy" target="_blank">Privacy Policies</a>
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
                  If an account exists for <strong>{email}</strong>, we&apos;ve
                  sent a sign-in link to it.
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

        {/* ─── Right panel: GPU showcase ─── */}
        <div className="account-right">
          <div className="account-showcase">
            {/* Teal glaze radiating from behind the GPU */}
            <div className="account-showcase-glow" aria-hidden="true" />
            {/* Customer logos, light-on-dark — sits above the GPU photo */}
            {!IS_OSS && <AccountLogoCloud />}
            <div className="account-gpu-wrap">
              <Image
                src="/images/gpu-cloud2.png"
                alt="Cloud GPU infrastructure"
                fill
                priority
                sizes="(max-width: 768px) 0px, 400px"
                className="account-gpu-img"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom proof marquee — continuous scrolling ticker in flow at the
          page bottom (not an overlay), so it always claims its own slice of
          the 100dvh budget and the columns above shrink to make room. */}
      {!IS_OSS && (
        <div className="account-marquee">
          <div className="account-marquee-track">
            {[0, 1, 2, 3].flatMap((rep) =>
              MARQUEE_STATS.map(({ icon, text }, i) => (
                <div key={`${rep}-${i}`} className="account-marquee-item">
                  {icon}
                  <span>{text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        /* ═══ Page shell ═══ */
        /* Never scrolls, ever — always exactly one viewport tall. dvh avoids
           the classic mobile bug where 100vh includes the browser chrome and
           leaves a sliver of scrollable overflow; vh is the fallback for
           browsers that don't support dvh. */
        .account-page {
          height: 100vh;
          height: 100dvh;
          max-height: 100vh;
          max-height: 100dvh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          font-family: var(--font-space-grotesk), Arial, Helvetica, sans-serif;
          /* True black, per direction — not the zinc-900/800 charcoal
             gradient this page used before. */
          background: #000;
          color: #fafafa;
        }

        /* ═══ Header ═══ */
        .account-header {
          flex-shrink: 0;
          z-index: 50;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.85);
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
          color: #a1a1aa;
          text-decoration: none;
          transition: color 0.15s;
        }
        .account-header-link:hover {
          color: #fafafa;
        }
        .account-header-signin {
          font-size: 14px;
          color: #fafafa;
          font-weight: 500;
          background: none;
          border: none;
          cursor: pointer;
        }

        /* ═══ Layout ═══ */
        .account-layout {
          flex: 1;
          display: flex;
          overflow: hidden;
          min-height: 0;
        }

        /* ═══ Left panel — sells AND converts ═══ */
        /* Transparent: the page's charcoal gradient shows straight through so
           the two columns read as one continuous dark surface. Never scrolls —
           padding and inner gaps use clamp() so content shrinks to fit instead
           of overflowing. */
        .account-left {
          flex: 1 1 46%;
          background: transparent;
          color: #fafafa;
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow: hidden;
          padding: clamp(16px, 5vh, 40px) 56px;
          min-height: 0;
        }
        .account-left-inner {
          max-width: 480px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: clamp(14px, 2.5vh, 22px);
          margin-top: auto;
          margin-bottom: auto;
          min-height: 0;
        }
        /* ═══ Left panel typography ═══ */
        .account-headline {
          font-size: clamp(2rem, 2.8vw, 2.6rem);
          font-weight: 700;
          line-height: 1.1;
          margin: 0;
          color: #fafafa;
          letter-spacing: -0.5px;
        }
        .account-headline-em {
          /* Space Grotesk has no true italic face — this is a synthetic
             (browser-generated) slant, which is fine for a one-word accent. */
          font-style: italic;
          font-weight: 500;
          letter-spacing: 0;
          color: var(--teal);
        }

        /* ═══ Trust line — single line under the headline ═══ */
        .account-trust-line {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #e1e1e1;
          font-size: 12.5px;
        }
        .account-trust-icon {
          display: flex;
          color: var(--teal);
          flex-shrink: 0;
        }

        /* ═══ Bottom proof marquee — greenish band, black text, in-flow ═══ */
        .account-marquee {
          flex-shrink: 0;
          width: 100%;
          overflow: hidden;
          background: var(--teal);
        }
        .account-marquee-track {
          display: flex;
          width: max-content;
          animation: account-marquee-scroll 26s linear infinite;
        }
        .account-marquee:hover .account-marquee-track {
          animation-play-state: paused;
        }
        .account-marquee-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 15px;
          font-weight: 700;
          color: #0a0a0a;
          white-space: nowrap;
          padding: 14px 36px;
          border-right: 1px solid rgba(0, 0, 0, 0.15);
        }
        .account-marquee-item svg {
          flex-shrink: 0;
          color: #0a0a0a;
        }
        @keyframes account-marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        /* The card keeps the old page background (zinc-900 → zinc-800
           gradient) even though the page itself moved to true black — it's
           what lifts the card off the now-pure-black surface around it. */
        .account-form-container {
          width: 100%;
          background: linear-gradient(to bottom right, #18181b, #27272a);
          border: 1px solid rgba(255, 255, 255, 0.09);
          border-radius: 16px;
          padding: clamp(20px, 4vh, 32px);
          box-sizing: border-box;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
        }

        /* ═══ Right panel — GPU showcase, no card ═══ */
        /* Fully transparent: the GPU and its glow float directly on the page's
           charcoal so the two columns are one seamless dark surface — no
           bordered box, no separate section. */
        .account-right {
          flex: 1 1 54%;
          background: transparent;
          display: flex;
          min-width: 0;
        }
        /* Logos + GPU are one centered vertical group in the middle of the
           column — logos on top, GPU below. */
        .account-showcase {
          position: relative;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 24px 0 32px;
          min-height: 0;
          overflow: hidden;
        }
        /* Teal glaze bleeding across the page background behind the GPU. Soft
           and wide so it reads as ambient light, not a contained panel. */
        .account-showcase-glow {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 58% 48% at 50% 42%, rgba(24, 182, 168, 0.26), transparent 70%),
            radial-gradient(ellipse 40% 30% at 50% 60%, rgba(24, 182, 168, 0.12), transparent 72%);
          pointer-events: none;
        }
        /* Fixed-size container — the Image uses fill mode (position:absolute)
           so this wrapper controls the exact rendered size. Centered by the
           parent's align-items:center. */
        .account-gpu-wrap {
          position: relative;
          width: min(60%, 400px);
          aspect-ratio: 1100 / 1162;
          max-height: 58vh;
          flex-shrink: 1;
          min-height: 0;
          margin-top: auto;
          margin-bottom: max(5%, 16px);
        }
        .account-showcase :global(.account-gpu-img) {
          object-fit: contain;
          filter: drop-shadow(0 0 70px rgba(24, 182, 168, 0.38))
            drop-shadow(0 24px 48px rgba(0, 0, 0, 0.55));
        }

        /* ═══ Form header ═══ */
        .account-form-header {
          margin-bottom: 28px;
        }
        .account-form-title {
          font-size: 22px;
          font-weight: 700;
          color: #fafafa;
          margin: 0 0 6px;
        }
        .account-form-subtitle {
          font-size: 14px;
          color: #a1a1aa;
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
          color: #e4e4e7;
          margin-bottom: 6px;
        }
        .account-input {
          width: 100%;
          padding: 12px 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          font-size: 15px;
          color: #fafafa;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.05);
        }
        .account-input::placeholder {
          color: #71717a;
        }
        .account-input:focus {
          border-color: var(--teal);
          box-shadow: 0 0 0 3px rgba(24, 182, 168, 0.18);
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
          accent-color: var(--teal);
          flex-shrink: 0;
        }
        .account-terms-text {
          font-size: 13px;
          color: #a1a1aa;
          line-height: 1.5;
        }
        .account-terms-text a {
          color: var(--teal);
          text-decoration: none;
        }
        .account-terms-text a:hover {
          text-decoration: underline;
        }
        .account-consent-note {
          font-size: 11px;
          color: #71717a;
          margin: -8px 0 16px;
          line-height: 1.5;
        }

        /* ═══ Error ═══ */
        .account-error {
          color: #ef4444;
          font-size: 13px;
          margin: 0 0 12px;
        }

        /* ═══ Submit button ═══ */
        /* Teal gradient pill — same treatment as the dashboard's "+ On-demand"
           and wallet "Top up" buttons (teal-400 → teal-600). */
        .account-submit {
          width: 100%;
          padding: 13px;
          background: linear-gradient(to bottom right, #2dd4bf, #0d9488);
          color: white;
          border: none;
          border-radius: 9999px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
          box-shadow: 0 4px 14px rgba(24, 182, 168, 0.35);
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
          color: #a1a1aa;
          margin: 24px 0 0;
        }
        .account-mode-switch button {
          color: var(--teal);
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
          color: #a1a1aa;
          font-size: 12px;
        }

        /* ═══ Magic link sent state ═══ */
        .account-sent {
          text-align: center;
        }
        .account-sent-icon {
          width: 56px;
          height: 56px;
          background: var(--teal);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .account-sent-title {
          font-size: 20px;
          font-weight: 700;
          color: #fafafa;
          margin: 0 0 8px;
        }
        .account-sent-text {
          font-size: 14px;
          color: #a1a1aa;
          margin: 0 0 20px;
        }
        .account-sent-text strong {
          color: #fafafa;
        }
        .account-sent-note {
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.09);
          font-size: 13px;
          color: #a1a1aa;
          margin-bottom: 12px;
        }
        /* Subtle teal tint — a friendly suggestion, not a warning (this used
           to be amber, which read as an alert). */
        .account-sent-hint {
          padding: 12px;
          background: rgba(24, 182, 168, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(24, 182, 168, 0.25);
          font-size: 13px;
          color: #e4e4e7;
          margin-bottom: 20px;
        }
        .account-sent-hint button {
          color: var(--teal);
          background: none;
          border: none;
          cursor: pointer;
          font-weight: 500;
          font-size: 13px;
        }
        .account-sent-retry {
          font-size: 14px;
          color: #a1a1aa;
          background: none;
          border: none;
          cursor: pointer;
        }
        .account-sent-retry:hover {
          color: #fafafa;
        }

        /* ═══ Animation ═══ */
        @keyframes account-spin {
          to { transform: rotate(360deg); }
        }

        /* ═══ Responsive ═══ */
        /* The GPU showcase and bottom marquee are decorative — on a phone
           there isn't room for headline + form + imagery + marquee in one
           screen without scrolling, and scrolling isn't allowed. Drop the
           decorative pieces first; the conversion column (headline, trust
           line, form) always keeps its full 100dvh to itself. */
        @media (max-width: 768px) {
          .account-left {
            flex: 1;
            width: 100%;
            padding: 24px 20px;
          }
          .account-headline {
            font-size: 1.75rem;
          }
          .account-right,
          .account-marquee {
            display: none;
          }
        }
        /* Short desktop/laptop windows (e.g. a resized browser, a small
           laptop panel): the marquee is the least essential element, so it
           goes first rather than risking any clipping of the columns above
           it. The GPU image max-height also tightens so it stays within
           the shorter panel. */
        @media (max-height: 760px) {
          .account-marquee {
            display: none;
          }
        }
        /* Very short viewports (short phones, a browser window barely taller
           than the form itself): the legal boilerplate line is redundant with
           the checkbox label right above it (both link to the same two
           policies) and is the safest thing to drop next — nothing the
           visitor needs to complete signup is lost. */
        @media (max-height: 700px) {
          .account-consent-note {
            display: none;
          }
          .account-left-inner {
            gap: 10px;
          }
          .account-form-container {
            padding: 16px;
          }
        }

        /* ═══ Large screens (≥1440px — QHD / 27″ monitors) ═══ */
        /* Scale up content so the page feels intentional on wide displays
           instead of a small island floating in a sea of black. */
        @media (min-width: 1440px) {
          .account-header-inner {
            max-width: 1400px;
          }
          .account-left-inner {
            max-width: 520px;
          }
          .account-headline {
            font-size: clamp(2.2rem, 2.6vw, 3rem);
          }
          .account-gpu-wrap {
            width: min(65%, 520px);
          }
          .account-trust-line {
            font-size: 13.5px;
          }
        }

        /* ═══ Extra-large screens (≥1920px — 4K / ultra-wide) ═══ */
        @media (min-width: 1920px) {
          .account-header-inner {
            max-width: 1600px;
          }
          .account-left {
            padding-left: 80px;
            padding-right: 80px;
          }
          .account-left-inner {
            max-width: 560px;
          }
          .account-headline {
            font-size: clamp(2.4rem, 2.4vw, 3.2rem);
          }
          .account-form-title {
            font-size: 24px;
          }
          .account-form-subtitle {
            font-size: 15px;
          }
          .account-gpu-wrap {
            width: min(70%, 600px);
          }
          .account-marquee-item {
            font-size: 16px;
            padding: 16px 44px;
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
