/**
 * GPUaaS Admin Pool Management
 *
 * Functions for managing GPU pools in the GPUaaS infrastructure.
 */

import { gpuaasAdminRequest } from "./client";
import type { GPUaaSPool, CreatePoolInput, AddGPUToPoolInput, PoolGPU } from "./types";

/**
 * List all pools for a GPUaaS cluster
 *
 * Note: The correct endpoint is /gpuaas/{clusterId}/pool/list, not /gpuaas/pool?gpuaas_id=
 * The API returns a direct array, not wrapped in { items: [...] }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePool(raw: any): GPUaaSPool {
  return {
    ...raw,
    // API returns pool_name, we use name
    name: raw.name || raw.pool_name || "",
    // API returns sharing_ratio, we use overcommit_ratio
    overcommit_ratio: raw.overcommit_ratio ?? raw.sharing_ratio ?? 1,
    // API returns gpuaas_id for cluster, we use region_id
    region_id: raw.region_id ?? raw.gpuaas_id ?? 0,
    // API may omit these on list endpoint
    total_gpus: raw.total_gpus ?? 0,
    available_gpus: raw.available_gpus ?? 0,
    allocated_gpus: raw.allocated_gpus ?? 0,
    security_mode: raw.security_mode || raw.security_level || null,
  };
}

export async function listPools(gpuaasId: number): Promise<GPUaaSPool[]> {
  const response = await gpuaasAdminRequest<GPUaaSPool[] | { items: GPUaaSPool[] } | null>(
    "GET",
    `/gpuaas/${gpuaasId}/pool/list`
  );
  // Handle null/undefined responses
  if (!response) {
    return [];
  }
  // Handle both direct array and { items: [...] } wrapper
  const items = Array.isArray(response) ? response : (response.items || []);
  return items.map(normalizePool);
}

/**
 * Get a specific pool by ID
 */
export async function getPool(poolId: number): Promise<GPUaaSPool> {
  const raw = await gpuaasAdminRequest<GPUaaSPool>("GET", `/gpuaas/pool/${poolId}`);
  return normalizePool(raw);
}

/**
 * Create a new GPU pool
 *
 * Pools are used to allocate GPUs to customers.
 * The sharing_ratio allows virtual GPU sharing (1.0-10.0).
 * team_name can be used to restrict pool access.
 * security_level sets the security level (low, medium, high).
 *
 * Note: Uses /gpuaas/pool/create endpoint with nested 'pool' object.
 * The API expects:
 * - gpuaas_id: cluster ID at root level
 * - pool: nested object with pool_name, sharing_ratio, time_quantum_in_sec, attach_gpu_ids, security_level
 * - attach_gpu_ids: array of GPU UUID strings (e.g., "GPU-72883924-9789-83a9-2a01-64d351042646")
 */
export async function createPool(input: CreatePoolInput): Promise<GPUaaSPool> {
  // The API requires a nested 'pool' object with specific field names
  // IMPORTANT: time_quantum_in_sec must be 90 (not 3600) - the API rejects larger values!
  return gpuaasAdminRequest<GPUaaSPool>("POST", "/gpuaas/pool/create", {
    gpuaas_id: input.gpuaas_id,
    pool: {
      pool_name: input.name,
      sharing_ratio: input.overcommit_ratio || 1.0,
      time_quantum_in_sec: input.time_quantum_in_sec || 90, // MUST be 90, API rejects 3600
      attach_gpu_ids: input.attach_gpu_ids || [],
      security_level: input.security_mode || "low",
    },
  });
}

/**
 * Update a pool
 */
export async function updatePool(
  poolId: number,
  input: Partial<CreatePoolInput>
): Promise<GPUaaSPool> {
  return gpuaasAdminRequest<GPUaaSPool>("PUT", `/gpuaas/pool/${poolId}`, input);
}

/**
 * Delete a pool
 *
 * Only possible if no active subscriptions exist.
 */
export async function deletePool(
  poolId: number
): Promise<{ success: boolean }> {
  return gpuaasAdminRequest<{ success: boolean }>(
    "DELETE",
    `/gpuaas/pool/${poolId}`
  );
}

/**
 * Add a GPU to a pool
 *
 * Associates a GPU from a node with a pool.
 * The GPU will become available for allocation to customers.
 */
export async function addGPUToPool(input: AddGPUToPoolInput): Promise<PoolGPU> {
  return gpuaasAdminRequest<PoolGPU>("POST", "/gpuaas/pool/gpu", {
    pool_id: input.pool_id,
    gpuaas_node_id: input.gpuaas_node_id,
    gpu_index: input.gpu_index,
  });
}

/**
 * List GPUs in a pool
 */
export async function listPoolGPUs(poolId: number): Promise<PoolGPU[]> {
  const response = await gpuaasAdminRequest<{ items: PoolGPU[] }>(
    "GET",
    `/gpuaas/pool/${poolId}/gpus`
  );
  return response.items || [];
}

/**
 * Remove a GPU from a pool
 */
export async function removeGPUFromPool(
  poolId: number,
  gpuId: number
): Promise<{ success: boolean }> {
  return gpuaasAdminRequest<{ success: boolean }>(
    "DELETE",
    `/gpuaas/pool/${poolId}/gpu/${gpuId}`
  );
}

/**
 * Get pool utilization percentage
 */
export function getPoolUtilization(pool: GPUaaSPool): number {
  if (pool.total_gpus === 0) return 0;
  return Math.round((pool.allocated_gpus / pool.total_gpus) * 100);
}

/**
 * Check if a pool has available capacity
 */
export function hasAvailableCapacity(pool: GPUaaSPool): boolean {
  return pool.available_gpus > 0;
}

/**
 * Format pool capacity string
 */
export function formatPoolCapacity(pool: GPUaaSPool): string {
  return `${pool.allocated_gpus}/${pool.total_gpus} GPUs (${pool.available_gpus} available)`;
}

/**
 * Get GPUaaS cluster ID for a region
 * @deprecated Use gpuaasAdmin.getClusterByRegion instead
 */
export async function getGpuaasIdForRegion(
  regionId: number
): Promise<number | null> {
  // This function is deprecated - use getClusterByRegion from regions.ts
  console.warn("getGpuaasIdForRegion is deprecated - use gpuaasAdmin.getClusterByRegion");
  return null;
}

/**
 * Get unassigned GPUs from a cluster
 * Returns GPUs that are not yet assigned to any pool
 * @deprecated Use getAvailableGPUs instead which uses the correct API endpoint
 */
export async function getUnassignedClusterGPUs(
  clusterId: number
): Promise<Array<{ uuid: string; name: string; node_id: number }>> {
  try {
    const response = await gpuaasAdminRequest<{
      items: Array<{
        uuid: string;
        gpu_model: string;
        gpuaas_node_id: number;
        assignment_status: string;
      }>;
    }>("GET", `/gpuaas/${clusterId}/gpus`);

    return (response.items || [])
      .filter((gpu) => gpu.assignment_status === "unassigned" || !gpu.assignment_status)
      .map((gpu) => ({
        uuid: gpu.uuid,
        name: gpu.gpu_model,
        node_id: gpu.gpuaas_node_id,
      }));
  } catch (error) {
    console.warn("Failed to get unassigned GPUs:", error);
    return [];
  }
}

/**
 * Available GPU response from the API
 */
export interface AvailableGPU {
  id: number;
  uuid: string;
  vendor: string;
  gpu_model: string;
  memory_in_mb: number;
  gpuaas_node_id: number;
  assignment_status: "unassigned" | "assigned" | string;
}

/**
 * Get available GPUs for a cluster that can be attached to a pool
 *
 * This is the correct endpoint to use before creating a pool.
 * Returns GPUs that are detected on nodes and ready for assignment.
 *
 * @param gpuaasId - The GPUaaS cluster ID
 * @returns Array of available GPUs with their UUIDs
 */
export async function getAvailableGPUs(
  gpuaasId: number
): Promise<AvailableGPU[]> {
  const response = await gpuaasAdminRequest<{ items: AvailableGPU[] }>(
    "GET",
    `/gpuaas/${gpuaasId}/pool/available_gpus`
  );
  return response.items || [];
}

/**
 * GPU in a pool (from all_gpus endpoint)
 */
export interface ClusterPoolGPU {
  id: number;
  uuid: string;
  vendor: string;
  gpu_model: string;
  memory_in_mb: number;
  gpuaas_node_id: number;
  pool_id: number;
  pool_name?: string;
  assignment_status: "assigned" | "unassigned" | string;
}

/**
 * Raw GPU response from the all_gpus endpoint (nested structure)
 */
interface RawPoolGPU {
  id: number;
  uuid: string;
  vendor: string;
  gpu_model: string;
  memory_in_mb?: number;
  assignment_status: string;
  node_details?: { id: number; name: string };
  pool_details?: { id: number; name: string };
  // Legacy flat fields (some endpoints return these)
  gpuaas_node_id?: number;
  pool_id?: number;
  pool_name?: string;
}

/**
 * Get all GPUs across all pools in a cluster
 *
 * Correct API endpoint: GET /gpuaas/{clusterId}/pool/all_gpus
 * This returns all GPUs that have been assigned to any pool in the cluster.
 *
 * Note: The API may return nested node_details/pool_details or flat gpuaas_node_id/pool_id
 * depending on the endpoint version. This function normalizes both formats.
 *
 * @param clusterId - The GPUaaS cluster ID
 * @returns Array of all GPUs with their pool assignments (normalized)
 */
export async function getAllPoolGPUs(clusterId: number): Promise<ClusterPoolGPU[]> {
  const response = await gpuaasAdminRequest<RawPoolGPU[] | { items: RawPoolGPU[] } | null>(
    "GET",
    `/gpuaas/${clusterId}/pool/all_gpus`
  );

  // Handle null/undefined responses
  if (!response) {
    return [];
  }

  // Handle both direct array and { items: [...] } wrapper
  const rawGpus = Array.isArray(response) ? response : (response.items || []);

  // Normalize the response to flatten nested node_details/pool_details
  return rawGpus.map((gpu) => ({
    id: gpu.id,
    uuid: gpu.uuid,
    vendor: gpu.vendor,
    gpu_model: gpu.gpu_model,
    memory_in_mb: gpu.memory_in_mb || 0,
    gpuaas_node_id: gpu.node_details?.id || gpu.gpuaas_node_id || 0,
    pool_id: gpu.pool_details?.id || gpu.pool_id || 0,
    pool_name: gpu.pool_details?.name || gpu.pool_name,
    assignment_status: gpu.assignment_status?.toLowerCase() || "unknown",
  }));
}

/**
 * Get GPUs assigned to a specific pool
 *
 * API endpoint: GET /gpuaas/pool/{poolId}/gpus
 *
 * @param poolId - The pool ID
 * @returns Array of GPUs in this pool
 */
export async function getPoolGPUs(poolId: number): Promise<ClusterPoolGPU[]> {
  const response = await gpuaasAdminRequest<{ items: ClusterPoolGPU[] }>(
    "GET",
    `/gpuaas/pool/${poolId}/gpus`
  );
  return response.items || [];
}

/**
 * Remove GPUs from a pool
 *
 * Correct API endpoint: GET /gpuaas/pool/{poolId}/remove_gpus?gpu_uuids=UUID1,UUID2,...
 * This unassigns GPUs from a pool before the pool can be deleted.
 *
 * @param poolId - The pool ID to remove GPUs from
 * @param gpuUuids - Array of GPU UUIDs to remove (e.g., ["GPU-72883924-9789-83a9-2a01-64d351042646"])
 * @returns Success status
 */
export async function removeGPUsFromPool(
  poolId: number,
  gpuUuids: string[]
): Promise<{ success: boolean }> {
  if (gpuUuids.length === 0) {
    return { success: true }; // Nothing to remove
  }
  const uuidParam = gpuUuids.join(",");
  return gpuaasAdminRequest<{ success: boolean }>(
    "GET",
    `/gpuaas/pool/${poolId}/remove_gpus?gpu_uuids=${encodeURIComponent(uuidParam)}`
  );
}

/**
 * List all pools for a cluster
 *
 * Correct API endpoint: GET /gpuaas/{clusterId}/pool/list
 *
 * @param clusterId - The GPUaaS cluster ID
 * @returns Array of pools in the cluster
 */
export async function listPoolsForCluster(clusterId: number): Promise<GPUaaSPool[]> {
  const response = await gpuaasAdminRequest<{ items: GPUaaSPool[] } | null>(
    "GET",
    `/gpuaas/${clusterId}/pool/list`
  );
  // Handle null/undefined responses
  if (!response) {
    return [];
  }
  return (response.items || []).map(normalizePool);
}

/**
 * Pool capacity info from the admin pool list endpoint.
 * Includes sharing_ratio and GPU count so we can calculate total vGPU slots.
 */
export interface PoolCapacityInfo {
  poolId: number;
  poolName: string;
  gpuaasId: number;
  gpuCount: number;
  sharingRatio: number;
  totalVgpuSlots: number; // gpuCount × sharingRatio
  status: string;
  gpuModel: string;
}

/**
 * Raw pool detail from admin API /gpuaas/{clusterId}/pool/list
 * This is the actual shape returned by the API (differs from GPUaaSPool type).
 */
interface AdminPoolDetail {
  id: number;
  gpuaas_id: number;
  pool_name: string;
  sharing_ratio: number;
  time_quantum_in_sec: number;
  status: string;
  gpu_model_type?: string;
  gpu_vendor_type?: string;
  security_level?: string;
  gpus?: Array<{
    id: number;
    gpu_id: string;
    uuid: string;
    vendor: string;
    gpu_model: string;
    assignment_status: string;
  }>;
}

/**
 * Get capacity info for all pools across specified clusters.
 * Returns total vGPU slots per pool (GPU count × sharing ratio).
 *
 * @param clusterIds - Array of GPUaaS cluster IDs to query
 * @returns Map of poolId → PoolCapacityInfo
 */
export async function getPoolCapacityMap(
  clusterIds: number[]
): Promise<Map<number, PoolCapacityInfo>> {
  const capacityMap = new Map<number, PoolCapacityInfo>();

  await Promise.all(
    clusterIds.map(async (clusterId) => {
      try {
        const pools = await gpuaasAdminRequest<AdminPoolDetail[] | { items: AdminPoolDetail[] } | null>(
          "GET",
          `/gpuaas/${clusterId}/pool/list`
        );

        const poolList = !pools ? [] : Array.isArray(pools) ? pools : (pools.items || []);

        for (const pool of poolList) {
          // pool.gpus contains vGPU entries (one per virtual GPU slot), not physical GPUs
          // Physical GPUs = entries / sharing_ratio
          const vgpuEntries = pool.gpus?.length || 0;
          const sharingRatio = pool.sharing_ratio || 1;
          const physicalGpuCount = Math.round(vgpuEntries / sharingRatio);
          capacityMap.set(pool.id, {
            poolId: pool.id,
            poolName: pool.pool_name,
            gpuaasId: pool.gpuaas_id,
            gpuCount: physicalGpuCount,
            sharingRatio,
            totalVgpuSlots: vgpuEntries,
            status: pool.status,
            gpuModel: pool.gpu_model_type || "",
          });
        }
      } catch (error) {
        console.warn(`[getPoolCapacityMap] Failed for cluster ${clusterId}:`, error);
      }
    })
  );

  return capacityMap;
}

/**
 * Subscribed team info returned by the admin API
 */
export interface PoolSubscribedTeam {
  team_id: string;
  team_name: string;
  total_ram_mb: number;
  total_tflops: number;
  status: string;
}

/**
 * Get subscribed teams for a specific pool
 *
 * API endpoint: GET /gpuaas/pool/{poolId}/subscribed_teams?sort_least_consumed=1&from_time_seconds=0&page=0&limit=100
 *
 * Returns all teams currently subscribed to this pool with their resource usage.
 * This is the authoritative source for how many subscribers (vGPU slots) a pool has.
 *
 * @param poolId - The pool ID
 * @param limit - Max results per page (default 100)
 * @returns Array of subscribed teams and total count
 */
export async function getPoolSubscribedTeams(
  poolId: number,
  limit = 100
): Promise<{ data: PoolSubscribedTeam[]; total: number }> {
  const response = await gpuaasAdminRequest<{
    data: PoolSubscribedTeam[];
    total: number;
    page: number;
    limit: number;
  }>(
    "GET",
    `/gpuaas/pool/${poolId}/subscribed_teams?sort_least_consumed=1&from_time_seconds=0&page=0&limit=${limit}`
  );
  return { data: response.data || [], total: response.total || 0 };
}

/**
 * Get subscriber counts for all pools across specified clusters.
 * Queries each pool's subscribed_teams endpoint to get the real occupancy.
 *
 * @param poolIds - Array of pool IDs to query
 * @returns Map of poolId → subscriber count (occupied vGPU slots)
 */
export async function getPoolOccupancyMap(
  poolIds: number[]
): Promise<Map<number, number>> {
  const occupancyMap = new Map<number, number>();

  await Promise.all(
    poolIds.map(async (poolId) => {
      try {
        const result = await getPoolSubscribedTeams(poolId);
        occupancyMap.set(poolId, result.total);
      } catch (error) {
        console.warn(`[getPoolOccupancyMap] Failed for pool ${poolId}:`, error);
      }
    })
  );

  return occupancyMap;
}

/**
 * Delete a pool by ID
 *
 * Correct API endpoint: DELETE /gpuaas/pool/{poolId}/delete
 * IMPORTANT: All GPUs must be removed from the pool first using removeGPUsFromPool()
 *
 * @param poolId - The pool ID to delete
 * @returns Success status
 */
export async function deletePoolById(poolId: number): Promise<{ success: boolean }> {
  return gpuaasAdminRequest<{ success: boolean }>(
    "DELETE",
    `/gpuaas/pool/${poolId}/delete`
  );
}
