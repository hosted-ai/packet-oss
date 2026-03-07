"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error" | "2fa">("loading");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState(["", "", "", "", "", ""]);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("No token provided");
      return;
    }

    async function verify() {
      try {
        const response = await fetch("/api/investor/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok && !data.requiresTwoFactor) {
          setStatus("error");
          setError(data.error || "Verification failed");
          return;
        }

        if (data.requiresTwoFactor) {
          setStatus("2fa");
          setEmail(data.email);
          return;
        }

        setStatus("success");
        setTimeout(() => {
          router.push("/investors");
        }, 1500);
      } catch {
        setStatus("error");
        setError("Failed to verify token");
      }
    }

    verify();
  }, [token, router]);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...twoFactorCode];
    newCode[index] = value.slice(-1);
    setTwoFactorCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are entered
    if (newCode.every((d) => d) && newCode.join("").length === 6) {
      handleTwoFactorSubmit(newCode.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !twoFactorCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newCode = [...twoFactorCode];
    for (let i = 0; i < pasted.length; i++) {
      newCode[i] = pasted[i];
    }
    setTwoFactorCode(newCode);
    if (pasted.length === 6) {
      handleTwoFactorSubmit(pasted);
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
  };

  const handleTwoFactorSubmit = async (code: string) => {
    setIsVerifying(true);
    setError("");

    try {
      const response = await fetch("/api/investor/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, twoFactorCode: code }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus("success");
        setTimeout(() => {
          router.push("/investors");
        }, 1500);
      } else {
        setError(data.error || "Invalid verification code");
        setTwoFactorCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("Failed to verify code");
    } finally {
      setIsVerifying(false);
    }
  };

  if (status === "2fa") {
    return (
      <div className="max-w-md w-full px-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#f7f8fb] border border-[#e4e7ef] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#1a4fff]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold mb-2 text-[#0b0f1c]">Two-Factor Authentication</h1>
          <p className="text-[#5b6476]">
            Enter the 6-digit code from your authenticator app
          </p>
          {email && (
            <p className="text-[#5b6476] text-sm mt-1">{email}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
            {error}
          </div>
        )}

        <div className="flex justify-center gap-2 mb-6">
          {twoFactorCode.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              disabled={isVerifying}
              className="w-12 h-14 text-center text-2xl font-mono bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:border-[#1a4fff] focus:ring-1 focus:ring-[#1a4fff] outline-none disabled:opacity-50"
            />
          ))}
        </div>

        {isVerifying && (
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-[#1a4fff] border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-[#5b6476] mt-2">Verifying...</p>
          </div>
        )}

        <p className="text-[#5b6476] text-sm text-center mt-6">
          You can also use a backup code if you&apos;ve lost access to your authenticator app.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full px-6">
      {status === "loading" && (
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#1a4fff] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2 text-[#0b0f1c]">Verifying...</h1>
          <p className="text-[#5b6476]">Please wait while we verify your login.</p>
        </div>
      )}

      {status === "success" && (
        <div className="text-center">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold mb-2 text-[#0b0f1c]">Logged In</h1>
          <p className="text-[#5b6476]">Redirecting to dashboard...</p>
        </div>
      )}

      {status === "error" && (
        <div className="text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold mb-2 text-[#0b0f1c]">Verification Failed</h1>
          <p className="text-[#5b6476] mb-4">{error}</p>
          <Link
            href="/investors/login"
            className="inline-block px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg transition-colors"
          >
            Back to Login
          </Link>
        </div>
      )}
    </div>
  );
}

export default function InvestorVerifyPage() {
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
        <Suspense fallback={
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-[#1a4fff] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[#5b6476]">Loading...</p>
          </div>
        }>
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
