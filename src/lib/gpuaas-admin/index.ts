/**
 * GPUaaS Admin API
 *
 * Client library for the GPUaaS admin API.
 * Used to manage GPU infrastructure for service providers.
 *
 * @example
 * ```typescript
 * import { gpuaasAdmin } from "@/lib/gpuaas-admin";
 *
 * // List regions
 * const regions = await gpuaasAdmin.listRegions();
 *
 * // Add a node
 * const node = await gpuaasAdmin.addNode({
 *   name: "gpu-node-01",
 *   region_id: 1,
 *   node_ip: "192.168.1.100",
 *   username: "root",
 *   port: 22,
 *   external_service_ip: "203.0.113.100",
 *   is_controller_node: true,
 *   is_worker_node: false,
 *   is_gateway_service: true,
 *   is_storage_service: false,
 * });
 *
 * // Get SSH keys to install on node
 * const { public_keys } = await gpuaasAdmin.getNodeSSHKeys(node.Id);
 *
 * // Initialize the node
 * await gpuaasAdmin.initializeNode(node.Id);
 *
 * // Create a pool
 * const pool = await gpuaasAdmin.createPool({
 *   name: "default-pool",
 *   region_id: 1,
 *   overcommit_ratio: 1.0,
 * });
 * ```
 */

// Re-export types
export type {
  Region,
  CreateRegionInput,
  GPUaaSCluster,
  GPUaaSNode,
  AddNodeInput,
  GPUaaSPool,
  CreatePoolInput,
  APIError,
  LoginResponse,
} from "./types";

export type { ScanResourcesResponse, ScanStatusResponse } from "./nodes";
export type { AvailableGPU, ClusterPoolGPU, PoolCapacityInfo, PoolSubscribedTeam } from "./pools";

// Re-export client utilities
export { gpuaasAdminRequest, clearSession, getApiUrl } from "./client";

// Import functions for namespace export
import {
  listRegions,
  getRegion,
  createRegion,
  updateRegion,
  deleteRegion,
  listClusters,
  getCluster,
  getClusterByRegion,
  deleteCluster,
  isGPUaaSEnabled,
  getClusterStatusLabel,
} from "./regions";

import {
  listNodes,
  getNode,
  addNode,
  getNodeSSHKeys,
  initializeNode,
  enableGPUaaS,
  joinNode,
  scanGPUs,
  scanNodeResources,
  deleteNode,
  deinitNode,
  NodeInitStatus,
  K8sJoinStatus,
  isNodeReady,
  isNodeError,
  findNodeByIP,
  findRegionByAddress,
  testConnection,
  getScanResourcesStatus,
} from "./nodes";

import {
  listPools,
  getPool,
  createPool,
  updatePool,
  deletePool,
  getPoolUtilization,
  hasAvailableCapacity,
  formatPoolCapacity,
  addGPUToPool,
  getGpuaasIdForRegion,
  getUnassignedClusterGPUs,
  getAvailableGPUs,
  getAllPoolGPUs,
  getPoolGPUs,
  removeGPUsFromPool,
  listPoolsForCluster,
  deletePoolById,
  getPoolCapacityMap,
  getPoolSubscribedTeams,
  getPoolOccupancyMap,
} from "./pools";

/**
 * GPUaaS Admin API namespace
 *
 * All functions for managing GPU infrastructure.
 */
export const gpuaasAdmin = {
  // Regions
  listRegions,
  getRegion,
  createRegion,
  updateRegion,
  deleteRegion,

  // Clusters
  listClusters,
  getCluster,
  getClusterByRegion,
  deleteCluster,
  isGPUaaSEnabled,
  getClusterStatusLabel,

  // Nodes
  listNodes,
  getNode,
  addNode,
  getNodeSSHKeys,
  initializeNode,
  enableGPUaaS,
  joinNode,
  scanGPUs,
  scanNodeResources,
  deleteNode,
  deinitNode,
  NodeInitStatus,
  K8sJoinStatus,
  isNodeReady,
  isNodeError,
  findNodeByIP,
  findRegionByAddress,
  testConnection,
  getScanResourcesStatus,

  // Pools
  listPools,
  getPool,
  createPool,
  updatePool,
  deletePool,
  getPoolUtilization,
  hasAvailableCapacity,
  formatPoolCapacity,
  addGPUToPool,
  getGpuaasIdForRegion,
  getUnassignedClusterGPUs,
  getAvailableGPUs,
  getAllPoolGPUs,
  getPoolGPUs,
  removeGPUsFromPool,
  listPoolsForCluster,
  deletePoolById,
  getPoolCapacityMap,
  getPoolSubscribedTeams,
  getPoolOccupancyMap,
} as const;

// Also export individual functions for direct imports
export {
  // Regions
  listRegions,
  getRegion,
  createRegion,
  updateRegion,
  deleteRegion,
  listClusters,
  getCluster,
  getClusterByRegion,
  deleteCluster,
  isGPUaaSEnabled,
  getClusterStatusLabel,
  // Nodes
  listNodes,
  getNode,
  addNode,
  getNodeSSHKeys,
  initializeNode,
  enableGPUaaS,
  joinNode,
  scanGPUs,
  scanNodeResources,
  deleteNode,
  deinitNode,
  NodeInitStatus,
  K8sJoinStatus,
  isNodeReady,
  isNodeError,
  findNodeByIP,
  findRegionByAddress,
  testConnection,
  getScanResourcesStatus,
  // Pools
  listPools,
  getPool,
  createPool,
  updatePool,
  deletePool,
  getPoolUtilization,
  hasAvailableCapacity,
  formatPoolCapacity,
  addGPUToPool,
  getGpuaasIdForRegion,
  getUnassignedClusterGPUs,
  getAvailableGPUs,
  getAllPoolGPUs,
  getPoolGPUs,
  removeGPUsFromPool,
  listPoolsForCluster,
  deletePoolById,
  getPoolCapacityMap,
  getPoolSubscribedTeams,
  getPoolOccupancyMap,
};
