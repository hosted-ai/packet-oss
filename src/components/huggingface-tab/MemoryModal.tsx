/**
 * Memory Modal Component
 *
 * Modal displaying detailed memory requirements for HuggingFace models.
 * Shows parameter counts, data types, and component breakdowns.
 *
 * @module components/huggingface-tab/MemoryModal
 */

"use client";

import type { HfMemResult } from "./types";
import { formatBytes, formatParams, getDtypeDisplayName } from "./helpers";

interface MemoryModalProps {
  memoryData: HfMemResult | null;
  loading: boolean;
  onClose: () => void;
}

export function MemoryModal({ memoryData, loading, onClose }: MemoryModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-[var(--ink)]">
                Memory Requirements
              </h2>
              {memoryData && (
                <p className="text-sm text-[var(--muted)] mt-1">
                  {memoryData.modelId}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--ink)] p-1"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--blue)] border-t-transparent mb-3"></div>
              <p className="text-sm text-[var(--muted)]">
                Analyzing safetensors metadata...
              </p>
            </div>
          ) : memoryData ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--muted)] uppercase tracking-wider">
                      Total Parameters
                    </p>
                    <p className="text-2xl font-bold text-[var(--ink)]">
                      {formatParams(memoryData.totalParams)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)] uppercase tracking-wider">
                      Est. VRAM Required
                    </p>
                    <p className="text-2xl font-bold text-purple-600">
                      {memoryData.estimatedVramGb} GB
                    </p>
                  </div>
                </div>
                <p className="text-xs text-[var(--muted)] mt-2">
                  Model weights: {formatBytes(memoryData.totalBytes)} (+ 20%
                  overhead for inference)
                </p>
              </div>

              {/* Data Type Breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)] mb-2">
                  Data Types
                </h3>
                <div className="space-y-2">
                  {memoryData.dtypeSummary.map((dtype) => (
                    <div
                      key={dtype.dtype}
                      className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg"
                    >
                      <div>
                        <span className="font-mono text-sm font-medium text-[var(--ink)]">
                          {getDtypeDisplayName(dtype.dtype)}
                        </span>
                        <span className="text-xs text-[var(--muted)] ml-2">
                          ({formatParams(dtype.paramCount)} params)
                        </span>
                      </div>
                      <span className="text-sm font-medium text-purple-600">
                        {formatBytes(dtype.bytesCount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Components (for diffusers models) */}
              {memoryData.components.length > 1 && (
                <div>
                  <h3 className="text-sm font-semibold text-[var(--ink)] mb-2">
                    Model Components
                  </h3>
                  <div className="space-y-2">
                    {memoryData.components.map((component) => (
                      <div
                        key={component.name}
                        className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg"
                      >
                        <span className="text-sm text-[var(--ink)]">
                          {component.name}
                        </span>
                        <div className="text-right">
                          <span className="text-sm font-medium text-purple-600">
                            {formatBytes(component.bytesCount)}
                          </span>
                          <p className="text-xs text-[var(--muted)]">
                            {formatParams(component.paramCount)} params
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Info note */}
              <div className="text-xs text-[var(--muted)] p-3 bg-blue-50 rounded-lg">
                <p className="font-medium text-blue-700 mb-1">
                  How this is calculated
                </p>
                <p>
                  Memory is calculated by parsing safetensors metadata headers
                  using HTTP Range requests. The estimate includes a 20%
                  overhead for KV cache, activations, and inference buffers.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-[var(--muted)]">
                Could not fetch memory information for this model.
              </p>
              <p className="text-sm text-[var(--muted)] mt-1">
                The model may not use safetensors format or may be gated.
              </p>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={onClose}
              className="w-full py-2.5 px-4 border border-[var(--line)] rounded-lg text-[var(--ink)] hover:bg-zinc-50 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
