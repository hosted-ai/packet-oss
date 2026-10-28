/**
 * Bare-metal subscription functions for hosted.ai (Ariel native baremetal).
 *
 * These hit HAI's native /baremetal/instances endpoints used for the B200
 * term-prepay flow — distinct from the VM/pod path in instances.ts
 * (/service/i/create-instance). See docs/baremetal-term-prepay-plan.md.
 *
 * Auth is the shared X-API-Key service token via hostedaiRequest.
 */

import { hostedaiRequest } from "./client";

// Payload for POST /baremetal/instances (the subset we send).
export interface SubscribeToBaremetalPayload {
  team_id: string; // required — HAI team UUID
  region_id: number; // required — region the node must live in
  name: string; // required — display name
  gpu_type?: string; // e.g. "B200"
  quantity?: number; // defaults to 1 server-side
  service_id?: string;
  instance_type_id?: number;
  image_hash?: string;
  image_id?: number;
  os_type?: string;
  os_version?: string;
  workspace_id?: string;
  node_id?: number; // pin a specific node; omit to let admin/auto-assign
  ssh_keys?: string[]; // registered SSH key UUIDs
}

// BaremetalSubscriptionResp (subset). The Go DB id is a uint — always numeric
// on the wire (confirmed live: id=4); Packet stores it as String(id) and the
// Go routes ParseUint it back from the URL. Full status set (Go consts):
// Requested → Active → Terminated, plus Failed and Deleting.
export interface BaremetalSubscription {
  id: number;
  nature?: string; // always "baremetal"
  name?: string;
  team_id?: string;
  status?: "Requested" | "Active" | "Terminated" | "Failed" | "Deleting" | string;
  status_desc?: string;
  node_id?: number;
  instance_type_id?: number;
  gpu_type?: string;
  region_id?: number;
  service_id?: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_keys?: string[];
  created_at?: string;
  updated_at?: string;
}

// Response of POST /baremetal/instances/cost-estimate (unit is "monthly").
export interface BaremetalCostEstimate {
  status?: string;
  cost_estimate?: {
    amount: string; // decimal string, e.g. "2500.00"
    currency: string; // e.g. "USD"
    symbol?: string;
    unit?: string; // e.g. "monthly"
    quantity?: number;
  };
  breakdown?: Record<string, unknown>;
}

// Provision one or more bare-metal nodes for a team. Returns one subscription
// per requested unit; status is "Active" (node assigned) or "Requested" (queued
// for async/admin assignment). POST returns an array; we normalize single→array.
export async function subscribeToBaremetal(
  payload: SubscribeToBaremetalPayload
): Promise<BaremetalSubscription[]> {
  const res = await hostedaiRequest<BaremetalSubscription[] | BaremetalSubscription>(
    "POST",
    "/baremetal/instances",
    payload as unknown as Record<string, unknown>
  );
  return Array.isArray(res) ? res : [res];
}

// SSH credentials for a baremetal subscription (GET .../credentials).
// HAI scopes access by the authenticated user — Packet's service key
// resolves any subscription (verified live 2026-06-12). NEVER persist the
// password; fetch on demand and hand it straight to the customer.
export interface BaremetalCredentials {
  ip?: string;
  username?: string;
  password?: string;
  port?: number;
}

export async function getBaremetalCredentials(
  subscriptionId: string | number
): Promise<BaremetalCredentials> {
  return hostedaiRequest<BaremetalCredentials>(
    "GET",
    `/baremetal/instances/${subscriptionId}/credentials`
  );
}

// All platform regions (unfiltered). Prefer getServiceCompatibleRegions
// (instances.ts) when a service + team are known — it is baremetal-aware
// (Go: GetCompatibleRegions sets nature="baremetal" for baremetal_gpu
// services) and respects team region-access policy.
export interface HAIRegion {
  id: number;
  region_name: string;
  city?: string;
  country?: string;
}
export async function getAllRegions(): Promise<HAIRegion[]> {
  const res = await hostedaiRequest<HAIRegion[]>("GET", "/regions");
  return Array.isArray(res) ? res : [];
}

// List a team's bare-metal subscriptions (Requested + Active).
export async function listBaremetalInstances(teamId: string): Promise<BaremetalSubscription[]> {
  const res = await hostedaiRequest<BaremetalSubscription[] | BaremetalSubscription>(
    "GET",
    `/baremetal/instances?team_id=${encodeURIComponent(teamId)}`
  );
  return Array.isArray(res) ? res : res && (res as BaremetalSubscription).id ? [res as BaremetalSubscription] : [];
}

// Get a single bare-metal subscription. team_id is REQUIRED by HAI as a query param.
export async function getBaremetalInstance(
  id: string | number,
  teamId: string
): Promise<BaremetalSubscription> {
  return hostedaiRequest<BaremetalSubscription>(
    "GET",
    `/baremetal/instances/${id}?team_id=${encodeURIComponent(teamId)}`
  );
}

// Audit-log rows for a baremetal subscription (GET .../logs).
//
// PA-688: the only way to recover node_id for a TERMINATED subscription. HAI
// soft-deletes subscriptions on release and its normal getters exclude
// soft-deleted rows, so getBaremetalInstance returns nothing — but
// baremetal_audit_logs rows survive and carry node_id. The HAI handler queries
// purely by subscription id (no active-status check, no team scoping), so this
// works for historical rows.
export interface BaremetalAuditLogEntry {
  id?: number;
  subscription_id?: number;
  action?: string;
  status?: string;
  event_description?: string;
  node_id?: number | null;
  started_at?: string;
  completed_at?: string | null;
}

export async function getBaremetalAuditLogs(
  subscriptionId: string | number
): Promise<BaremetalAuditLogEntry[]> {
  // Paginated. The real response shape is `{logs, total_count, page, page_size}`
  // — verified live 2026-08-06. `items` is accepted too because other paginated
  // HAI admin endpoints use that key, and a bare array in case it changes again;
  // reading the wrong key here fails SILENTLY (empty history, everything looks
  // unresolvable), which is exactly how this was missed the first time.
  const res = await hostedaiRequest<
    | BaremetalAuditLogEntry[]
    | { logs?: BaremetalAuditLogEntry[]; items?: BaremetalAuditLogEntry[] }
  >("GET", `/baremetal/instances/${subscriptionId}/logs`);
  if (Array.isArray(res)) return res;
  const bag = res as { logs?: BaremetalAuditLogEntry[]; items?: BaremetalAuditLogEntry[] } | null;
  const rows = bag?.logs ?? bag?.items;
  return Array.isArray(rows) ? rows : [];
}

// Estimate the (monthly) cost for a bare-metal config before ordering.
export async function getBaremetalCostEstimate(
  payload: SubscribeToBaremetalPayload
): Promise<BaremetalCostEstimate> {
  return hostedaiRequest<BaremetalCostEstimate>(
    "POST",
    "/baremetal/instances/cost-estimate",
    payload as unknown as Record<string, unknown>
  );
}

// Release / terminate a bare-metal subscription. team_id REQUIRED as query param.
// Idempotent: a 404 means the node is already gone, which is success — a
// double-release (auto-terminate cron racing a manual terminate / cancel) must
// not raise a false failure.
export async function terminateBaremetal(
  id: string | number,
  teamId: string
): Promise<void> {
  try {
    await hostedaiRequest(
      "DELETE",
      `/baremetal/instances/${id}?team_id=${encodeURIComponent(teamId)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("(404)")) return; // already released — treat as success
    throw err;
  }
}

export interface WaitForBaremetalOptions {
  maxMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export interface BaremetalWaitResult {
  active: boolean;
  finalStatus: string;
  subscription: BaremetalSubscription;
}

// Poll a baremetal subscription until "Active", a terminal failure, or the
// deadline. Returns the last-seen subscription. Mirrors waitForInstanceRunning.
// Transient errors are swallowed and retried (staging node assignment is async).
export async function waitForBaremetalActive(
  id: string | number,
  teamId: string,
  opts: WaitForBaremetalOptions = {}
): Promise<BaremetalWaitResult> {
  const maxMs = opts.maxMs ?? 15 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 30 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + maxMs;
  let last: BaremetalSubscription = { id: Number(id) };

  while (Date.now() < deadline) {
    try {
      last = await getBaremetalInstance(id, teamId);
      const status = last.status || "";
      if (status === "Active") return { active: true, finalStatus: status, subscription: last };
      if (status === "Terminated" || status === "Failed") {
        return { active: false, finalStatus: status, subscription: last };
      }
      // "Requested" / "Deleting" — keep polling
    } catch {
      // transient (5xx / timeout) — keep polling
    }
    await sleep(intervalMs);
  }
  return { active: false, finalStatus: last.status || "timeout", subscription: last };
}
