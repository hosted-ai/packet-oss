"use client";

import { useState } from "react";
import Image from "next/image";

export default function ComingSoon() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to join waitlist");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  };

  return (
    <div className="coming-soon-overlay">
      <div className="coming-soon-content">
        <Image
          src="/packet-logo.png"
          alt="GPU Cloud"
          width={180}
          height={64}
          className="coming-soon-logo"
        />

        <h1>Coming Soon</h1>
        <p>
          We&apos;re launching NVIDIA B200 GPUs at $2/hour.<br />
          Join the waitlist to get early access.
        </p>

        {status === "success" ? (
          <div className="coming-soon-success">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span>You&apos;re on the list! We&apos;ll be in touch soon.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="coming-soon-form">
            <div className="coming-soon-input-row">
              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "loading"}
              />
              <button type="submit" disabled={status === "loading"}>
                {status === "loading" ? (
                  <span className="loading-spinner" />
                ) : (
                  "Join Waitlist"
                )}
              </button>
            </div>
            {status === "error" && errorMessage && (
              <p className="coming-soon-error">{errorMessage}</p>
            )}
          </form>
        )}

        <p className="coming-soon-note">
          No spam. Unsubscribe anytime.
        </p>
      </div>
    </div>
  );
}
