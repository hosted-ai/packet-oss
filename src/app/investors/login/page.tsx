"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function InvestorLoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/investor/auth", {
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
    <div className="min-h-screen bg-[#f7f8fb] flex flex-col">
      <header className="border-b border-[#e4e7ef] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/packet-logo.png"
              alt="GPU Cloud"
              width={120}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-[#1a4fff] text-sm font-medium">Investors</span>
          </Link>
        </div>
      </header>

      <div className="flex-grow flex items-center justify-center py-12">
        <div className="max-w-md w-full px-6">
          <h1 className="text-2xl font-bold text-center mb-2 text-[#0b0f1c]">Investor Dashboard</h1>
          <p className="text-[#5b6476] text-center mb-8">
            Enter your email to receive a login link
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="investor@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff] focus:border-transparent"
              />

              {error && (
                <p className="text-red-600 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? "Sending..." : "Send Login Link"}
              </button>
            </form>
          ) : (
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-6 text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-[#0b0f1c]">Check your email</h3>
              <p className="text-sm text-[#5b6476]">
                If you&apos;re an investor, you&apos;ll receive a login link at <strong>{email}</strong>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
