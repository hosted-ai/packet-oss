/**
 * Authentication Module
 *
 * Unified authentication system supporting multiple user types:
 * - Customer: Stripe customers accessing the billing dashboard
 * - Admin: Internal administrators with elevated privileges
 * - Investor: External investors with read-only access to metrics
 *
 * All auth types use JWT tokens with role-based claims.
 * Two-factor authentication is supported for admin users.
 *
 * @module auth
 *
 * @example
 * ```typescript
 * import { generateCustomerToken, verifyCustomerToken } from "@/lib/auth";
 *
 * const token = generateCustomerToken({
 *   email: "user@example.com",
 *   customerId: "cus_xxx"
 * });
 * const payload = verifyCustomerToken(token);
 * ```
 */

// Customer auth
export {
  generateCustomerToken,
  generateAdminBypassToken,
  verifyCustomerToken,
  type CustomerTokenPayload,
} from "./customer";

// Admin auth
export {
  getAdmins,
  isAdmin,
  addAdmin,
  removeAdmin,
  generateAdminToken,
  verifyAdminToken,
  generateSessionToken,
  verifySessionToken,
  type Admin,
} from "./admin";

// Investor auth
export {
  getInvestors,
  isInvestor,
  isInvestorOwner,
  addInvestor,
  removeInvestor,
  updateInvestorLogin,
  generateInvestorToken,
  verifyInvestorToken,
  generateInvestorSessionToken,
  verifyInvestorSessionToken,
  type Investor,
} from "./investor";

// Auth helpers
export {
  getAuthenticatedCustomer,
  type AuthenticatedCustomer,
} from "./helpers";

// Two-factor auth
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
} from "./two-factor";
