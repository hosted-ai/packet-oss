/**
 * Packet Scenario Management
 *
 * Manages HAI scenarios for service discovery:
 * - Per-category scenarios: one HAI scenario per GpuCategory (replaces single GPU scenario)
 * - packet-apps: recipe-backed app services (one per deployable GpuApp)
 *
 * Category scenarios are auto-created when admin creates a GpuCategory.
 * The old single "Packet GPU Provisioning" scenario is deprecated but kept
 * for backward compat until all products are migrated to categories.
 *
 * Services are auto-assigned/unassigned when admin configures products or apps.
 */

import { getSetting, setSetting } from "@/lib/settings";
import {
  listScenarios,
  createScenario,
  assignServiceToScenario,
  unassignServiceFromScenario,
} from "@/lib/hostedai";
import { prisma } from "@/lib/prisma";
import { getBrandName } from "@/lib/branding";

const GPU_SCENARIO_KEY = "packet_gpu_scenario_id"; // DEPRECATED: kept for migration
const APPS_SCENARIO_KEY = "packet_apps_scenario_id";

/**
 * Find an existing scenario by name via the HAI list endpoint.
 * Returns the scenario ID if found, null otherwise.
 */
async function findScenarioByName(name: string): Promise<string | null> {
  const scenarios = await listScenarios();
  const match = scenarios.find((s) => s.name === name);
  return match?.id ?? null;
}

/**
 * Get or create a scenario, handling the case where the scenario
 * already exists in HAI but our DB lost the reference.
 */
async function getOrCreateScenario(
  settingKey: string,
  name: string,
  description: string,
  label: string
): Promise<string> {
  const existing = await getSetting(settingKey);
  if (existing) return existing;

  console.log(`[Scenarios] Creating ${label} scenario in HAI...`);
  try {
    const result = await createScenario({ name, description });
    await setSetting(settingKey, result.id);
    console.log(`[Scenarios] Created ${label} scenario: ${result.id}`);
    return result.id;
  } catch (error) {
    // If the scenario already exists in HAI, look it up by name
    if (error instanceof Error && error.message.includes("invalid scenario name")) {
      console.log(`[Scenarios] ${label} scenario already exists in HAI, looking up by name...`);
      const id = await findScenarioByName(name);
      if (id) {
        await setSetting(settingKey, id);
        console.log(`[Scenarios] Found existing ${label} scenario: ${id}`);
        return id;
      }
    }
    console.error(`[Scenarios] Failed to create ${label} scenario:`, error);
    throw error;
  }
}

/**
 * Get or create the GPU provisioning scenario.
 * Returns the scenario UUID.
 */
export async function getGpuScenarioId(): Promise<string> {
  return getOrCreateScenario(
    GPU_SCENARIO_KEY,
    "Packet GPU Provisioning",
    `Bare GPU pod services managed by ${getBrandName()} dashboard`,
    "GPU"
  );
}

/**
 * Get or create the Apps scenario.
 * Returns the scenario UUID.
 */
export async function getAppsScenarioId(): Promise<string> {
  return getOrCreateScenario(
    APPS_SCENARIO_KEY,
    "Packet Apps",
    `Recipe-backed app services managed by ${getBrandName()} dashboard`,
    "Apps"
  );
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

// ============================================
// Category-scoped scenario management
// ============================================

/**
 * Sanitize a scenario name for HAI: keep alphanumerics, spaces, hyphens and
 * underscores, collapse whitespace (HAI rejects other characters as
 * "invalid scenario name").
 */
function sanitizeScenarioName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Create an HAI scenario for a GPU category.
 * Returns the scenario UUID, or null if HAI is unreachable.
 */
export async function createCategoryScenario(
  categoryName: string,
  categorySlug: string
): Promise<string | null> {
  const scenarioName = sanitizeScenarioName(`Packet GPU ${categoryName}`);
  try {
    const result = await createScenario({
      name: scenarioName,
      description: `GPU category "${categoryName}" — managed by ${getBrandName()} dashboard`,
    });
    console.log(`[Scenarios] Created category scenario: ${result.id} for ${categoryName}`);
    return result.id;
  } catch (error) {
    // If scenario already exists in HAI, look it up by name
    if (error instanceof Error && error.message.includes("invalid scenario name")) {
      console.log(`[Scenarios] Category scenario "${scenarioName}" already exists, looking up...`);
      const id = await findScenarioByName(scenarioName);
      if (id) {
        console.log(`[Scenarios] Found existing category scenario: ${id}`);
        return id;
      }
    }
    console.error(`[Scenarios] Failed to create category scenario for ${categoryName}:`, error);
    return null;
  }
}

/**
 * Sync a service's scenario list to match the product's categories.
 * Uses PUT /api/service/{id} to update the scenarios array on the service object,
 * instead of the broken POST /api/scenario/assign-service endpoint.
 *
 * Called when admin saves a product with categories. Pass ALL categoryIds the
 * product belongs to — this replaces the service's scenarios array.
 */
export async function syncServiceScenarios(
  serviceId: string,
  categoryIds: string[]
): Promise<void> {
  try {
    // Resolve scenarioIds from categories
    const categories = await prisma.gpuCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, scenarioId: true, name: true },
    });

    console.log(`[Scenarios] Resolving scenarios for ${categoryIds.length} categories:`, categories.map(c => `${c.name}=${c.scenarioId}`));

    const scenarioIds = categories
      .filter(c => c.scenarioId)
      .map(c => c.scenarioId!);

    if (scenarioIds.length === 0) {
      console.warn(`[Scenarios] No scenarioIds found for categories [${categoryIds.join(", ")}], skipping sync`);
      return;
    }

    // Read current service, get existing scenarios, merge with new ones
    // Clear cache first to ensure we get fresh data
    const { getHAIService, updateHAIService } = await import("@/lib/hostedai");
    const { clearCache } = await import("@/lib/hostedai/client");
    clearCache(`/service/${serviceId}`);

    const svc = await getHAIService(serviceId);
    const existingScenarios: string[] = Array.isArray(svc.scenarios) ? svc.scenarios as string[] : [];

    // Build new scenarios list: keep non-category scenarios + add category scenarios
    const allCategoryScenarioIds = (await prisma.gpuCategory.findMany({
      where: { scenarioId: { not: null } },
      select: { scenarioId: true },
    })).map(c => c.scenarioId!);

    const nonCategoryScenarios = existingScenarios.filter(s => !allCategoryScenarioIds.includes(s));
    const newScenarios = [...new Set([...nonCategoryScenarios, ...scenarioIds])];

    console.log(`[Scenarios] Service ${serviceId}: existing=[${existingScenarios.join(",")}] → new=[${newScenarios.join(",")}] (${scenarioIds.length} category scenarios, ${nonCategoryScenarios.length} preserved)`);

    // Clear cache again before updateHAIService reads (it does its own GET)
    clearCache(`/service/${serviceId}`);
    await updateHAIService(serviceId, { scenarios: newScenarios });
    console.log(`[Scenarios] Synced service ${serviceId} scenarios successfully`);
  } catch (error) {
    console.error(`[Scenarios] Failed to sync service ${serviceId} scenarios:`, error);
  }
}

/**
 * Remove all category scenarios from a service.
 * Called when a product's service is cleared or all categories are removed.
 */
export async function clearServiceCategoryScenarios(
  serviceId: string
): Promise<void> {
  try {
    const { getHAIService, updateHAIService } = await import("@/lib/hostedai");
    const svc = await getHAIService(serviceId);
    const existingScenarios: string[] = Array.isArray(svc.scenarios) ? svc.scenarios as string[] : [];

    // Remove all Packet category scenarios, keep others
    const allCategoryScenarioIds = (await prisma.gpuCategory.findMany({
      where: { scenarioId: { not: null } },
      select: { scenarioId: true },
    })).map(c => c.scenarioId!);

    const cleaned = existingScenarios.filter(s => !allCategoryScenarioIds.includes(s));
    await updateHAIService(serviceId, { scenarios: cleaned });
    console.log(`[Scenarios] Cleared category scenarios from service ${serviceId}`);
  } catch (error) {
    console.error(`[Scenarios] Failed to clear category scenarios from service ${serviceId}:`, error);
  }
}
