// Re-export from new auth module for backwards compatibility
export {
  getAdmins,
  isAdmin,
  addAdmin,
  addAdminWithPassword,
  verifyAdminPassword,
  adminHasPassword,
  removeAdmin,
  generateAdminToken,
  verifyAdminToken,
  generateSessionToken,
  verifySessionToken,
  type Admin,
} from "./auth/admin";
