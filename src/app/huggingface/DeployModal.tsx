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

interface DeployModalProps {
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
  item,
  launchOptions,
  selectedProduct,
  setSelectedProduct,
  selectedRegion,
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
  const selectedProductDetails = products.find((p) => p.id === selectedProduct);
  const regions = selectedProductDetails?.regions ?? [];

  /** When the user clicks a product card, auto-select first region */
  const handleSelectProduct = (productId: string) => {
    setSelectedProduct(productId);
    const product = products.find((p) => p.id === productId);
    if (product && product.regions.length > 0) {
      setSelectedRegion(product.regions[0].id);
    } else {
      setSelectedRegion(null);
    }
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

          {/* Product Cards */}
          {products.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">
                Select a GPU
              </label>
              <div className="space-y-2">
                {products.map((product) => {
                  const isSelected = selectedProduct === product.id;
                  const isAvailable = product.available;
                  const pricePerHour = (
                    product.pricePerHourCents / 100
                  ).toFixed(2);

                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => {
                        if (isAvailable) handleSelectProduct(product.id);
                      }}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                        !isAvailable
                          ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                          : isSelected
                            ? "border-teal-500 bg-teal-50"
                            : "border-gray-200 hover:border-teal-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900">
                            {product.name}
                          </span>
                          {product.vramGb && (
                            <div className="text-sm text-gray-500 mt-0.5">
                              {product.vramGb}GB VRAM
                              {product.description
                                ? ` · ${product.description}`
                                : ""}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          {!isAvailable ? (
                            <span className="text-xs font-medium text-gray-400">
                              Unavailable
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div>
                                <span className="text-lg font-bold text-gray-900">
                                  ${pricePerHour}
                                </span>
                                <span className="text-xs text-gray-500">
                                  /hr
                                </span>
                              </div>
                              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {products.length === 0 && launchOptions && (
            <div className="mb-4 text-center py-6 text-gray-500 text-sm">
              No GPUs available right now. Check back later.
            </div>
          )}

          {/* Region Pills */}
          {selectedProduct && regions.length > 0 && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                Region
              </label>
              <div className="flex flex-wrap gap-2">
                {regions.map((region) => {
                  const isSelected = selectedRegion === region.id;
                  return (
                    <button
                      key={region.id}
                      type="button"
                      onClick={() => setSelectedRegion(region.id)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        isSelected
                          ? "bg-teal-100 text-teal-700 border border-teal-300"
                          : "bg-gray-100 text-gray-600 border border-transparent hover:bg-gray-200"
                      }`}
                    >
                      {region.region_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
