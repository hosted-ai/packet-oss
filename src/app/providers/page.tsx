"use client";

import { useState } from "react";
import Link from "next/link";

export default function ProviderLoginPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/providers/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({
          type: "success",
          text: "Check your email for the login link.",
        });
        setEmail("");
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to send login link. Please try again.",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0b0f1c]">Provider Portal</h1>
          <p className="text-[#5b6476] mt-2">
            Sign in to manage your GPU infrastructure on GPU Cloud
          </p>
        </div>

        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8">
          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[#0b0f1c] mb-2"
              >
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-3 border border-[#e4e7ef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a4fff] focus:border-transparent text-[#0b0f1c]"
                required
              />
            </div>

            {message && (
              <div
                className={`mb-6 p-4 rounded-lg ${
                  message.type === "success"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !email}
              className="w-full bg-[#1a4fff] text-white py-3 px-4 rounded-lg font-medium hover:bg-[#1a4fff]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Sending..." : "Send Login Link"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[#e4e7ef] text-center">
            <p className="text-[#5b6476] text-sm">
              Not a provider yet?{" "}
              <Link
                href="/providers/apply"
                className="text-[#1a4fff] hover:underline font-medium"
              >
                Apply to become a provider
              </Link>
            </p>
          </div>
        </div>

        <div className="text-center mt-6">
          <Link
            href="/"
            className="text-[#5b6476] text-sm hover:text-[#0b0f1c]"
          >
            ← Back to GPU Cloud
          </Link>
        </div>
      </div>
    </div>
  );
}
