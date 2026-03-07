/**
 * Blog Posts
 *
 * Aggregates all blog posts and provides utility functions.
 *
 * @module blog/posts
 */

export type { BlogPost } from "./types";

import { gpuUtilizationLie } from "./gpu-utilization-the-lie-your-dashboard-tells";
import { skypilotIntegrationAlpha } from "./skypilot-integration-alpha";
import { persistentWorkspacesDeepDive } from "./persistent-workspaces-deep-dive";
import { snapshotsAndStorageDemystified } from "./snapshots-and-storage-demystified";
import { oneClickGpuEnvironments } from "./one-click-gpu-environments";
import { dynamicPlacementExplained } from "./dynamic-placement-explained";
import { nordicDatacenterAdvantage } from "./nordic-datacenter-advantage";
import { gpuPricingModelsCompared } from "./gpu-pricing-models-compared";
import { deepBlueAnniversaryGpus } from "./deep-blue-anniversary-gpus";
import type { BlogPost } from "./types";

export const blogPosts: BlogPost[] = [
  deepBlueAnniversaryGpus,
  snapshotsAndStorageDemystified,
  gpuUtilizationLie,
  skypilotIntegrationAlpha,
  persistentWorkspacesDeepDive,
  oneClickGpuEnvironments,
  dynamicPlacementExplained,
  nordicDatacenterAdvantage,
  gpuPricingModelsCompared,
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function getAllPosts(): BlogPost[] {
  return blogPosts.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

// Re-export individual posts for direct import if needed
export {
  deepBlueAnniversaryGpus,
  snapshotsAndStorageDemystified,
  gpuUtilizationLie,
  skypilotIntegrationAlpha,
  persistentWorkspacesDeepDive,
  oneClickGpuEnvironments,
  dynamicPlacementExplained,
  nordicDatacenterAdvantage,
  gpuPricingModelsCompared,
};
