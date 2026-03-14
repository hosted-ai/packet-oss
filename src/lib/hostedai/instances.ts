/**
 * Instance management functions for hosted.ai
 */

import { hostedaiRequest } from "./client";
import type {
  Instance,
  CreateInstanceParams,
  InstanceCredentials,
  InstanceType,
  Image,
  ImagePolicy,
  ImagePolicyObject,
  StorageBlock,
  VNCSession,
  ServiceScenario,
  CompatibleScenariosResponse,
} from "./types";

// Get compatible service scenarios for a team
export async function getCompatibleServiceScenarios(
  teamId: string
): Promise<CompatibleScenariosResponse> {
  return hostedaiRequest<CompatibleScenariosResponse>(
    "GET",
    `/compatible-service-scenarios?team_id=${teamId}`
  );
}

// Get available instance types for a service
export async function getInstanceTypes(
  serviceId: string,
  teamId: string
): Promise<InstanceType[]> {
  return hostedaiRequest<InstanceType[]>(
    "GET",
    `/service/i/instance-types?service_id=${serviceId}&team_id=${teamId}`
  );
}

// Get compatible images for a service
export async function getCompatibleImages(
  serviceId: string,
  teamId: string
): Promise<Image[]> {
  return hostedaiRequest<Image[]>(
    "GET",
    `/service/i/compatible-images?service_id=${serviceId}&team_id=${teamId}`
  );
}

// Get all image policies (for GPUaaS image selection)
export async function getImagePolicies(): Promise<ImagePolicy[]> {
  return hostedaiRequest<ImagePolicy[]>("GET", "/policy/image");
}

// Get images for a specific team from image policies
export async function getGPUaaSImages(teamId: string): Promise<ImagePolicyObject[]> {
  const policies = await getImagePolicies();

  // Find policies that include this team
  for (const policy of policies) {
    const hasTeam = policy.teams?.some(t => t.id === teamId);
    if (hasTeam && policy.objects && policy.objects.length > 0) {
      console.log(`Found images for team ${teamId} in policy ${policy.name}:`, policy.objects);
      return policy.objects;
    }
  }

  // Fall back to default GPUaaS Policy if no team-specific policy found
  const gpuaasPolicy = policies.find(p => p.name === "GPUaaS Policy");
  if (gpuaasPolicy?.objects) {
    console.log("Using default GPUaaS Policy images:", gpuaasPolicy.objects);
    return gpuaasPolicy.objects;
  }

  return [];
}

// Get available storage blocks
export async function getStorageBlocks(): Promise<StorageBlock[]> {
  return hostedaiRequest<StorageBlock[]>("GET", "/storage-blocks");
}

// Get instance details
export async function getInstance(instanceId: string): Promise<Instance> {
  return hostedaiRequest<Instance>("GET", `/instance/${instanceId}`);
}

// Create a new instance
export async function createInstance(
  params: CreateInstanceParams
): Promise<Instance> {
  return hostedaiRequest<Instance>("POST", "/service/i/create-instance", params as unknown as Record<string, unknown>);
}

// Start an instance
export async function startInstance(instanceId: string): Promise<void> {
  await hostedaiRequest("PUT", `/instance/${instanceId}/start`);
}

// Stop an instance
export async function stopInstance(instanceId: string): Promise<void> {
  await hostedaiRequest("PUT", `/instance/${instanceId}/stop`);
}

// Restart an instance
export async function restartInstance(instanceId: string): Promise<void> {
  await hostedaiRequest("PUT", `/instance/${instanceId}/restart`);
}

// Delete an instance
export async function deleteInstance(instanceId: string): Promise<void> {
  await hostedaiRequest("DELETE", `/instance/${instanceId}`);
}

// Get SSH credentials for an instance
export async function getInstanceCredentials(
  instanceId: string
): Promise<InstanceCredentials> {
  return hostedaiRequest<InstanceCredentials>(
    "GET",
    `/instance/${instanceId}/credentials`
  );
}

// Get GPUaaS compatible instances for a team (lists running instances)
export async function getTeamInstances(teamId: string): Promise<Instance[]> {
  return hostedaiRequest<Instance[]>(
    "GET",
    `/gpuaas/compatible-instances/${teamId}`,
    undefined,
    60000 // 60s timeout — teams with many GPUs can be slow
  );
}

// ============================================
// VNC Console Access
// ============================================

// Start VNC session for an instance
export async function startVNCSession(instanceId: string): Promise<VNCSession> {
  // VNC is only supported for traditional VM instances, not GPUaaS pods
  return hostedaiRequest<VNCSession>("POST", `/instance/${instanceId}/vnc`);
}

// Stop VNC session for an instance
export async function stopVNCSession(instanceId: string): Promise<void> {
  // VNC is only supported for traditional VM instances, not GPUaaS pods
  await hostedaiRequest("DELETE", `/instance/${instanceId}/vnc`);
}

// Rename an instance
export async function renameInstance(instanceId: string, newName: string): Promise<void> {
  await hostedaiRequest("PUT", `/instance/${instanceId}/rename`, { name: newName });
}

// Factory reset an instance
export async function factoryResetInstance(instanceId: string): Promise<void> {
  await hostedaiRequest("PUT", `/instance/${instanceId}/factory_reset`);
}

// ============================================
// Storage Management
// ============================================

export interface AddDiskParams {
  storage_block_id: string;
  disk_position?: number;
}

export interface AddDiskPricing {
  hourly_cost: number;
  monthly_cost: number;
  currency: string;
  storage_block: {
    id: string;
    name: string;
    size_gb: number;
  };
}

// Get pricing for adding a disk to an instance
export async function getAddDiskPricing(
  instanceId: string,
  storageBlockId: string
): Promise<AddDiskPricing> {
  return hostedaiRequest<AddDiskPricing>(
    "GET",
    `/instance/${instanceId}/add-disk/pricing?storage_block_id=${storageBlockId}`
  );
}

// Add disks to a traditional instance
export async function addDisksToInstance(
  instanceId: string,
  disks: AddDiskParams[]
): Promise<void> {
  await hostedaiRequest("POST", `/instance/${instanceId}/add-disks`, {
    disks,
  });
}
