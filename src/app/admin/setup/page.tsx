"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getLogoUrl } from "@/lib/branding";
import { useBranding } from "@/hooks/useBranding";

function AdminSetupContent() {
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const branding = useBranding();
  const logoUrl = branding?.logoUrl || getLogoUrl();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [tokenValid, setTokenValid] = useState(false);

  useEffect(() => {
    if (!invite) {
      setError("Missing invite token");
      setLoading(false);
      return;
    }

    fetch(`/api/admin/auth/setup?invite=${encodeURIComponent(invite)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setEmail(data.email);
          setTokenValid(true);
        } else {
          setError(data.error || "Invalid invite link");
        }
      })
      .catch(() => {
        setError("Failed to validate invite link");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [invite]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite, password, confirmPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to set up account");
        return;
      }

      if (data.success) {
        window.location.href = "/admin";
      }
    } catch {
      setError("Failed to process setup");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400">Validating invite...</p>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold mb-2">Invalid Invite</h1>
          <p className="text-zinc-400 mb-4">{error}</p>
          <p className="text-zinc-500 text-sm">Ask your admin to send a new invite link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src={logoUrl}
              alt="Admin Setup"
              width={120}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-zinc-500 text-sm">Admin</span>
          </Link>
        </div>
      </header>

      <div className="grow flex items-center justify-center py-12">
        <div className="max-w-md w-full px-6">
          <h1 className="text-2xl font-bold text-center mb-2">Set Up Your Account</h1>
          <p className="text-zinc-400 text-center mb-8">
            Create a password for <strong>{email}</strong>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-4 py-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-400 cursor-not-allowed"
            />

            <input
              type="password"
              placeholder="Create password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              autoFocus
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
            />

            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
            />

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-900 rounded-lg font-medium transition-colors disabled:bg-zinc-600 disabled:cursor-not-allowed"
            >
              {submitting ? "Setting up..." : "Set Password & Log In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AdminSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-zinc-400">Loading...</p>
          </div>
        </div>
      }
    >
      <AdminSetupContent />
    </Suspense>
  );
}
