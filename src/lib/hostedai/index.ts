/**
 * hosted.ai API client - modular export
 *
 * This index file maintains backwards compatibility with the original
 * monolithic hostedai.ts by re-exporting all functions and types.
 *
 * Usage:
 *   import { createTeam, getPoolSubscriptions } from "@/lib/hostedai";
 *
 * Or import from specific modules:
 *   import { createTeam } from "@/lib/hostedai/teams";
 *   import { getPoolSubscriptions } from "@/lib/hostedai/pools";
 */

// Re-export all types
export * from "./types";

// Re-export client utilities
export {
  hostedaiRequest,
  getCached,
  setCache,
  clearCache,
  getApiUrl,
  getApiKey,
} from "./client";

// Re-export team functions
export {
  createTeam,
  onboardUser,
  createOneTimeLogin,
  suspendTeam,
  unsuspendTeam,
  terminateTeam,
  getTeam,
  changeTeamPackage,
  // PA-175
  listTeamMembers,
  findTeamMemberByEmail,
  inviteToTeam,
  changeUserRole,
  setMemberStatus,
  removeUserFromTeam,
} from "./teams";

// Re-export billing functions
export {
  formatBillingDatetime,
  getTeamBillingSummary,
  getTeamBillingLastHour,
  getTeamBillingSummaryV2,
  getTeamUsageSinceLast,
} from "./billing";

// Re-export instance functions
export {
  getCompatibleServiceScenarios,
  getInstanceTypes,
  getCompatibleImages,
  getImagePolicies,
  getGPUaaSImages,
  getStorageBlocks,
  getInstance,
  createInstance,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  getInstanceCredentials,
  getTeamInstances,
  startVNCSession,
  stopVNCSession,
  renameInstance,
  factoryResetInstance,
  getAddDiskPricing,
  addDisksToInstance,
  listScenarios,
  createScenario,
  assignServiceToScenario,
  unassignServiceFromScenario,
  getScenarioCompatibleServices,
  getServiceCompatibleRegions,
  getServiceCompatibleGPUPools,
  getServiceProvisioningInfo,
  getHAIService,
  updateHAIService,
  getTeamWorkspaces,
  getUnifiedInstances,
  UnifiedInstancesUnavailableError,
  getUnifiedInstanceDetail,
  isUnifiedInstanceId,
  getAllUnifiedInstances,
  podVolumeAction,
  waitForInstanceRunning,
  getPodMetricsV2,
  getTeamMetricsV2,
} from "./instances";

export type { UnifiedInstance, UnifiedInstanceDetail, WaitResult, WaitForInstanceOptions, GpuMetricsPoint, MetricsWindow } from "./instances";

export type { AddDiskParams, AddDiskPricing } from "./instances";

// Re-export pool functions
export {
  getAvailableRegions,
  getAvailablePools,
  AvailabilityCheckError,
  getPoolSubscriptions,
  getPoolInstanceTypes,
  getPoolEphemeralStorageBlocks,
  getPoolPersistentStorageBlocks,
  calculatePoolSubscriptionCost,
  subscribeToPool,
  scalePoolSubscription,
  unsubscribeFromPool,
  getAllPools,
  getAllPoolsWithRegions,
  getConnectionInfo,
  podAction,
  reimagePoolSubscription,
  // Shared volume management
  createSharedVolume,
  getSharedVolumes,
  getSharedStorageBlocks,
  getServiceSharedVolumes,
  deleteSharedVolume,
  // Optimal pool selection
  selectOptimalPool,
  subscribeWithFallback,
} from "./pools";

export type {
  SelectOptimalPoolParams,
  SelectOptimalPoolResult,
} from "./pools";

export type {
  CreateSharedVolumeParams,
  SharedVolume,
} from "./types";

// Re-export metrics functions
export {
  getGPUaaSMetrics,
  getGPUaaSMetricsGraph,
  getGPUaaSHoursUsed,
} from "./metrics";

// Re-export service exposure functions
export {
  exposeService,
  getExposeServiceStatus,
  updateExposedService,
  deleteExposedService,
  getExposedServices,
} from "./services";

// Re-export resource policy functions
export {
  getResourcePolicy,
  getDefaultResourcePolicy,
  updateResourcePolicy,
  addRegionToResourcePolicy,
  addRegionToDefaultPolicy,
  syncTeamsToDefaultPolicy,
} from "./policies";

export type {
  ResourcePolicy,
  ResourcePolicyRegion,
  UpdateResourcePolicyInput,
} from "./policies";

// Re-export default policies functions
export {
  getDefaultPolicies,
  getDefaultPoliciesSync,
  clearDefaultPoliciesCache,
  initializeDefaultPolicies,
  ensureDefaultPolicies,
  DEFAULT_POLICIES,
  FALLBACK_POLICIES,
} from "./default-policies";

// Re-export default roles functions
export {
  getRoles,
  getRolesSync,
  clearRolesCache,
  initializeRoles,
  ensureRoles,
  ROLES,
  FALLBACK_ROLES,
} from "./default-roles";

// Re-export recipe functions
export {
  listRecipes,
  findRecipeByName,
  compressRecipe,
  uploadRecipe,
  createAppService,
  deleteAppService,
} from "./recipes";

// Re-export bare-metal (Ariel native) functions
export {
  subscribeToBaremetal,
  listBaremetalInstances,
  getBaremetalInstance,
  getBaremetalCostEstimate,
  getBaremetalCredentials,
  terminateBaremetal,
  waitForBaremetalActive,
} from "./baremetal";

export type {
  SubscribeToBaremetalPayload,
  BaremetalSubscription,
  BaremetalCostEstimate,
  WaitForBaremetalOptions,
  BaremetalWaitResult,
} from "./baremetal";
