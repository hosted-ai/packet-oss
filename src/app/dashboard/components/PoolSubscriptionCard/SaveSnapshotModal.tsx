/**
 * Save Snapshot Modal Component
 *
 * Modal for saving GPU pod configuration and optionally preserving data.
 *
 * @module dashboard/PoolSubscriptionCard/SaveSnapshotModal
 */

"use client";

import { useState, useEffect } from "react";
import { formatSmartPrice } from "@/lib/format";

interface StorageOption {
  id: string;
  name: string;
  sizeGb: number;
  pricePerHour: number;
  monthlyEstimate: number;
  recommended: boolean;
  warning?: string;
}

interface SnapshotPrepare {
  existingVolumeCount: number;
  hasExistingStorage: boolean; // Computed from existingVolumeCount > 0
  dataSizeGb: number | null;
  storageOptions: StorageOption[];
  requiresDataCopy: boolean;
  estimatedCopyTimeMinutes?: number;
  existingVolumes?: Array<{ id: string; name: string; sizeGb: number }>;
}

interface SaveSnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  subscriptionId: string | number;
  displayName?: string;
  poolName?: string;
  onSnapshotCreated?: () => void;
  onRefresh?: () => void;
}

export function SaveSnapshotModal({
  isOpen,
  onClose,
  token,
  subscriptionId,
  displayName,
  poolName,
  onSnapshotCreated,
  onRefresh,
}: SaveSnapshotModalProps) {
  const [snapshotName, setSnapshotName] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotStep, setSnapshotStep] = useState<"name" | "options" | "saving">("name");
  const [snapshotPrepare, setSnapshotPrepare] = useState<SnapshotPrepare | null>(null);
  const [saveData, setSaveData] = useState(false);
  const [selectedStorageId, setSelectedStorageId] = useState<string | null>(null);
  const [terminateAfterSave, setTerminateAfterSave] = useState(false);
  const [saveProgress, setSaveProgress] = useState("");

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSnapshotName("");
      setSnapshotError(null);
      setSnapshotStep("name");
      setSnapshotPrepare(null);
      setSaveData(false);
      setSelectedStorageId(null);
      setTerminateAfterSave(false);
      setSaveProgress("");
    }
  }, [isOpen]);

  const resetModal = () => {
    onClose();
  };

  const handlePrepareSnapshot = async () => {
    setSavingSnapshot(true);
    setSnapshotError(null);
    try {
      const response = await fetch(`/api/instances/pool-subscription/${subscriptionId}/snapshot/prepare`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to prepare snapshot");
      }
      // Compute hasExistingStorage from existingVolumeCount
      const prepareData: SnapshotPrepare = {
        ...result,
        hasExistingStorage: (result.existingVolumeCount || 0) > 0,
      };
      setSnapshotPrepare(prepareData);
      setSnapshotStep("options");
      if (result.storageOptions?.length > 0) {
        const recommended = result.storageOptions.find((o: StorageOption) => o.recommended);
        setSelectedStorageId(recommended?.id || result.storageOptions[0].id);
      }
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Failed to prepare snapshot");
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handleSaveSnapshot = async () => {
    setSavingSnapshot(true);
    setSnapshotError(null);
    setSnapshotStep("saving");
    setSaveProgress("Creating snapshot...");

    try {
      const body: {
        displayName: string;
        saveData?: boolean;
        storageBlockId?: string;
        terminateAfterSave?: boolean;
      } = {
        displayName: snapshotName.trim() || displayName || poolName || "GPU Snapshot",
      };

      if (saveData && snapshotPrepare && !snapshotPrepare.hasExistingStorage) {
        body.saveData = true;
        body.storageBlockId = selectedStorageId || undefined;
        setSaveProgress("Creating storage volume...");
      }

      if (terminateAfterSave) {
        body.terminateAfterSave = true;
      }

      const response = await fetch(`/api/instances/pool-subscription/${subscriptionId}/snapshot`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to save snapshot");
      }

      onClose();
      if (onSnapshotCreated) {
        onSnapshotCreated();
      }
      if (terminateAfterSave && onRefresh) {
        onRefresh();
      }
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Failed to save snapshot");
      setSnapshotStep("options");
    } finally {
      setSavingSnapshot(false);
      setSaveProgress("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ink)]">
            {snapshotStep === "name" && "Save Pod Configuration"}
            {snapshotStep === "options" && "Data Preservation"}
            {snapshotStep === "saving" && "Saving..."}
          </h3>
          <button
            onClick={resetModal}
            className="text-zinc-400 hover:text-zinc-600 p-1"
            disabled={snapshotStep === "saving"}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {snapshotError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl flex-shrink-0">
            {snapshotError}
          </div>
        )}

        {/* Scrollable content area */}
        <div className="overflow-y-auto flex-1 min-h-0">
        {/* Step 1: Name */}
        {snapshotStep === "name" && (
          <>
            <p className="text-sm text-zinc-600 mb-4">
              Save this pod&apos;s configuration so you can quickly launch it again later.
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Snapshot Name
              </label>
              <input
                type="text"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                placeholder={displayName || poolName || "My GPU Setup"}
                className="w-full px-3 py-2 border border-[var(--line)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetModal}
                className="flex-1 px-4 py-2 border border-[var(--line)] text-zinc-700 text-sm font-medium rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePrepareSnapshot}
                disabled={savingSnapshot}
                className="flex-1 px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {savingSnapshot ? "Preparing..." : "Next"}
              </button>
            </div>
          </>
        )}

        {/* Step 2: Data preservation options */}
        {snapshotStep === "options" && snapshotPrepare && (
          <>
            {snapshotPrepare.hasExistingStorage ? (
              <div className="mb-4 p-3 bg-teal-50 border border-teal-200 text-teal-700 text-sm rounded-xl">
                <span className="font-medium">Great news!</span> You have persistent storage attached.
                Your data will be preserved automatically.
                {snapshotPrepare.existingVolumes && snapshotPrepare.existingVolumes.length > 0 && (
                  <div className="mt-2 text-xs">
                    <span className="font-medium">Volumes:</span>{" "}
                    {snapshotPrepare.existingVolumes.map((v, i) => (
                      <span key={v.id}>
                        {v.name} ({v.sizeGb}GB){i < snapshotPrepare.existingVolumes!.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-600 mb-4">
                  This pod doesn&apos;t have persistent storage. Would you like to save your data?
                </p>

                {snapshotPrepare.dataSizeGb && (
                  <div className="mb-4 p-3 bg-zinc-100 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-700">Your pod data:</span>
                      <span className="text-sm font-semibold text-zinc-900">~{snapshotPrepare.dataSizeGb}GB</span>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    checked={saveData}
                    onChange={(e) => setSaveData(e.target.checked)}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-zinc-700">Preserve my data</span>
                    <span className="text-xs text-zinc-500 block">
                      Store your files so they can be restored later
                    </span>
                  </div>
                </label>

                {saveData && snapshotPrepare.storageOptions.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-zinc-700 mb-2">
                      Select storage size
                    </label>
                    <div className="space-y-2">
                      {snapshotPrepare.storageOptions.map((option) => (
                        <label
                          key={option.id}
                          className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer transition-colors ${
                            selectedStorageId === option.id
                              ? option.warning ? "border-amber-500 bg-amber-50" : "border-teal-500 bg-teal-50"
                              : "border-[var(--line)] hover:border-zinc-300"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="storage"
                              checked={selectedStorageId === option.id}
                              onChange={() => setSelectedStorageId(option.id)}
                              className="w-4 h-4 text-teal-600 focus:ring-teal-500"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-zinc-700">{option.sizeGb}GB</span>
                                {option.recommended && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded">Recommended</span>
                                )}
                              </div>
                              {option.warning && (
                                <span className="text-xs text-amber-600 block">{option.warning}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-medium text-zinc-700">{formatSmartPrice(option.pricePerHour)}/hr</span>
                            <span className="text-xs text-zinc-500 block">~${option.monthlyEstimate.toFixed(0)}/mo</span>
                          </div>
                        </label>
                      ))}
                    </div>

                    {selectedStorageId && (
                      <div className="mt-3 p-3 bg-teal-50 border border-teal-200 rounded-xl">
                        <p className="text-sm text-teal-800">
                          <span className="font-medium">Storage cost:</span>{" "}
                          {formatSmartPrice(snapshotPrepare.storageOptions.find(o => o.id === selectedStorageId)?.pricePerHour || 0)}/hr to keep your data saved
                        </p>
                      </div>
                    )}

                    {snapshotPrepare.estimatedCopyTimeMinutes && (
                      <p className="text-xs text-zinc-500 mt-2">
                        Estimated copy time: ~{snapshotPrepare.estimatedCopyTimeMinutes} minutes
                      </p>
                    )}
                  </div>
                )}

                {saveData && snapshotPrepare.storageOptions.length === 0 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl">
                    No storage options available. Only configuration will be saved.
                  </div>
                )}
              </>
            )}

            <label className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl cursor-pointer mb-6">
              <input
                type="checkbox"
                checked={terminateAfterSave}
                onChange={(e) => setTerminateAfterSave(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-zinc-700">Terminate after saving</span>
                <span className="text-xs text-zinc-500 block">
                  Stop billing by terminating the pod after saving
                </span>
              </div>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setSnapshotStep("name")}
                className="flex-1 px-4 py-2 border border-[var(--line)] text-zinc-700 text-sm font-medium rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSaveSnapshot}
                disabled={savingSnapshot || (saveData && !snapshotPrepare.hasExistingStorage && snapshotPrepare.storageOptions.length > 0 && !selectedStorageId)}
                className="flex-1 px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                Save Snapshot
              </button>
            </div>
          </>
        )}

        {/* Step 3: Saving progress */}
        {snapshotStep === "saving" && (
          <div className="py-8 text-center">
            <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm text-zinc-600">{saveProgress || "Saving..."}</p>
            {saveData && !snapshotPrepare?.hasExistingStorage && (
              <p className="text-xs text-zinc-500 mt-2">
                This may take several minutes while we copy your data.
              </p>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
