"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function SuccessContent() {
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const type = searchParams.get("type");
  const email = searchParams.get("email");
  const sessionId = searchParams.get("session_id");
  const directToken = searchParams.get("token");
  const isFreeTrial = type === "free-trial" || type === "free";
  const isVoucher = type === "voucher";

  useEffect(() => {
    setMounted(true);
  }, []);

  // For voucher signups: token is in the URL, redirect immediately
  useEffect(() => {
    if (!directToken || !isVoucher) return;

    setAccountReady(true);
    const url = `/dashboard?token=${directToken}`;
    setDashboardUrl(url);
    setTimeout(() => {
      window.location.href = url;
    }, 2000);
  }, [directToken, isVoucher]);

  // Poll for account readiness — auto-redirect when ready
  // Uses session_id (from Stripe checkout redirect) for secure verification
  useEffect(() => {
    if (!sessionId || isFreeTrial) return;

    let attempts = 0;
    const maxAttempts = 15; // 30 seconds at 2s intervals
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval>;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/account/check-ready?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();

        if (data.ready && data.dashboardUrl) {
          stopped = true;
          clearInterval(intervalId);
          setAccountReady(true);
          setDashboardUrl(data.dashboardUrl);
          setTimeout(() => {
            window.location.href = data.dashboardUrl;
          }, 2000);
          return;
        }
      } catch {
        // Ignore polling errors
      }

      attempts++;
      if (attempts >= maxAttempts) {
        stopped = true;
        clearInterval(intervalId);
        setPollFailed(true);
      }
    };

    poll();
    intervalId = setInterval(poll, 2000);

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isFreeTrial]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-100 bg-white/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image
              src="/packet-logo.png"
              alt="GPU Cloud"
              width={120}
              height={32}
              className="h-7 w-auto"
            />
          </Link>
        </div>
      </header>

      {/* Progress */}
      <div className="border-b border-zinc-100">
        <div className="mx-auto max-w-xl px-6 py-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div className="flex-1 h-px bg-zinc-900 mx-3" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div className="flex-1 h-px bg-zinc-900 mx-3" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-grow flex items-center justify-center py-16">
        <div className="max-w-md text-center px-6">
          {/* Success Icon */}
          <div className={`w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-8 transition-all duration-500 ${mounted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-3">
            {isFreeTrial ? "Your free account is ready!" : "Welcome to GPU Cloud"}
          </h1>

          <p className="text-zinc-500 mb-10">
            {isFreeTrial
              ? "Check your email for your API key and dashboard link."
              : "Your payment was successful. Your GPU dashboard is being set up now."}
          </p>

          {/* Steps - Dynamic based on account readiness */}
          {accountReady ? (
            <div className="mb-10">
              <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="font-semibold text-emerald-900">Your account is ready!</p>
                </div>
                <p className="text-sm text-emerald-700 ml-11">
                  Redirecting you to your dashboard...
                </p>
                {dashboardUrl && (
                  <a
                    href={dashboardUrl}
                    className="inline-block mt-3 ml-11 text-sm font-medium text-emerald-700 underline hover:text-emerald-800"
                  >
                    Click here if not redirected
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-left mb-10">
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0">
                    {sessionId && !isFreeTrial && !pollFailed ? (
                      <div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
                    ) : (
                      <span className="text-sm font-medium text-zinc-900">1</span>
                    )}
                  </div>
                  <div className="pt-1">
                    <p className="font-medium text-zinc-900">
                      {sessionId && !isFreeTrial && !pollFailed ? "Setting up your account..." : "Check your email"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {isFreeTrial
                        ? `We sent your API key and login link${email ? ` to ${email}` : ""}`
                        : pollFailed
                        ? "We're sending you a login link"
                        : sessionId
                        ? "This usually takes about 10 seconds"
                        : "We're sending you a login link"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0 text-sm font-medium text-zinc-900">
                    2
                  </div>
                  <div className="pt-1">
                    <p className="font-medium text-zinc-900">
                      {isFreeTrial || pollFailed || !sessionId ? "Click the link" : "Auto-login to dashboard"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {isFreeTrial || pollFailed || !sessionId ? "No password needed" : "We'll redirect you automatically"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0 text-sm font-medium text-zinc-900">
                    3
                  </div>
                  <div className="pt-1">
                    <p className="font-medium text-zinc-900">
                      {isFreeTrial ? "Start using the API" : "Launch your first GPU"}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {isFreeTrial
                        ? "You have 10,000 free tokens to explore LLM inference"
                        : "Start computing in minutes"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Free trial upgrade prompt */}
          {isFreeTrial && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-sm text-amber-800">
              <span className="font-medium">Want GPU pods?</span> Add $50 to your wallet to unlock dedicated GPU instances for training, fine-tuning, and more.
            </div>
          )}

          {/* Notice */}
          <div className="p-4 bg-zinc-50 rounded-lg mb-8 text-sm text-zinc-600">
            <span className="font-medium">Didn&apos;t get the email?</span> Check your spam folder or request a new link.
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/account"
              className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Resend Login Link
            </Link>
            <Link
              href="https://www.the platform/support/"
              className="px-6 py-3 border border-zinc-200 hover:border-zinc-300 text-zinc-700 rounded-lg text-sm font-medium transition-colors"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-100">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className="text-center text-xs text-zinc-400">
            &copy; {new Date().getFullYear()} GPU Cloud Platform
          </p>
        </div>
      </footer>
    </div>
  );
}

function SuccessLoading() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<SuccessLoading />}>
      <SuccessContent />
    </Suspense>
  );
}
