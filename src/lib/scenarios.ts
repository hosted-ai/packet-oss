/**
 * Packet Scenario Management
 *
 * Manages two HAI scenarios that Packet uses for service discovery:
 * - packet-gpu-provisioning: bare GPU services (one per GpuProduct)
 * - packet-apps: recipe-backed app services (one per deployable GpuApp)
 *
 * Scenarios are auto-created on first use and stored in SystemSetting.
 * Services are auto-assigned/unassigned when admin configures products or apps.
 */

import { getSetting, setSetting } from "@/lib/settings";
import {
  createScenario,
  assignServiceToScenario,
  unassignServiceFromScenario,
} from "@/lib/hostedai";

const GPU_SCENARIO_KEY = "packet_gpu_scenario_id";
const APPS_SCENARIO_KEY = "packet_apps_scenario_id";

/**
 * Get or create the GPU provisioning scenario.
 * Returns the scenario UUID.
 */
export async function getGpuScenarioId(): Promise<string> {
  let scenarioId = await getSetting(GPU_SCENARIO_KEY);
  if (scenarioId) return scenarioId;

  console.log("[Scenarios] Creating GPU provisioning scenario in HAI...");
  try {
    const result = await createScenario({
      name: "Packet GPU Provisioning",
      description: "Bare GPU pod services managed by Packet.ai dashboard",
    });
    scenarioId = result.id;
    await setSetting(GPU_SCENARIO_KEY, scenarioId);
    console.log(`[Scenarios] Created GPU scenario: ${scenarioId}`);
    return scenarioId;
  } catch (error) {
    console.error("[Scenarios] Failed to create GPU scenario:", error);
    throw error;
  }
}

/**
 * Get or create the Apps scenario.
 * Returns the scenario UUID.
 */
export async function getAppsScenarioId(): Promise<string> {
  let scenarioId = await getSetting(APPS_SCENARIO_KEY);
  if (scenarioId) return scenarioId;

  console.log("[Scenarios] Creating Apps scenario in HAI...");
  try {
    const result = await createScenario({
      name: "Packet Apps",
      description: "Recipe-backed app services managed by Packet.ai dashboard",
    });
    scenarioId = result.id;
    await setSetting(APPS_SCENARIO_KEY, scenarioId);
    console.log(`[Scenarios] Created Apps scenario: ${scenarioId}`);
    return scenarioId;
  } catch (error) {
    console.error("[Scenarios] Failed to create Apps scenario:", error);
    throw error;
  }
}

/**
 * Assign a service to the GPU provisioning scenario.
 * Called when admin links a serviceId to a GpuProduct.
 */
export async function assignGpuService(serviceId: string): Promise<void> {
  try {
    const scenarioId = await getGpuScenarioId();
    await assignServiceToScenario(serviceId, scenarioId);
    console.log(`[Scenarios] Assigned service ${serviceId} to GPU scenario`);
  } catch (error) {
    // Log but don't fail — scenario assignment is best-effort
    // The service still works via direct serviceId, just won't appear in scenario queries
    console.error(`[Scenarios] Failed to assign GPU service ${serviceId}:`, error);
  }
}

/**
 * Unassign a service from the GPU provisioning scenario.
 * Called when admin removes serviceId from a GpuProduct.
 */
export async function unassignGpuService(serviceId: string): Promise<void> {
  try {
    const scenarioId = await getGpuScenarioId();
    await unassignServiceFromScenario(serviceId, scenarioId);
    console.log(`[Scenarios] Unassigned service ${serviceId} from GPU scenario`);
  } catch (error) {
    console.error(`[Scenarios] Failed to unassign GPU service ${serviceId}:`, error);
  }
}

/**
 * Assign a service to the Apps scenario.
 * Called when admin links a serviceId to a GpuApp.
 */
export async function assignAppService(serviceId: string): Promise<void> {
  try {
    const scenarioId = await getAppsScenarioId();
    await assignServiceToScenario(serviceId, scenarioId);
    console.log(`[Scenarios] Assigned service ${serviceId} to Apps scenario`);
  } catch (error) {
    console.error(`[Scenarios] Failed to assign App service ${serviceId}:`, error);
  }
}

/**
 * Unassign a service from the Apps scenario.
 * Called when admin removes serviceId from a GpuApp.
 */
export async function unassignAppService(serviceId: string): Promise<void> {
  try {
    const scenarioId = await getAppsScenarioId();
    await unassignServiceFromScenario(serviceId, scenarioId);
    console.log(`[Scenarios] Unassigned service ${serviceId} from Apps scenario`);
  } catch (error) {
    console.error(`[Scenarios] Failed to unassign App service ${serviceId}:`, error);
  }
}
