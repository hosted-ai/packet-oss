/**
 * Item Card Component
 *
 * Card component for displaying HuggingFace model/space items.
 *
 * @module components/huggingface-tab/ItemCard
 */

"use client";

import type { CatalogItem, SearchResult } from "./types";
import { getCompatibilityBadge } from "./helpers";

interface ItemCardProps {
  item: CatalogItem | SearchResult;
  onDeploy: (item: CatalogItem | SearchResult) => void;
  onOpenMemoryModal: (modelId: string) => void;
}

export function ItemCard({ item, onDeploy, onOpenMemoryModal }: ItemCardProps) {
  const isGated = "gated" in item && item.gated;
  const vramGb =
    "vramGb" in item
      ? item.vramGb
      : "estimatedVramGb" in item
      ? item.estimatedVramGb
      : 0;
  // Check if this is a real VRAM value from HF API (for catalog items)
  const hasRealVram = "realVramGb" in item && item.realVramGb !== undefined;

  return (
    <div className="bg-white rounded-xl border border-[var(--line)] p-5 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold text-[var(--ink)] truncate"
            title={item.name}
          >
            {item.name}
          </h3>
          <p className="text-xs text-[var(--muted)] truncate" title={item.id}>
            {item.id}
          </p>
        </div>
        {isGated && (
          <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full ml-2 whitespace-nowrap">
            Requires Token
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--muted)] line-clamp-2 mb-3 min-h-[2.5rem]">
        {item.description}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {/* Memory requirement with "read more" link */}
        {vramGb > 0 && (
          <span
            className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${
              hasRealVram
                ? "bg-emerald-100 text-emerald-700"
                : "bg-purple-100 text-purple-700"
            }`}
            title={hasRealVram ? "Calculated from model files" : "Estimated"}
          >
            {hasRealVram && (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            {vramGb}GB VRAM
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenMemoryModal(item.id);
              }}
              className={`hover:underline ml-0.5 ${
                hasRealVram
                  ? "text-emerald-600 hover:text-emerald-800"
                  : "text-purple-500 hover:text-purple-800"
              }`}
            >
              details
            </button>
          </span>
        )}
        {getCompatibilityBadge(item.compatibility)}
        {"source" in item && item.source === "huggingface" && (
          <span className="text-xs px-2 py-1 bg-zinc-100 text-zinc-600 rounded-full">
            HF Hub
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-4">
        {item.tags?.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-xs px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded"
          >
            {tag}
          </span>
        ))}
      </div>

      <button
        onClick={() => onDeploy(item)}
        className="w-full py-2 px-4 bg-[var(--blue)] text-white rounded-lg hover:opacity-90 transition-opacity text-sm font-medium"
      >
        Deploy to GPU
      </button>
    </div>
  );
}
