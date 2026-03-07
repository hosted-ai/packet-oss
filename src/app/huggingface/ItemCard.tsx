/**
 * Item Card Component
 *
 * Displays a catalog or search result item.
 *
 * @module huggingface/ItemCard
 */

"use client";

import type { CatalogItem, SearchResult } from "./types";
import { getVramBadge, getCompatibilityBadge } from "./helpers";

interface ItemCardProps {
  item: CatalogItem | SearchResult;
  onDeploy: (item: CatalogItem | SearchResult) => void;
}

export function ItemCard({ item, onDeploy }: ItemCardProps) {
  const isGated = "gated" in item && item.gated;
  const vramGb =
    "vramGb" in item
      ? item.vramGb
      : "estimatedVramGb" in item
      ? item.estimatedVramGb
      : 0;
  const logo = "logo" in item ? item.logo : undefined;
  const provider = "provider" in item ? item.provider : undefined;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 mb-2">
        {/* Logo */}
        {logo ? (
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
            <img
              src={logo}
              alt={`${provider || item.name} logo`}
              className="w-8 h-8 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center">
            <span className="text-lg">
              {item.type === "docker" ? "🐳" : item.type === "space" ? "🚀" : "🤖"}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3
                className="font-medium text-gray-900 truncate"
                title={item.name}
              >
                {item.name}
              </h3>
              <p className="text-sm text-gray-500 truncate" title={item.id}>
                {provider ? `${provider} • ` : ""}
                {item.id}
              </p>
            </div>
            {isGated && (
              <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full ml-2 flex-shrink-0">
                Requires Token
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-600 line-clamp-2 mb-3">
        {item.description}
      </p>

      <div className="flex flex-wrap gap-1 mb-3">
        {getVramBadge(vramGb)}
        {getCompatibilityBadge(item.compatibility)}
        {"source" in item && item.source === "huggingface" && (
          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
            HF Hub
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {item.tags?.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
          >
            {tag}
          </span>
        ))}
      </div>

      <button
        onClick={() => onDeploy(item)}
        className="w-full py-2 px-4 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors text-sm font-medium"
      >
        Deploy to GPU
      </button>
    </div>
  );
}
