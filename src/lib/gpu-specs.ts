/**
 * GPU specifications for VRAM compatibility checking
 */

export interface GPUSpec {
  name: string;
  vramGb: number;
  architecture: string;
  tensorCores: boolean;
}

// GPU VRAM specifications (in GB)
export const GPU_SPECS: Record<string, GPUSpec> = {
  // Consumer
  "RTX 3090": { name: "RTX 3090", vramGb: 24, architecture: "Ampere", tensorCores: true },
  "RTX 4090": { name: "RTX 4090", vramGb: 24, architecture: "Ada Lovelace", tensorCores: true },

  // Data center - Ampere
  "A100 40GB": { name: "A100 40GB", vramGb: 40, architecture: "Ampere", tensorCores: true },
  "A100 80GB": { name: "A100 80GB", vramGb: 80, architecture: "Ampere", tensorCores: true },
  "A100": { name: "A100 80GB", vramGb: 80, architecture: "Ampere", tensorCores: true },

  // Data center - Hopper
  "H100": { name: "H100", vramGb: 80, architecture: "Hopper", tensorCores: true },
  "H100 SXM": { name: "H100 SXM", vramGb: 80, architecture: "Hopper", tensorCores: true },
  "H100 PCIe": { name: "H100 PCIe", vramGb: 80, architecture: "Hopper", tensorCores: true },
  "H200": { name: "H200", vramGb: 141, architecture: "Hopper", tensorCores: true },

  // Data center - Blackwell
  "B200": { name: "B200", vramGb: 180, architecture: "Blackwell", tensorCores: true },
  "B100": { name: "B100", vramGb: 192, architecture: "Blackwell", tensorCores: true },
};

/**
 * Extract GPU model from pool name and return VRAM
 * Pool names might be like "B200 Pool", "NVIDIA H100", etc.
 */
export function getPoolVRAM(poolName: string): number {
  const normalizedName = poolName.toUpperCase();

  // Try to match known GPU models
  for (const [model, spec] of Object.entries(GPU_SPECS)) {
    if (normalizedName.includes(model.toUpperCase())) {
      return spec.vramGb;
    }
  }

  // Default fallback - assume 80GB (H100 class)
  return 80;
}

/**
 * Get GPU spec by name (fuzzy match)
 */
export function getGPUSpec(gpuName: string): GPUSpec | null {
  const normalizedName = gpuName.toUpperCase();

  for (const [model, spec] of Object.entries(GPU_SPECS)) {
    if (normalizedName.includes(model.toUpperCase())) {
      return spec;
    }
  }

  return null;
}

/**
 * Check if a model with given VRAM requirement can run on a GPU pool
 */
export function checkVRAMCompatibility(
  requiredVramGb: number,
  poolName: string,
  gpuCount: number = 1
): {
  compatible: boolean;
  poolVram: number;
  totalVram: number;
  minGpusNeeded: number;
} {
  const poolVram = getPoolVRAM(poolName);
  const totalVram = poolVram * gpuCount;
  const minGpusNeeded = Math.ceil(requiredVramGb / poolVram);

  return {
    compatible: totalVram >= requiredVramGb,
    poolVram,
    totalVram,
    minGpusNeeded,
  };
}

/**
 * Get a human-readable compatibility message
 */
export function getCompatibilityMessage(
  requiredVramGb: number,
  poolName: string,
  maxGpuCount: number = 8
): {
  status: "compatible" | "needs_multi_gpu" | "incompatible";
  message: string;
  minGpusNeeded: number;
} {
  const poolVram = getPoolVRAM(poolName);
  const minGpusNeeded = Math.ceil(requiredVramGb / poolVram);

  if (requiredVramGb <= poolVram) {
    return {
      status: "compatible",
      message: `Compatible with ${poolName}`,
      minGpusNeeded: 1,
    };
  }

  if (minGpusNeeded <= maxGpuCount) {
    return {
      status: "needs_multi_gpu",
      message: `Requires ${minGpusNeeded}x ${poolName} (${minGpusNeeded * poolVram}GB VRAM)`,
      minGpusNeeded,
    };
  }

  return {
    status: "incompatible",
    message: `Requires ${requiredVramGb}GB VRAM - exceeds available capacity`,
    minGpusNeeded,
  };
}
