"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ComingSoonForm from "./ComingSoonForm";

const BYPASS_KEY = "packet_preview";
const UNLOCK_CODE = process.env.NEXT_PUBLIC_UNLOCK_CODE || "";

export default function ComingSoonWrapper() {
  const [bypassed, setBypassed] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);

  useEffect(() => {
    // Check if bypass is stored in localStorage
    if (localStorage.getItem(BYPASS_KEY) === "1") {
      setBypassed(true);
    }
  }, []);

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.toLowerCase().trim() === UNLOCK_CODE) {
      localStorage.setItem(BYPASS_KEY, "1");
      setBypassed(true);
    } else {
      setCodeError(true);
      setTimeout(() => setCodeError(false), 2000);
    }
  };

  if (bypassed) {
    return null;
  }

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
        <ComingSoonForm />
        <p className="coming-soon-note">
          No spam. Unsubscribe anytime.
        </p>

        {/* Hidden unlock code input */}
        <div className="mt-8 pt-4 border-t border-white/10">
          {!showCodeInput ? (
            <button
              onClick={() => setShowCodeInput(true)}
              className="text-xs text-white/30 hover:text-white/50 transition-colors"
            >
              Have an access code?
            </button>
          ) : (
            <form onSubmit={handleCodeSubmit} className="flex gap-2 justify-center">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter code"
                autoFocus
                className={`px-3 py-1.5 text-sm bg-white/10 border rounded text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30 w-32 ${
                  codeError ? "border-red-500 shake" : "border-white/20"
                }`}
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-sm bg-white/20 hover:bg-white/30 text-white rounded transition-colors"
              >
                Go
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
