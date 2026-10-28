/**
 * Deploy Modal Component
 *
 * Modal for configuring and starting a deployment.
 * Uses product cards + region pills for GPU selection (HAI 2.2).
 *
 * @module huggingface/DeployModal
 */

"use client";

import type { CatalogItem, SearchResult, LaunchOptions } from "./types";
import { getVramBadge, getCompatibilityBadge } from "./helpers";
import { GPUPicker, type GPUPickerSelection } from "@/components/GPUPicker";

interface DeployModalProps {
  token: string;
  item: CatalogItem | SearchResult;
  launchOptions: LaunchOptions | null;
  selectedProduct: string;
  setSelectedProduct: (v: string) => void;
  selectedRegion: number | null;
  setSelectedRegion: (v: number | null) => void;
  gpuCount: number;
  setGpuCount: (v: number) => void;
  hfToken: string;
  setHfToken: (v: string) => void;
  deploying: boolean;
  deployError: string | null;
  onClose: () => void;
  onDeploy: () => void;
}

export function DeployModal({
  token,
  item,
  launchOptions,
  selectedProduct,
  setSelectedProduct,
  setSelectedRegion,
  hfToken,
  setHfToken,
  deploying,
  deployError,
  onClose,
  onDeploy,
}: DeployModalProps) {
  const vramGb =
    "vramGb" in item
      ? item.vramGb
      : "estimatedVramGb" in item
      ? item.estimatedVramGb
      : 0;
  const isGated = "gated" in item && item.gated;

  const products = launchOptions?.products ?? [];
  const categories = launchOptions?.categories ?? [];

  const selectedProductDetails = products.find(p => p.id === selectedProduct);

  const handleGPUSelection = (selection: GPUPickerSelection) => {
    if (selection.product) setSelectedProduct(selection.product.id);
    setSelectedRegion(selection.region?.id ?? null);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Deploy to GPU
              </h2>
              <p className="text-sm text-gray-600 mt-1">{item.name}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
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

          {/* Item Info */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-600">{item.description}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {getVramBadge(vramGb)}
              {getCompatibilityBadge(item.compatibility)}
            </div>
          </div>

          {/* GPU Selection — shared category-based picker */}
          <div className="mb-4">
            <GPUPicker
              token={token}
              categories={categories}
              products={products}
              onSelectionChange={handleGPUSelection}
              compact
            />
          </div>

          {/* Wallet + pricing summary */}
          {selectedProduct && selectedProductDetails && launchOptions && (
            <div className="text-xs text-gray-500 mb-4 p-3 bg-gray-50 rounded-lg space-y-1">
              <div>
                Wallet:{" "}
                <span className="font-medium text-gray-700">
                  ${(launchOptions.walletBalanceCents / 100).toFixed(2)}
                </span>
              </div>
              <div>
                First 30 min prepaid:{" "}
                <span className="font-medium text-gray-700">
                  $
                  {(
                    Math.round(
                      (30 / 60) * selectedProductDetails.pricePerHourCents
                    ) / 100
                  ).toFixed(2)}
                </span>
              </div>
              <div>
                Then billed hourly at $
                {(selectedProductDetails.pricePerHourCents / 100).toFixed(2)}/hr
              </div>
            </div>
          )}

          {/* HF Token (for gated models) */}
          {isGated && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                HuggingFace Token
                <span className="text-orange-600 ml-1">*</span>
              </label>
              <input
                type="password"
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                placeholder="hf_xxxxxxxxxxxxx"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <p className="text-sm text-gray-500 mt-1">
                This model requires a token.{" "}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 hover:underline"
                >
                  Get your token here
                </a>
              </p>
            </div>
          )}

          {/* Error Message */}
          {deployError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {deployError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onDeploy}
              disabled={deploying || !selectedProduct}
              className="flex-1 py-2 px-4 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deploying ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
