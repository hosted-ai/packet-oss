// Re-export from new auth module for backwards compatibility
export {
  getAdmins,
  isAdmin,
  addAdmin,
  removeAdmin,
  generateAdminToken,
  verifyAdminToken,
  generatePreAuthToken,
  verifyPreAuthToken,
  generateSessionToken,
  verifySessionToken,
  type Admin,
} from "./auth/admin";
