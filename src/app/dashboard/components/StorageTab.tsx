"use client";

import { useState, useEffect, useCallback } from "react";
import { formatSmartPrice } from "@/lib/format";

interface StorageVolume {
  id: number;
  name: string;
  size_in_gb: number;
  region_id: number;
  status: string;
  mount_point: string | null;
  cost: number;
  displaySize: string;
  isAvailable: boolean;
}

interface StorageTabProps {
  token: string;
}

export function StorageTab({ token }: StorageTabProps) {
  const [volumes, setVolumes] = useState<StorageVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StorageVolume | null>(null);
  const [affectedSnapshots, setAffectedSnapshots] = useState<Array<{ id: string; name: string }>>([]);

  const fetchVolumes = useCallback(async () => {
    try {
      const response = await fetch("/api/instances/shared-volumes", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch storage volumes");
      }

      const data = await response.json();
      setVolumes(data.volumes || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load storage");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchVolumes();
  }, [fetchVolumes]);

  const handleDelete = async (volume: StorageVolume, deleteSnapshots = false) => {
    setDeleting(volume.id);
    setError(null);

    try {
      const response = await fetch("/api/instances/shared-volumes", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ volume_id: volume.id, deleteSnapshots }),
      });

      const data = await response.json();

      // API returns 409 when snapshots would be affected — show warning
      if (response.status === 409 && data.requiresConfirmation) {
        setAffectedSnapshots(data.affectedSnapshots || []);
        setDeleting(null);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete volume");
      }

      // Remove from local state
      setVolumes((prev) => prev.filter((v) => v.id !== volume.id));
      setConfirmDelete(null);
      setAffectedSnapshots([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete volume");
    } finally {
      setDeleting(null);
    }
  };

  // Calculate total storage cost per hour
  const totalHourlyCost = volumes.reduce((sum, v) => sum + (v.cost || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-zinc-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Loading storage volumes...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Storage</h1>
          <p className="text-sm text-[var(--muted)]">
            Manage your persistent storage volumes
          </p>
        </div>
        <button
          onClick={fetchVolumes}
          className="text-sm text-[var(--muted)] hover:text-zinc-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Summary Card */}
      {volumes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
            <div className="text-xs text-[var(--muted)] mb-1">Total Volumes</div>
            <div className="text-3xl font-bold text-[var(--ink)]">{volumes.length}</div>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
            <div className="text-xs text-[var(--muted)] mb-1">Total Storage</div>
            <div className="text-3xl font-bold text-[var(--ink)]">
              {volumes.reduce((sum, v) => sum + v.size_in_gb, 0)} GB
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
            <div className="text-xs text-[var(--muted)] mb-1">Attached</div>
            <div className="text-3xl font-bold text-emerald-600">
              {volumes.filter((v) => v.status === "attached").length}
            </div>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-[var(--line)]">
            <div className="text-xs text-[var(--muted)] mb-1">Storage Cost</div>
            <div className="text-3xl font-bold text-[var(--ink)]">
              {formatSmartPrice(totalHourlyCost)}
              <span className="text-sm font-normal text-zinc-400">/hr</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Volumes List */}
      {volumes.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[var(--line)] p-12 text-center">
          <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-[var(--ink)] mb-2">No Storage Volumes</h3>
          <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
            You don&apos;t have any persistent storage volumes yet. Storage is created when you launch a GPU with persistent storage enabled.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {volumes.map((volume) => (
            <div
              key={volume.id}
              className="bg-white rounded-2xl border border-[var(--line)] p-5 hover:border-zinc-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    volume.status === "attached" ? "bg-emerald-100" : "bg-zinc-100"
                  }`}>
                    <svg className={`w-6 h-6 ${volume.status === "attached" ? "text-emerald-600" : "text-zinc-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                    </svg>
                  </div>

                  {/* Details */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--ink)]">{volume.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        volume.status === "attached"
                          ? "bg-emerald-100 text-emerald-700"
                          : volume.status === "available"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}>
                        {volume.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-[var(--muted)]">
                      <span className="font-medium text-zinc-700">{volume.size_in_gb} GB</span>
                      {volume.mount_point && (
                        <span className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                          {volume.mount_point}
                        </span>
                      )}
                      {volume.cost > 0 && (
                        <span>{formatSmartPrice(volume.cost)}/hr</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {volume.status === "attached" ? (
                    <span className="text-xs text-zinc-400">
                      Detach from GPU to delete
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(volume)}
                      disabled={deleting === volume.id}
                      className="px-3 py-1.5 text-sm text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deleting === volume.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </div>
              </div>

              {/* Warning for attached volumes */}
              {volume.status === "attached" && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
                  This volume is attached to a running GPU. Terminate the GPU first to delete this storage.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 p-4 bg-zinc-50 rounded-xl border border-zinc-100">
        <h3 className="font-medium text-zinc-700 mb-2">About Storage Volumes</h3>
        <ul className="text-sm text-zinc-600 space-y-1">
          <li>
            <strong>Attached</strong> volumes are currently connected to a running GPU.
          </li>
          <li>
            <strong>Available</strong> volumes can be attached to a new GPU or deleted.
          </li>
          <li>
            Storage is billed hourly while the volume exists, even if not attached.
          </li>
          <li>
            Delete unused volumes to stop billing.
          </li>
        </ul>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-zinc-800">Delete Storage Volume</h3>
            </div>

            <p className="text-sm text-zinc-600 mb-2">
              Are you sure you want to delete <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="text-sm text-rose-600 bg-rose-50 p-3 rounded-lg mb-4">
              This action cannot be undone. All data on this volume will be permanently lost.
            </p>

            {affectedSnapshots.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800 mb-1">
                  {affectedSnapshots.length} snapshot{affectedSnapshots.length === 1 ? "" : "s"} will also be deleted:
                </p>
                <ul className="text-sm text-amber-700 list-disc list-inside">
                  {affectedSnapshots.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => { setConfirmDelete(null); setAffectedSnapshots([]); }}
                className="px-4 py-2 text-sm text-zinc-600 hover:text-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete, affectedSnapshots.length > 0)}
                disabled={deleting === confirmDelete.id}
                className="px-4 py-2 text-sm bg-rose-600 text-white rounded-xl hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleting === confirmDelete.id ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deleting...
                  </>
                ) : affectedSnapshots.length > 0 ? (
                  "Delete Volume & Snapshots"
                ) : (
                  "Delete Volume"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
