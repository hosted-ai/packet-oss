/**
 * GPU Apps - Pre-configured software stacks for one-click deployment
 *
 * Each app is a bash script that installs and configures software on a GPU pod.
 * Apps are designed to fit on a single GPU (up to 96GB VRAM).
 *
 * @module lib/gpu-apps
 */

// Re-export types and shared constants
export { type GpuAppDefinition, SCRIPT_PREAMBLE } from "./apps/types";

// Import app definitions by category
import { DEVELOPMENT_APPS } from "./apps/development";
import { INFERENCE_APPS } from "./apps/inference";
import { TRAINING_APPS } from "./apps/training";
import { CREATIVE_APPS } from "./apps/creative";

/**
 * All GPU Apps available for installation, combined from all categories.
 *
 * Categories:
 * - development: Jupyter, VS Code, Langflow, MLflow
 * - inference: vLLM, TGI, Triton, LocalAI, Text Gen WebUI, Open WebUI
 * - training: Axolotl, Kohya_ss
 * - creative: ComfyUI, A1111, Fooocus, CogVideoX
 */
export const GPU_APPS = [
  ...DEVELOPMENT_APPS,
  ...INFERENCE_APPS,
  ...TRAINING_APPS,
  ...CREATIVE_APPS,
];

/**
 * Get an app by slug
 */
export function getAppBySlug(slug: string) {
  return GPU_APPS.find((app) => app.slug === slug);
}

/**
 * Get apps by category
 */
export function getAppsByCategory(category: string) {
  return GPU_APPS.filter((app) => app.category === category);
}

/**
 * Get apps that fit within a given VRAM budget
 */
export function getAppsForVram(vramGb: number) {
  return GPU_APPS.filter((app) => app.minVramGb <= vramGb);
}

// Re-export category arrays for direct access
export { DEVELOPMENT_APPS, INFERENCE_APPS, TRAINING_APPS, CREATIVE_APPS };
