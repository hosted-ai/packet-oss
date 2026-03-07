// Re-export from new auth module for backwards compatibility
export {
  generateSecret,
  generateOTPAuthURI,
  generateQRCode,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  isTwoFactorEnabled,
  getTwoFactorStatus,
  startTwoFactorSetup,
  completeTwoFactorSetup,
  verifyTwoFactorCode,
  disableTwoFactor,
  regenerateBackupCodes,
} from "./auth/two-factor";
