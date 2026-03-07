"use client";

import { useState, useEffect } from "react";

interface App {
  slug: string;
  name: string;
  description: string;
  longDescription?: string;
  category: string;
  minVramGb: number;
  recommendedVramGb: number;
  estimatedInstallMin: number;
  defaultPort?: number;
  webUiPort?: number;
  icon: string;
  badgeText?: string;
  tags: string[];
  docsUrl?: string;
}

interface InstalledApp {
  id: string;
  appSlug: string;
  appName: string;
  appIcon: string;
  status: string;
  installProgress: number;
  port: number | null;
  webUiPort: number | null;
  externalUrl: string | null;
  webUiUrl: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  createdAt: string;
}

interface Subscription {
  id: string | number;
  status: string;
  pods?: Array<{ pod_name: string; pod_status: string }>;
}

interface AppsTabProps {
  token: string;
  subscriptions: Subscription[];
  onRefresh: () => void;
}

export function AppsTab({ token, subscriptions, onRefresh }: AppsTabProps) {
  const [apps, setApps] = useState<App[]>([]);
  const [installedBySubscription, setInstalledBySubscription] = useState<Record<string, InstalledApp[]>>({});
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<{ subscriptionId: string; appSlug: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSubscription, setSelectedSubscription] = useState<string>("all");

  // Filter active subscriptions with running pods
  const activeSubscriptions = subscriptions.filter(
    s => (s.status === "active" || s.status === "subscribed") && s.pods?.some(p => p.pod_status === "Running")
  );

  // Fetch available apps
  useEffect(() => {
    async function fetchApps() {
      try {
        const response = await fetch("/api/apps", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setApps(data.apps || []);
        }
      } catch (err) {
        console.error("Failed to fetch apps:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchApps();
  }, [token]);

  // Fetch installed apps for all subscriptions
  useEffect(() => {
    async function fetchAllInstalled() {
      const installed: Record<string, InstalledApp[]> = {};

      for (const sub of activeSubscriptions) {
        try {
          const response = await fetch(`/api/apps/status?subscriptionId=${sub.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            installed[String(sub.id)] = data.apps || [];
          }
        } catch (err) {
          console.error(`Failed to fetch apps for subscription ${sub.id}:`, err);
        }
      }

      setInstalledBySubscription(installed);
    }

    if (activeSubscriptions.length > 0) {
      fetchAllInstalled();
    }

    // Poll for installing apps
    const hasInstalling = Object.values(installedBySubscription).flat().some(a => a.status === "installing");
    if (hasInstalling) {
      const interval = setInterval(fetchAllInstalled, 5000);
      return () => clearInterval(interval);
    }
  }, [token, activeSubscriptions.length, installing]);

  const handleDismiss = async (subscriptionId: string, appSlug: string) => {
    try {
      const response = await fetch(`/api/apps?subscriptionId=${subscriptionId}&appSlug=${appSlug}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove app");
      }

      // Refresh installed apps
      setInstalledBySubscription(prev => ({
        ...prev,
        [subscriptionId]: prev[subscriptionId]?.filter(a => a.appSlug !== appSlug) || [],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove app");
    }
  };

  const handleInstall = async (subscriptionId: string, appSlug: string) => {
    setInstalling({ subscriptionId, appSlug });
    setError(null);

    try {
      const response = await fetch("/api/apps/install", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscriptionId, appSlug }),
      });

      // Handle empty or non-JSON responses
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Server returned an invalid response. Please try again.");
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to install app");
      }

      // Refresh installed apps
      const statusResponse = await fetch(`/api/apps/status?subscriptionId=${subscriptionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusResponse.ok) {
        const statusText = await statusResponse.text();
        try {
          const statusData = statusText ? JSON.parse(statusText) : { apps: [] };
          setInstalledBySubscription(prev => ({
            ...prev,
            [subscriptionId]: statusData.apps || [],
          }));
        } catch {
          // Ignore status parse errors
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install app");
    } finally {
      setInstalling(null);
    }
  };

  // Get all installed apps across all subscriptions
  const allInstalledApps = Object.entries(installedBySubscription).flatMap(([subId, apps]) =>
    apps.map(app => ({ ...app, subscriptionId: subId }))
  );

  // Get unique categories
  const categories = ["all", ...Array.from(new Set(apps.map(a => a.category)))];

  // Filter apps by category
  const filteredApps = selectedCategory === "all"
    ? apps
    : apps.filter(a => a.category === selectedCategory);

  // Category icons and labels
  const categoryInfo: Record<string, { icon: string; label: string }> = {
    all: { icon: "📦", label: "All Apps" },
    development: { icon: "🛠️", label: "Development" },
    inference: { icon: "🤖", label: "Inference" },
    training: { icon: "📊", label: "Training" },
    creative: { icon: "🎨", label: "Creative" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-zinc-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Loading apps...</span>
        </div>
      </div>
    );
  }

  if (activeSubscriptions.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">📦</div>
        <h3 className="text-lg font-semibold text-zinc-800 mb-2">No Active GPUs</h3>
        <p className="text-zinc-500 max-w-md mx-auto">
          Launch a GPU to start installing one-click apps like Jupyter, Ollama, ComfyUI, and more.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--ink)]">Apps</h1>
        <p className="text-sm text-[var(--muted)]">Install pre-configured apps on your GPUs with one click</p>
      </div>

      {/* Installed Apps Section */}
      {allInstalledApps.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-800 mb-4">Installed Apps</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allInstalledApps.map(app => {
              const subscription = activeSubscriptions.find(s => String(s.id) === app.subscriptionId);
              const podName = subscription?.pods?.[0]?.pod_name || "GPU";

              return (
                <div
                  key={`${app.subscriptionId}-${app.id}`}
                  className="bg-white rounded-xl border border-[var(--line)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{app.appIcon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800">{app.appName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          app.status === "running" ? "bg-emerald-100 text-emerald-700" :
                          app.status === "installing" ? "bg-amber-100 text-amber-700" :
                          app.status === "failed" ? "bg-rose-100 text-rose-700" :
                          "bg-zinc-100 text-zinc-600"
                        }`}>
                          {app.status === "installing" ? `Installing ${app.installProgress}%` : app.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">on {podName}</p>

                      {app.status === "running" && (
                        <div className="flex items-center gap-2 mt-3">
                          {app.externalUrl && (
                            <a
                              href={app.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-3 py-1.5 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 transition-colors"
                            >
                              Open App
                            </a>
                          )}
                          {app.webUiUrl && app.webUiUrl !== app.externalUrl && (
                            <a
                              href={app.webUiUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-3 py-1.5 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 transition-colors"
                            >
                              Web UI
                            </a>
                          )}
                          {!app.externalUrl && app.port && (
                            <span className="text-xs text-zinc-500">Port {app.port}</span>
                          )}
                        </div>
                      )}

                      {app.status === "failed" && (
                        <div className="flex items-center gap-2 mt-2">
                          {app.errorMessage && (
                            <p className="text-xs text-rose-600 flex-1">{app.errorMessage}</p>
                          )}
                          <button
                            onClick={() => handleDismiss(app.subscriptionId, app.appSlug)}
                            className="text-xs px-2 py-1 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 transition-colors whitespace-nowrap"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Category filter */}
        <div className="flex items-center gap-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                selectedCategory === cat
                  ? "bg-teal-100 text-teal-700"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {categoryInfo[cat]?.icon} {categoryInfo[cat]?.label || cat}
            </button>
          ))}
        </div>

        {/* GPU filter */}
        {activeSubscriptions.length > 1 && (
          <select
            value={selectedSubscription}
            onChange={(e) => setSelectedSubscription(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--line)] bg-white text-zinc-700"
          >
            <option value="all">All GPUs</option>
            {activeSubscriptions.map(sub => (
              <option key={sub.id} value={String(sub.id)}>
                {sub.pods?.[0]?.pod_name || `GPU ${sub.id}`}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Available Apps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredApps.map(app => {
          // Check if already installed on selected GPU(s)
          const targetSubs = selectedSubscription === "all"
            ? activeSubscriptions
            : activeSubscriptions.filter(s => String(s.id) === selectedSubscription);

          return (
            <div
              key={app.slug}
              className="relative bg-white rounded-xl border border-[var(--line)] p-4 hover:border-teal-300 transition-colors"
            >
              {app.badgeText && (
                <span className="absolute -top-2 -right-2 text-xs px-2 py-0.5 bg-amber-400 text-white rounded-full font-medium">
                  {app.badgeText}
                </span>
              )}

              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl">{app.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-zinc-800">{app.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                    <span>{categoryInfo[app.category]?.icon} {app.category}</span>
                    <span>•</span>
                    <span>~{app.estimatedInstallMin} min</span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-zinc-600 mb-4 line-clamp-2">{app.description}</p>

              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
                <span>Min {app.minVramGb}GB VRAM</span>
                {app.recommendedVramGb > app.minVramGb && (
                  <>
                    <span>•</span>
                    <span>Rec {app.recommendedVramGb}GB</span>
                  </>
                )}
              </div>

              {/* Install buttons for each GPU */}
              <div className="space-y-2">
                {targetSubs.map(sub => {
                  const installed = installedBySubscription[String(sub.id)]?.find(a => a.appSlug === app.slug);
                  const isInstallingThis = installing?.subscriptionId === String(sub.id) && installing?.appSlug === app.slug;
                  const podName = sub.pods?.[0]?.pod_name || `GPU ${sub.id}`;

                  if (installed && installed.status !== "uninstalled" && installed.status !== "failed") {
                    return (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between p-2 bg-teal-50 rounded-lg text-sm"
                      >
                        <span className="text-teal-700">
                          {installed.status === "installing"
                            ? `Installing on ${podName}... ${installed.installProgress}%`
                            : `Installed on ${podName}`
                          }
                        </span>
                        {installed.status === "running" && installed.externalUrl && (
                          <a
                            href={installed.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 bg-teal-200 text-teal-800 rounded hover:bg-teal-300"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={sub.id}
                      onClick={() => handleInstall(String(sub.id), app.slug)}
                      disabled={isInstallingThis}
                      className={`w-full py-2 px-3 text-sm rounded-lg transition-colors ${
                        isInstallingThis
                          ? "bg-amber-100 text-amber-700 cursor-wait"
                          : "bg-zinc-100 text-zinc-700 hover:bg-teal-100 hover:text-teal-700"
                      }`}
                    >
                      {isInstallingThis ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Installing...
                        </span>
                      ) : targetSubs.length > 1 ? (
                        `Install on ${podName}`
                      ) : (
                        "Install"
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {filteredApps.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          No apps found in this category
        </div>
      )}
    </div>
  );
}
