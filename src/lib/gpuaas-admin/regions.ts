/**
 * GPUaaS Admin Region Management
 *
 * Functions for managing regions and GPUaaS clusters.
 */

import { gpuaasAdminRequest } from "./client";
import type { Region, CreateRegionInput, GPUaaSCluster } from "./types";

/**
 * List all regions
 *
 * Note: The API returns regions as a direct array, not wrapped in { items: [...] }
 */
export async function listRegions(): Promise<Region[]> {
  const response = await gpuaasAdminRequest<Region[]>("GET", "/regions");
  // Handle both array response and potential { items: [...] } wrapper
  if (Array.isArray(response)) {
    return response;
  }
  // Fallback for potential wrapped response
  return (response as unknown as { items?: Region[] })?.items || [];
}

/**
 * Get a specific region by ID
 *
 * Note: The API wraps the response in { region: {...} } so we extract it
 */
export async function getRegion(regionId: number): Promise<Region> {
  const response = await gpuaasAdminRequest<Region | { region: Region }>(
    "GET",
    `/regions/${regionId}`
  );
  // Handle wrapped response { region: {...} }
  if (response && typeof response === "object" && "region" in response) {
    return response.region;
  }
  return response as Region;
}

/**
 * Helper function to wait a specified time
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a new region
 *
 * Region names must be max 12 characters, alphanumeric and hyphens only.
 * For HK/SG cities, country and country_code are auto-detected.
 *
 * Note: The API returns only { message: "Region created successfully" }
 * so we fetch the region list afterward to get the full region object with ID.
 * Due to API timing issues, we retry the lookup a few times.
 */
export async function createRegion(input: CreateRegionInput): Promise<Region> {
  // Create the region (API doesn't return the created region)
  await gpuaasAdminRequest<{ message: string }>("POST", "/regions", {
    region_name: input.region_name,
    address: input.address,
    city: input.city,
    country: input.country,
    country_code: input.country_code,
    zipcode: input.zipcode,
    lat: input.lat,
    lng: input.lng,
    accelerator_type: input.accelerator_type,
    support_rdma: input.support_rdma,
  });

  // Retry fetching the region list with delays (API may have replication lag)
  const maxRetries = 5;
  const retryDelayMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Wait before fetching (give the API time to propagate)
    await sleep(retryDelayMs);

    const regions = await listRegions();
    const createdRegion = regions.find(
      (r) => r.region_name === input.region_name
    );

    if (createdRegion) {
      return createdRegion;
    }

    console.log(
      `[GPUaaS Admin] Region ${input.region_name} not found in list, attempt ${attempt}/${maxRetries}`
    );
  }

  throw new Error(
    `Region was created but could not be found by name after ${maxRetries} attempts: ${input.region_name}`
  );
}

/**
 * Update a region
 */
export async function updateRegion(
  regionId: number,
  input: Partial<CreateRegionInput>
): Promise<Region> {
  return gpuaasAdminRequest<Region>("PUT", `/regions/${regionId}`, input);
}

/**
 * Delete a region
 *
 * Only possible if no nodes or clusters are associated.
 *
 * IMPORTANT: The API returns empty response for both success and failure!
 * This function verifies deletion by checking if region still exists afterward.
 *
 * @param regionId - The ID of the region to delete
 * @throws Error if region still exists after delete attempt
 */
export async function deleteRegion(
  regionId: number
): Promise<{ success: boolean }> {
  // Make the delete request
  await gpuaasAdminRequest<{ success: boolean }>("DELETE", `/regions/${regionId}`);

  // Wait a moment for the deletion to propagate
  await sleep(1000);

  // Verify the region was actually deleted
  try {
    const region = await getRegion(regionId);
    if (region && region.id) {
      // Region still exists - deletion failed silently
      throw new Error(
        `Region ${regionId} still exists after delete attempt. ` +
          `It may still have associated nodes or clusters. ` +
          `Delete those first before deleting the region.`
      );
    }
  } catch (error) {
    // If getRegion throws "not found" error, the deletion was successful
    if (error instanceof Error && error.message.includes("not found")) {
      console.log(`[GPUaaS Admin] Region ${regionId} successfully deleted (verified)`);
      return { success: true };
    }
    // Re-throw other errors (including "still exists" error)
    throw error;
  }

  return { success: true };
}

/**
 * List all GPUaaS clusters
 *
 * Note: The API returns clusters as a direct array, not wrapped in { items: [...] }
 */
export async function listClusters(): Promise<GPUaaSCluster[]> {
  const response = await gpuaasAdminRequest<GPUaaSCluster[]>("GET", "/gpuaas");
  // Handle both array response and potential { items: [...] } wrapper
  if (Array.isArray(response)) {
    return response;
  }
  // Fallback for potential wrapped response
  return (response as unknown as { items?: GPUaaSCluster[] })?.items || [];
}

/**
 * Get a specific GPUaaS cluster by ID
 */
export async function getCluster(gpuaasId: number): Promise<GPUaaSCluster> {
  return gpuaasAdminRequest<GPUaaSCluster>("GET", `/gpuaas/${gpuaasId}`);
}

/**
 * Get the GPUaaS cluster for a region
 *
 * Returns null if no cluster exists for the region.
 */
export async function getClusterByRegion(
  regionId: number
): Promise<GPUaaSCluster | null> {
  const clusters = await listClusters();
  return clusters.find((c) => c.region_id === regionId) || null;
}

/**
 * Delete a GPUaaS cluster
 *
 * Removes a GPUaaS cluster from the admin console.
 * The cluster must have no active nodes before deletion.
 *
 * IMPORTANT: The API returns empty response for both success and failure!
 * This function verifies deletion by checking if cluster still exists afterward.
 *
 * @param clusterId - The ID of the cluster to delete
 * @throws Error if cluster still exists after delete attempt
 */
export async function deleteCluster(
  clusterId: number
): Promise<{ success: boolean }> {
  // Make the delete request
  await gpuaasAdminRequest<{ success: boolean }>("DELETE", `/gpuaas/${clusterId}`);

  // Wait a moment for the deletion to propagate
  await sleep(1000);

  // Verify the cluster was actually deleted
  try {
    const cluster = await getCluster(clusterId);
    if (cluster && cluster.id) {
      // Cluster still exists - deletion failed silently
      throw new Error(
        `Cluster ${clusterId} still exists after delete attempt. ` +
          `Status: ${cluster.status}. ` +
          `The cluster may still have associated nodes. Delete nodes first.`
      );
    }
  } catch (error) {
    // If getCluster throws "not found" error, the deletion was successful
    if (error instanceof Error && error.message.includes("not found")) {
      console.log(`[GPUaaS Admin] Cluster ${clusterId} successfully deleted (verified)`);
      return { success: true };
    }
    // Re-throw other errors (including "still exists" error)
    throw error;
  }

  return { success: true };
}

/**
 * Check if a region has GPUaaS enabled
 */
export function isGPUaaSEnabled(region: Region): boolean {
  return region.status.gpuaas === "enabled";
}

/**
 * Get cluster status label
 */
export function getClusterStatusLabel(
  status: GPUaaSCluster["status"]
): string {
  switch (status) {
    case "GPUAAS_ACTIVE":
      return "Active";
    case "GPUAAS_INACTIVE":
      return "Inactive";
    case "GPUAAS_INITIALIZING":
      return "Initializing";
    default:
      return "Unknown";
  }
}
