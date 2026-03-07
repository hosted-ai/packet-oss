/**
 * Billing and usage tracking functions for hosted.ai
 */

import { getApiUrl, getApiKey } from "./client";
import { getPoolSubscriptions } from "./pools";
import type { TeamBillingData, BillingSummaryResponse } from "./types";

// Format date for billing API: YYYY-MM-DDTHH:mm
export function formatBillingDatetime(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Get team billing data
// Endpoint: GET /team-billing/{team_id}/{start_datetime}/{end_datetime}/{interval}?timezone=UTC
// Datetime format: YYYY-MM-DDTHH:mm
// Interval: daily, weekly, monthly
export async function getTeamBillingSummary(
  teamId: string,
  startDatetime: string, // YYYY-MM-DDTHH:mm
  endDatetime: string, // YYYY-MM-DDTHH:mm
  interval: "daily" | "weekly" | "monthly" = "daily"
): Promise<TeamBillingData> {
  const url = `${getApiUrl()}/api/team-billing/${teamId}/${startDatetime}/${endDatetime}/${interval}?timezone=UTC`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": getApiKey(),
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    console.log("Team billing API response status:", response.status, "body:", text);

    if (!text) {
      console.log("Billing API returned empty response");
      return { total_cost: 0, total_hours: 0, instances: [] };
    }

    try {
      const data = JSON.parse(text) as TeamBillingData;

      // Handle failure responses gracefully
      if (data.result === "FAILURE" || !response.ok) {
        console.log("Billing API returned failure:", data.errors);
        return { total_cost: 0, total_hours: 0, instances: [] };
      }

      return data;
    } catch {
      console.log("Billing API returned non-JSON response");
      return { total_cost: 0, total_hours: 0, instances: [] };
    }
  } catch (error) {
    console.error("Billing API request failed:", error);
    return { total_cost: 0, total_hours: 0, instances: [] };
  }
}

// Helper to get billing for current day (for hourly sync)
export async function getTeamBillingLastHour(teamId: string): Promise<{
  totalCost: number;
  hoursUsed: number;
}> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const billing = await getTeamBillingSummary(
    teamId,
    formatBillingDatetime(startOfDay),
    formatBillingDatetime(now),
    "daily"
  );

  // Get total cost and hours from billing response
  const totalCost = billing.total_cost || 0;
  const hoursUsed = billing.total_hours || totalCost / 2; // Fallback to estimate

  return { totalCost, hoursUsed };
}

// Get team billing summary - this is the preferred endpoint for usage tracking
// Endpoint: GET /team-billing/summary/{team_id}/{start_datetime}/{end_datetime}
// Datetime format: YYYY-MM-DDTHH:mm
export async function getTeamBillingSummaryV2(
  teamId: string,
  startDatetime: string, // YYYY-MM-DDTHH:mm
  endDatetime: string // YYYY-MM-DDTHH:mm
): Promise<BillingSummaryResponse> {
  const url = `${getApiUrl()}/api/team-billing/summary/${teamId}/${startDatetime}/${endDatetime}`;

  console.log("Fetching team billing summary from:", url);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": getApiKey(),
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    console.log("Team billing summary API response status:", response.status, "body:", text);

    if (!text) {
      console.log("Billing summary API returned empty response");
      return { total_cost: 0, total_hours: 0, pool_hours: 0 };
    }

    try {
      const data = JSON.parse(text) as BillingSummaryResponse;

      // Handle failure responses gracefully
      if (!response.ok) {
        console.log("Billing summary API returned error:", response.status);
        return { total_cost: 0, total_hours: 0, pool_hours: 0 };
      }

      return data;
    } catch {
      console.log("Billing summary API returned non-JSON response:", text);
      return { total_cost: 0, total_hours: 0, pool_hours: 0 };
    }
  } catch (error) {
    console.error("Billing summary API request failed:", error);
    return { total_cost: 0, total_hours: 0, pool_hours: 0 };
  }
}

// Get usage for last billing period (e.g., last 30 minutes for cron)
// Uses active subscriptions to calculate GPU-hours based on sync interval
// This is more reliable than the billing summary API which may return 0 hours
// when the pricing policy is misconfigured (zero cost)
export async function getTeamUsageSinceLast(
  teamId: string,
  minutesBack: number = 30
): Promise<{ hoursUsed: number; totalCost: number }> {
  // Get active pool subscriptions for this team
  const subscriptions = await getPoolSubscriptions(teamId);

  // Calculate GPU-hours based on RUNNING pods only
  // Only count pods that are actively running (not stopped/paused)
  let activeGpuCount = 0;
  let totalSubsChecked = 0;
  let totalPodsChecked = 0;

  for (const sub of subscriptions) {
    // Skip subscriptions that aren't active
    if (sub.status !== "subscribed" && sub.status !== "active") {
      continue;
    }

    totalSubsChecked++;

    // Get GPU count per pod from subscription config - always at least 1, round up fractional
    const vgpuCount = Math.max(1, Math.ceil(sub.per_pod_info?.vgpu_count || 1));

    // Count running pods
    if (sub.pods && sub.pods.length > 0) {
      for (const pod of sub.pods) {
        totalPodsChecked++;
        const podStatus = (pod.pod_status || "").toLowerCase();
        // Only bill for running pods
        if (podStatus === "running") {
          const podGpuCount = Math.max(1, Math.ceil(pod.gpu_count || vgpuCount));
          activeGpuCount += podGpuCount;
          console.log(`[Billing] Pod ${pod.pod_name} is running with ${podGpuCount} GPU(s)`);
        } else {
          console.log(`[Billing] Pod ${pod.pod_name} status "${podStatus}" - not billing`);
        }
      }
    } else {
      // No pods array - subscription may be initializing
      // Don't bill if there are no pods yet
      console.log(`[Billing] Subscription ${sub.id} has no pods array, status: ${sub.status}`);
    }
  }

  // Calculate hours based on sync interval
  // minutesBack = 30 means we're calculating usage for the last 30 minutes
  const hoursInInterval = minutesBack / 60;
  const gpuHours = activeGpuCount * hoursInInterval;

  // NOTE: Cost calculation is done by the sync endpoint using per-product rates from PodMetadata
  // We only return GPU-hours here - the caller handles rate lookup
  console.log(`[Billing] Usage for team ${teamId} last ${minutesBack}min: subs=${totalSubsChecked}, pods=${totalPodsChecked}, runningGpus=${activeGpuCount}, gpuHours=${gpuHours.toFixed(4)}`);

  return {
    hoursUsed: gpuHours,
    totalCost: 0, // Cost is calculated by sync endpoint using product rates
  };
}
