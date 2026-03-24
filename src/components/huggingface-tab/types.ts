/**
 * HuggingFace Tab Types
 *
 * Type definitions for the HuggingFace deployment interface.
 *
 * @module components/huggingface-tab/types
 */

export interface DtypeBreakdown {
  dtype: string;
  paramCount: number;
  bytesCount: number;
}

export interface ComponentBreakdown {
  name: string;
  dtypes: DtypeBreakdown[];
  paramCount: number;
  bytesCount: number;
}

export interface HfMemResult {
  modelId: string;
  components: ComponentBreakdown[];
  totalParams: number;
  totalBytes: number;
  estimatedVramGb: number;
  dtypeSummary: DtypeBreakdown[];
}

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
  realVramGb?: number;
  deployScript: string;
  tags: string[];
  gated: boolean;
  featured?: boolean;
  downloads?: number;
  compatibility?: {
    status: "compatible" | "needs_multi_gpu" | "incompatible";
    message: string;
    minGpusNeeded: number;
    compatiblePools?: string[];
  };
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
  compatibility?: {
    status: "compatible" | "needs_multi_gpu" | "incompatible";
    message: string;
    minGpusNeeded: number;
  };
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

export interface ExistingSubscription {
  id: string;
  pool_name: string;
  pool_label?: string;
  gpu_model?: string;
  vgpus: number;
  status: string;
}

export type TabType = "popular" | "rtx" | "model" | "space";
export type DeployMode = "new" | "existing";
