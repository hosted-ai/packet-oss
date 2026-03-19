"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

type LoginMode = "loading" | "magic-link" | "password" | "setup";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("loading");

  // Detect if we're on a tenant subdomain
  const isTenantSubdomain = typeof window !== "undefined" &&
    window.location.hostname.includes(".tenants.");

  // Check login mode on mount
  useEffect(() => {
    async function checkMode() {
      try {
        const res = await fetch("/api/admin/auth");
        const data = await res.json();
        if (data.authenticated) {
          window.location.href = "/admin";
          return;
        }
        if (data.loginMode === "password") {
          setLoginMode(data.isFirstRun ? "setup" : "password");
        } else {
          setLoginMode("magic-link");
        }
      } catch {
        setLoginMode("magic-link");
      }
    }
    checkMode();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Validate password confirmation for setup mode
    if (loginMode === "setup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    setLoading(true);

    try {
      const authEndpoint = isTenantSubdomain ? "/api/tenants/auth" : "/api/admin/auth";
      const body: Record<string, string> = { email };

      // Include password for OSS modes
      if (loginMode === "password" || loginMode === "setup") {
        body.password = password;
      }

      const response = await fetch(authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      // Password login with 2FA — redirect to verify page
      if (data.requiresTwoFactor && data.token) {
        window.location.href = `/admin/verify?token=${data.token}`;
        return;
      }

      // Password login returns session directly — redirect
      if (data.success && (loginMode === "password" || loginMode === "setup")) {
        window.location.href = "/admin";
        return;
      }

      // Magic link flow — show "check email" message
      setSubmitted(true);
    } catch {
      setError("Failed to process login");
    } finally {
      setLoading(false);
    }
  }

  if (loginMode === "loading") {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  const isSetup = loginMode === "setup";
  const isPassword = loginMode === "password" || isSetup;

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/packet-logo.png"
              alt="Admin Login"
              width={120}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-zinc-500 text-sm">Admin</span>
          </Link>
        </div>
      </header>

      <div className="flex-grow flex items-center justify-center py-12">
        <div className="max-w-md w-full px-6">
          <h1 className="text-2xl font-bold text-center mb-2">
            {isSetup ? "Create Admin Account" : "Admin Login"}
          </h1>
          <p className="text-zinc-400 text-center mb-8">
            {isSetup
              ? "Set up your administrator account"
              : isPassword
                ? "Enter your admin credentials"
                : "Enter your admin email to receive a login link"}
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
              />

              {isPassword && (
                <input
                  type="password"
                  placeholder={isSetup ? "Create password (min 8 chars)" : "Password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                />
              )}

              {isSetup && (
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                />
              )}

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-900 rounded-lg font-medium transition-colors disabled:bg-zinc-600 disabled:cursor-not-allowed"
              >
                {loading
                  ? (isSetup ? "Creating Account..." : isPassword ? "Logging in..." : "Sending...")
                  : (isSetup ? "Create Account" : isPassword ? "Log In" : "Send Login Link")}
              </button>
            </form>
          ) : (
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-6 text-center">
              <div className="w-12 h-12 bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Check your email</h3>
              <p className="text-sm text-zinc-400">
                If you&apos;re an admin, you&apos;ll receive a login link at <strong>{email}</strong>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
