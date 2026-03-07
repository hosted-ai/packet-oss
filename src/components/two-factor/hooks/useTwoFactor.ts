"use client";

import { useState, useEffect, useCallback } from "react";
import type { SetupData } from "../types";

interface UseTwoFactorProps {
  apiEndpoint: string;
  token?: string;
  initialEnabled?: boolean;
  initialHasBackupCodes?: boolean;
  onStatusChange: () => void;
}

interface UseTwoFactorReturn {
  // Status
  enabled: boolean;
  hasBackupCodes: boolean;
  isLoading: boolean;
  error: string | null;
  success: string | null;

  // Setup state
  showSetup: boolean;
  setupData: SetupData | null;
  verificationCode: string;

  // Disable state
  showDisable: boolean;
  disableCode: string;

  // Regenerate state
  showRegenerate: boolean;
  regenerateCode: string;
  newBackupCodes: string[] | null;

  // Actions
  handleStartSetup: () => Promise<void>;
  handleConfirmSetup: () => Promise<void>;
  handleDisable: () => Promise<void>;
  handleRegenerateBackupCodes: () => Promise<void>;
  copyBackupCodes: (codes: string[]) => void;

  // Setters
  setVerificationCode: (code: string) => void;
  setDisableCode: (code: string) => void;
  setRegenerateCode: (code: string) => void;
  setShowSetup: (show: boolean) => void;
  setShowDisable: (show: boolean) => void;
  setShowRegenerate: (show: boolean) => void;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  resetSetup: () => void;
  resetDisable: () => void;
  resetRegenerate: () => void;
  resetNewBackupCodes: () => void;
}

export function useTwoFactor({
  apiEndpoint,
  token,
  initialEnabled,
  initialHasBackupCodes,
  onStatusChange,
}: UseTwoFactorProps): UseTwoFactorReturn {
  // Determine if we need to fetch status (admin/investor) or use props (customer)
  const shouldFetchStatus = initialEnabled === undefined;

  const [enabled, setEnabled] = useState(initialEnabled ?? false);
  const [hasBackupCodes, setHasBackupCodes] = useState(initialHasBackupCodes ?? false);
  const [isLoading, setIsLoading] = useState(shouldFetchStatus);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Setup state
  const [showSetup, setShowSetup] = useState(false);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [verificationCode, setVerificationCode] = useState("");

  // Disable state
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  // Regenerate backup codes state
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  // Fetch status for admin/investor (they don't receive it as props)
  useEffect(() => {
    if (!shouldFetchStatus) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch(apiEndpoint);
        const data = await res.json();
        if (res.ok) {
          setEnabled(data.enabled);
          setHasBackupCodes(data.hasBackupCodes);
        }
      } catch {
        console.error("Failed to fetch 2FA status");
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatus();
  }, [apiEndpoint, shouldFetchStatus]);

  // Update from props for customer dashboard
  useEffect(() => {
    if (initialEnabled !== undefined) {
      setEnabled(initialEnabled);
    }
  }, [initialEnabled]);

  useEffect(() => {
    if (initialHasBackupCodes !== undefined) {
      setHasBackupCodes(initialHasBackupCodes);
    }
  }, [initialHasBackupCodes]);

  const callApi = useCallback(
    async (action: string, code?: string) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, code }),
      });
      return res.json();
    },
    [apiEndpoint, token]
  );

  const handleStartSetup = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await callApi("setup");
      if (data.error) {
        setError(data.error);
      } else {
        setSetupData({
          qrCode: data.qrCode,
          secret: data.secret,
          backupCodes: data.backupCodes,
        });
        setShowSetup(true);
      }
    } catch {
      setError("Failed to start 2FA setup");
    }
    setIsLoading(false);
  }, [callApi]);

  const handleConfirmSetup = useCallback(async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError("Please enter a 6-digit code");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await callApi("confirm", verificationCode);
      if (data.error) {
        setError(data.error);
      } else {
        setSuccess("Two-factor authentication enabled successfully!");
        setShowSetup(false);
        setSetupData(null);
        setVerificationCode("");
        setEnabled(true);
        setHasBackupCodes(true);
        onStatusChange();
      }
    } catch {
      setError("Failed to confirm 2FA setup");
    }
    setIsLoading(false);
  }, [callApi, verificationCode, onStatusChange]);

  const handleDisable = useCallback(async () => {
    if (!disableCode) {
      setError("Please enter your 2FA code");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await callApi("disable", disableCode);
      if (data.error) {
        setError(data.error);
      } else {
        setSuccess("Two-factor authentication disabled.");
        setShowDisable(false);
        setDisableCode("");
        setEnabled(false);
        setHasBackupCodes(false);
        onStatusChange();
      }
    } catch {
      setError("Failed to disable 2FA");
    }
    setIsLoading(false);
  }, [callApi, disableCode, onStatusChange]);

  const handleRegenerateBackupCodes = useCallback(async () => {
    if (!regenerateCode) {
      setError("Please enter your 2FA code");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await callApi("regenerate-backup-codes", regenerateCode);
      if (data.error) {
        setError(data.error);
      } else {
        setNewBackupCodes(data.backupCodes);
        setSuccess("New backup codes generated. Save these securely!");
      }
    } catch {
      setError("Failed to regenerate backup codes");
    }
    setIsLoading(false);
  }, [callApi, regenerateCode]);

  const copyBackupCodes = useCallback(
    (codes: string[]) => {
      navigator.clipboard.writeText(codes.join("\n"));
      setSuccess("Backup codes copied to clipboard!");
    },
    []
  );

  const resetSetup = useCallback(() => {
    setShowSetup(false);
    setSetupData(null);
    setVerificationCode("");
    setError(null);
  }, []);

  const resetDisable = useCallback(() => {
    setShowDisable(false);
    setDisableCode("");
    setError(null);
  }, []);

  const resetRegenerate = useCallback(() => {
    setShowRegenerate(false);
    setRegenerateCode("");
    setError(null);
  }, []);

  const resetNewBackupCodes = useCallback(() => {
    setNewBackupCodes(null);
    setShowRegenerate(false);
    setRegenerateCode("");
    setSuccess(null);
  }, []);

  return {
    enabled,
    hasBackupCodes,
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
    setShowSetup,
    setShowDisable,
    setShowRegenerate,
    setError,
    setSuccess,
    resetSetup,
    resetDisable,
    resetRegenerate,
    resetNewBackupCodes,
  };
}
