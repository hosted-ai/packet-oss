/**
 * Deploy Modal Component
 *
 * Modal for deploying HuggingFace models to GPU instances.
 * Supports both new GPU creation and deployment to existing GPUs.
 *
 * @module components/huggingface-tab/DeployModal
 */

"use client";

import type {
  CatalogItem,
  SearchResult,
  LaunchOptions,
  ExistingSubscription,
  DeployMode,
  DeploymentStatus,
} from "./types";
import { isChatModel, getVramBadge, getCompatibilityBadge } from "./helpers";

interface DeployModalProps {
  selectedItem: CatalogItem | SearchResult;
  launchOptions: LaunchOptions | null;
  existingSubscriptions: ExistingSubscription[];
  deployMode: DeployMode;
  setDeployMode: (mode: DeployMode) => void;
  selectedSubscription: string;
  setSelectedSubscription: (id: string) => void;
  selectedPool: string;
  setSelectedPool: (id: string) => void;
  selectedStorage: string;
  setSelectedStorage: (id: string) => void;
  gpuCount: number;
  setGpuCount: (count: number) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  addOpenWebUI: boolean;
  setAddOpenWebUI: (add: boolean) => void;
  deploying: boolean;
  deployError: string | null;
  deploySuccess: string | null;
  deployLogs: string | null;
  showLogs: boolean;
  setShowLogs: (show: boolean) => void;
  deployResult: { serviceHost?: string; servicePort?: number } | null;
  isPolling: boolean;
  deploymentStatus: DeploymentStatus;
  deploymentMessage: string;
  onClose: () => void;
  onDeploy: () => void;
}

export function DeployModal({
  selectedItem,
  launchOptions,
  existingSubscriptions,
  deployMode,
  setDeployMode,
  selectedSubscription,
  setSelectedSubscription,
  selectedPool,
  setSelectedPool,
  selectedStorage,
  setSelectedStorage,
  gpuCount,
  setGpuCount,
  hfToken,
  setHfToken,
  addOpenWebUI,
  setAddOpenWebUI,
  deploying,
  deployError,
  deploySuccess,
  deployLogs,
  showLogs,
  setShowLogs,
  deployResult,
  isPolling,
  deploymentStatus,
  deploymentMessage,
  onClose,
  onDeploy,
}: DeployModalProps) {
  const vramGb =
    "vramGb" in selectedItem
      ? selectedItem.vramGb
      : "estimatedVramGb" in selectedItem
      ? selectedItem.estimatedVramGb
      : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-[var(--ink)]">
                Deploy to GPU
              </h2>
              <p className="text-sm text-[var(--muted)] mt-1">
                {selectedItem.name}
              </p>
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

          {/* Item Info */}
          <div className="bg-zinc-50 rounded-xl p-4 mb-4">
            <p className="text-sm text-[var(--muted)]">
              {selectedItem.description}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {getVramBadge(vramGb)}
              {getCompatibilityBadge(selectedItem.compatibility)}
            </div>
          </div>

          {/* Deploy Mode Selection */}
          {existingSubscriptions.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                Deploy To
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeployMode("existing")}
                  className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors ${
                    deployMode === "existing"
                      ? "border-[var(--blue)] bg-blue-50 text-[var(--blue)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:bg-zinc-50"
                  }`}
                >
                  Existing GPU
                </button>
                <button
                  onClick={() => setDeployMode("new")}
                  className={`flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors ${
                    deployMode === "new"
                      ? "border-[var(--blue)] bg-blue-50 text-[var(--blue)]"
                      : "border-[var(--line)] text-[var(--muted)] hover:bg-zinc-50"
                  }`}
                >
                  New GPU
                </button>
              </div>
            </div>
          )}

          {/* Existing GPU Selection */}
          {deployMode === "existing" && existingSubscriptions.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                Select GPU
              </label>
              <select
                value={selectedSubscription}
                onChange={(e) => setSelectedSubscription(e.target.value)}
                className="w-full px-3 py-2.5 border border-[var(--line)] rounded-lg focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent bg-white"
              >
                {existingSubscriptions.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.pool_name}{" "}
                    {sub.gpu_model ? `(${sub.gpu_model})` : ""} - {sub.vgpus}{" "}
                    GPU{sub.vgpus > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)] mt-1.5">
                The model will be deployed on your running GPU. Any existing
                workload will be replaced.
              </p>
            </div>
          )}

          {/* New GPU Options */}
          {(deployMode === "new" || existingSubscriptions.length === 0) && (
            <>
              {/* Storage Selection */}
              {launchOptions?.ephemeralStorageBlocks &&
                launchOptions.ephemeralStorageBlocks.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                      Storage
                    </label>
                    <select
                      value={selectedStorage}
                      onChange={(e) => setSelectedStorage(e.target.value)}
                      className="w-full px-3 py-2.5 border border-[var(--line)] rounded-lg focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent bg-white"
                    >
                      {launchOptions.ephemeralStorageBlocks.map((storage) => (
                        <option key={storage.id} value={storage.id}>
                          {storage.name}
                          {storage.size_gb ? ` (${storage.size_gb}GB)` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
            </>
          )}

          {/* HF Token (for gated models) */}
          {"gated" in selectedItem && selectedItem.gated && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                HuggingFace Token
                <span className="text-orange-600 ml-1">*</span>
              </label>
              <input
                type="password"
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                placeholder="hf_xxxxxxxxxxxxx"
                className="w-full px-3 py-2.5 border border-[var(--line)] rounded-lg focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent bg-white"
              />
              <p className="text-sm text-[var(--muted)] mt-1">
                This model requires a token.{" "}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--blue)] hover:underline"
                >
                  Get your token here
                </a>
              </p>
            </div>
          )}

          {/* Open WebUI Option (for chat models only) */}
          {isChatModel(selectedItem) && (
            <div className="mb-4">
              <label className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg cursor-pointer hover:bg-zinc-100 transition-colors">
                <input
                  type="checkbox"
                  checked={addOpenWebUI}
                  onChange={(e) => setAddOpenWebUI(e.target.checked)}
                  className="w-4 h-4 text-[var(--blue)] rounded border-zinc-300 focus:ring-[var(--blue)]"
                />
                <div>
                  <span className="font-medium text-[var(--ink)]">
                    Add Chat UI (Open WebUI)
                  </span>
                  <p className="text-xs text-[var(--muted)]">
                    Deploy a ChatGPT-like interface alongside your model
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Deploying Status */}
          {deploying && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
                <span className="font-medium text-blue-800">Deploying...</span>
              </div>
              <p className="text-sm text-blue-700">
                Setting up vLLM and starting inference server. This may take
                several minutes.
              </p>
            </div>
          )}

          {/* Installation Progress */}
          {isPolling && !deploying && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div>
                  <p className="font-medium text-blue-800">
                    {deploymentMessage}
                  </p>
                  <p className="text-sm text-blue-600">
                    {deploymentStatus === "installing" &&
                      "Installing vLLM framework..."}
                    {deploymentStatus === "install_complete" &&
                      "Starting model server..."}
                    {deploymentStatus === "starting" &&
                      "Loading model weights..."}
                  </p>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-500 animate-pulse"
                  style={{
                    width:
                      deploymentStatus === "installing"
                        ? "30%"
                        : deploymentStatus === "install_complete"
                        ? "60%"
                        : deploymentStatus === "starting"
                        ? "80%"
                        : "10%",
                  }}
                />
              </div>
              <p className="text-xs text-blue-600 mt-2">
                Logs update automatically every 5 seconds
              </p>
            </div>
          )}

          {/* Error Message */}
          {deployError && (
            <div className="mb-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {deployError}
              </div>
              {deployLogs && (
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="mt-2 text-sm text-[var(--blue)] hover:underline"
                >
                  {showLogs ? "Hide logs" : "Show deployment logs"}
                </button>
              )}
            </div>
          )}

          {/* Success Message */}
          {deploySuccess && (
            <div className="mb-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    className="w-5 h-5 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="font-medium text-green-800">
                    {deploySuccess}
                  </span>
                </div>
                {deployResult && (
                  <div className="mt-3 p-3 bg-white rounded border border-green-200">
                    <p className="text-sm text-[var(--ink)] mb-1">
                      <strong>API Endpoint:</strong>
                    </p>
                    <code className="text-sm text-[var(--blue)] break-all">
                      http://{deployResult.serviceHost}:
                      {deployResult.servicePort}
                    </code>
                    <p className="text-xs text-[var(--muted)] mt-2">
                      The model is loading. Wait 2-5 minutes before making
                      requests.
                    </p>
                  </div>
                )}
              </div>
              {deployLogs && (
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="mt-2 text-sm text-[var(--blue)] hover:underline"
                >
                  {showLogs ? "Hide logs" : "Show deployment logs"}
                </button>
              )}
            </div>
          )}

          {/* Deployment Logs */}
          {showLogs && deployLogs && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--ink)]">
                  Deployment Logs
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deployLogs);
                  }}
                  className="text-xs text-[var(--blue)] hover:underline"
                >
                  Copy
                </button>
              </div>
              <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto max-h-64 overflow-y-auto font-mono">
                {deployLogs}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 border border-[var(--line)] rounded-lg text-[var(--ink)] hover:bg-zinc-50 transition-colors font-medium"
            >
              {deploySuccess || isPolling ? "Close" : "Cancel"}
            </button>
            {!deploySuccess && (
              <button
                onClick={onDeploy}
                disabled={
                  deploying ||
                  isPolling ||
                  (deployMode === "existing" && !selectedSubscription)
                }
                className="flex-1 py-2.5 px-4 bg-[var(--blue)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-medium"
              >
                Deploy
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
