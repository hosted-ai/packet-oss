/**
 * Resource policy management functions for hosted.ai
 *
 * Resource policies control which regions/pools teams can access.
 * When a new provider region is created, it must be added to the
 * default resource policy for customers to be able to subscribe.
 */

import { hostedaiRequest } from "./client";
import { getDefaultPoliciesSync } from "./default-policies";

// Helper to get DEFAULT_POLICIES synchronously
const DEFAULT_POLICIES = new Proxy({} as { resource: string }, {
  get(_target, prop: string) {
    const policies = getDefaultPoliciesSync();
    return policies[prop as keyof typeof policies];
  }
});

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
 * Assign a single team to a resource policy via hosted.ai's dedicated team
 * endpoint (`POST /resource-policy/assign-team`).
 *
 * Unlike a whole-policy PUT, this touches only the team↔policy link — it never
 * rewrites the policy's regions or resource groups, so it cannot strip
 * `allotted_rgs` from a region or trip hosted.ai's "restricted region requires
 * resource groups" validation. That lossy whole-policy round-trip is what
 * corrupted the default policy on every team creation (PA-272).
 *
 * hosted.ai returns 400 "Team is already linked to this resource policy" when
 * the team is already assigned; that's a no-op for us, so we swallow it to keep
 * the call idempotent.
 */
async function assignTeamToPolicy(policyId: string, teamId: string): Promise<void> {
  try {
    await hostedaiRequest("POST", "/resource-policy/assign-team", {
      policy_id: policyId,
      team_id: teamId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already linked/i.test(message)) {
      return; // Team is already on the policy — nothing to do.
    }
    throw err;
  }
}

/**
 * Add a region to a resource policy, and/or ensure teams are assigned to it.
 *
 * A new region genuinely requires a whole-policy PUT (hosted.ai has no
 * incremental "add region" endpoint), so that path is kept. Team membership,
 * however, is applied through the dedicated `assign-team` endpoint rather than
 * folded into the PUT — a policy PUT rebuilt from our lossy read model strips
 * resource groups and wipes restricted-region config (PA-272).
 */
export async function addRegionToResourcePolicy(
  policyId: string,
  regionId: number,
  teamIds?: string[]
): Promise<boolean> {
  // Read-only: needed to tell whether the region is already present.
  const policy = await getResourcePolicy(policyId);

  const existingRegions = policy.regions.map((r) => r.region_details?.id || 0);
  const regionExists = existingRegions.includes(regionId);

  // Add the region only when it's genuinely new — team membership no longer
  // rides along on this PUT (see assignTeamToPolicy below).
  if (!regionExists) {
    // ponytail: this whole-policy PUT still reconstructs regions from our lossy
    // read model (ResourcePolicyRegion), so it drops allotted_rgs / baremetal
    // limits from existing regions and will 400 on a policy with a restricted
    // region. Only genuine new-region provisioning hits this path (rare), not
    // team-sync. A faithful round-trip needs the read model to capture the
    // asymmetric write shape (resource_groups/baremetal_limits) plus the linked
    // hosted.ai atomic-edit fix; deferred to a follow-up.
    await updateResourcePolicy(policyId, {
      name: policy.name,
      regions: [
        ...policy.regions.map((r) => ({
          region_id: r.region_details?.id || 0,
          access: r.access,
        })),
        { region_id: regionId, access: "unlimited" as const },
      ],
    });
    console.log(`[ResourcePolicy] Added region ${regionId} to policy ${policyId}`);
  } else if (!teamIds || teamIds.length === 0) {
    console.log(`[ResourcePolicy] Region ${regionId} already in policy ${policyId}`);
  }

  // Ensure teams are assigned via the non-lossy endpoint.
  if (teamIds && teamIds.length > 0) {
    for (const teamId of teamIds) {
      await assignTeamToPolicy(policyId, teamId);
    }
    console.log(`[ResourcePolicy] Assigned ${teamIds.length} team(s) to policy ${policyId}`);
  }

  return !regionExists; // True if a new region was added
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
 * Sync all provided team IDs to the default resource policy.
 *
 * Ensures each team can access the default policy's regions. Uses hosted.ai's
 * dedicated assign-team endpoint (idempotent, additive), so team membership
 * never rewrites the policy's regions or resource groups (PA-272) — previously
 * this did a lossy whole-policy GET→PUT that wiped restricted-region config on
 * every team creation.
 */
export async function syncTeamsToDefaultPolicy(teamIds: string[]): Promise<void> {
  const policyId = DEFAULT_POLICIES.resource;
  for (const teamId of teamIds) {
    await assignTeamToPolicy(policyId, teamId);
  }
  console.log(`[ResourcePolicy] Synced ${teamIds.length} team(s) to default policy`);
}
