// Re-export from new auth module for backwards compatibility
export {
  getAdmins,
  isAdmin,
  addAdmin,
  removeAdmin,
  bootstrapFirstAdmin,
  generateAdminToken,
  verifyAdminToken,
  generateSessionToken,
  verifySessionToken,
  type Admin,
} from "./auth/admin";
