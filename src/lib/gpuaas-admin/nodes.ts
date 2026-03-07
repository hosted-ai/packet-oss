/**
 * GPUaaS Admin Node Management
 *
 * Functions for managing GPU nodes in the GPUaaS infrastructure.
 * Handles node registration, initialization, SSH keys, and cluster joining.
 */

import { gpuaasAdminRequest } from "./client";
import type { GPUaaSNode, AddNodeInput } from "./types";

/**
 * List all nodes for a region
 *
 * The API endpoint is /gpuaas/node/list?region_id=X and returns a direct array.
 */
export async function listNodes(regionId: number): Promise<GPUaaSNode[]> {
  const response = await gpuaasAdminRequest<GPUaaSNode[] | null>(
    "GET",
    `/gpuaas/node/list?region_id=${regionId}`
  );
  if (!response) {
    return [];
  }
  if (Array.isArray(response)) {
    return response;
  }
  // Fallback: handle unexpected { items: [...] } wrapper
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (response as any).items;
  return Array.isArray(items) ? items : [];
}

/**
 * Get a specific node by ID
 */
export async function getNode(nodeId: number): Promise<GPUaaSNode> {
  return gpuaasAdminRequest<GPUaaSNode>("GET", `/gpuaas/node/${nodeId}`);
}

/**
 * Add a new node to a region
 *
 * Note: The node must be accessible via SSH for initialization.
 * After adding, you need to:
 * 1. Get SSH keys and install them on the node
 * 2. Initialize the node
 * 3. If first controller, enable GPUaaS
 * 4. For workers, join to cluster
 */
export async function addNode(input: AddNodeInput): Promise<GPUaaSNode> {
  return gpuaasAdminRequest<GPUaaSNode>("POST", "/gpuaas/node/add", {
    name: input.name,
    region_id: input.region_id,
    node_ip: input.node_ip,
    username: input.username,
    port: input.port,
    external_service_ip: input.external_service_ip,
    volume_group: input.volume_group,
    is_controller_node: input.is_controller_node,
    is_worker_node: input.is_worker_node,
    is_gateway_service: input.is_gateway_service,
    is_storage_service: input.is_storage_service,
  });
}

/**
 * Get SSH keys for a node
 *
 * Returns the public keys that must be added to the node's authorized_keys.
 * This is required before initialization can proceed.
 *
 * Note: The API returns a direct array of SSH key strings, not wrapped in { public_keys: [...] }
 */
export async function getNodeSSHKeys(
  nodeId: number
): Promise<{ public_keys: string[] }> {
  const response = await gpuaasAdminRequest<string[] | { public_keys: string[] }>(
    "GET",
    `/gpuaas/node/${nodeId}/ssh_keys`
  );
  // Handle both direct array response and potential { public_keys: [...] } wrapper
  if (Array.isArray(response)) {
    return { public_keys: response };
  }
  // Fallback for wrapped response
  return response;
}

/**
 * Initialize a node
 *
 * This starts the node initialization process. The node must have
 * SSH access configured with the keys from getNodeSSHKeys().
 *
 * Check node.initialize_state_status_code for progress:
 * - 0: Not initialized
 * - 1: In progress
 * - 2: Completed
 * - -1: Error
 */
export async function initializeNode(
  nodeId: number
): Promise<{ success: boolean; message?: string }> {
  return gpuaasAdminRequest<{ success: boolean; message?: string }>(
    "GET",
    `/gpuaas/node/init?gpuaas_node_id=${nodeId}`
  );
}

/**
 * Enable GPUaaS on a region using the first controller node
 *
 * This should be called after the first controller node is initialized.
 * It sets up the K8s cluster for the region.
 */
export async function enableGPUaaS(
  controllerNodeId: number
): Promise<{ success: boolean; gpuaas_id?: number }> {
  return gpuaasAdminRequest<{ success: boolean; gpuaas_id?: number }>(
    "POST",
    `/gpuaas/enable?controller_node_id=${controllerNodeId}`
  );
}

/**
 * Join a worker node to an existing GPUaaS cluster
 *
 * The node must be initialized first.
 * Only required for worker nodes, not the initial controller.
 */
export async function joinNode(input: {
  gpuaas_id: number;
  gpuaas_node_id: number;
}): Promise<{ success: boolean }> {
  return gpuaasAdminRequest<{ success: boolean }>("POST", "/gpuaas/node/join", {
    gpuaas_id: input.gpuaas_id,
    gpuaas_node_id: input.gpuaas_node_id,
  });
}

/**
 * Scan a node for available GPUs
 *
 * Returns a list of GPUs detected on the node.
 * Used to verify GPU availability before creating pools.
 */
export async function scanGPUs(
  nodeId: number
): Promise<{
  gpus: Array<{
    index: number;
    name: string;
    memory: number;
    uuid: string;
  }>;
}> {
  return gpuaasAdminRequest<{
    gpus: Array<{
      index: number;
      name: string;
      memory: number;
      uuid: string;
    }>;
  }>("GET", `/gpuaas/node/scan_gpus?gpuaas_node_id=${nodeId}`);
}

/**
 * Scan node resources response from the API
 */
export interface ScanResourcesResponse {
  id: number;
  request_id: string;
  status: "pending" | "completed" | "failed";
  node_id: number;
  error_msg: string;
  resources: {
    gpus: unknown[] | null;
    npus: unknown[] | null;
    hca_devices: unknown[] | null;
    hca_device_info: unknown[] | null;
    volume: unknown | null;
  };
}

/**
 * Trigger a resource scan on a node
 *
 * This queues a background job to SSH into the node and detect:
 * - Memory (total_memory_in_mb)
 * - Disk (total_disk_in_mb)
 * - CPU cores (cores)
 * - GPUs, NPUs, HCA devices
 *
 * Note: The backend job queue may take time to process. Poll the node
 * status to check if resources have been updated.
 *
 * @param nodeId - The ID of the node to scan
 * @returns Job info with status "pending" initially
 */
export async function scanNodeResources(
  nodeId: number
): Promise<ScanResourcesResponse> {
  return gpuaasAdminRequest<ScanResourcesResponse>(
    "GET",
    `/gpuaas/node/scan_resources?gpuaas_node_id=${nodeId}`
  );
}

/**
 * Delete a node
 *
 * Removes a node from the GPUaaS infrastructure.
 * The node should be drained of workloads first and de-initialized (status 0).
 *
 * Correct endpoint: GET /gpuaas/node/{nodeId}/delete
 *
 * IMPORTANT: The API returns empty response for both success and failure!
 * This function verifies deletion by checking if node still exists after the delete call.
 *
 * @param nodeId - The ID of the node to delete
 * @throws Error if node still exists after delete attempt
 */
export async function deleteNode(
  nodeId: number
): Promise<{ success: boolean }> {
  // Correct endpoint per API docs: /gpuaas/node/{nodeId}/delete
  const endpoint = `/gpuaas/node/${nodeId}/delete`;

  // Make the delete request (GET method per API)
  await gpuaasAdminRequest<{ success: boolean }>("GET", endpoint);

  // Wait for the deletion to propagate
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Verify the node was actually deleted by checking if it still exists
  try {
    const node = await getNode(nodeId);
    if (node && node.Id) {
      // Node still exists - deletion failed silently
      throw new Error(
        `Node ${nodeId} still exists after delete attempt. ` +
        `Status: init=${node.initialize_state_status_code}, k8s=${node.k8s_join_state_status_code}. ` +
        `The node must be fully de-initialized (status 0) before it can be deleted.`
      );
    }
  } catch (error) {
    // If getNode throws "not found" error, the deletion was successful
    if (error instanceof Error && error.message.includes("not found")) {
      console.log(`[GPUaaS Admin] Node ${nodeId} successfully deleted (verified)`);
      return { success: true };
    }
    // Re-throw other errors (including "still exists" error)
    throw error;
  }

  return { success: true };
}

/**
 * De-initialize a node
 *
 * Triggers the de-initialization process on a node, which runs cleanup
 * scripts to reset the node to pre-GPUaaS state. This includes:
 * - Running kubeadm reset
 * - Cleaning up containers
 * - Stopping kubelet
 *
 * After calling, monitor initialize_state_status_code:
 * - -2: Deinit in progress
 * - 0: Deinit completed (node is now uninitialized)
 * - -1: Error occurred
 */
export async function deinitNode(
  nodeId: number
): Promise<{ success: boolean; message?: string }> {
  return gpuaasAdminRequest<{ success: boolean; message?: string }>(
    "GET",
    `/gpuaas/node/deinit?gpuaas_node_id=${nodeId}`
  );
}

/**
 * Node initialization status codes
 */
export const NodeInitStatus = {
  NOT_INITIALIZED: 0,
  IN_PROGRESS: 1,
  COMPLETED: 2,
  ERROR: -1,
} as const;

/**
 * K8s join status codes
 */
export const K8sJoinStatus = {
  NOT_JOINED: 0,
  IN_PROGRESS: 1,
  COMPLETED: 2,
  ERROR: -1,
} as const;

/**
 * Test SSH connection to a node
 *
 * Validates that SSH connectivity is working before attempting initialization.
 * This should be called after SSH keys are installed on the node.
 *
 * @param nodeId - The GPUaaS node ID
 * @returns Connection test result with status message
 */
export async function testConnection(
  nodeId: number
): Promise<{ success: boolean; message?: string }> {
  return gpuaasAdminRequest<{ success: boolean; message?: string }>(
    "GET",
    `/gpuaas/node/test_conn?gpuaas_node_id=${nodeId}`
  );
}

/**
 * Scan resources status response
 */
export interface ScanStatusResponse {
  id: number;
  request_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  node_id: number;
  error_msg: string;
  resources: {
    gpus: Array<{
      uuid: string;
      vendor: string;
      gpu_model: string;
      memory_in_mb: number;
    }> | null;
    npus: unknown[] | null;
    hca_devices: unknown[] | null;
    hca_device_info: unknown[] | null;
    volume: unknown | null;
  } | null;
}

/**
 * Get the status of a resource scan
 *
 * After calling scanNodeResources(), poll this endpoint to check when
 * the scan completes. The scan runs as a background job.
 *
 * Status flow: pending -> processing -> completed/failed
 *
 * @param scanId - The scan ID returned from scanNodeResources()
 * @returns Current scan status with resources when completed
 */
export async function getScanResourcesStatus(
  scanId: number
): Promise<ScanStatusResponse> {
  return gpuaasAdminRequest<ScanStatusResponse>(
    "GET",
    `/gpuaas/node/scan_resources/status?scan_id=${scanId}`
  );
}

/**
 * Check if a node is ready for use
 */
export function isNodeReady(node: GPUaaSNode): boolean {
  return node.initialize_state_status_code === NodeInitStatus.COMPLETED;
}

/**
 * Check if a node initialization failed
 */
export function isNodeError(node: GPUaaSNode): boolean {
  return node.initialize_state_status_code === NodeInitStatus.ERROR;
}

/**
 * Find a node by its IP address across all clusters
 *
 * Useful for finding orphaned GPUaaS resources when we don't have the node ID stored.
 * Searches all clusters to find a node matching the given IP address.
 *
 * @returns The node and cluster ID if found, null otherwise
 */
export async function findNodeByIP(
  ipAddress: string
): Promise<{ node: GPUaaSNode; gpuaasId: number } | null> {
  // First, list all clusters
  const clusters = await import("./regions").then((m) => m.listClusters());

  for (const cluster of clusters) {
    try {
      const nodes = await listNodes(cluster.region_id);
      const matchingNode = nodes.find((n) => n.node_ip === ipAddress);
      if (matchingNode) {
        return { node: matchingNode, gpuaasId: cluster.id };
      }
    } catch {
      // Cluster might not have any nodes, continue
    }
  }

  return null;
}

/**
 * Find a region by its address (IP)
 *
 * Useful for finding orphaned GPUaaS resources when we don't have the region ID stored.
 *
 * @returns The region if found, null otherwise
 */
export async function findRegionByAddress(
  address: string
): Promise<import("./types").Region | null> {
  const regions = await import("./regions").then((m) => m.listRegions());
  return regions.find((r) => r.address === address) || null;
}
