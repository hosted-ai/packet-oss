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

export interface LaunchProduct {
  id: string;
  name: string;
  description: string | null;
  pricePerHourCents: number;
  vramGb: number | null;
  available: boolean;
  regions: Array<{ id: number; region_name: string }>;
}

export interface LaunchOptions {
  products: LaunchProduct[];
  walletBalanceCents: number;
}

export interface FilterOptions {
  tasks: Array<{ value: string; label: string }>;
  libraries: Array<{ value: string; label: string }>;
  paramSizes: Array<{ value: string; label: string }>;
}

export type TabType = "popular" | "model" | "docker" | "space";
