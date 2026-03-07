"use client";

import { useState } from "react";

interface ComingSoonFormProps {
  initialEmail?: string;
}

export default function ComingSoonForm({ initialEmail = "" }: ComingSoonFormProps) {
  const [email, setEmail] = useState(initialEmail);
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

  if (status === "success") {
    return (
      <div className="coming-soon-success">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>You&apos;re on the list! We&apos;ll be in touch soon.</span>
      </div>
    );
  }

  return (
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
  );
}
