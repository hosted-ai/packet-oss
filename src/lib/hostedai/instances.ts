/**
 * Instance management functions for hosted.ai
 */

import { hostedaiRequest } from "./client";
import { scenarioName } from "./scenario-name";
import { isRegionInMaintenance, RegionMaintenanceError } from "@/lib/maintenance/regions";
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

// HAI 2.2 unified instance shape (from GET /instances/unified)
export interface UnifiedInstance {
  id: string;
  name: string;
  created_at: string;
  status: string;
  nature: string;
  ip: string[];
  service?: { id: string; name: string; type: string };
  team?: { id: string; name: string };
  region?: {
    id: number;
    region_name: string;
    city?: string;
    country?: string;
    country_code?: string;
  };
  workspace?: { id: string; name: string };
  pod_info?: {
    pool_id?: number; // present on both list + detail responses (despite older code assuming otherwise)
    model?: string;
    vendor?: string;
    pool_name?: string;
    pool_label?: string;
    pool_display_mode?: string;
    provisioned_service_name?: string;
    exposed_count?: number;
    vram_gb?: string;
    max_tflops?: string;
    vgpu_count?: number; // present on the DETAIL response only (list omits it)
  };
  instance_type?: {
    id: string;
    name: string;
    cpu_cores: number;
    ram_mb: number;
    scale?: number;
  };
}

// HAI 2.2 detailed instance (from GET /instances/unified/{id})
export interface UnifiedInstanceDetail extends UnifiedInstance {
  region?: {
    id: number;
    region_name: string;
    city?: string;
    country?: string;
    country_code?: string;
    has_shared_storage_support?: boolean;
  };
  root_disk?: { id: string; name: string; size_gb: number };
  shared_volumes?: Array<{
    id: number;
    name: string;
    mount_point: string;
    size_in_gb: number;
    status: string;
    mount_operation?: string;
    mount_status?: string;
    mount_error?: string;
  }>;
}

// Get a single unified instance by ID (HAI 2.2)
// The newest app-install recipe execution for an instance, or null if none has
// started. A GPU "app" deploy runs an Ansible recipe after the pod boots; when it
// fails the pod never reports running, so without this the deploy only surfaces
// as a poll timeout minutes later.
export async function getLatestRecipeExecution(
  instanceId: string
): Promise<RecipeExecution | null> {
  const resp = await hostedaiRequest<{ recipe_logs?: { items?: RecipeExecution[] } }>(
    "GET",
    `/user/recipes/execution-logs?instance_id=${encodeURIComponent(instanceId)}&per_page=1`
  );
  return resp?.recipe_logs?.items?.[0] ?? null;
}

export interface RecipeExecution {
  id?: string;
  status?: string;
  service_name?: string;
  failure_context?: string;
}

// Unified instance ids are `i-<uuid>`; pool-subscription ids are numeric.
export function isUnifiedInstanceId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith("i-");
}

export async function getUnifiedInstanceDetail(
  instanceId: string
): Promise<UnifiedInstanceDetail> {
  return hostedaiRequest<UnifiedInstanceDetail>(
    "GET",
    `/instances/unified/${instanceId}`
  );
}

// ── GPU utilization metrics (HAI-sourced) ───────────────────────────────────
// Real GPU telemetry (TFLOPs + VRAM) bucketed over time, served by the HAI
// user-panel API from its Prometheus-backed `team_metrics`. This replaces the
// old per-pod SSH `nvidia-smi` collector — HAI is the source of truth.

export type MetricsWindow =
  | "last_5m"
  | "last_15m"
  | "last_1h"
  | "last_24h"
  | "last_7d"
  | "all_time";

// tflops/vram_mib are null for a bucket the telemetry never reported. Typing
// them as number let a missing reading render as a measured zero.
export interface GpuMetricsPoint {
  unix_timestamp: number;
  formatted_time: string;
  tflops: number | null;
  vram_mib: number | null;
}

/** Per-pod GPU metrics time series (HAI GET /pods/metrics). */
export async function getPodMetricsV2(
  podId: string,
  teamId: string,
  window: MetricsWindow
): Promise<GpuMetricsPoint[]> {
  const qs = new URLSearchParams({ pod_id: podId, team_id: teamId, window });
  return hostedaiRequest<GpuMetricsPoint[]>("GET", `/pods/metrics?${qs.toString()}`);
}

/** Team-wide GPU metrics time series, aggregated across all the team's pods
 *  (HAI GET /pods/team-metrics). */
export async function getTeamMetricsV2(
  teamId: string,
  window: MetricsWindow
): Promise<GpuMetricsPoint[]> {
  const qs = new URLSearchParams({ team_id: teamId, window });
  return hostedaiRequest<GpuMetricsPoint[]>("GET", `/pods/team-metrics?${qs.toString()}`);
}

// Status classification for HAI 2.2 unified instances.
// Matches existing usage in huggingface/deploy/[id] and huggingface/deploy-status routes.
const RUNNING_STATUSES = new Set(["running", "active"]);
const TERMINAL_FAIL_STATUSES = new Set([
  "succeeded", "failed", "terminated", "error", "crashloopbackoff", "stopped",
]);

export type WaitResult =
  | { ready: true; finalStatus: string }
  | { ready: false; reason: string; finalStatus: string };

export interface WaitForInstanceOptions {
  maxMs?: number;
  intervalMs?: number;
  // Injectable for testing — defaults to getUnifiedInstanceDetail.
  getDetail?: (id: string) => Promise<{ status?: string }>;
  // Injectable for testing — defaults to setTimeout-based sleep.
  sleep?: (ms: number) => Promise<void>;
  // Injectable for testing — defaults to getLatestRecipeExecution. Returning null
  // means "no recipe for this instance", which is the normal case for a plain pod.
  getRecipe?: (id: string) => Promise<RecipeExecution | null>;
}

// Poll HAI for an instance's status until it reaches running, terminal failure,
// or the deadline. Used by deploy code to detect "createInstance returned an id
// but the pod silently died" and trigger a wallet refund.
//
// 404 handling: HAI auto-deprovisions instances that fail to schedule or stay
// pending for >10min. A single 404 *could* be a transient API blip (e.g. a
// brief reschedule race), so we require two consecutive 404s ~30s apart
// before declaring the instance deleted. Any non-404 response between two
// 404s resets the counter.
export async function waitForInstanceRunning(
  instanceId: string,
  opts: WaitForInstanceOptions = {}
): Promise<WaitResult> {
  const maxMs = opts.maxMs ?? 13 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 30 * 1000;
  const getDetail = opts.getDetail ?? getUnifiedInstanceDetail;
  const getRecipe = opts.getRecipe ?? getLatestRecipeExecution;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + maxMs;
  let consecutive404s = 0;

  while (Date.now() < deadline) {
    try {
      const detail = await getDetail(instanceId);
      const status = (detail.status || "").toLowerCase();
      consecutive404s = 0; // a successful response invalidates any prior 404 streak
      if (RUNNING_STATUSES.has(status)) {
        return { ready: true, finalStatus: status };
      }
      if (TERMINAL_FAIL_STATUSES.has(status)) {
        return { ready: false, reason: `terminal status: ${status}`, finalStatus: status };
      }
      // An app pod only reaches running once its recipe installs. A failed recipe
      // never recovers, so waiting out the deadline just bills the customer for a
      // machine that will be deleted, and reports it as a timeout rather than the
      // install error it is.
      const recipeFail = await recipeFailure(getRecipe, instanceId);
      if (recipeFail) {
        return { ready: false, reason: recipeFail, finalStatus: "recipe_failed" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("(404)")) {
        consecutive404s += 1;
        if (consecutive404s >= 2) {
          return { ready: false, reason: "instance deleted by HAI", finalStatus: "deleted" };
        }
        // first 404 — wait and re-check; might be a transient blip
      }
      // Transient errors (5xx, timeouts) — keep polling, leave 404 streak as-is
      // so two non-consecutive 404s separated by a 5xx don't trigger deletion.
    }
    await sleep(intervalMs);
  }
  return { ready: false, reason: `poll timeout after ${Math.round(maxMs / 60000)}min`, finalStatus: "timeout" };
}

// recipeFailure reports a failed app-install recipe, or null. The catch is
// belt-and-braces: the caller's 404-streak reset already absorbs a throw here, so
// no test can distinguish it — but a diagnostic lookup should not be able to
// reach the poll loop's error handling in the first place.
async function recipeFailure(
  getRecipe: (id: string) => Promise<RecipeExecution | null>,
  instanceId: string
): Promise<string | null> {
  try {
    const rec = await getRecipe(instanceId);
    if (!rec || (rec.status || "").toLowerCase() !== "failed") return null;
    const app = rec.service_name ? ` (${rec.service_name})` : "";
    const ref = rec.id ? ` [recipe execution ${rec.id}]` : "";
    return `app install failed${app}${ref}`;
  } catch {
    return null;
  }
}

// Attach or detach shared volumes on a running pod
export async function podVolumeAction(
  podName: string,
  action: "attach_volume" | "detach_volume",
  volumeIds: number[]
): Promise<void> {
  await hostedaiRequest("POST", "/pods/volume-action", {
    pod_name: podName,
    action,
    volumes: volumeIds,
  });
}

// PA-422: HAI intermittently returns HTTP 200 with "items": null during a
// control-plane hiccup. Every caller coerces that to [] (result.items || []),
// which silently renders a false-empty dashboard and — worse — makes the
// deploy-flow stale-pod cleanup treat every pod as stale and delete its
// metadata. "Upstream failed" and "genuinely no instances" are told apart by
// the pagination envelope (see getUnifiedInstances), so we guard at this single
// chokepoint (all ~15 callers route through here) and throw on the failure
// case. Callers that already try/catch a HAI failure now do the safe thing on
// it too; the rest surface an honest transient error rather than a convincing
// empty state.
export class UnifiedInstancesUnavailableError extends Error {
  constructor(public readonly teamId: string) {
    super(
      `HAI /instances/unified returned a non-array "items" for ${
        teamId ? `team ${teamId}` : "the global sweep"
      } — treating as upstream failure, not an empty instance list`
    );
    this.name = "UnifiedInstancesUnavailableError";
  }
}

// Get unified instances for a team (HAI 2.2)
export async function getUnifiedInstances(
  teamId: string,
  page = 0,
  perPage = 100
): Promise<{ items: UnifiedInstance[]; total_items: number }> {
  const result = await hostedaiRequest<{
    items: UnifiedInstance[] | null;
    total_items?: number;
  }>(
    "GET",
    `/instances/unified?page=${page}&per_page=${perPage}&team_id=${teamId}`,
    undefined,
    60000
  );
  if (!Array.isArray(result.items)) {
    // Only a real list response carries the pagination envelope: a null items
    // alongside total_items is a team with nothing running, not an outage.
    if (typeof result.total_items === "number") {
      return { ...result, items: [], total_items: result.total_items };
    }
    // Loud server-side log — this was previously invisible (PA-422).
    console.error(
      `[Hosted.AI] /instances/unified returned non-array items with no pagination envelope for team ${teamId} (HTTP 200, items=${JSON.stringify(
        result.items
      )}) — treating as upstream failure`
    );
    throw new UnifiedInstancesUnavailableError(teamId);
  }
  return result as { items: UnifiedInstance[]; total_items: number };
}

// Status count entry from HAI 2.2 /instances/unified response
export interface InstanceStatusCount {
  status: string;
  count: number;
}

// Global instance summary (no team_id filter)
export interface GlobalInstanceSummary {
  statusCounts: InstanceStatusCount[];
  totalItems: number;
}

// Get global instance summary from HAI 2.2 (all teams, all statuses)
// Uses per_page=1 to minimize payload — we only need status_counts and total_items
export async function getGlobalInstanceSummary(): Promise<GlobalInstanceSummary> {
  const response = await hostedaiRequest<{
    items: unknown[];
    status_counts: InstanceStatusCount[];
    total_items: number;
  }>(
    "GET",
    `/instances/unified?page=0&per_page=1`,
    undefined,
    30000
  );
  return {
    statusCounts: response.status_counts || [],
    totalItems: response.total_items || 0,
  };
}

// Get ALL unified instances globally (paginated, no team filter)
// Used by admin pods to get actual running/stopped instances
const MAX_INSTANCE_PAGES = 500;

export async function getAllUnifiedInstances(): Promise<UnifiedInstance[]> {
  const all: UnifiedInstance[] = [];
  const perPage = 100;
  for (let page = 0; page < MAX_INSTANCE_PAGES; page++) {
    const res = await hostedaiRequest<{ items: UnifiedInstance[] | null; total_items?: number }>(
      "GET",
      `/instances/unified?page=${page}&per_page=${perPage}`,
      undefined,
      60000
    );
    // The per-team read's items-null guard, which this sweep never had: ending
    // the walk on it truncates the result, and every team below the cut then
    // reads as a confident "0 active GPUs" rather than an upstream failure.
    if (!Array.isArray(res.items)) {
      if (typeof res.total_items === "number") break;
      throw new UnifiedInstancesUnavailableError("");
    }
    if (res.items.length === 0) break;
    all.push(...res.items);
    // total_items is the authority on where the listing ends: HAI may serve
    // fewer rows than the requested per_page, which a short-page stop misread.
    const done = typeof res.total_items === "number"
      ? all.length >= res.total_items
      : res.items.length < perPage;
    if (done) break;
  }
  return all;
}

// Get workspaces for a team (every team has at least one default workspace)
export async function getTeamWorkspaces(
  teamId: string
): Promise<Array<{ id: string; name: string }>> {
  const res = await hostedaiRequest<{
    workspaces: Array<{ id: string; name: string }>;
  }>("GET", `/workspace?page=0&itemsPerPage=10&teamId=${teamId}`);
  return res.workspaces || [];
}

// Create a new instance
export async function createInstance(
  params: CreateInstanceParams
): Promise<Instance> {
  // Defense-in-depth region maintenance gate. Every GPU create path flows
  // through here, so block provisions into a region under maintenance even on
  // the paths that don't pre-check (snapshot restore, HF deploy, v1/API). The
  // main /api/instances flow pre-checks and returns a clean 503 before reaching
  // this; here we throw — and those secondary paths already refund on a
  // createInstance throw. Fail-open inside the resolver (a DB blip won't block).
  const maint = await isRegionInMaintenance(params.region_id);
  if (maint.inMaintenance) {
    throw new RegionMaintenanceError(maint.message);
  }

  // Ariel (HAI 2.2) supports rootfs persistence for GPUaaS pods. Enable it by
  // default on EVERY provision path (this is the single chokepoint all callers
  // — /api/instances, v1, from-snapshot, huggingface — flow through). A caller
  // can still opt out by passing pod_opts.rootfs_enabled = false explicitly.
  const withRootfs: CreateInstanceParams = {
    ...params,
    pod_opts: {
      ...(params.pod_opts ?? {}),
      rootfs_enabled: params.pod_opts?.rootfs_enabled ?? true,
    },
  };
  return hostedaiRequest<Instance>("POST", "/service/i/create-instance", withRootfs as unknown as Record<string, unknown>);
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

// ============================================
// Scenario Management
// ============================================

// List all scenarios in HAI
export async function listScenarios(): Promise<ServiceScenario[]> {
  const res = await hostedaiRequest<{ scenarios: ServiceScenario[] } | ServiceScenario[]>(
    "GET",
    "/scenario"
  );
  return Array.isArray(res) ? res : res.scenarios;
}

// Create a scenario in HAI. The name is coerced to HAI's own rule first —
// an unsupported character makes it reject the whole call.
export async function createScenario(opts: {
  name: string;
  description: string;
}): Promise<{ id: string }> {
  const body = { ...opts, name: scenarioName(opts.name) };
  return hostedaiRequest<{ id: string }>("POST", "/scenario", body as unknown as Record<string, unknown>);
}

// Assign a service to a scenario
export async function assignServiceToScenario(
  serviceId: string,
  scenarioId: string
): Promise<void> {
  await hostedaiRequest("POST", "/scenario/assign-service", {
    service_id: serviceId,
    scenario_id: scenarioId,
  });
}

// Unassign a service from a scenario
export async function unassignServiceFromScenario(
  serviceId: string,
  scenarioId: string
): Promise<void> {
  await hostedaiRequest("POST", "/scenario/unassign-service", {
    service_id: serviceId,
    scenario_id: scenarioId,
  });
}

export type CompatibleService = {
  id: string;
  name: string;
  description: string;
  service_type: string;
  regions: Array<{ id: number; name: string }>;
  tags?: string[];
};

// Get compatible services under a scenario for a team
// HAI may return { services: [...] } or a bare array depending on version
export async function getScenarioCompatibleServices(
  scenarioId: string,
  teamId: string,
  limit = 50,
  offset = 0
): Promise<
  | { services: CompatibleService[]; has_more_batches: boolean; next_offset: number }
  | CompatibleService[]
> {
  // PA-407: HAI takes 12-19s to compute this for the B200 scenario (other
  // categories: 1-2s) and latency varies per team. The default 15s GET
  // timeout sat inside that band, so checks timed out and the launch modal
  // showed "No GPUs available" intermittently. 45s = ~2.4x worst measured,
  // still under nginx's 60s proxy window. Real fix is HAI-side performance.
  return hostedaiRequest(
    "GET",
    `/service/i/scenario-compatible-services?scenario_id=${scenarioId}&team_id=${teamId}&limit=${limit}&offset=${offset}`,
    undefined,
    45_000
  );
}

// ============================================
// Service Provisioning APIs
// ============================================

// Get compatible regions for a service
export async function getServiceCompatibleRegions(
  serviceId: string,
  teamId: string
): Promise<Array<{ id: number; region_name: string; name?: string; country?: string; city?: string }>> {
  return hostedaiRequest(
    "GET",
    `/service/i/compatible-regions?service_id=${serviceId}&team_id=${teamId}`
  );
}

// Get compatible GPU pools for a service in a region
export async function getServiceCompatibleGPUPools(
  serviceId: string,
  teamId: string,
  regionId: number
): Promise<Array<{
  id: number;
  name: string;
  gpu_model?: string;
  available_vgpus?: number;
  total_vgpus?: number;
}>> {
  return hostedaiRequest(
    "GET",
    `/service/i/compatible-gpu-pools?service_id=${serviceId}&team_id=${teamId}&region_id=${regionId}`
  );
}

// Get provisioning info for a service (returns locked defaults)
export async function getServiceProvisioningInfo(
  serviceId: string,
  teamId: string,
  regionId: number
): Promise<Record<string, unknown>> {
  return hostedaiRequest(
    "GET",
    `/service/i/provisioning-info?service_id=${serviceId}&team_id=${teamId}&region_id=${regionId}`
  );
}

// Get a HAI service by ID (returns the full service object including gpu_config)
export async function getHAIService(
  serviceId: string
): Promise<Record<string, unknown>> {
  return hostedaiRequest<Record<string, unknown>>(
    "GET",
    `/service/${serviceId}`
  );
}

// Update a HAI service (read-modify-write since PUT requires full body)
export async function updateHAIService(
  serviceId: string,
  opts: Record<string, unknown>
): Promise<void> {
  // GET current service to get the full object
  const current = await hostedaiRequest<Record<string, unknown>>(
    "GET",
    `/service/${serviceId}`
  );

  // Deep-merge opts into current — supports nested objects like gpu_config
  const merged = { ...current };
  for (const [key, value] of Object.entries(opts)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      // Merge nested object (e.g., gpu_config)
      merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      merged[key] = value;
    }
  }

  await hostedaiRequest("PUT", `/service/${serviceId}`, merged);
}
