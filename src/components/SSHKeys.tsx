"use client";

import { useState, useEffect, useCallback } from "react";

interface SSHKey {
  id: string;
  name: string;
  fingerprint: string;
  createdAt: string;
  keyPreview: string;
}

interface Pod {
  pod_name: string;
  pod_status: string;
}

interface PoolSubscription {
  id: string;
  pool_name?: string;
  pool_label?: string;
  status: string;
  pods?: Pod[];
}

interface SSHKeysProps {
  token: string;
  subscriptions?: PoolSubscription[];
}

export default function SSHKeys({ token, subscriptions = [] }: SSHKeysProps) {
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [injectingKeyId, setInjectingKeyId] = useState<string | null>(null);
  const [selectedSubscription, setSelectedSubscription] = useState<string>("");

  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/account/ssh-keys", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Failed to fetch SSH keys:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setAdding(true);

    try {
      const response = await fetch("/api/account/ssh-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: keyName,
          publicKey: publicKey,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add SSH key");
      }

      setSuccess(`SSH key "${keyName}" added successfully`);
      setKeyName("");
      setPublicKey("");
      setShowAddForm(false);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add SSH key");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (keyId: string, keyName: string) => {
    if (!confirm(`Delete SSH key "${keyName}"?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/account/ssh-keys?id=${keyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete SSH key");
      }

      setSuccess(`SSH key "${keyName}" deleted`);
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete SSH key");
    }
  };

  const handleInject = async (keyId: string, keyName: string) => {
    if (!selectedSubscription) {
      setError("Please select a GPU to inject the key into");
      return;
    }

    setError(null);
    setSuccess(null);
    setInjectingKeyId(keyId);

    try {
      const response = await fetch("/api/instances/inject-ssh-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          keyId,
          subscriptionId: selectedSubscription,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to inject SSH key");
      }

      setSuccess(`SSH key "${keyName}" injected into GPU successfully. You can now connect without a password.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inject SSH key");
    } finally {
      setInjectingKeyId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Filter subscriptions to only show running ones
  const runningSubscriptions = subscriptions.filter(
    (s) => s.status === "subscribed" && s.pods?.some((p) => p.pod_status === "Running")
  );

  return (
    <div className="border border-zinc-200 rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900">SSH Keys</h2>
        {!showAddForm && keys.length < 10 && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            + Add Key
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="mb-4 p-4 bg-zinc-50 rounded-lg">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Key name
              </label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="My MacBook"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Public key
              </label>
              <textarea
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA... your-email@example.com"
                className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-xs"
                rows={4}
                required
              />
              <p className="mt-1 text-xs text-zinc-500">
                Paste your public key (e.g., from ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub)
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {adding ? "Adding..." : "Add Key"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setKeyName("");
                  setPublicKey("");
                }}
                className="px-4 py-2 bg-zinc-200 text-zinc-700 rounded-lg hover:bg-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* GPU Selector for injection (only show if there are keys and running GPUs) */}
      {keys.length > 0 && runningSubscriptions.length > 0 && (
        <div className="mb-4 p-3 bg-zinc-50 rounded-lg">
          <label className="block text-sm font-medium text-zinc-700 mb-2">
            Select GPU to inject keys into:
          </label>
          <select
            value={selectedSubscription}
            onChange={(e) => setSelectedSubscription(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
          >
            <option value="">Choose a running GPU...</option>
            {runningSubscriptions.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.pool_label || sub.pool_name || `GPU ${sub.id}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Keys List */}
      {loading ? (
        <div className="text-sm text-zinc-500">Loading SSH keys...</div>
      ) : keys.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-4">
          No SSH keys yet. Add a key to enable passwordless login to your GPUs.
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between p-3 bg-zinc-50 rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-zinc-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-zinc-900 truncate">
                    {key.name}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-500 font-mono truncate">
                  {key.fingerprint}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <span className="text-xs text-zinc-400">
                  {formatDate(key.createdAt)}
                </span>
                {runningSubscriptions.length > 0 && (
                  <button
                    onClick={() => handleInject(key.id, key.name)}
                    disabled={!selectedSubscription || injectingKeyId === key.id}
                    className="text-xs text-purple-600 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!selectedSubscription ? "Select a GPU first" : "Inject key into selected GPU"}
                  >
                    {injectingKeyId === key.id ? "Injecting..." : "Inject"}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(key.id, key.name)}
                  className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-zinc-500">
        {keys.length > 0 ? (
          <>
            SSH keys allow passwordless login to your GPUs. Select a running GPU above, then click &quot;Inject&quot; to add a key.
            {keys.length >= 10 && " Maximum of 10 keys reached."}
          </>
        ) : (
          "Add your SSH public key to enable secure, passwordless access to your GPU instances."
        )}
      </div>
    </div>
  );
}
