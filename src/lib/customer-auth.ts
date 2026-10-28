// Re-export from new auth module for backwards compatibility
export {
  generateCustomerToken,
  generateAdminBypassToken,
  generateTwoFactorVerifiedToken,
  verifyCustomerToken,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  type CustomerTokenPayload,
} from "./auth/customer";

// PA-380: single-use sign-in / invitation links. Emailed magic-link mint sites
// should call createLoginLink() instead of generateCustomerToken() so the link
// is short-lived, single-use, and invalidated when a newer link is issued.
export { createLoginLink, LOGIN_LINK_TTL_MINUTES } from "./auth/login-link";
