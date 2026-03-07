"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

type Mode = "loading" | "setup" | "login";

export default function AdminLoginPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [usePasswordLogin, setUsePasswordLogin] = useState(true);

  useEffect(() => {
    fetch("/api/admin/setup")
      .then((r) => r.json())
      .then((data) => {
        setMode(data.needsSetup ? "setup" : "login");
      })
      .catch(() => setMode("login"));
  }, []);

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Setup failed");
        return;
      }

      window.location.href = "/admin?tab=platform-settings";
    } catch {
      setError("Failed to complete setup");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Login failed");
        return;
      }

      window.location.href = "/admin";
    } catch {
      setError("Failed to log in");
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Failed to send login link");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="animate-pulse text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/packet-logo.png"
              alt="Admin"
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
          {mode === "setup" ? (
            <>
              <h1 className="text-2xl font-bold text-center mb-2">Welcome! Create Your Admin Account</h1>
              <p className="text-zinc-400 text-center mb-8">
                Set up the first admin account to get started with your GPU cloud platform.
              </p>

              <form onSubmit={handleSetup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="admin@yourcompany.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
                  <input
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                  />
                </div>

                {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-900 rounded-lg font-medium transition-colors disabled:bg-zinc-600 disabled:cursor-not-allowed"
                >
                  {loading ? "Creating Account..." : "Create Admin Account"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-center mb-2">Admin Login</h1>
              <p className="text-zinc-400 text-center mb-8">
                {usePasswordLogin
                  ? "Enter your admin credentials"
                  : "Enter your admin email to receive a login link"}
              </p>

              {!submitted ? (
                <>
                  <form onSubmit={usePasswordLogin ? handlePasswordLogin : handleMagicLink} className="space-y-4">
                    <input
                      type="email"
                      placeholder="admin@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                    />

                    {usePasswordLogin && (
                      <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
                      />
                    )}

                    {error && <p className="text-red-400 text-sm text-center">{error}</p>}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-900 rounded-lg font-medium transition-colors disabled:bg-zinc-600 disabled:cursor-not-allowed"
                    >
                      {loading
                        ? (usePasswordLogin ? "Logging in..." : "Sending...")
                        : (usePasswordLogin ? "Log In" : "Send Login Link")}
                    </button>
                  </form>

                  <button
                    onClick={() => {
                      setUsePasswordLogin(!usePasswordLogin);
                      setError("");
                    }}
                    className="w-full mt-3 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {usePasswordLogin ? "Use magic link instead" : "Use password instead"}
                  </button>
                </>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
