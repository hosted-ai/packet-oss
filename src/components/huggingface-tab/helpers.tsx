/**
 * HuggingFace Tab Helpers
 *
 * Helper functions and utility components for the HuggingFace deployment interface.
 *
 * @module components/huggingface-tab/helpers
 */

import type { CatalogItem, SearchResult } from "./types";

/**
 * Detect if a model supports chat interface
 */
export const isChatModel = (item: CatalogItem | SearchResult): boolean => {
  const id = item.id.toLowerCase();
  const name = item.name.toLowerCase();

  const chatIndicators = [
    "instruct",
    "chat",
    "-it",
    "_it",
    "assistant",
    "conversational",
  ];

  if (chatIndicators.some((ind) => id.includes(ind) || name.includes(ind))) {
    return true;
  }

  const tags = item.tags?.map((t) => t.toLowerCase()) || [];
  if (tags.includes("conversational") || tags.includes("chat")) {
    return true;
  }

  const baseIndicators = ["base", "pretrain", "foundation"];
  if (baseIndicators.some((ind) => id.includes(ind) || name.includes(ind))) {
    return false;
  }

  return false;
};

/**
 * Format bytes to human readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(2)} KB`;
};

/**
 * Format parameter count to human readable string
 */
export const formatParams = (params: number): string => {
  if (params >= 1_000_000_000) {
    return `${(params / 1_000_000_000).toFixed(2)}B`;
  }
  if (params >= 1_000_000) {
    return `${(params / 1_000_000).toFixed(2)}M`;
  }
  return `${(params / 1_000).toFixed(2)}K`;
};

/**
 * Get human-readable dtype display name
 */
export const getDtypeDisplayName = (dtype: string): string => {
  const names: Record<string, string> = {
    F64: "float64",
    F32: "float32",
    F16: "float16",
    BF16: "bfloat16",
    I8: "int8",
    U8: "uint8",
    F8_E5M2: "fp8 (E5M2)",
    F8_E4M3: "fp8 (E4M3)",
  };
  return names[dtype] || dtype;
};

/**
 * Render VRAM requirement badge
 */
export const getVramBadge = (vramGb: number) => {
  if (vramGb === 0) return null;
  return (
    <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
      {vramGb}GB VRAM
    </span>
  );
};

/**
 * Render compatibility status badge
 */
export const getCompatibilityBadge = (
  compatibility?: CatalogItem["compatibility"] | SearchResult["compatibility"]
) => {
  if (!compatibility) return null;

  const colors = {
    compatible: "bg-green-100 text-green-700",
    needs_multi_gpu: "bg-yellow-100 text-yellow-700",
    incompatible: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`text-xs px-2 py-1 rounded-full ${colors[compatibility.status]}`}
      title={compatibility.message}
    >
      {compatibility.status === "compatible"
        ? "Compatible"
        : compatibility.status === "needs_multi_gpu"
        ? `Needs ${compatibility.minGpusNeeded} GPUs`
        : "Incompatible"}
    </span>
  );
};
