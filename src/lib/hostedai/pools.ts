/**
 * GPUaaS pool subscription functions for hosted.ai
 */

import { hostedaiRequest, getCached, setCache, clearCache, getApiUrl, getApiKey } from "./client";
import { recordSubscriptionLineage } from "@/lib/subscription-lineage";
import { prisma } from "@/lib/prisma";
import { getDefaultResourcePolicy } from "./policies";
import { validateSSHParams } from "@/lib/ssh-validation";
import { spawn } from "child_process";
import type {
  GPURegion,
  GPUPool,
  GPUPoolExtended,
  RawGPUPool,
  PoolSubscription,
  PoolSubscriptionResponse,
  SubscribePoolParams,
  CalculatePoolSubscriptionParams,
  PoolSubscriptionCostEstimate,
  SubscriptionConnectionInfo,
  InstanceType,
  StorageBlock,
  MetricWindow,
  PodAction,
  CreateSharedVolumeParams,
  SharedVolume,
} from "./types";

// ============================================
// Shared Volume Management
// ============================================

// Create a shared (persistent) volume for a team
export async function createSharedVolume(params: CreateSharedVolumeParams): Promise<SharedVolume> {
  const result = await hostedaiRequest<SharedVolume>(
    "POST",
    "/shared-volumes",
    {
      team_id: params.team_id,
      region_id: params.region_id,
      name: params.name,
      storage_block_id: params.storage_block_id,
    }
  );
  return result;
}

// Get shared volumes for a team
// IMPORTANT: The hosted.ai API ignores team_id filter and returns ALL volumes,
// so we MUST filter on our side to prevent data leakage between customers
export async function getSharedVolumes(teamId: string): Promise<SharedVolume[]> {
  const allVolumes = await hostedaiRequest<SharedVolume[]>(
    "GET",
    `/shared-volumes?team_id=${teamId}`
  );

  // CRITICAL: Filter to only this team's volumes - API doesn't do this!
  // Use String() comparison because API may return team_id as number
  const teamVolumes = allVolumes.filter(v => String(v.team_id) === String(teamId));

  if (allVolumes.length !== teamVolumes.length) {
    console.warn(`[getSharedVolumes] SECURITY: Filtered ${allVolumes.length - teamVolumes.length} volumes from other teams`);
  }

  return teamVolumes;
}

// Delete a shared volume
export async function deleteSharedVolume(volumeId: number): Promise<void> {
  await hostedaiRequest("DELETE", `/shared-volumes/${volumeId}`);
}

// ============================================
// Region Management
// ============================================

// Get available GPUaaS regions
export async function getAvailableRegions(teamId: string): Promise<GPURegion[]> {
  return hostedaiRequest<GPURegion[]>(
    "GET",
    `/gpuaas/available-regions?team_id=${teamId}`
  );
}

// Custom error class for availability check failures
// This allows callers to distinguish API errors from actual "no GPUs" situations
export class AvailabilityCheckError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'AvailabilityCheckError';
  }
}

// Get available GPU pools for a region
export async function getAvailablePools(
  teamId: string,
  gpuaasId: string
): Promise<GPUPool[]> {
  const url = `${getApiUrl()}/api/gpuaas/available-pools?team_id=${teamId}&gpuaas_id=${gpuaasId}`;

  // 30 second timeout — B200 cluster API can take 15-20s to respond
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": getApiKey(),
      "Content-Type": "application/json",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  const text = await response.text();

  if (!response.ok) {
    // Try to extract the error code from JSON response body
    // The hosted.ai API returns HTTP 500 with {"code": 12370004, ...} for resource policy errors
    let errorCode: number | undefined;
    try {
      const errorData = JSON.parse(text);
      if (errorData && typeof errorData.code === 'number') {
        errorCode = errorData.code;
      }
    } catch {
      // Not JSON, leave errorCode undefined
    }
    throw new AvailabilityCheckError(`Hosted.ai API error: ${response.status} - ${text}`, errorCode);
  }

  if (!text) {
    return [];
  }

  try {
    const data = JSON.parse(text);

    // Check if API returned an error object instead of pools
    // e.g. {"code": 12370004, "message": "unable to retrieve resource access permissions for your team"}
    if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
      console.error(`[getAvailablePools] API returned error object: ${data.code} - ${data.message}`);
      // Throw specific error so callers know this is an API issue, not "no GPUs"
      throw new AvailabilityCheckError(data.message, data.code);
    }

    // Map API response fields to our GPUPool interface
    // API returns: id, pool_name, gpu_model_type, available_vgpus, pricing_hourly
    // We need: id, name, gpu_model, available_gpus, price_per_hour
    const pools = Array.isArray(data) ? data : (data?.items || data?.pools || []);
    return pools.map((p: {
      id: number | string;
      pool_name?: string;
      name?: string;
      gpu_model_type?: string;
      gpu_model?: string;
      available_vgpus?: number;
      available_gpus?: number;
      pricing_hourly?: string;
      price_per_hour?: number;
    }) => ({
      id: String(p.id),
      name: p.pool_name || p.name || "",
      gpu_model: p.gpu_model_type || p.gpu_model,
      available_gpus: p.available_vgpus ?? p.available_gpus,
      price_per_hour: p.pricing_hourly ? parseFloat(p.pricing_hourly) : p.price_per_hour,
    }));
  } catch (parseError) {
    // If it's our custom error, rethrow it
    if (parseError instanceof AvailabilityCheckError) {
      throw parseError;
    }
    console.log("[getAvailablePools] Failed to parse response:", text);
    throw new AvailabilityCheckError(`Failed to parse available-pools response`);
  }
}

// Get pool subscriptions for a team
export async function getPoolSubscriptions(
  teamId: string,
  metricWindow?: MetricWindow,
  timeoutMs?: number
): Promise<PoolSubscription[]> {
  // Check cache first
  const cacheKey = `pool-subscriptions:${teamId}:${metricWindow || "default"}`;
  const cached = getCached<PoolSubscription[]>(cacheKey);
  if (cached) return cached;

  // Endpoint from hosted.ai dashboard - returns paginated response
  // metric_window controls the time range for tflops_usage and vram_usage metrics
  const windowParam = metricWindow ? `&metric_window=${metricWindow}` : "";
  const response = await hostedaiRequest<PoolSubscriptionResponse>(
    "GET",
    `/gpuaas/pool-subscription?team_id=${teamId}&page=0&per_page=100${windowParam}`,
    undefined,
    timeoutMs
  );
  const allItems = response.items || [];

  // CRITICAL: Filter to only this team's subscriptions - API may return items from other teams!
  // Same pattern as getSharedVolumes() - the hosted.ai API doesn't reliably filter by team_id
  const items = allItems.filter(item => {
    if (!item.team_id) return true; // If no team_id on item, can't filter (keep it)
    return String(item.team_id) === String(teamId);
  });

  if (allItems.length !== items.length) {
    console.warn(`[getPoolSubscriptions] SECURITY: Filtered ${allItems.length - items.length} subscriptions from other teams for team ${teamId}`);
  }

  // Cache the result
  setCache(cacheKey, items);
  return items;
}

// Get compatible instance types for a GPU pool
export async function getPoolInstanceTypes(
  regionId: string,
  teamId: string
): Promise<InstanceType[]> {
  return hostedaiRequest<InstanceType[]>(
    "GET",
    `/gpuaas/pool/compatible-instance-types?region_id=${regionId}&team_id=${teamId}`
  );
}

// Get ephemeral storage blocks for GPU pools
export async function getPoolEphemeralStorageBlocks(
  regionId: string,
  teamId: string
): Promise<StorageBlock[]> {
  return hostedaiRequest<StorageBlock[]>(
    "GET",
    `/gpuaas/pool/ephemeral-storage-blocks?region_id=${regionId}&team_id=${teamId}`
  );
}

// Get persistent storage blocks for GPU pools
export async function getPoolPersistentStorageBlocks(
  regionId: string,
  teamId: string
): Promise<StorageBlock[]> {
  return hostedaiRequest<StorageBlock[]>(
    "GET",
    `/gpuaas/pool/persistent-storage-blocks?region_id=${regionId}&team_id=${teamId}`
  );
}

// Calculate pool subscription cost before subscribing
export async function calculatePoolSubscriptionCost(
  params: CalculatePoolSubscriptionParams
): Promise<PoolSubscriptionCostEstimate> {
  const result = await hostedaiRequest<PoolSubscriptionCostEstimate>(
    "POST",
    "/gpuaas/calculate-pool-subscription",
    {
      pool_id: typeof params.pool_id === "number" ? params.pool_id : parseInt(String(params.pool_id), 10),
      gpu_count: params.gpu_count,
      duration_hours: params.duration_hours || 1,
      team_id: params.team_id,
    }
  );
  return result;
}

// Subscribe to a GPU pool
export async function subscribeToPool(params: SubscribePoolParams): Promise<{ subscription_id: string }> {
  // Match the payload format from the hosted.ai dashboard
  // Default image UUID can be configured via environment variable
  const DEFAULT_IMAGE_UUID = process.env.DEFAULT_IMAGE_UUID || "dc6b43aa-73c2-4b10-9c59-12481319e933";

  // IMPORTANT: Always enforce 1 GPU per pod
  // Multi-GPU subscriptions create multiple pods which our UI doesn't handle properly
  // This prevents confusing scenarios with multiple SSH connections per subscription
  const ENFORCED_VGPUS = 1;
  if (params.vgpus && params.vgpus > 1) {
    console.warn(`[subscribeToPool] Requested ${params.vgpus} vGPUs but enforcing ${ENFORCED_VGPUS} (multi-GPU not supported)`);
  }

  const requestData: Record<string, unknown> = {
    pool_id: parseInt(params.pool_id, 10),
    team_id: params.team_id,
    is_vip_priority: false,
    vgpus: ENFORCED_VGPUS,
    guaranteed_gpu_share_percent: 0,
    instance_type_id: params.instance_type_id,
    shared_volumes: params.shared_volumes || [],
    ephemeral_storage_block_id: params.ephemeral_storage_block_id,
    image_uuid: params.image_uuid || DEFAULT_IMAGE_UUID,
    ifb_subscription_id: "",
    port_guid: "",
  };

  // Note: persistent_storage_block_id doesn't work in the API
  // Use shared_volumes instead (requires pre-creating the volume)

  console.log("Sending to subscribe API:", JSON.stringify(requestData, null, 2));

  let result: { subscription_id?: string } | undefined;
  let alreadySubscribed = false;
  let timedOut = false;

  // Use 15 second timeout - if hosted.ai takes longer, we'll return pending status
  // This allows multiple users to launch concurrently without blocking each other
  const SUBSCRIBE_TIMEOUT_MS = 15000;

  try {
    result = await hostedaiRequest<{ subscription_id?: string }>(
      "POST",
      "/gpuaas/pool/subscribe",
      requestData,
      SUBSCRIBE_TIMEOUT_MS
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle timeout - subscription was initiated but API is slow to respond
    if (errorMessage.startsWith("TIMEOUT:")) {
      console.log("Subscribe API timed out, subscription likely initiated. Will return pending status.");
      timedOut = true;
    }
    // Handle "Already subscribed to this pool" error (409)
    else if (errorMessage.includes("Already subscribed") || errorMessage.includes("409")) {
      console.log("Already subscribed to this pool, finding existing subscription...");
      alreadySubscribed = true;
    } else {
      throw error;
    }
  }

  // If API returns subscription_id, use it
  if (result?.subscription_id) {
    return { subscription_id: result.subscription_id };
  }

  // If already subscribed, timed out, or API returned empty, find the existing subscription
  // Clear cache to get fresh data
  clearCache(`pool-subscriptions:${params.team_id}`);

  if (alreadySubscribed || timedOut) {
    const subs = await getPoolSubscriptions(params.team_id);
    // Check for any active or transitioning subscription
    const existingSub = subs.find(s =>
      String(s.pool_id) === String(params.pool_id) &&
      (s.status === "subscribing" || s.status === "subscribed" || s.status === "active" || s.status === "un_subscribing")
    );

    if (existingSub) {
      if (existingSub.status === "un_subscribing" && !timedOut) {
        throw new Error("Previous subscription is still terminating. Please wait a moment and try again.");
      }
      console.log("Found existing subscription:", existingSub.id);
      return { subscription_id: String(existingSub.id) };
    }

    // If timed out and no subscription found yet, return pending - it's likely still being created
    if (timedOut) {
      console.log("Subscription timed out and not yet visible, returning pending status. Dashboard will poll for it.");
      return { subscription_id: `pending-${params.pool_id}-${Date.now()}` };
    }

    throw new Error("Already subscribed but could not find existing subscription. Please try again.");
  }

  // Quick poll - try once immediately, then once after 2 seconds
  // This allows parallel launches instead of blocking for 45+ seconds
  console.log("Subscribe API returned empty, doing quick poll for subscription...");

  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      clearCache(`pool-subscriptions:${params.team_id}`);
    }

    const subs = await getPoolSubscriptions(params.team_id);
    const newSub = subs.find(s =>
      String(s.pool_id) === String(params.pool_id) &&
      (s.status === "subscribing" || s.status === "subscribed" || s.status === "active")
    );

    if (newSub) {
      console.log("Found subscription:", newSub.id);
      return { subscription_id: String(newSub.id) };
    }
  }

  // If still not found, return a placeholder - the subscription is being created async
  // The dashboard polling will pick it up when it appears
  console.log("Subscription not yet visible, returning pending status. Dashboard will poll for it.");
  return { subscription_id: `pending-${params.pool_id}-${Date.now()}` };
}

// Scale/update a pool subscription by unsubscribing and resubscribing with new vgpus
export async function scalePoolSubscription(params: {
  subscriptionId: string | number;
  poolId: string | number;
  teamId: string;
  vgpus: number;
  instanceTypeId: string;
  ephemeralStorageBlockId: string;
  imageUuid?: string;
}): Promise<{ subscription_id: string }> {
  // First unsubscribe from current
  console.log("Unsubscribing from current subscription:", params.subscriptionId, "pool:", params.poolId);
  await unsubscribeFromPool(params.subscriptionId, params.teamId, params.poolId);

  // Poll until subscription is fully removed (not just "un_subscribing")
  const maxAttempts = 120; // 120 seconds max
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const subs = await getPoolSubscriptions(params.teamId);
    const existingSub = subs.find(s =>
      String(s.pool_id) === String(params.poolId) ||
      String(s.id) === String(params.subscriptionId)
    );

    if (!existingSub) {
      console.log("Subscription fully removed after", i + 1, "seconds");
      break;
    }

    console.log("Waiting for unsubscribe... status:", existingSub.status, "attempt:", i + 1);

    if (existingSub.status === "un_subscribing") {
      continue; // Still unsubscribing, keep waiting
    }

    // If still subscribed after unsubscribe call, something's wrong
    if (existingSub.status === "subscribed" && i > 5) {
      throw new Error("Failed to unsubscribe - subscription still active");
    }
  }

  // Resubscribe with new vgpus count
  console.log("Resubscribing with new vgpus count:", params.vgpus);
  return subscribeToPool({
    pool_id: String(params.poolId),
    team_id: params.teamId,
    vgpus: params.vgpus,
    instance_type_id: params.instanceTypeId,
    ephemeral_storage_block_id: params.ephemeralStorageBlockId,
    image_uuid: params.imageUuid,
  });
}

// Unsubscribe from a pool
export async function unsubscribeFromPool(
  subscriptionId: string | number,
  teamId: string,
  poolId: string | number
): Promise<void> {
  // Use POST with subscription_id, team_id, and pool_id in body
  await hostedaiRequest("POST", "/gpuaas/pool/unsubscribe", {
    subscription_id: Number(subscriptionId),
    team_id: teamId,
    pool_id: Number(poolId),
  });
}

// Get all available GPU pools (without region filter)
export async function getAllPools(): Promise<GPUPoolExtended[]> {
  const rawPools = await hostedaiRequest<RawGPUPool[]>("GET", "/gpuaas/all-pools");
  // Transform to expected format, keeping gpuaas_id and region_id
  return rawPools.map(pool => ({
    id: String(pool.pool_id),
    name: pool.pool_name,
    gpu_model: pool.pool_name, // Use pool name as GPU model for display
    gpuaas_id: pool.gpuaas_id,
    region_id: pool.region_id,
  }));
}

// Get all pools with full region info (for catalog API)
export async function getAllPoolsWithRegions(): Promise<RawGPUPool[]> {
  return hostedaiRequest<RawGPUPool[]>("GET", "/gpuaas/all-pools");
}

// Get connection info (SSH credentials) for pool subscriptions
export async function getConnectionInfo(
  teamId: string,
  subscriptionId?: string | number
): Promise<SubscriptionConnectionInfo[]> {
  // Check cache first
  const cacheKey = `connection-info:${teamId}:${subscriptionId || "all"}`;
  const cached = getCached<SubscriptionConnectionInfo[]>(cacheKey);
  if (cached) return cached;

  let endpoint = `/gpuaas/connection-info?team_id=${teamId}`;
  if (subscriptionId) {
    endpoint += `&subscription_id=${subscriptionId}`;
  }
  const result = await hostedaiRequest<SubscriptionConnectionInfo[] | { items?: SubscriptionConnectionInfo[] }>("GET", endpoint);

  // Normalize: API might return array or { items: [...] } or null
  const allItems = Array.isArray(result) ? result : (result?.items || []);

  // CRITICAL: If we fetched subscriptions for this team, only return connection info
  // for subscriptions that belong to this team (prevents cross-team data leakage)
  let items = allItems;
  if (!subscriptionId) {
    // When fetching all connection info for a team, cross-reference against
    // the team's actual subscriptions to filter out any leaked data
    const teamSubs = await getPoolSubscriptions(teamId);
    const teamSubIds = new Set(teamSubs.map(s => String(s.id)));
    items = allItems.filter(item => teamSubIds.has(String(item.id)));

    if (allItems.length !== items.length) {
      console.warn(`[getConnectionInfo] SECURITY: Filtered ${allItems.length - items.length} connection infos from other teams for team ${teamId}`);
    }
  }

  // Cache the result
  setCache(cacheKey, items);
  return items;
}

// Pod actions (start, stop, restart)
// Endpoint: POST /pods/action
export async function podAction(
  podName: string,
  poolSubscriptionId: string | number,
  action: PodAction
): Promise<{ success: boolean }> {
  console.log(`Pod action: ${action} for pod ${podName}, subscription ${poolSubscriptionId}`);

  const payload = {
    pod_name: podName,
    pool_subscription_id: Number(poolSubscriptionId),
    pod_action: action,
  };

  console.log("Pod action payload:", JSON.stringify(payload));

  return hostedaiRequest<{ success: boolean }>("POST", "/pods/action", payload);
}

// DEPRECATED: Old restart method using unsubscribe + resubscribe
// Use podAction() with action="restart" instead
// Restart a GPUaaS pod subscription (unsubscribe + resubscribe)
// Note: Ephemeral storage will be reset, but persistent storage will be preserved if provided
export async function restartPoolSubscription(
  subscriptionId: string | number,
  teamId: string,
  poolId: string | number,
  vgpus: number = 1,
  instanceTypeId: string,
  ephemeralStorageBlockId: string,
  imageUuid?: string,
  persistentStorageBlockId?: string
): Promise<{ subscription_id: string }> {
  // Unsubscribe first
  console.log("Restarting: unsubscribing from", subscriptionId);
  await unsubscribeFromPool(subscriptionId, teamId, poolId);

  // Wait for unsubscribe to complete
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const subs = await getPoolSubscriptions(teamId);
    const existingSub = subs.find(s =>
      String(s.id) === String(subscriptionId) ||
      String(s.pool_id) === String(poolId)
    );
    if (!existingSub) {
      console.log("Unsubscribe complete after", i + 1, "seconds");
      break;
    }
    if (existingSub.status === "un_subscribing") {
      continue;
    }
  }

  // Resubscribe with same settings (including persistent storage if provided)
  console.log("Restarting: resubscribing to pool", poolId, "with persistent storage:", persistentStorageBlockId || "none");
  const newSubscription = await subscribeToPool({
    pool_id: String(poolId),
    team_id: teamId,
    vgpus,
    instance_type_id: instanceTypeId,
    ephemeral_storage_block_id: ephemeralStorageBlockId,
    persistent_storage_block_id: persistentStorageBlockId,
    image_uuid: imageUuid,
  });

  // Record the lineage so metrics can be aggregated across restarts
  // This allows the dashboard to show data as though it's the same pod
  await recordSubscriptionLineage({
    teamId,
    previousSubscriptionId: String(subscriptionId),
    newSubscriptionId: newSubscription.subscription_id,
    poolId: String(poolId),
    reason: "restart",
  });

  return newSubscription;
}

// Reimage a GPUaaS pod subscription (change image)
export async function reimagePoolSubscription(
  subscriptionId: string | number,
  teamId: string,
  imageUuid: string
): Promise<void> {
  await hostedaiRequest("POST", "/gpuaas/pool/reimage", {
    subscription_id: Number(subscriptionId),
    team_id: teamId,
    image_uuid: imageUuid,
  });
}

// ============================================
// Live VRAM Measurement via SSH
// ============================================

/**
 * Run a single SSH command and return stdout. Used for live nvidia-smi checks.
 */
function sshExec(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs = 8000
): Promise<{ success: boolean; output: string }> {
  validateSSHParams({ host, port, username });

  return new Promise((resolve) => {
    const args = [
      "-e", "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=5",
      "-p", String(port),
      `${username}@${host}`,
      command,
    ];

    let stdout = "";
    let resolved = false;

    const proc = spawn("sshpass", args, {
      timeout: timeoutMs,
      env: { ...process.env, SSHPASS: password },
    });

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.on("close", (code) => {
      if (!resolved) { resolved = true; resolve({ success: code === 0, output: stdout }); }
    });
    proc.on("error", (err) => {
      if (!resolved) { resolved = true; resolve({ success: false, output: err.message }); }
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; proc.kill(); resolve({ success: false, output: "timeout" }); }
    }, timeoutMs);
  });
}

/**
 * Parse SSH connection string like "ssh -p 12345 root@1.2.3.4" or "ssh root@1.2.3.4 -p 12345"
 */
function parseSSHCmd(cmd: string): { host: string; port: number; username: string } | null {
  let match = cmd.match(/ssh\s+-p\s+(\d+)\s+(\w+)@([^\s]+)/);
  if (match) return { port: parseInt(match[1], 10), username: match[2], host: match[3] };
  match = cmd.match(/ssh\s+(\w+)@([^\s]+)\s+-p\s+(\d+)/);
  if (match) return { username: match[1], host: match[2], port: parseInt(match[3], 10) };
  return null;
}

/**
 * Fetch live VRAM utilisation for a set of pools by SSH-ing into every running pod
 * and running nvidia-smi. Runs all SSH commands in parallel with a tight timeout.
 *
 * Returns a Map of poolId → { usedMb, totalMb } aggregated across all pods in that pool.
 */
async function fetchLivePoolVram(
  eligiblePoolIds: number[]
): Promise<Map<number, { usedMb: number; totalMb: number }>> {
  const result = new Map<number, { usedMb: number; totalMb: number }>();

  try {
    // Get all teams from the resource policy (same source the cron uses)
    const policy = await getDefaultResourcePolicy();
    const teams = policy.teams || [];

    if (teams.length === 0) return result;

    const eligibleSet = new Set(eligiblePoolIds.map(String));

    // Collect SSH tasks: { poolId, host, port, user, pass }
    const sshTasks: Array<{ poolId: number; host: string; port: number; username: string; password: string }> = [];

    // Process teams in parallel batches of 10 to avoid overloading the API
    const batchSize = 10;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (team) => {
          try {
            const [subs, conns] = await Promise.all([
              getPoolSubscriptions(team.id).catch(() => []),
              getConnectionInfo(team.id).catch(() => []),
            ]);

            const subsArr = Array.isArray(subs) ? subs : [];
            const connsArr = Array.isArray(conns) ? conns : [];

            // Build connection map
            const connMap = new Map<string, { host: string; port: number; username: string; password: string }>();
            for (const conn of connsArr) {
              const pod = conn.pods?.[0];
              if (conn.id && pod?.ssh_info?.cmd && pod?.ssh_info?.pass) {
                const parsed = parseSSHCmd(pod.ssh_info.cmd);
                if (parsed) connMap.set(String(conn.id), { ...parsed, password: pod.ssh_info.pass });
              }
            }

            // Match running subs in eligible pools to their SSH info
            const tasks: typeof sshTasks = [];
            for (const sub of subsArr) {
              const status = sub.status?.toLowerCase();
              if (status !== "subscribed" && status !== "active" && status !== "running") continue;
              if (!eligibleSet.has(String(sub.pool_id))) continue;

              const conn = connMap.get(String(sub.id));
              if (!conn) continue;

              tasks.push({
                poolId: parseInt(String(sub.pool_id), 10),
                ...conn,
              });
            }
            return tasks;
          } catch {
            return [];
          }
        })
      );
      sshTasks.push(...batchResults.flat());
    }

    if (sshTasks.length === 0) return result;

    console.log(`[fetchLivePoolVram] Running nvidia-smi on ${sshTasks.length} pods across ${eligiblePoolIds.length} pools...`);

    // Run nvidia-smi on all pods in parallel (tight 8s timeout per pod)
    const VRAM_CMD = "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1";
    const sshResults = await Promise.all(
      sshTasks.map(async (task) => {
        const res = await sshExec(task.host, task.port, task.username, task.password, VRAM_CMD);
        if (!res.success) return { poolId: task.poolId, usedMb: 0, totalMb: 0, ok: false };

        const values = res.output.trim().split(",").map(v => parseFloat(v.trim()));
        if (values.length >= 2 && !isNaN(values[0]) && !isNaN(values[1])) {
          return { poolId: task.poolId, usedMb: values[0], totalMb: values[1], ok: true };
        }
        return { poolId: task.poolId, usedMb: 0, totalMb: 0, ok: false };
      })
    );

    // Aggregate per pool
    for (const r of sshResults) {
      if (!r.ok) continue;
      const existing = result.get(r.poolId) || { usedMb: 0, totalMb: 0 };
      existing.usedMb += r.usedMb;
      existing.totalMb += r.totalMb;
      result.set(r.poolId, existing);
    }

    const successCount = sshResults.filter(r => r.ok).length;
    console.log(`[fetchLivePoolVram] Got VRAM from ${successCount}/${sshTasks.length} pods`);
  } catch (err) {
    console.error("[fetchLivePoolVram] Error:", err);
  }

  return result;
}

// ============================================
// Optimal Pool Selection
// ============================================

export interface SelectOptimalPoolParams {
  /** The pool_id the frontend/caller requested (used to determine GPU type) */
  requestedPoolId: string | number;
  /** Team ID for the customer */
  teamId: string;
  /** Number of GPUs requested (default 1) */
  gpuCount?: number;
  /** All known pools from hosted.ai (pass the result of getAllPools()) */
  allPools: GPUPoolExtended[];
  /** Optional: pool IDs from the GPU product — searches across all clusters, not just one gpuaas_id */
  productPoolIds?: number[];
}

export interface SelectOptimalPoolResult {
  /** The selected pool to deploy to */
  pool: GPUPoolExtended;
  /** Remaining eligible pools sorted by availability (for retry on Insufficient resources) */
  fallbackPools: GPUPoolExtended[];
  /** Pool IDs where this user already has an active subscription */
  blockedPoolIds: Set<string>;
}

/**
 * Select the optimal pool for a new GPU deployment.
 *
 * Enforces two rules:
 * 1. One pod per pool per user — a user cannot have more than one subscription in the same pool
 * 2. Least VRAM consumption first — always pick the pool with the lowest total VRAM usage
 *    (from real nvidia-smi data in GpuHardwareMetrics, collected every ~3 minutes)
 *
 * VRAM ranking uses the latest metric reading per active pod per pool, summed per pool.
 * Falls back to available GPU slot count from hosted.ai API if no VRAM data exists.
 *
 * This function is the single authoritative place for pool selection logic.
 * All deployment routes (dashboard, API, snapshot restore, HF deploy, SkyPilot) must use it.
 *
 * @throws Error with a descriptive message and a `status` property for HTTP status code
 */
export async function selectOptimalPool(
  params: SelectOptimalPoolParams
): Promise<SelectOptimalPoolResult> {
  const { requestedPoolId, teamId, allPools, gpuCount = 1, productPoolIds: explicitPoolIds } = params;

  // 1. Determine compatible pools from the product's pool list.
  // The product defines which pools can be used — search ALL of them across all clusters.
  // If productPoolIds not passed, look up the product that contains the requested pool.
  let resolvedPoolIds: number[] | undefined = explicitPoolIds;

  if (!resolvedPoolIds || resolvedPoolIds.length === 0) {
    try {
      const products = await prisma.gpuProduct.findMany({
        where: { active: true },
        select: { poolIds: true },
      });
      for (const product of products) {
        const ids = JSON.parse(product.poolIds) as number[];
        if (ids.includes(Number(requestedPoolId))) {
          resolvedPoolIds = ids;
          break;
        }
      }
    } catch (err) {
      console.error("[selectOptimalPool] Failed to look up product pools:", err);
    }
  }

  let compatiblePools: GPUPoolExtended[];

  if (resolvedPoolIds && resolvedPoolIds.length > 0) {
    const productSet = new Set(resolvedPoolIds.map(String));
    compatiblePools = allPools.filter(p => productSet.has(String(p.id)));
    console.log(`[selectOptimalPool] Product has ${resolvedPoolIds.length} pool IDs, ${compatiblePools.length} found in allPools`);
  } else {
    // Final fallback: filter by gpuaas_id
    const requestedPool = allPools.find(p => String(p.id) === String(requestedPoolId));
    const gpuaasId = requestedPool?.gpuaas_id;

    if (!gpuaasId) {
      const err = new Error("Requested GPU pool not found or has no GPU type configured.");
      (err as any).status = 404;
      throw err;
    }

    compatiblePools = allPools.filter(p => p.gpuaas_id === gpuaasId);
  }

  // 3. Build blockedPoolIds — pools where user already has an active/transitioning subscription
  let blockedPoolIds = new Set<string>();
  try {
    const existingSubscriptions = await getPoolSubscriptions(teamId);
    blockedPoolIds = new Set(
      existingSubscriptions
        .filter(s =>
          s.status === "subscribing" ||
          s.status === "subscribed" ||
          s.status === "active" ||
          s.status === "running" ||
          s.status === "un_subscribing"
        )
        .map(s => String(s.pool_id))
    );
  } catch (err) {
    console.error("[selectOptimalPool] Failed to check existing subscriptions:", err);
    // Continue — hosted.ai will reject duplicates with "Already subscribed"
  }

  // 4. Filter to eligible pools (same GPU type, not blocked)
  const eligiblePools = compatiblePools.filter(p => !blockedPoolIds.has(String(p.id)));

  if (eligiblePools.length === 0) {
    const err = new Error(
      blockedPoolIds.has(String(requestedPoolId))
        ? "All pools for this GPU type are in use by your account. Terminate an existing pod or wait for a terminating pod to finish."
        : "No pools available for this GPU type."
    );
    (err as any).status = 409;
    throw err;
  }

  // 5. Check GPU slot availability across eligible pools (for capacity filtering)
  // Query each unique gpuaas_id in the eligible pools
  let availabilityMap = new Map<string, number>();
  let availabilityCheckSucceeded = false;

  try {
    const gpuaasIds = [...new Set(eligiblePools.map(p => p.gpuaas_id).filter(Boolean))];
    for (const gid of gpuaasIds) {
      const availablePools = await getAvailablePools(teamId, String(gid));
      for (const ap of availablePools) {
        if (ap.available_gpus !== undefined) {
          availabilityMap.set(String(ap.id), ap.available_gpus);
        }
      }
    }
    availabilityCheckSucceeded = availabilityMap.size > 0;
  } catch (err) {
    console.error("[selectOptimalPool] Failed to check availability:", err);
  }

  // 6. Get real VRAM consumption per pool from GpuHardwareMetrics
  //    We query the most recent metric entry per subscription per pool (within last 10 min),
  //    then sum memoryUsedMb per pool. Lower total = less loaded pool.
  let vramByPool = new Map<number, { usedMb: number; totalMb: number }>();
  let vramDataAvailable = false;

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const eligiblePoolIds = eligiblePools
      .map(p => parseInt(String(p.id), 10))
      .filter(id => !isNaN(id));

    if (eligiblePoolIds.length > 0) {
      // Get the latest VRAM reading per subscription for each pool
      // Uses the @@index([pool_id, recorded_at]) for efficient lookup
      const latestMetrics = await prisma.$queryRawUnsafe<
        Array<{ poolId: number; subscriptionId: string; memoryUsedMb: number; memoryTotalMb: number }>
      >(
        `SELECT m1.pool_id as poolId, m1.subscription_id as subscriptionId, m1.memory_used_mb as memoryUsedMb, m1.memory_total_mb as memoryTotalMb
         FROM gpu_hardware_metrics m1
         INNER JOIN (
           SELECT subscription_id, MAX(recorded_at) as maxTs
           FROM gpu_hardware_metrics
           WHERE pool_id IN (${eligiblePoolIds.map(() => '?').join(',')})
             AND recorded_at > ?
             AND pool_id IS NOT NULL
           GROUP BY subscription_id
         ) m2 ON m1.subscription_id = m2.subscription_id AND m1.recorded_at = m2.maxTs`,
        ...eligiblePoolIds,
        tenMinutesAgo
      );

      // Aggregate VRAM per pool
      for (const metric of latestMetrics) {
        if (metric.poolId == null) continue;
        const existing = vramByPool.get(metric.poolId) || { usedMb: 0, totalMb: 0 };
        existing.usedMb += metric.memoryUsedMb || 0;
        existing.totalMb += metric.memoryTotalMb || 0;
        vramByPool.set(metric.poolId, existing);
      }

      vramDataAvailable = vramByPool.size > 0;
      if (vramDataAvailable) {
        console.log(
          `[selectOptimalPool] VRAM data (DB) for ${vramByPool.size} pools:`,
          Array.from(vramByPool.entries()).map(([pid, v]) =>
            `pool ${pid}: ${(v.usedMb / 1024).toFixed(1)}GB / ${(v.totalMb / 1024).toFixed(1)}GB (${v.totalMb > 0 ? ((v.usedMb / v.totalMb) * 100).toFixed(0) : '?'}%)`
          ).join(', ')
        );
      }
    }
  } catch (err) {
    console.error("[selectOptimalPool] Failed to query VRAM metrics:", err);
  }

  // 6b. FALLBACK: If no VRAM data in the DB, run live nvidia-smi on all pods in eligible pools
  if (!vramDataAvailable) {
    console.log("[selectOptimalPool] No VRAM data in DB — running live nvidia-smi on pool VMs...");
    try {
      const eligiblePoolIds = eligiblePools
        .map(p => parseInt(String(p.id), 10))
        .filter(id => !isNaN(id));

      const liveVram = await fetchLivePoolVram(eligiblePoolIds);
      if (liveVram.size > 0) {
        vramByPool = liveVram;
        vramDataAvailable = true;
        console.log(
          `[selectOptimalPool] VRAM data (live SSH) for ${liveVram.size} pools:`,
          Array.from(liveVram.entries()).map(([pid, v]) =>
            `pool ${pid}: ${(v.usedMb / 1024).toFixed(1)}GB / ${(v.totalMb / 1024).toFixed(1)}GB (${v.totalMb > 0 ? ((v.usedMb / v.totalMb) * 100).toFixed(0) : '?'}%)`
          ).join(', ')
        );
      } else {
        console.log("[selectOptimalPool] Live SSH returned no VRAM data (pools may be empty)");
      }
    } catch (err) {
      console.error("[selectOptimalPool] Live VRAM fallback failed:", err);
    }
  }

  // 7. Load pool priorities and maintenance status from admin overrides
  const poolOverrides = await prisma.poolSettingsOverride.findMany({
    select: { gpuaasPoolId: true, priority: true, maintenance: true },
  });
  const priorityMap = new Map<number, number>();
  const maintenancePoolIds = new Set<number>();
  for (const o of poolOverrides) {
    if (o.priority != null) priorityMap.set(o.gpuaasPoolId, o.priority);
    if (o.maintenance) maintenancePoolIds.add(o.gpuaasPoolId);
  }

  // 8. Score and rank eligible pools
  // RULE 1: Maintenance is a hard filter — maintenance pools are excluded
  const scorablePools = eligiblePools.filter(p => !maintenancePoolIds.has(parseInt(String(p.id), 10)));
  if (maintenancePoolIds.size > 0) {
    const excluded = eligiblePools.length - scorablePools.length;
    if (excluded > 0) {
      console.log(
        `[selectOptimalPool] Maintenance: excluded ${excluded} pools, ${scorablePools.length} remaining`
      );
    }
  }
  const scored = scorablePools
    .map(pool => {
      const poolIdNum = parseInt(String(pool.id), 10);
      return {
        pool,
        available: availabilityMap.get(String(pool.id)),
        vram: vramByPool.get(poolIdNum),
        priority: priorityMap.get(poolIdNum) ?? 0,
      };
    })
    .filter(entry => {
      // If we have availability data, exclude pools with insufficient capacity
      if (entry.available !== undefined) {
        return entry.available >= gpuCount;
      }
      return true;
    })
    .sort((a, b) => {
      // RULE 0: Higher priority pools first (admin-configured)
      if (a.priority !== b.priority) return b.priority - a.priority;

      // RULE 1: (maintenance is a hard filter — applied before scoring)

      // RULE 2: Empty pools first — if ANY pool has zero pods, pick it
      const aEmpty = !a.vram || a.vram.usedMb === 0;
      const bEmpty = !b.vram || b.vram.usedMb === 0;
      if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;

      // RULE 3: Among non-empty pools, prefer the one with LEAST VRAM consumption
      const aUsed = a.vram?.usedMb ?? 0;
      const bUsed = b.vram?.usedMb ?? 0;
      if (aUsed !== bUsed) return aUsed - bUsed;

      // Tiebreaker: more available GPU slots preferred
      const aAvail = a.available ?? 0;
      const bAvail = b.available ?? 0;
      return bAvail - aAvail;
    });

  if (scored.length === 0) {
    const err = new Error(
      "No GPUs currently available. All eligible pools are at capacity. Please try again later."
    );
    (err as any).status = 503;
    throw err;
  }

  const selected = scored[0];
  const fallbackPools = scored.slice(1).map(s => s.pool);

  console.log(
    `[selectOptimalPool] Selected pool ${selected.pool.id} (${selected.pool.name}) ` +
    `VRAM: ${selected.vram ? `${(selected.vram.usedMb / 1024).toFixed(1)}GB / ${(selected.vram.totalMb / 1024).toFixed(1)}GB` : 'no data'}, ` +
    `slots: ${selected.available ?? 'unknown'} ` +
    `(${scored.length} eligible, ${fallbackPools.length} fallbacks, ` +
    `VRAM data: ${vramDataAvailable ? 'YES' : 'NO'}, ` +
    `availability API: ${availabilityCheckSucceeded ? 'OK' : 'failed'})`
  );

  return { pool: selected.pool, fallbackPools, blockedPoolIds };
}

/**
 * Try subscribing to a pool, with automatic fallback to alternative pools on "Insufficient resources".
 *
 * Uses the fallbackPools from selectOptimalPool() to retry without re-computing availability.
 */
export async function subscribeWithFallback(params: {
  primaryPool: GPUPoolExtended;
  fallbackPools: GPUPoolExtended[];
  subscribeParams: Omit<SubscribePoolParams, "pool_id">;
}): Promise<{ subscription_id: string; pool: GPUPoolExtended }> {
  const { primaryPool, fallbackPools, subscribeParams } = params;

  // Try the primary pool first
  try {
    const result = await subscribeToPool({
      ...subscribeParams,
      pool_id: String(primaryPool.id),
    });
    return { subscription_id: result.subscription_id, pool: primaryPool };
  } catch (deployError) {
    const errMsg = deployError instanceof Error ? deployError.message : "";
    const isInsufficientResources =
      errMsg.includes("Insufficient resources") || errMsg.includes("10189007");

    if (!isInsufficientResources || fallbackPools.length === 0) {
      throw deployError;
    }

    console.log(
      `[subscribeWithFallback] Pool ${primaryPool.id} rejected with Insufficient resources. ` +
      `Trying ${fallbackPools.length} fallback pools...`
    );

    // Try each fallback pool in order (already sorted by availability)
    for (const candidate of fallbackPools) {
      try {
        console.log(`[subscribeWithFallback] Trying pool ${candidate.id} (${candidate.name})...`);
        const result = await subscribeToPool({
          ...subscribeParams,
          pool_id: String(candidate.id),
        });
        console.log(`[subscribeWithFallback] Success with pool ${candidate.id} (${candidate.name})`);
        return { subscription_id: result.subscription_id, pool: candidate };
      } catch (fallbackErr) {
        const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "";
        console.log(`[subscribeWithFallback] Pool ${candidate.id} also failed: ${fbMsg}`);
        continue;
      }
    }

    // All pools failed — re-throw the original error
    throw deployError;
  }
}

// ============================================
// Storage Management for Pool Subscriptions
// ============================================

export interface AddStorageToSubscriptionParams {
  subscriptionId: string | number;
  teamId: string;
  persistentStorageBlockId: string;
}

export interface StoragePricingInfo {
  hourly_cost: number;
  monthly_cost?: number;
  currency: string;
  storage_block?: {
    id: string;
    name: string;
    size_gb: number;
  };
}

// Get pricing for adding persistent storage to a pool subscription
export async function getPoolSubscriptionStoragePricing(
  regionId: string,
  teamId: string,
  storageBlockId: string
): Promise<StoragePricingInfo> {
  // Get storage block details to calculate pricing
  const storageBlocks = await getPoolPersistentStorageBlocks(regionId, teamId);
  const block = storageBlocks.find(b => b.id === storageBlockId);

  if (!block) {
    throw new Error("Storage block not found");
  }

  // Return pricing info (price_per_hour comes from the storage block)
  return {
    hourly_cost: block.price_per_hour || 0,
    monthly_cost: (block.price_per_hour || 0) * 24 * 30,
    currency: "USD",
    storage_block: {
      id: block.id,
      name: block.name,
      size_gb: block.size_gb || 0,
    },
  };
}

// Add persistent storage to a pool subscription
// Note: This requires unsubscribing and resubscribing with the new storage config
// The restartPoolSubscription function already handles this
export async function addStorageToPoolSubscription(
  params: AddStorageToSubscriptionParams & {
    poolId: string | number;
    vgpus?: number;
    instanceTypeId: string;
    ephemeralStorageBlockId: string;
    imageUuid?: string;
  }
): Promise<{ subscription_id: string }> {
  console.log("Adding persistent storage to subscription:", params.subscriptionId);

  // Use the restart function which unsubscribes and resubscribes with new config
  return restartPoolSubscription(
    params.subscriptionId,
    params.teamId,
    params.poolId,
    params.vgpus || 1,
    params.instanceTypeId,
    params.ephemeralStorageBlockId,
    params.imageUuid,
    params.persistentStorageBlockId
  );
}
