"use client";

import { useState, useEffect, useCallback } from "react";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface NewKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  scopes: string;
  expiresAt: string | null;
  createdAt: string;
}

interface ApiKeysSettingsProps {
  token: string;
}

export function ApiKeysSettings({ token }: ApiKeysSettingsProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<NewKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/account/api-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch API keys");
      }

      const data = await response.json();
      setKeys(data.keys || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;

    setCreating(true);
    try {
      const response = await fetch("/api/account/api-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create API key");
      }

      const data = await response.json();
      setNewKey(data.apiKey);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/account/api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to delete API key");
      }

      fetchKeys();
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete API key");
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewKeyName("");
    setNewKey(null);
    setCopied(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--line)] p-6">
        <div className="animate-pulse">
          <div className="h-6 w-32 bg-zinc-100 rounded mb-4"></div>
          <div className="h-4 w-64 bg-zinc-100 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--line)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">API Keys</h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              Manage API keys for programmatic access to your account
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors flex items-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Key
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-6 py-4 bg-red-50 border-b border-red-100">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Keys list */}
      <div className="divide-y divide-[var(--line)]">
        {keys.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <p className="text-[var(--muted)] text-sm mb-4">No API keys yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-sm text-[var(--blue)] hover:underline font-medium"
            >
              Create your first API key
            </button>
          </div>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--ink)] truncate">{key.name}</p>
                    <code className="text-xs bg-zinc-100 px-2 py-0.5 rounded text-zinc-600 font-mono">
                      {key.keyPrefix}...
                    </code>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--muted)] mt-1">
                    <span>Created {formatDate(key.createdAt)}</span>
                    {key.lastUsedAt && (
                      <>
                        <span className="w-1 h-1 bg-zinc-300 rounded-full" />
                        <span>Last used {formatDate(key.lastUsedAt)}</span>
                      </>
                    )}
                    {key.expiresAt && (
                      <>
                        <span className="w-1 h-1 bg-zinc-300 rounded-full" />
                        <span className="text-amber-600">Expires {formatDate(key.expiresAt)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {confirmDelete === key.id ? (
                  <>
                    <span className="text-xs text-[var(--muted)] mr-2">Delete this key?</span>
                    <button
                      onClick={() => handleDelete(key.id)}
                      disabled={deletingId === key.id}
                      className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {deletingId === key.id ? "..." : "Yes"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-3 py-1.5 bg-zinc-100 text-zinc-600 text-xs font-medium rounded-lg hover:bg-zinc-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(key.id)}
                    className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete key"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Documentation hint */}
      <div className="px-6 py-4 bg-zinc-50 border-t border-[var(--line)]">
        <p className="text-xs text-[var(--muted)]">
          API keys provide full access to your account via the REST API.{" "}
          <a href="/dashboard?tab=docs" className="text-[var(--blue)] hover:underline">
            View API documentation →
          </a>
        </p>
      </div>

      {/* Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            {!newKey ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-[var(--ink)]">Create API Key</h3>
                  <button
                    onClick={closeCreateModal}
                    className="text-zinc-400 hover:text-zinc-600 p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mb-6">
                  <label htmlFor="keyName" className="block text-sm font-medium text-[var(--ink)] mb-2">
                    Key Name
                  </label>
                  <input
                    type="text"
                    id="keyName"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., Production, CI/CD, Development"
                    className="w-full px-4 py-3 border border-[var(--line)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                    }}
                  />
                  <p className="text-xs text-[var(--muted)] mt-2">
                    Give your key a descriptive name to identify its purpose
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={closeCreateModal}
                    className="flex-1 px-4 py-2.5 border border-[var(--line)] text-[var(--ink)] font-medium rounded-xl hover:bg-zinc-50 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newKeyName.trim() || creating}
                    className="flex-1 px-4 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors text-sm disabled:opacity-50"
                  >
                    {creating ? "Creating..." : "Create Key"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--ink)]">API Key Created</h3>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    Make sure to copy your key now. You won&apos;t be able to see it again!
                  </p>
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                    Your API Key
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={newKey.key}
                      readOnly
                      className="w-full px-4 py-3 pr-24 bg-zinc-50 border border-[var(--line)] rounded-xl text-sm font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(newKey.key)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[var(--ink)] text-white text-xs font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-6">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-800">Store securely</p>
                      <p className="text-xs text-amber-700 mt-1">
                        This key grants full access to your account. Keep it secret and never commit it to version control.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={closeCreateModal}
                  className="w-full px-4 py-2.5 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-xl transition-colors text-sm"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
