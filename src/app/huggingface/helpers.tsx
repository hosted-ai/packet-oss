/**
 * HuggingFace Page Helpers
 *
 * @module huggingface/helpers
 */

import type { CompatibilityInfo } from "./types";

export function getVramBadge(vramGb: number) {
  if (vramGb === 0) return null;
  return (
    <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
      {vramGb}GB VRAM
    </span>
  );
}

export function getCompatibilityBadge(compatibility?: CompatibilityInfo) {
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
}
