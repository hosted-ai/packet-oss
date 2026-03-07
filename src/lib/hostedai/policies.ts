/**
 * Resource policy management functions for hosted.ai
 *
 * Resource policies control which regions/pools teams can access.
 * When a new provider region is created, it must be added to the
 * default resource policy for customers to be able to subscribe.
 */

import { hostedaiRequest } from "./client";
import { DEFAULT_POLICIES } from "./types";

export interface ResourcePolicyRegion {
  region_id: number;
  region_name: string;
  access: "unlimited" | "limited" | "none";
  region_details?: {
    id: number;
    region_name: string;
    address: string;
    city: string;
    country: string;
    country_code: string;
  };
  allotted_rgs?: Array<{
    id: number;
    name: string;
    access: string;
  }>;
}

export interface ResourcePolicy {
  id: string;
  name: string;
  is_system_defined: boolean;
  is_default: boolean;
  globals: unknown[];
  regions: ResourcePolicyRegion[];
  teams: Array<{
    id: string;
    name: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface UpdateResourcePolicyInput {
  name: string;
  regions: Array<{
    region_id: number;
    access: "unlimited" | "limited" | "none";
  }>;
  teams?: string[];
}

/**
 * Get a resource policy by ID
 */
export async function getResourcePolicy(policyId: string): Promise<ResourcePolicy> {
  return hostedaiRequest<ResourcePolicy>("GET", `/resource-policy/${policyId}`);
}

/**
 * Get the default resource policy used for customer teams
 */
export async function getDefaultResourcePolicy(): Promise<ResourcePolicy> {
  return getResourcePolicy(DEFAULT_POLICIES.resource);
}

/**
 * Update a resource policy
 *
 * Note: The API requires the name field to be included
 */
export async function updateResourcePolicy(
  policyId: string,
  input: UpdateResourcePolicyInput
): Promise<void> {
  await hostedaiRequest("PUT", `/resource-policy/${policyId}`, input as unknown as Record<string, unknown>);
}

/**
 * Add a region to a resource policy
 *
 * This is a convenience function that:
 * 1. Gets the current policy
 * 2. Adds the new region if not already present
 * 3. Preserves existing teams
 * 4. Updates the policy
 */
export async function addRegionToResourcePolicy(
  policyId: string,
  regionId: number,
  teamIds?: string[]
): Promise<boolean> {
  // Get current policy
  const policy = await getResourcePolicy(policyId);

  // Check if region already exists
  const existingRegions = policy.regions.map((r) => r.region_details?.id || 0);
  const regionExists = existingRegions.includes(regionId);

  if (regionExists && (!teamIds || teamIds.length === 0)) {
    console.log(`[ResourcePolicy] Region ${regionId} already in policy ${policyId}`);
    return false; // Already exists and no teams to add
  }

  // Build updated regions
  const updatedRegions = regionExists
    ? policy.regions.map((r) => ({
        region_id: r.region_details?.id || 0,
        access: r.access,
      }))
    : [
        ...policy.regions.map((r) => ({
          region_id: r.region_details?.id || 0,
          access: r.access,
        })),
        { region_id: regionId, access: "unlimited" as const },
      ];

  // Combine existing teams with new teams (deduplicated)
  const existingTeamIds = (policy.teams || []).map((t) => t.id);
  const allTeamIds = [...new Set([...existingTeamIds, ...(teamIds || [])])];

  // Update policy with regions and teams
  await updateResourcePolicy(policyId, {
    name: policy.name,
    regions: updatedRegions,
    teams: allTeamIds.length > 0 ? allTeamIds : undefined,
  });

  if (!regionExists) {
    console.log(`[ResourcePolicy] Added region ${regionId} to policy ${policyId}`);
  }
  if (teamIds && teamIds.length > 0) {
    console.log(`[ResourcePolicy] Updated teams in policy ${policyId}: ${allTeamIds.length} teams`);
  }
  return !regionExists; // True if region was added
}

/**
 * Add a region to the default resource policy
 *
 * This should be called after creating a new provider pool
 * to ensure customers can access it.
 *
 * @param regionId - The region ID to add
 * @param teamIds - Optional array of team IDs to ensure are included in the policy
 */
export async function addRegionToDefaultPolicy(
  regionId: number,
  teamIds?: string[]
): Promise<boolean> {
  return addRegionToResourcePolicy(DEFAULT_POLICIES.resource, regionId, teamIds);
}

/**
 * Sync all provided team IDs to the default resource policy
 *
 * This ensures all teams can access the policy's regions.
 * Used when provisioning new servers or fixing access issues.
 */
export async function syncTeamsToDefaultPolicy(teamIds: string[]): Promise<void> {
  const policy = await getResourcePolicy(DEFAULT_POLICIES.resource);

  // Combine existing teams with new teams (deduplicated)
  const existingTeamIds = (policy.teams || []).map((t) => t.id);
  const allTeamIds = [...new Set([...existingTeamIds, ...teamIds])];

  // Update policy with teams
  await updateResourcePolicy(DEFAULT_POLICIES.resource, {
    name: policy.name,
    regions: policy.regions.map((r) => ({
      region_id: r.region_details?.id || 0,
      access: r.access,
    })),
    teams: allTeamIds,
  });

  console.log(`[ResourcePolicy] Synced ${allTeamIds.length} teams to default policy`);
}
