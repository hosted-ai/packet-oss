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
  getTeamInstances,
  startVNCSession,
  stopVNCSession,
  renameInstance,
  factoryResetInstance,
  getAddDiskPricing,
  addDisksToInstance,
} from "./instances";

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
  getPoolSubscriptionStoragePricing,
  // Shared volume management
  createSharedVolume,
  getSharedVolumes,
  deleteSharedVolume,
  // Optimal pool selection
  selectOptimalPool,
  subscribeWithFallback,
} from "./pools";

export type {
  StoragePricingInfo,
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
