/**
 * HuggingFace Page Types
 *
 * @module huggingface/types
 */

export type DeploymentStatus =
  | "not_started"
  | "installing"
  | "install_complete"
  | "starting"
  | "running"
  | "failed";

export interface CatalogItem {
  id: string;
  type: "model" | "docker" | "space";
  name: string;
  description: string;
  vramGb: number;
  deployScript: string;
  tags: string[];
  gated: boolean;
  featured?: boolean;
  downloads?: number;
  logo?: string;
  provider?: string;
  compatibility?: CompatibilityInfo;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  likes: number;
  gated: boolean;
  tags: string[];
  estimatedVramGb: number;
  type: "model" | "space";
  source: "catalog" | "huggingface";
  compatibility?: CompatibilityInfo;
}

export interface CompatibilityInfo {
  status: "compatible" | "needs_multi_gpu" | "incompatible";
  message: string;
  minGpusNeeded: number;
  compatiblePools?: string[];
}

export interface LaunchOptions {
  pools: Array<{
    id: string;
    name: string;
    gpu_model?: string;
    available_gpus?: number;
  }>;
  ephemeralStorageBlocks: Array<{
    id: string;
    name: string;
    size_gb?: number;
  }>;
}

export interface FilterOptions {
  tasks: Array<{ value: string; label: string }>;
  libraries: Array<{ value: string; label: string }>;
  paramSizes: Array<{ value: string; label: string }>;
}

export type TabType = "popular" | "model" | "docker" | "space";
