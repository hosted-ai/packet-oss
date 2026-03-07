"use client";

import React, { useState } from "react";
import { PodSnapshot } from "./types";

interface SnapshotCardProps {
  snapshot: PodSnapshot;
  token: string;
  onRestore: () => void;
  onDelete: () => void;
}

export function SnapshotCard({ snapshot, token, onRestore, onDelete }: SnapshotCardProps) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore configuration
  const [restoreVgpus] = useState(1);
  const [attachStorage, setAttachStorage] = useState(true);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate days remaining for auto-preserved snapshots
  const getDaysRemaining = (): number | null => {
    if (!snapshot.autoPreserved || !snapshot.expiresAt) return null;
    const now = new Date();
    const expires = new Date(snapshot.expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  const daysRemaining = getDaysRemaining();

  const handleRestore = async () => {
    setIsRestoring(true);
    setError(null);
    try {
      const response = await fetch(`/api/instances/from-snapshot/${snapshot.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vgpus: restoreVgpus,
          attachStorage: attachStorage && snapshot.hasStorage,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to restore");
      }

      setShowRestoreModal(false);
      onRestore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore");
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/instances/snapshots/${snapshot.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to delete");
      }

      setShowDeleteConfirm(false);
      onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setIsDeleting(false);
    }
  };

  const isAutoPreserved = snapshot.autoPreserved;

  return (
    <>
      <div className={`bg-white rounded-2xl border p-5 hover:shadow-sm transition-shadow ${
        isAutoPreserved ? "border-amber-200" : "border-[var(--line)]"
      }`}>
        {/* Auto-preserved banner */}
        {isAutoPreserved && daysRemaining !== null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 rounded-xl text-sm">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-amber-700">
              Auto-saved due to insufficient balance.{" "}
              {daysRemaining > 0 ? (
                <>Storage preserved for <strong>{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}</strong>. Top up your wallet to re-deploy.</>
              ) : (
                <strong>Expiring today. Top up now to save your data.</strong>
              )}
            </span>
          </div>
        )}

        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isAutoPreserved ? "bg-amber-100" : "bg-zinc-100"
          }`}>
            {isAutoPreserved ? (
              <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-[var(--ink)] truncate">{snapshot.displayName}</h3>
              <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs rounded-full">
                {snapshot.snapshotType === "full" ? "Full" : "Template"}
              </span>
              {isAutoPreserved && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                  Auto-saved
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
              {snapshot.poolName && <span>{snapshot.poolName}</span>}
              <span>{snapshot.vgpus} GPU{snapshot.vgpus !== 1 ? "s" : ""}</span>
              {snapshot.hasStorage && snapshot.storage && (
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  {snapshot.storage.sizeGb}GB
                </span>
              )}
              {snapshot.hfModel && (
                <span className="flex items-center gap-1">
                  <span>🤗</span>
                  <span className="truncate max-w-[150px]">{snapshot.hfModel.name || snapshot.hfModel.id}</span>
                </span>
              )}
            </div>

            <div className="text-xs text-zinc-400 mt-1">
              Saved {formatDate(snapshot.createdAt)}
              {isAutoPreserved && daysRemaining !== null && (
                <span className={`ml-2 ${daysRemaining <= 1 ? "text-rose-500 font-medium" : "text-amber-500"}`}>
                  {daysRemaining > 0 ? `Expires in ${daysRemaining}d` : "Expires today"}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowRestoreModal(true)}
              className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-medium rounded-xl transition-colors"
            >
              Resume
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 text-zinc-400 hover:text-rose-500 transition-colors"
              title="Delete snapshot"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-auto my-auto shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ink)]">Resume Pod</h3>
              <button
                onClick={() => setShowRestoreModal(false)}
                className="text-zinc-400 hover:text-zinc-600 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-zinc-600 mb-4">
              Launch a new pod from &quot;{snapshot.displayName}&quot;
            </p>

            {isAutoPreserved && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-xl">
                This pod was auto-saved when your wallet ran out. Ensure you have sufficient balance before resuming — the first 30 minutes will be charged upfront.
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl">
                {error}
              </div>
            )}

            <div className="space-y-4 mb-6">
              {snapshot.hasStorage && snapshot.storage && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="attachStorage"
                    checked={attachStorage}
                    onChange={(e) => setAttachStorage(e.target.checked)}
                    className="w-4 h-4 text-[var(--blue)] border-zinc-300 rounded focus:ring-[var(--blue)]"
                  />
                  <label htmlFor="attachStorage" className="text-sm text-zinc-700">
                    Attach saved storage ({snapshot.storage.sizeGb}GB)
                  </label>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRestoreModal(false)}
                className="flex-1 px-4 py-2 border border-[var(--line)] text-zinc-700 text-sm font-medium rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRestore}
                disabled={isRestoring}
                className="flex-1 px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {isRestoring ? "Launching..." : "Launch Pod"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--ink)] mb-2">Delete Snapshot?</h3>
            <p className="text-sm text-zinc-600 mb-4">
              This will delete &quot;{snapshot.displayName}&quot;.
              {snapshot.hasStorage && (
                <span className="block mt-2 text-amber-600">
                  {isAutoPreserved
                    ? "Warning: This will also delete the preserved storage volume and your data will be lost permanently."
                    : "Note: Your persistent storage volume will NOT be deleted."
                  }
                </span>
              )}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-[var(--line)] text-zinc-700 text-sm font-medium rounded-xl hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
