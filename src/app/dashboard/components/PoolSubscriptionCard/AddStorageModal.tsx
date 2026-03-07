"use client";

import { useState, useEffect } from "react";

interface StorageBlock {
  id: string;
  name: string;
  size_gb?: number;
  price_per_hour?: number;
}

interface SharedVolumeInfo {
  name: string;
  mount_point: string;
  size_in_gb: number;
}

interface AddStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscriptionId: string;
  token: string;
  onSuccess: () => void;
  existingStorage?: {
    ephemeral_storage_gb?: number;
    persistent_storage_gb?: number;
    persistent_storage_block_id?: string;
    shared_volumes?: SharedVolumeInfo[];
  };
}

export function AddStorageModal({
  isOpen,
  onClose,
  subscriptionId,
  token,
  onSuccess,
  existingStorage,
}: AddStorageModalProps) {
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [storageBlocks, setStorageBlocks] = useState<StorageBlock[]>([]);
  const [selectedStorage, setSelectedStorage] = useState("");
  const [hasPersistentStorage, setHasPersistentStorage] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    async function fetchStorageOptions() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/instances/pool-subscription/${subscriptionId}/add-storage`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setStorageBlocks(data.persistentStorageBlocks || []);
          setHasPersistentStorage(data.hasPersistentStorage);
          if (data.persistentStorageBlocks?.length > 0) {
            setSelectedStorage(data.persistentStorageBlocks[0].id);
          }
        } else {
          // Try to parse JSON error, but handle HTML error pages gracefully
          const text = await response.text();
          try {
            const errData = JSON.parse(text);
            setError(errData.error || "Failed to load storage options");
          } catch {
            if (response.status === 502 || response.status === 504) {
              setError("Server is temporarily unavailable. Please try again.");
            } else {
              setError(`Failed to load storage options (HTTP ${response.status})`);
            }
          }
        }
      } catch {
        setError("Failed to load storage options. Please check your connection.");
      } finally {
        setLoading(false);
      }
    }

    fetchStorageOptions();
  }, [isOpen, subscriptionId, token]);

  const handleAddStorage = async () => {
    if (!selectedStorage) {
      setError("Please select a storage option");
      return;
    }

    setAdding(true);
    setError("");

    try {
      const response = await fetch(
        `/api/instances/pool-subscription/${subscriptionId}/add-storage`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            persistent_storage_block_id: selectedStorage,
          }),
        }
      );

      if (response.ok) {
        onSuccess();
        onClose();
      } else {
        // Try to parse JSON error, but handle HTML error pages gracefully
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          setError(data.error || "Failed to add storage");
        } catch {
          // Response wasn't JSON (likely HTML error page)
          if (response.status === 502 || response.status === 504) {
            setError("Server is temporarily unavailable. Please try again.");
          } else if (response.status === 401) {
            setError("Session expired. Please refresh the page.");
          } else {
            setError(`Failed to add storage (HTTP ${response.status})`);
          }
        }
      }
    } catch {
      setError("Failed to add storage. Please check your connection.");
    } finally {
      setAdding(false);
    }
  };

  if (!isOpen) return null;

  const selectedBlock = storageBlocks.find((b) => b.id === selectedStorage);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">
                Add Persistent Storage
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Data persists across restarts
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
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
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-900"></div>
            </div>
          ) : hasPersistentStorage ? (
            <div className="py-4">
              <div className="space-y-3">
                {/* Show ephemeral storage */}
                {existingStorage?.ephemeral_storage_gb && (
                  <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-[var(--line)]">
                    <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--ink)]">Ephemeral Storage</div>
                      <div className="text-xs text-[var(--muted)]">{existingStorage.ephemeral_storage_gb}GB &middot; Cleared on restart</div>
                    </div>
                  </div>
                )}

                {/* Show persistent block storage */}
                {existingStorage?.persistent_storage_gb && (
                  <div className="flex items-center gap-3 p-3 bg-teal-50 rounded-xl border border-teal-200">
                    <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-teal-800">Persistent Storage</div>
                      <div className="text-xs text-teal-600">{existingStorage.persistent_storage_gb}GB &middot; Survives restarts</div>
                    </div>
                    <span className="ml-auto px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full">attached</span>
                  </div>
                )}

                {/* Show shared volumes */}
                {existingStorage?.shared_volumes?.map((vol, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-teal-50 rounded-xl border border-teal-200">
                    <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-teal-800 truncate">{vol.name}</div>
                      <div className="text-xs text-teal-600">
                        {vol.size_in_gb}GB &middot; Mount: <code className="bg-teal-100 px-1 rounded">{vol.mount_point}</code>
                      </div>
                    </div>
                    <span className="ml-auto px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full shrink-0">attached</span>
                  </div>
                ))}

                {/* No storage details available */}
                {!existingStorage?.ephemeral_storage_gb && !existingStorage?.persistent_storage_gb && !existingStorage?.shared_volumes?.length && (
                  <div className="text-center py-4">
                    <p className="text-sm text-[var(--muted)]">
                      This GPU has persistent storage attached.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                <p className="text-xs text-[var(--muted)]">
                  Manage your storage volumes in the <strong>Storage</strong> tab of the dashboard.
                </p>
              </div>
            </div>
          ) : storageBlocks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-[var(--muted)]">
                No persistent storage options available for this region.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <label className="block text-xs font-medium text-[var(--muted)] mb-3 uppercase tracking-wide">
                  Select Storage Size
                </label>
                <div className="space-y-2">
                  {storageBlocks.map((block) => (
                    <button
                      key={block.id}
                      onClick={() => setSelectedStorage(block.id)}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                        selectedStorage === block.id
                          ? "border-teal-500 bg-teal-50"
                          : "border-[var(--line)] hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-[var(--ink)]">
                            {block.name}
                          </div>
                          <div className="text-sm text-[var(--muted)]">
                            {block.size_gb && `${block.size_gb}GB`}
                            {block.price_per_hour !== undefined &&
                              ` · $${block.price_per_hour.toFixed(3)}/hr`}
                          </div>
                        </div>
                        {selectedStorage === block.id && (
                          <div className="w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center">
                            <svg
                              className="w-4 h-4 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Warning */}
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-6">
                <div className="flex gap-2">
                  <svg
                    className="w-5 h-5 text-amber-600 shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="text-sm text-amber-700">
                    <strong>GPU will restart.</strong> Adding storage requires a
                    quick restart. Unsaved data in ephemeral storage will be
                    lost.
                  </div>
                </div>
              </div>

              {/* Pricing summary */}
              {selectedBlock && (
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-teal-700">
                      Additional Cost
                    </span>
                    <span className="text-lg font-bold text-teal-700">
                      +${(selectedBlock.price_per_hour || 0).toFixed(3)}/hr
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--line)] p-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-xl transition-colors"
          >
            Cancel
          </button>
          {!hasPersistentStorage && storageBlocks.length > 0 && (
            <button
              onClick={handleAddStorage}
              disabled={adding || !selectedStorage}
              className="flex-1 py-3 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {adding ? (
                <>
                  <span className="animate-spin">&#x21bb;</span>
                  Adding...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Add Storage
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
