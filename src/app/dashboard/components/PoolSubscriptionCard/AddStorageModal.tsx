"use client";

import { useState, useEffect } from "react";
import { formatSmartPrice } from "@/lib/format";

interface AttachedVolume {
  id: number;
  name: string;
  mount_point: string;
  size_in_gb: number;
  status: string;
  mount_status?: string;
}

interface AvailableVolume {
  id: number;
  name: string;
  size_in_gb: number;
  mount_point: string;
  status?: string;
  cost: string | number;
}

interface StorageBlockOption {
  id: string;
  name: string;
  size: number;
  /** $/hr, derived from our configured storage rate (see getSharedStorageBlocks). */
  cost: number;
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
    shared_volumes?: Array<{ name: string; mount_point: string; size_in_gb: number }>;
  };
}

export function AddStorageModal({
  isOpen,
  onClose,
  subscriptionId,
  token,
  onSuccess,
}: AddStorageModalProps) {
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState(false);
  const [attachSuccess, setAttachSuccess] = useState(false);
  const [error, setError] = useState("");

  // Data from API
  const [attachedVolumes, setAttachedVolumes] = useState<AttachedVolume[]>([]);
  const [availableVolumes, setAvailableVolumes] = useState<AvailableVolume[]>([]);
  const [storageBlocks, setStorageBlocks] = useState<StorageBlockOption[]>([]);
  const [sharedStorageSupported, setSharedStorageSupported] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // Form state
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [selectedVolumeId, setSelectedVolumeId] = useState<number | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    async function fetchStorageOptions() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/instances/pool-subscription/${subscriptionId}/add-storage`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (response.ok) {
          const data = await response.json();
          setAttachedVolumes(data.attachedVolumes || []);
          setAvailableVolumes(data.availableVolumes || []);
          setStorageBlocks(data.storageBlocks || []);
          setSharedStorageSupported(data.hasSharedStorageSupport ?? true);
          setLoadFailed(Boolean(data.loadFailed));

          // Default to existing if there are available volumes
          if (data.availableVolumes?.length > 0) {
            setMode("existing");
            setSelectedVolumeId(data.availableVolumes[0].id);
          } else if (data.storageBlocks?.length > 0) {
            setMode("create");
            setSelectedBlockId(data.storageBlocks[0].id);
          }
        } else {
          const text = await response.text();
          try {
            const errData = JSON.parse(text);
            setError(errData.error || "Failed to load storage options");
          } catch {
            setError(`Failed to load storage options (HTTP ${response.status})`);
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

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSelectedVolumeId(null);
      setSelectedBlockId("");
      setError("");
      setAttaching(false);
      setAttachSuccess(false);
    }
  }, [isOpen]);

  const handleAttach = async () => {
    setAttaching(true);
    setError("");

    try {
      const body: Record<string, unknown> = {};
      if (mode === "existing" && selectedVolumeId) {
        body.volume_id = selectedVolumeId;
      } else if (mode === "create" && selectedBlockId) {
        body.storage_block_id = selectedBlockId;
      } else {
        setError("Please select a storage option");
        setAttaching(false);
        return;
      }

      const response = await fetch(
        `/api/instances/pool-subscription/${subscriptionId}/add-storage`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (response.ok) {
        setAttachSuccess(true);
        setAttaching(false);
        // Trigger dashboard refresh so the card shows "Attaching..." state
        onSuccess();
        // Auto-close after a brief pause
        setTimeout(() => onClose(), 2000);
        return;
      } else {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          setError(data.error || "Failed to attach storage");
        } catch {
          setError(`Failed to attach storage (HTTP ${response.status})`);
        }
      }
    } catch {
      setError("Failed to attach storage. Please check your connection.");
    } finally {
      setAttaching(false);
    }
  };

  if (!isOpen) return null;

  const canAttach =
    (mode === "existing" && selectedVolumeId !== null) ||
    (mode === "create" && selectedBlockId !== "");
  const noOptions = !sharedStorageSupported || (availableVolumes.length === 0 && storageBlocks.length === 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">Storage</h2>
              <p className="text-xs text-[var(--muted)]">
                Manage persistent storage volumes
              </p>
            </div>
            <button aria-label="Close dialog"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {attachSuccess ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-[var(--ink)]">Volume is being attached</p>
              <p className="text-xs text-[var(--muted)]">The GPU will restart briefly. Check the card for status.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-900"></div>
            </div>
          ) : (
            <>
              {/* Attached Volumes */}
              {attachedVolumes.length > 0 && (
                <div className="mb-5">
                  <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                    Attached
                  </label>
                  <div className="space-y-2">
                    {attachedVolumes.map((vol) => (
                      <div
                        key={vol.id}
                        className="flex items-center gap-3 p-3 bg-teal-50 rounded-xl border border-teal-200"
                      >
                        <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center shrink-0">
                          <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-teal-800 truncate">{vol.name}</div>
                          <div className="text-xs text-teal-600">
                            {vol.size_in_gb}GB · <code className="bg-teal-100 px-1 rounded">{vol.mount_point}</code>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full shrink-0">
                          {vol.mount_status === "SUCCEEDED" ? "attached" : vol.status?.toLowerCase()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attach New Volume */}
              {!noOptions && (
                <>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wide">
                    Attach Volume
                  </label>

                  {/* Mode toggle */}
                  <div className="flex gap-2 mb-3">
                    {availableVolumes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("existing");
                          if (availableVolumes.length > 0 && selectedVolumeId === null) {
                            setSelectedVolumeId(availableVolumes[0].id);
                          }
                        }}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          mode === "existing"
                            ? "border-teal-500 bg-teal-50 text-teal-700 font-medium"
                            : "border-[var(--line)] text-[var(--muted)] hover:border-zinc-300"
                        }`}
                      >
                        Existing volume
                      </button>
                    )}
                    {storageBlocks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("create");
                          if (storageBlocks.length > 0 && !selectedBlockId) {
                            setSelectedBlockId(storageBlocks[0].id);
                          }
                        }}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          mode === "create"
                            ? "border-teal-500 bg-teal-50 text-teal-700 font-medium"
                            : "border-[var(--line)] text-[var(--muted)] hover:border-zinc-300"
                        }`}
                      >
                        Create new
                      </button>
                    )}
                  </div>

                  {/* Existing volume picker */}
                  {mode === "existing" && availableVolumes.length > 0 && (
                    <div className="space-y-2">
                      {availableVolumes.map((vol) => (
                        <button
                          key={vol.id}
                          type="button"
                          onClick={() => setSelectedVolumeId(vol.id)}
                          className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                            selectedVolumeId === vol.id
                              ? "border-teal-500 bg-teal-50"
                              : "border-[var(--line)] hover:border-zinc-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-[var(--ink)]">{vol.name}</div>
                              <div className="text-xs text-[var(--muted)]">
                                {vol.size_in_gb}GB · {vol.mount_point}
                                {vol.status?.toUpperCase() === "IN_USE" && " · shared with another instance"}
                              </div>
                            </div>
                            {selectedVolumeId === vol.id && (
                              <div className="w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center">
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Block size picker for create mode */}
                  {mode === "create" && storageBlocks.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {storageBlocks.map((block) => (
                        <button
                          key={block.id}
                          type="button"
                          onClick={() => setSelectedBlockId(block.id)}
                          className={`px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                            selectedBlockId === block.id
                              ? "border-teal-500 bg-teal-50 text-teal-700 font-medium"
                              : "border-[var(--line)] text-[var(--muted)] hover:border-zinc-300"
                          }`}
                        >
                          {block.size}GB
                          {block.cost > 0 && (
                            <span className="text-xs ml-1">({formatSmartPrice(block.cost)}/hr)</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Restart warning */}
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex gap-2">
                      <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="text-sm text-amber-700">
                        <strong>GPU will restart briefly.</strong> Unsaved work in local storage may be lost.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* No options */}
              {noOptions && attachedVolumes.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-[var(--muted)]">
                    {loadFailed
                      ? "Couldn't load storage options just now. Please try again in a moment."
                      : !sharedStorageSupported
                        ? "Shared storage isn't supported in this instance's region."
                        : "This region has no storage capacity available right now."}
                  </p>
                </div>
              )}

              {/* Info when only showing attached */}
              {noOptions && attachedVolumes.length > 0 && (
                <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                  <p className="text-xs text-[var(--muted)]">
                    Manage your storage volumes in the <strong>Storage</strong> tab.
                  </p>
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
            {noOptions || loading ? "Close" : "Cancel"}
          </button>
          {!noOptions && !loading && (
            <button
              onClick={handleAttach}
              disabled={attaching || !canAttach}
              className="flex-1 py-3 px-4 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {attaching ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Attaching...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Attach Storage
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
