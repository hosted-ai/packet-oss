"use client";

import { useState, useEffect, useCallback } from "react";

interface SSHKey {
  id: string;
  name: string;
  fingerprint: string;
  createdAt: string;
  keyPreview: string;
}

interface SSHKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  subscriptionId: string;
  podName?: string;
  poolName?: string;
}

export function SSHKeyModal({
  isOpen,
  onClose,
  token,
  subscriptionId,
  podName,
  poolName,
}: SSHKeyModalProps) {
  const [savedKeys, setSavedKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [injecting, setInjecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New key form
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newPublicKey, setNewPublicKey] = useState("");
  const [saveNewKey, setSaveNewKey] = useState(true);
  const [addingKey, setAddingKey] = useState(false);

  const fetchSavedKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/account/ssh-keys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSavedKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Failed to fetch SSH keys:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) {
      fetchSavedKeys();
      setError(null);
      setSuccess(null);
      setShowNewKeyForm(false);
      setNewKeyName("");
      setNewPublicKey("");
    }
  }, [isOpen, fetchSavedKeys]);

  const handleInjectSavedKey = async (keyId: string, keyName: string) => {
    setError(null);
    setSuccess(null);
    setInjecting(keyId);

    try {
      const response = await fetch("/api/instances/inject-ssh-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          keyId,
          subscriptionId,
          podName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to inject SSH key");
      }

      import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.SSH_KEY_ADDED)).catch(() => {});
      setSuccess(`SSH key "${keyName}" added! You can now connect without a password.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inject SSH key");
    } finally {
      setInjecting(null);
    }
  };

  const handleInjectNewKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setAddingKey(true);

    try {
      // If saving the key, first add it to the database
      let keyId: string | undefined;
      if (saveNewKey && newKeyName.trim()) {
        const addResponse = await fetch("/api/account/ssh-keys", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: newKeyName,
            publicKey: newPublicKey,
          }),
        });

        const addData = await addResponse.json();
        if (addResponse.ok) {
          keyId = addData.key.id;
        }
        // If key already exists, continue with injection anyway
        fetchSavedKeys(); // Refresh the list
      }

      // Inject the key (either by ID if saved, or directly)
      const injectResponse = await fetch("/api/instances/inject-ssh-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          keyId,
          publicKey: keyId ? undefined : newPublicKey,
          subscriptionId,
          podName,
        }),
      });

      const injectData = await injectResponse.json();

      if (!injectResponse.ok) {
        throw new Error(injectData.error || "Failed to inject SSH key");
      }

      import("@/lib/plerdy").then(({ trackPlerdy, PLERDY_EVENTS }) => trackPlerdy(PLERDY_EVENTS.SSH_KEY_ADDED)).catch(() => {});
      setSuccess("SSH key added! You can now connect without a password.");
      setShowNewKeyForm(false);
      setNewKeyName("");
      setNewPublicKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add SSH key");
    } finally {
      setAddingKey(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">Add SSH Key</h3>
            <p className="text-sm text-zinc-500">
              {poolName || "GPU"} · Enable passwordless login
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        {success && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{success}</span>
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Saved Keys Section */}
          {!showNewKeyForm && (
            <>
              {loading ? (
                <div className="text-sm text-zinc-500 text-center py-4">Loading saved keys...</div>
              ) : savedKeys.length > 0 ? (
                <div className="space-y-2 mb-4">
                  <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Saved Keys
                  </h4>
                  {savedKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg border border-zinc-100"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-zinc-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                          <span className="text-sm font-medium text-zinc-900 truncate">{key.name}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400 font-mono truncate">{key.fingerprint}</div>
                      </div>
                      <button
                        onClick={() => handleInjectSavedKey(key.id, key.name)}
                        disabled={injecting === key.id}
                        className="ml-3 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                      >
                        {injecting === key.id ? (
                          <span className="flex items-center gap-1">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Adding...
                          </span>
                        ) : "Add"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 mb-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  <p className="text-sm text-zinc-500">No saved SSH keys yet</p>
                </div>
              )}

              {/* Add New Key Button */}
              <button
                onClick={() => setShowNewKeyForm(true)}
                className="w-full py-3 px-4 border-2 border-dashed border-zinc-200 rounded-xl text-sm text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add New Key
              </button>
            </>
          )}

          {/* New Key Form */}
          {showNewKeyForm && (
            <form onSubmit={handleInjectNewKey} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Public Key
                </label>
                <textarea
                  value={newPublicKey}
                  onChange={(e) => setNewPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAA... your-email@example.com"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent font-mono text-xs"
                  rows={4}
                  required
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Paste your public key (e.g., from ~/.ssh/id_ed25519.pub)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="saveKey"
                  checked={saveNewKey}
                  onChange={(e) => setSaveNewKey(e.target.checked)}
                  className="w-4 h-4 text-teal-600 border-zinc-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="saveKey" className="text-sm text-zinc-600">
                  Save this key for future use
                </label>
              </div>

              {saveNewKey && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Key Name
                  </label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="My MacBook"
                    className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    required={saveNewKey}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={addingKey}
                  className="flex-1 py-2.5 px-4 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
                >
                  {addingKey ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Adding Key...
                    </span>
                  ) : "Add Key to GPU"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewKeyForm(false);
                    setNewKeyName("");
                    setNewPublicKey("");
                  }}
                  className="py-2.5 px-4 text-zinc-600 hover:text-zinc-800 font-medium transition-colors"
                >
                  Back
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-4 pt-4 border-t border-zinc-100">
          <p className="text-xs text-zinc-400 text-center">
            SSH keys enable passwordless login to your GPU instances.
          </p>
        </div>
      </div>
    </div>
  );
}
