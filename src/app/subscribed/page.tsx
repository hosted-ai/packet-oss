"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { getBrandName, getLogoUrl, getSupportEmail } from "@/lib/branding-client";
import { useBranding } from "@/hooks/useBranding";

function SubscribedContent() {
  const searchParams = useSearchParams();
  const branding = useBranding();
  const LOGO_URL = branding?.logoUrl || getLogoUrl();
  const sessionId = searchParams.get("session_id");
  const [pollFailed, setPollFailed] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setPollFailed(true);
      return;
    }

    let stopped = false;
    let attempts = 0;
    const maxAttempts = 15; // 30s @ 2s

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/account/check-ready?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (data.ready && data.dashboardUrl) {
          stopped = true;
          clearInterval(intervalId);
          setRedirecting(true);
          // check-ready already returns /dashboard?token=XXX — append the
          // subscribed flag for any future UX that wants to react to it.
          const url = data.dashboardUrl.includes("?")
            ? `${data.dashboardUrl}&subscribed=1`
            : `${data.dashboardUrl}?subscribed=1`;
          window.location.href = url;
          return;
        }
      } catch {
        // ignore polling errors, keep trying
      }

      attempts++;
      if (attempts >= maxAttempts) {
        stopped = true;
        clearInterval(intervalId);
        setPollFailed(true);
      }
    };

    const intervalId = setInterval(poll, 2000);
    poll();

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      <header className="border-b border-zinc-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <BrandLogo src={LOGO_URL} alt={getBrandName()} width={120} height={32} className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      <div className="flex-grow flex items-center justify-center py-16">
        <div className="max-w-md text-center px-6">
          {pollFailed ? (
            <>
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-8">
                <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 3h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold tracking-tight mb-3">Subscription is processing</h1>
              <p className="text-zinc-500 mb-6">
                Your payment was successful but we&apos;re still finalizing your account. This usually
                completes within a few seconds — sign back in and the new subscription will be waiting.
              </p>
              <Link
                href="/account"
                className="inline-block px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Sign in
              </Link>
              <p className="text-sm text-zinc-500 mt-6">
                Still stuck? Reach us at{" "}
                <a
                  href={`mailto:${branding?.supportEmail || getSupportEmail()}`}
                  className="font-medium text-zinc-700 hover:text-zinc-900"
                >
                  {branding?.supportEmail || getSupportEmail()}
                </a>
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-8">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold tracking-tight mb-3">
                {redirecting ? "All set — redirecting you..." : "Adding your subscription..."}
              </h1>
              <p className="text-zinc-500 mb-10">
                {redirecting
                  ? "Taking you back to your dashboard."
                  : "Your payment was successful. We're attaching the subscription to your account — this takes a few seconds."}
              </p>
              <div className="flex items-center justify-center gap-3 text-sm text-zinc-500">
                <svg className="w-5 h-5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {redirecting ? "Redirecting..." : "Finalizing..."}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubscribedLoading() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
    </div>
  );
}

export default function SubscribedPage() {
  return (
    <Suspense fallback={<SubscribedLoading />}>
      <SubscribedContent />
    </Suspense>
  );
}
