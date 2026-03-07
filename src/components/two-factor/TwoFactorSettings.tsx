"use client";

import Image from "next/image";
import { useTwoFactor } from "./hooks/useTwoFactor";
import type { TwoFactorSettingsProps, TwoFactorConfig } from "./types";
import { USER_TYPE_CONFIG } from "./types";

export default function TwoFactorSettings({
  userType,
  apiEndpoint,
  token,
  initialEnabled,
  initialHasBackupCodes,
  onStatusChange,
}: TwoFactorSettingsProps) {
  const config: TwoFactorConfig = {
    userType,
    apiEndpoint,
    token,
    ...USER_TYPE_CONFIG[userType],
  };

  const {
    enabled,
    isLoading,
    error,
    success,
    showSetup,
    setupData,
    verificationCode,
    showDisable,
    disableCode,
    showRegenerate,
    regenerateCode,
    newBackupCodes,
    handleStartSetup,
    handleConfirmSetup,
    handleDisable,
    handleRegenerateBackupCodes,
    copyBackupCodes,
    setVerificationCode,
    setDisableCode,
    setRegenerateCode,
    setShowDisable,
    setShowRegenerate,
    setError,
    resetSetup,
    resetDisable,
    resetRegenerate,
    resetNewBackupCodes,
  } = useTwoFactor({
    apiEndpoint,
    token,
    initialEnabled,
    initialHasBackupCodes,
    onStatusChange,
  });

  const isDark = config.theme === "dark";

  // Loading state for admin/investor (they fetch status on mount)
  if (isLoading && !showSetup && !showDisable && !showRegenerate && initialEnabled === undefined) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className={`w-6 h-6 border-2 ${isDark ? "border-white" : "border-[var(--blue)]"} border-t-transparent rounded-full animate-spin`}></div>
      </div>
    );
  }

  // Theme classes
  const containerBg = isDark ? "bg-zinc-800" : "bg-white";
  const textPrimary = isDark ? "text-white" : "text-[var(--ink)]";
  const textSecondary = isDark ? "text-zinc-400" : "text-[var(--muted)]";
  const textStrong = isDark ? "text-zinc-300" : "text-[var(--ink)]";
  const cardBorder = isDark ? "" : "border border-[var(--line)]";
  const cardRounded = isDark ? "rounded-lg" : "rounded-2xl";
  const buttonRounded = isDark ? "rounded-lg" : "rounded-xl";
  const borderLine = isDark ? "border-zinc-700" : "border-[var(--line)]";
  const inputBg = isDark ? "bg-zinc-700 border-zinc-600" : "border-[var(--line)]";
  const inputText = isDark ? "text-white" : "";

  // Error/success theme classes
  const errorBg = isDark ? "bg-rose-900/50 border-rose-800 text-rose-300" : "bg-rose-50 border-rose-200 text-rose-600";
  const successBg = isDark ? "bg-emerald-900/50 border-emerald-800 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-600";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-lg font-semibold ${textPrimary}`}>
          Two-Factor Authentication
        </h2>
        <p className={`text-sm ${textSecondary}`}>
          Add an extra layer of security to {config.accountTypeLabel}
        </p>
      </div>

      {/* Status Card */}
      <div className={`${containerBg} ${cardRounded} ${cardBorder} p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                enabled
                  ? (isDark ? "bg-emerald-900" : "bg-emerald-100")
                  : (isDark ? "bg-zinc-700" : "bg-zinc-100")
              }`}
            >
              <svg
                className={`w-6 h-6 ${
                  enabled
                    ? (isDark ? "text-emerald-400" : "text-emerald-600")
                    : (isDark ? "text-zinc-400" : "text-zinc-400")
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <div>
              <h3 className={`font-medium ${textPrimary}`}>
                Authenticator App
              </h3>
              <p className={`text-sm ${textSecondary}`}>
                {enabled
                  ? "Your account is protected with 2FA"
                  : "Not enabled - your account uses email login only"}
              </p>
            </div>
          </div>

          {enabled ? (
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1.5 px-3 py-1 ${
                isDark ? "bg-emerald-900 text-emerald-300" : "bg-emerald-100 text-emerald-700"
              } rounded-full text-sm font-medium`}>
                <span className={`w-2 h-2 ${isDark ? "bg-emerald-400" : "bg-emerald-500"} rounded-full`}></span>
                Enabled
              </span>
            </div>
          ) : (
            <button
              onClick={handleStartSetup}
              disabled={isLoading}
              style={{ backgroundColor: config.accentColor }}
              className={`px-4 py-2 text-white font-medium ${buttonRounded} transition-colors disabled:opacity-50 hover:opacity-90`}
            >
              {isLoading ? "Setting up..." : "Enable 2FA"}
            </button>
          )}
        </div>

        {/* Actions for enabled 2FA */}
        {enabled && (
          <div className={`mt-6 pt-6 border-t ${borderLine} flex gap-3`}>
            <button
              onClick={() => {
                setShowRegenerate(true);
                setShowDisable(false);
                setError(null);
              }}
              className={`px-4 py-2 text-sm font-medium ${
                isDark ? "text-zinc-300 hover:text-white border-zinc-700" : "text-[var(--muted)] hover:text-zinc-700 border-[var(--line)]"
              } border ${buttonRounded} transition-colors`}
            >
              Regenerate Backup Codes
            </button>
            <button
              onClick={() => {
                setShowDisable(true);
                setShowRegenerate(false);
                setError(null);
              }}
              className={`px-4 py-2 text-sm font-medium ${
                isDark ? "text-rose-400 hover:text-rose-300 border-rose-800 hover:border-rose-700" : "text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300"
              } border ${buttonRounded} transition-colors`}
            >
              Disable 2FA
            </button>
          </div>
        )}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className={`p-4 ${errorBg} border ${cardRounded} text-sm`}>
          {error}
        </div>
      )}
      {success && !showSetup && !newBackupCodes && (
        <div className={`p-4 ${successBg} border ${cardRounded} text-sm`}>
          {success}
        </div>
      )}

      {/* Setup Modal */}
      {showSetup && setupData && (
        <div className={`${containerBg} ${cardRounded} ${cardBorder} p-6 space-y-6`}>
          <div>
            <h3 className={`font-semibold ${textPrimary} mb-2`}>
              Set Up Authenticator App
            </h3>
            <p className={`text-sm ${textSecondary}`}>
              Scan this QR code with your authenticator app (Google
              Authenticator, Authy, 1Password, etc.)
            </p>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <div className={`p-4 bg-white ${buttonRounded} ${isDark ? "" : "border border-[var(--line)]"}`}>
              <Image
                src={setupData.qrCode}
                alt="QR Code"
                width={200}
                height={200}
              />
            </div>
          </div>

          {/* Manual Entry */}
          <div className={`p-4 ${isDark ? "bg-zinc-700" : "bg-zinc-50"} ${buttonRounded}`}>
            <p className={`text-xs ${textSecondary} mb-2`}>
              Or enter this code manually:
            </p>
            <code className={`block text-sm font-mono ${textPrimary} break-all`}>
              {setupData.secret}
            </code>
          </div>

          {/* Backup Codes */}
          <div className={`p-4 ${isDark ? "bg-amber-900/30 border-amber-800" : "bg-amber-50 border-amber-200"} border ${buttonRounded}`}>
            <div className="flex items-start gap-3 mb-3">
              <svg
                className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"} mt-0.5`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className={`text-sm font-medium ${isDark ? "text-amber-300" : "text-amber-800"}`}>
                  Save Your Backup Codes
                </p>
                <p className={`text-xs ${isDark ? "text-amber-400" : "text-amber-700"} mt-1`}>
                  These codes can be used to access your account if you lose
                  your authenticator device. Each code can only be used once.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {setupData.backupCodes.map((code, i) => (
                <code
                  key={i}
                  className={`px-3 py-1.5 ${isDark ? "bg-zinc-800 text-white" : "bg-white"} rounded text-sm font-mono text-center`}
                >
                  {code}
                </code>
              ))}
            </div>
            <button
              onClick={() => copyBackupCodes(setupData.backupCodes)}
              className={`text-xs ${isDark ? "text-amber-400 hover:text-amber-300" : "text-amber-700 hover:text-amber-800"} font-medium flex items-center gap-1`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy backup codes
            </button>
          </div>

          {/* Verification */}
          <div>
            <label className={`block text-sm font-medium ${textPrimary} mb-2`}>
              Enter the 6-digit code from your app to verify
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                className={`flex-1 px-4 py-2.5 ${inputBg} border ${buttonRounded} text-center font-mono text-lg tracking-widest ${inputText} focus:outline-none focus:ring-2 focus:border-transparent`}
                style={{ "--tw-ring-color": config.focusRingColor } as React.CSSProperties}
                maxLength={6}
              />
              <button
                onClick={handleConfirmSetup}
                disabled={isLoading || verificationCode.length !== 6}
                style={{ backgroundColor: config.accentColor }}
                className={`px-6 py-2.5 text-white font-medium ${buttonRounded} transition-colors disabled:opacity-50 hover:opacity-90`}
              >
                {isLoading ? "Verifying..." : "Verify & Enable"}
              </button>
            </div>
          </div>

          {/* Cancel */}
          <button
            onClick={resetSetup}
            className={`text-sm ${textSecondary} hover:${isDark ? "text-zinc-300" : "text-zinc-700"}`}
          >
            Cancel setup
          </button>
        </div>
      )}

      {/* Disable 2FA Form */}
      {showDisable && (
        <div className={`${containerBg} ${cardRounded} border ${isDark ? "border-rose-800" : "border-rose-200"} p-6 space-y-4`}>
          <div>
            <h3 className={`font-semibold ${isDark ? "text-rose-400" : "text-rose-600"} mb-2`}>Disable 2FA</h3>
            <p className={`text-sm ${textSecondary}`}>
              Enter your current 2FA code to disable two-factor authentication.
              This will make your account less secure.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={disableCode}
              onChange={(e) =>
                setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="Enter 2FA code"
              className={`flex-1 px-4 py-2.5 ${inputBg} border ${buttonRounded} text-center font-mono text-lg tracking-widest ${inputText} focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent`}
              maxLength={6}
            />
            <button
              onClick={handleDisable}
              disabled={isLoading || !disableCode}
              className={`px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-medium ${buttonRounded} transition-colors disabled:opacity-50`}
            >
              {isLoading ? "Disabling..." : "Disable"}
            </button>
          </div>

          <button
            onClick={resetDisable}
            className={`text-sm ${textSecondary} hover:${isDark ? "text-zinc-300" : "text-zinc-700"}`}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Regenerate Backup Codes Form */}
      {showRegenerate && !newBackupCodes && (
        <div className={`${containerBg} ${cardRounded} ${cardBorder} p-6 space-y-4`}>
          <div>
            <h3 className={`font-semibold ${textPrimary} mb-2`}>
              Regenerate Backup Codes
            </h3>
            <p className={`text-sm ${textSecondary}`}>
              Enter your current 2FA code to generate new backup codes. Your old
              backup codes will no longer work.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={regenerateCode}
              onChange={(e) =>
                setRegenerateCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="Enter 2FA code"
              className={`flex-1 px-4 py-2.5 ${inputBg} border ${buttonRounded} text-center font-mono text-lg tracking-widest ${inputText} focus:outline-none focus:ring-2 focus:border-transparent`}
              style={{ "--tw-ring-color": config.focusRingColor } as React.CSSProperties}
              maxLength={6}
            />
            <button
              onClick={handleRegenerateBackupCodes}
              disabled={isLoading || !regenerateCode}
              style={{ backgroundColor: config.accentColor }}
              className={`px-6 py-2.5 text-white font-medium ${buttonRounded} transition-colors disabled:opacity-50 hover:opacity-90`}
            >
              {isLoading ? "Generating..." : "Generate"}
            </button>
          </div>

          <button
            onClick={resetRegenerate}
            className={`text-sm ${textSecondary} hover:${isDark ? "text-zinc-300" : "text-zinc-700"}`}
          >
            Cancel
          </button>
        </div>
      )}

      {/* New Backup Codes Display */}
      {newBackupCodes && (
        <div className={`${containerBg} ${cardRounded} border ${isDark ? "border-emerald-800" : "border-emerald-200"} p-6 space-y-4`}>
          <div className="flex items-start gap-3">
            <svg
              className={`w-5 h-5 ${isDark ? "text-emerald-400" : "text-emerald-600"} mt-0.5`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <h3 className={`font-semibold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                New Backup Codes Generated
              </h3>
              <p className={`text-sm ${isDark ? "text-emerald-300" : "text-emerald-600"} mt-1`}>
                Save these codes securely. Your old backup codes will no longer
                work.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {newBackupCodes.map((code, i) => (
              <code
                key={i}
                className={`px-3 py-1.5 ${isDark ? "bg-emerald-900/30 border-emerald-800 text-white" : "bg-emerald-50 border-emerald-200"} border rounded text-sm font-mono text-center`}
              >
                {code}
              </code>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => copyBackupCodes(newBackupCodes)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${
                isDark ? "text-emerald-400 border-emerald-700 hover:bg-emerald-900/30" : "text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              } border ${buttonRounded}`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy codes
            </button>
            <button
              onClick={resetNewBackupCodes}
              className={`px-4 py-2 text-sm font-medium ${textSecondary} hover:${isDark ? "text-zinc-300" : "text-zinc-700"}`}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className={`text-sm ${textSecondary} space-y-2`}>
        <p>
          <strong className={textStrong}>How it works:</strong> After enabling 2FA, you&apos;ll need to
          enter a code from your authenticator app each time you log in with a
          new magic link.
        </p>
        <p>
          <strong className={textStrong}>Recommended apps:</strong> Google Authenticator, Authy,
          1Password, Microsoft Authenticator, or any TOTP-compatible app.
        </p>
      </div>
    </div>
  );
}
