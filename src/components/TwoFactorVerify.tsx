"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";

interface TwoFactorVerifyProps {
  token: string;
  userEmail: string;
  onSuccess: () => void;
}

export default function TwoFactorVerify({
  token,
  userEmail,
  onSuccess,
}: TwoFactorVerifyProps) {
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedBackupCode, setUsedBackupCode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code) {
      setError("Please enter your 2FA code");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/account/two-factor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "verify", code }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setCode("");
        inputRef.current?.focus();
      } else {
        if (data.usedBackupCode) {
          setUsedBackupCode(true);
          // Brief delay to show backup code warning before continuing
          setTimeout(() => {
            onSuccess();
          }, 2000);
        } else {
          onSuccess();
        }
      }
    } catch {
      setError("Failed to verify code");
    }

    setIsLoading(false);
  };

  // Handle input change with validation
  const handleCodeChange = (value: string) => {
    // Allow digits (for TOTP) or alphanumeric (for backup codes)
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setCode(cleaned.slice(0, 8)); // Max 8 chars for backup codes
    setError(null);
  };

  // Auto-submit when 6 digits entered (for TOTP)
  useEffect(() => {
    if (code.length === 6 && /^\d+$/.test(code) && !isLoading) {
      handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Show backup code used warning
  if (usedBackupCode) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--background)]">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(247,248,251,0.92)] backdrop-blur-[12px]">
          <div className="mx-auto max-w-[1120px] px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center">
              <Image
                src="/packet-logo.png"
                alt="GPU Cloud"
                width={140}
                height={50}
                className="h-10 w-auto"
              />
            </Link>
          </div>
        </header>

        <div className="flex-grow flex items-center justify-center py-16">
          <div className="max-w-sm w-full px-6">
            <div className="bg-amber-50 border border-amber-200 rounded-[20px] p-8 text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-amber-800 mb-2">
                Backup Code Used
              </h2>
              <p className="text-sm text-amber-700 mb-4">
                You used a backup code to sign in. Remember, each backup code
                can only be used once.
              </p>
              <p className="text-xs text-amber-600">
                Consider regenerating your backup codes in Settings if you&apos;re
                running low.
              </p>
              <div className="mt-6 flex items-center justify-center gap-2 text-amber-700">
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span className="text-sm">Redirecting to dashboard...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(247,248,251,0.92)] backdrop-blur-[12px]">
        <div className="mx-auto max-w-[1120px] px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image
              src="/packet-logo.png"
              alt="GPU Cloud"
              width={140}
              height={50}
              className="h-10 w-auto"
            />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex-grow flex items-center justify-center py-16">
        <div className="max-w-sm w-full px-6">
          <div className="bg-white border border-[var(--line)] rounded-[20px] p-8 shadow-[0_8px_30px_-12px_rgba(26,79,255,0.15)]">
            <div className="text-center mb-8">
              {/* Lock icon */}
              <div className="w-16 h-16 bg-[var(--blue)] rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
                Two-Factor Authentication
              </h1>
              <p className="text-sm text-[var(--muted)] mt-2">
                Enter the code from your authenticator app
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="code" className="sr-only">
                  Authentication code
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className="w-full px-4 py-4 bg-white border border-[var(--line)] rounded-xl text-2xl text-center font-mono tracking-[0.5em] text-[var(--foreground)] placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent transition-all"
                  maxLength={8}
                />
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-sm text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || code.length < 6}
                className="w-full py-3 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_18px_30px_-24px_rgba(26,79,255,0.7)]"
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Verifying...
                  </span>
                ) : (
                  "Verify"
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-[var(--line)]">
              <p className="text-xs text-[var(--muted)] text-center">
                Signing in as <span className="font-medium text-[var(--foreground)]">{userEmail}</span>
              </p>
              <p className="text-xs text-[var(--muted)] text-center mt-3">
                Lost your authenticator?{" "}
                <span className="text-[var(--blue)]">Use a backup code</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-[1120px] px-6 py-6">
          <p className="text-center text-xs text-[var(--muted)]">
            &copy; {new Date().getFullYear()} GPU Cloud Platform
          </p>
        </div>
      </footer>
    </div>
  );
}
