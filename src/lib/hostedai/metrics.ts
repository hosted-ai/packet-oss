/**
 * GPUaaS metrics functions for hosted.ai
 */

import { hostedaiRequest } from "./client";
import type {
  GPUaaSMetricsResponse,
  GPUaaSMetricsGraphResponse,
} from "./types";

// Get GPUaaS usage metrics for team
// Endpoint: GET /gpuaas/{team_id}/metrics
export async function getGPUaaSMetrics(
  teamId: string,
  options?: {
    startDate?: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
    page?: number;
    limit?: number;
  }
): Promise<GPUaaSMetricsResponse> {
  const params = new URLSearchParams();
  if (options?.startDate) params.append("start_date", options.startDate);
  if (options?.endDate) params.append("end_date", options.endDate);
  // API requires page and itemsPerPage parameters (not per_page or limit)
  params.append("page", String(options?.page || 1));
  params.append("itemsPerPage", String(options?.limit || 500));

  const queryString = params.toString();
  const endpoint = `/gpuaas/${teamId}/metrics?${queryString}`;

  console.log("Fetching GPUaaS metrics from:", endpoint);

  try {
    const response = await hostedaiRequest<GPUaaSMetricsResponse>("GET", endpoint);
    console.log("GPUaaS metrics response:", JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error("Failed to get GPUaaS metrics:", error);
    return { items: [], total_hours: 0, total_cost: 0 };
  }
}

// Get GPUaaS TFLOPS graph data
// Endpoint: GET /gpuaas/{team_id}/metrics-graph
export async function getGPUaaSMetricsGraph(
  teamId: string,
  startTimestamp: number, // Unix timestamp in seconds
  endTimestamp: number, // Unix timestamp in seconds
  granularity: "hourly" | "daily" | "weekly" = "hourly"
): Promise<GPUaaSMetricsGraphResponse> {
  // Map granularity to API format
  const granularityMap = {
    hourly: "1h",
    daily: "1d",
    weekly: "1w",
  };

  const params = new URLSearchParams({
    start_timestamp: String(startTimestamp),
    end_timestamp: String(endTimestamp),
    granularity: granularityMap[granularity],
  });

  const endpoint = `/gpuaas/${teamId}/metrics-graph?${params.toString()}`;
  console.log("Fetching GPUaaS metrics graph from:", endpoint);

  try {
    const response = await hostedaiRequest<GPUaaSMetricsGraphResponse>("GET", endpoint);
    console.log("GPUaaS metrics graph response:", JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error("Failed to get GPUaaS metrics graph:", error);
    return { data: [], total_hours: 0 };
  }
}

// Helper to get GPU hours used since last sync
// Uses the metrics API instead of the billing API
export async function getGPUaaSHoursUsed(
  teamId: string,
  sinceTimestamp?: number // Unix timestamp in seconds
): Promise<{ hoursUsed: number; totalCost: number }> {
  const now = Math.floor(Date.now() / 1000);
  const since = sinceTimestamp || (now - 3600); // Default: last hour

  // Try metrics-graph first for accurate hourly data
  const graphData = await getGPUaaSMetricsGraph(teamId, since, now, "hourly");

  if (graphData.total_hours !== undefined && graphData.total_hours > 0) {
    return {
      hoursUsed: graphData.total_hours,
      // Use total_cost from API response if available, otherwise return 0
      // Note: Cost should be calculated from actual GPU pricing, not hardcoded
      totalCost: 0, // Cost is tracked separately via billing API
    };
  }

  // Fallback to regular metrics endpoint
  const startDate = new Date(since * 1000).toISOString().split("T")[0];
  const endDate = new Date(now * 1000).toISOString().split("T")[0];

  const metrics = await getGPUaaSMetrics(teamId, {
    startDate,
    endDate,
    limit: 100,
  });

  const totalHours = metrics.total_hours ||
    (metrics.items || metrics.metrics || []).reduce((sum, m) => sum + (m.hours_used || 0), 0);

  return {
    hoursUsed: totalHours,
    // Use total_cost from API response if available, otherwise return 0
    // Note: Cost should be calculated from actual GPU pricing, not hardcoded
    totalCost: metrics.total_cost || 0,
  };
}
