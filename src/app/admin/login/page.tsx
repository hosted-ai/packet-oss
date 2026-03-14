"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  // Detect if we're on a tenant subdomain
  const isTenantSubdomain = typeof window !== "undefined" &&
    window.location.hostname.includes(".tenants.");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Use tenant auth endpoint for tenant subdomains, core admin auth for main domain
      const authEndpoint = isTenantSubdomain ? "/api/tenants/auth" : "/api/admin/auth";
      const response = await fetch(authEndpoint, {
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
          <h1 className="text-2xl font-bold text-center mb-2">Admin Login</h1>
          <p className="text-zinc-400 text-center mb-8">
            Enter your admin email to receive a login link
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#9b51e0] focus:border-transparent"
              />

              {error && (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-white hover:bg-zinc-200 text-zinc-900 rounded-lg font-medium transition-colors disabled:bg-zinc-600 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : "Send Login Link"}
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
