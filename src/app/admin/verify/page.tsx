"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AdminVerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [requiresPin, setRequiresPin] = useState(false);
  const [pinSetup, setPinSetup] = useState(false);
  const [pinExpired, setPinExpired] = useState(false);
  const [pinStep, setPinStep] = useState<"create" | "confirm">("create");
  const [pinDigits, setPinDigits] = useState(["", "", "", "", "", ""]);
  const [confirmPinDigits, setConfirmPinDigits] = useState(["", "", "", "", "", ""]);
  const [email, setEmail] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState(["", "", "", "", "", ""]);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const token = searchParams.get("token");
  const tab = searchParams.get("tab");
  const provider = searchParams.get("provider");
  const adminRedirect = tab
    ? `/admin?tab=${tab}${provider ? `&provider=${provider}` : ""}`
    : "/admin";

  useEffect(() => {
    if (!token) {
      setError("Invalid login link");
      return;
    }

    // Verify the token
    fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          router.push(adminRedirect);
        } else if (data.requiresTwoFactor) {
          setRequiresTwoFactor(true);
          setEmail(data.email);
        } else if (data.requiresPin) {
          setRequiresPin(true);
          setPinSetup(data.pinSetup);
          setPinExpired(data.pinExpired || false);
          setEmail(data.email);
        } else {
          setError(data.error || "Invalid or expired link");
        }
      })
      .catch(() => {
        setError("Failed to verify login");
      });
  }, [searchParams, router, token, tab]);

  // PIN input handlers
  const handlePinChange = (index: number, value: string, isConfirm: boolean) => {
    if (!/^\d*$/.test(value)) return;

    const digits = isConfirm ? [...confirmPinDigits] : [...pinDigits];
    const setDigits = isConfirm ? setConfirmPinDigits : setPinDigits;
    const refs = isConfirm ? confirmPinInputRefs : pinInputRefs;

    digits[index] = value.slice(-1);
    setDigits(digits);

    if (value && index < 5) {
      refs.current[index + 1]?.focus();
    }

    // Auto-advance or auto-submit
    if (digits.every((d) => d) && digits.join("").length === 6) {
      if (pinSetup && !isConfirm) {
        // Move to confirm step
        setPinStep("confirm");
        setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
      } else if (pinSetup && isConfirm) {
        // Confirm step — check match and submit
        const created = pinDigits.join("");
        const confirmed = digits.join("");
        if (created !== confirmed) {
          setError("PINs don't match. Try again.");
          setConfirmPinDigits(["", "", "", "", "", ""]);
          setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
        } else {
          handlePinSetup(created);
        }
      } else {
        // PIN entry — submit
        handlePinVerify(digits.join(""));
      }
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent, isConfirm: boolean) => {
    const digits = isConfirm ? confirmPinDigits : pinDigits;
    const refs = isConfirm ? confirmPinInputRefs : pinInputRefs;
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent, isConfirm: boolean) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const digits = isConfirm ? [...confirmPinDigits] : [...pinDigits];
    const setDigits = isConfirm ? setConfirmPinDigits : setPinDigits;
    for (let i = 0; i < pasted.length; i++) {
      digits[i] = pasted[i];
    }
    setDigits(digits);
    if (pasted.length === 6) {
      if (pinSetup && !isConfirm) {
        setPinStep("confirm");
        setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
      } else if (pinSetup && isConfirm) {
        const created = pinDigits.join("");
        if (created !== pasted) {
          setError("PINs don't match. Try again.");
          setConfirmPinDigits(["", "", "", "", "", ""]);
          setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
        } else {
          handlePinSetup(created);
        }
      } else {
        handlePinVerify(pasted);
      }
    }
  };

  const handlePinSetup = async (pin: string) => {
    setIsVerifying(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPin: pin }),
      });
      const data = await response.json();
      if (data.success) {
        router.push(adminRedirect);
      } else {
        setError(data.error || "Failed to set PIN");
        setPinStep("create");
        setPinDigits(["", "", "", "", "", ""]);
        setConfirmPinDigits(["", "", "", "", "", ""]);
        setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
      }
    } catch {
      setError("Failed to set PIN");
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePinVerify = async (pin: string) => {
    setIsVerifying(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pinCode: pin }),
      });
      const data = await response.json();
      if (data.success) {
        router.push(adminRedirect);
      } else {
        // If PIN expired, switch to setup mode
        if (data.requiresPin && data.pinSetup) {
          setPinSetup(true);
          setPinExpired(true);
          setPinStep("create");
          setPinDigits(["", "", "", "", "", ""]);
          setConfirmPinDigits(["", "", "", "", "", ""]);
          setError("PIN expired. Please set a new PIN.");
          setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
        } else {
          setError(data.error || "Invalid PIN");
          setPinDigits(["", "", "", "", "", ""]);
          setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
        }
      }
    } catch {
      setError("Failed to verify PIN");
    } finally {
      setIsVerifying(false);
    }
  };

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
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, twoFactorCode: code }),
      });

      const data = await response.json();

      if (data.success) {
        router.push(adminRedirect);
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

  if (requiresPin) {
    const isSetupCreate = pinSetup && pinStep === "create";
    const isSetupConfirm = pinSetup && pinStep === "confirm";
    const isEntry = !pinSetup;
    const activeDigits = isSetupConfirm ? confirmPinDigits : pinDigits;
    const activeRefs = isSetupConfirm ? confirmPinInputRefs : pinInputRefs;
    const isConfirm = isSetupConfirm;

    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="w-full max-w-md px-6">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#9b51e0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold mb-2">
              {isSetupCreate && pinExpired && "PIN Expired — Set a New PIN"}
              {isSetupCreate && !pinExpired && "Set Your PIN"}
              {isSetupConfirm && "Confirm Your PIN"}
              {isEntry && "Enter Your PIN"}
            </h1>
            <p className="text-zinc-400">
              {isSetupCreate && "Choose a 6-digit PIN for admin login"}
              {isSetupConfirm && "Re-enter your PIN to confirm"}
              {isEntry && "Enter your 6-digit PIN to continue"}
            </p>
            {email && (
              <p className="text-zinc-500 text-sm mt-1">{email}</p>
            )}
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-900/50 border border-red-800 rounded-lg text-red-300 text-sm text-center">
              {error}
            </div>
          )}

          <div className="flex justify-center gap-2 mb-6">
            {activeDigits.map((digit, index) => (
              <input
                key={`${isConfirm ? "confirm" : "pin"}-${index}`}
                ref={(el) => { activeRefs.current[index] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handlePinChange(index, e.target.value, isConfirm)}
                onKeyDown={(e) => handlePinKeyDown(index, e, isConfirm)}
                onPaste={(e) => handlePinPaste(e, isConfirm)}
                disabled={isVerifying}
                autoFocus={index === 0}
                className="w-12 h-14 text-center text-2xl font-mono bg-zinc-800 border border-zinc-700 rounded-lg focus:border-[#9b51e0] focus:ring-1 focus:ring-[#9b51e0] outline-none disabled:opacity-50"
              />
            ))}
          </div>

          {isVerifying && (
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-[#9b51e0] border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-zinc-400 mt-2">{pinSetup ? "Setting PIN..." : "Verifying..."}</p>
            </div>
          )}

          {isSetupConfirm && !isVerifying && (
            <button
              onClick={() => {
                setPinStep("create");
                setPinDigits(["", "", "", "", "", ""]);
                setConfirmPinDigits(["", "", "", "", "", ""]);
                setError("");
                setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
              }}
              className="block mx-auto text-zinc-500 text-sm hover:text-zinc-300 mt-4"
            >
              Start over
            </button>
          )}

          {pinSetup && (
            <p className="text-zinc-500 text-sm text-center mt-6">
              Your PIN expires every 4 weeks. You&apos;ll be asked to set a new one when it does.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (requiresTwoFactor) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="w-full max-w-md px-6">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#9b51e0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold mb-2">Two-Factor Authentication</h1>
            <p className="text-zinc-400">
              Enter the 6-digit code from your authenticator app
            </p>
            {email && (
              <p className="text-zinc-500 text-sm mt-1">{email}</p>
            )}
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-900/50 border border-red-800 rounded-lg text-red-300 text-sm text-center">
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
                className="w-12 h-14 text-center text-2xl font-mono bg-zinc-800 border border-zinc-700 rounded-lg focus:border-[#9b51e0] focus:ring-1 focus:ring-[#9b51e0] outline-none disabled:opacity-50"
              />
            ))}
          </div>

          {isVerifying && (
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-[#9b51e0] border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-zinc-400 mt-2">Verifying...</p>
            </div>
          )}

          <p className="text-zinc-500 text-sm text-center mt-6">
            You can also use a backup code if you&apos;ve lost access to your authenticator app.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold mb-2">Login Failed</h1>
          <p className="text-zinc-400 mb-4">{error}</p>
          <a href="/admin/login" className="text-[#9b51e0] hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-zinc-400">Verifying login...</p>
      </div>
    </div>
  );
}

export default function AdminVerifyPage() {
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
      <AdminVerifyContent />
    </Suspense>
  );
}
