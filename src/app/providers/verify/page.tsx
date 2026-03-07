"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const type = searchParams.get("type"); // 'login' or 'admin-login-as'

    if (!token) {
      setStatus("error");
      setMessage("Invalid verification link. No token provided.");
      return;
    }

    const verifyToken = async () => {
      try {
        const action = type === "admin-login-as" ? "verify-admin-login-as" : "verify";
        const response = await fetch("/api/providers/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, token }),
        });

        const data = await response.json();

        if (data.success) {
          setStatus("success");
          setMessage("Login successful! Redirecting to dashboard...");
          // Redirect to dashboard after short delay
          setTimeout(() => {
            router.push("/providers/dashboard");
          }, 1500);
        } else {
          setStatus("error");
          setMessage(data.error || "Failed to verify login link. It may have expired.");
        }
      } catch {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      }
    };

    verifyToken();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
          {status === "verifying" && (
            <>
              <div className="w-16 h-16 mx-auto mb-4">
                <svg
                  className="animate-spin w-full h-full text-[#1a4fff]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#0b0f1c] mb-2">
                Verifying your login...
              </h2>
              <p className="text-[#5b6476]">Please wait a moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#0b0f1c] mb-2">
                Login Successful
              </h2>
              <p className="text-[#5b6476]">{message}</p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#0b0f1c] mb-2">
                Verification Failed
              </h2>
              <p className="text-[#5b6476] mb-6">{message}</p>
              <Link
                href="/providers"
                className="inline-block bg-[#1a4fff] text-white py-3 px-6 rounded-lg font-medium hover:bg-[#1a4fff]/90"
              >
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProviderVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4">
                <svg
                  className="animate-spin w-full h-full text-[#1a4fff]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#0b0f1c] mb-2">Loading...</h2>
            </div>
          </div>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
