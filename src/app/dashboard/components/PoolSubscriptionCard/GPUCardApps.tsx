"use client";

import { useState, useEffect } from "react";

interface App {
  slug: string;
  name: string;
  description: string;
  category: string;
  minVramGb: number;
  recommendedVramGb: number;
  estimatedInstallMin: number;
  defaultPort?: number;
  icon: string;
  badgeText?: string;
  tags: string[];
  // Installation status
  installed: boolean;
  installStatus: string | null;
  installedPort: number | null;
  externalUrl: string | null;
}

interface InstalledApp {
  id: string;
  appSlug: string;
  appName: string;
  appIcon: string;
  status: string;
  installProgress: number;
  port: number | null;
  externalUrl: string | null;
  errorMessage: string | null;
}

interface GPUCardAppsProps {
  subscriptionId: string;
  token: string;
  podName?: string;
  onExposeService?: (port: number, serviceName: string) => void;
}

export function GPUCardApps({ subscriptionId, token, podName, onExposeService }: GPUCardAppsProps) {
  const [apps, setApps] = useState<App[]>([]);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [showAllApps, setShowAllApps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available apps
  useEffect(() => {
    async function fetchApps() {
      try {
        const response = await fetch(`/api/apps?subscriptionId=${subscriptionId}`, {
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
  }, [subscriptionId, token]);

  // Fetch installed apps status
  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(`/api/apps/status?subscriptionId=${subscriptionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setInstalledApps(data.apps || []);
        }
      } catch (err) {
        console.error("Failed to fetch app status:", err);
      }
    }

    fetchStatus();

    // Poll for status updates if any app is installing
    const hasInstalling = installedApps.some(a => a.status === "installing");
    if (hasInstalling) {
      const interval = setInterval(fetchStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [subscriptionId, token, installing]);

  const handleDismiss = async (appSlug: string) => {
    try {
      const response = await fetch(`/api/apps?subscriptionId=${subscriptionId}&appSlug=${appSlug}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove app");
      }

      // Refresh installed apps list
      setInstalledApps(prev => prev.filter(a => a.appSlug !== appSlug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove app");
    }
  };

  const handleInstall = async (appSlug: string) => {
    setInstalling(appSlug);
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to install app");
      }

      // Refresh status
      const statusResponse = await fetch(`/api/apps/status?subscriptionId=${subscriptionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setInstalledApps(statusData.apps || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install app");
    } finally {
      setInstalling(null);
    }
  };

  // Get status for an app
  const getAppStatus = (slug: string): InstalledApp | undefined => {
    return installedApps.find(a => a.appSlug === slug);
  };

  // Category icons
  const categoryIcons: Record<string, string> = {
    development: "🛠️",
    inference: "🤖",
    training: "📊",
    creative: "🎨",
  };

  if (loading) {
    return (
      <div className="px-4 py-3 border-t border-[var(--line)]">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="animate-pulse">Loading apps...</span>
        </div>
      </div>
    );
  }

  // Show installed apps first, then available apps
  const installedSlugs = installedApps.map(a => a.appSlug);
  const availableApps = apps.filter(a => !installedSlugs.includes(a.slug));
  const displayedApps = showAllApps ? availableApps : availableApps.slice(0, 4);

  return (
    <div className="border-t border-[var(--line)]">
      {/* Installed Apps */}
      {installedApps.length > 0 && (
        <div className="px-4 py-3 bg-teal-50/50">
          <h4 className="text-xs font-medium text-teal-700 mb-2">Installed Apps</h4>
          <div className="space-y-2">
            {installedApps.map(app => (
              <div
                key={app.id}
                className="flex items-center justify-between p-2 bg-white rounded-lg border border-teal-200"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{app.appIcon}</span>
                  <div>
                    <span className="text-sm font-medium text-zinc-800">{app.appName}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                      app.status === "running" ? "bg-emerald-100 text-emerald-700" :
                      app.status === "installing" ? "bg-amber-100 text-amber-700" :
                      app.status === "failed" ? "bg-rose-100 text-rose-700" :
                      "bg-zinc-100 text-zinc-600"
                    }`}>
                      {app.status === "installing" ? `Installing ${app.installProgress}%` : app.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {app.status === "running" && app.port && (
                    <>
                      {app.externalUrl ? (
                        <a
                          href={app.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-1 bg-teal-100 text-teal-700 rounded hover:bg-teal-200"
                        >
                          Open
                        </a>
                      ) : onExposeService && (
                        <button
                          onClick={() => onExposeService(app.port!, app.appSlug)}
                          className="text-xs px-2 py-1 bg-zinc-100 text-zinc-700 rounded hover:bg-zinc-200"
                        >
                          Expose Port {app.port}
                        </button>
                      )}
                    </>
                  )}
                  {app.status === "failed" && (
                    <div className="flex items-center gap-2">
                      {app.errorMessage && (
                        <span className="text-xs text-rose-600 truncate max-w-[100px]" title={app.errorMessage}>
                          {app.errorMessage}
                        </span>
                      )}
                      <button
                        onClick={() => handleDismiss(app.appSlug)}
                        className="text-xs px-2 py-1 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Apps */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-zinc-500">
            {installedApps.length > 0 ? "Install More Apps" : "One-Click Apps"}
          </h4>
          {availableApps.length > 4 && (
            <button
              onClick={() => setShowAllApps(!showAllApps)}
              className="text-xs text-teal-600 hover:text-teal-700"
            >
              {showAllApps ? "Show less" : `Show all ${availableApps.length}`}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-2 p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {displayedApps.map(app => {
            const status = getAppStatus(app.slug);
            const isInstalling = installing === app.slug || status?.status === "installing";

            return (
              <button
                key={app.slug}
                onClick={() => handleInstall(app.slug)}
                disabled={isInstalling || app.installed}
                className={`relative p-3 text-left rounded-xl border transition-all ${
                  isInstalling
                    ? "bg-amber-50 border-amber-200 cursor-wait"
                    : app.installed
                    ? "bg-teal-50 border-teal-200 cursor-default"
                    : "bg-white border-[var(--line)] hover:border-teal-300 hover:bg-teal-50/50"
                } disabled:opacity-60`}
              >
                {/* Badge */}
                {app.badgeText && (
                  <span className="absolute -top-1 -right-1 text-[10px] px-1.5 py-0.5 bg-amber-400 text-white rounded-full font-medium">
                    {app.badgeText}
                  </span>
                )}

                <div className="flex items-start gap-2">
                  <span className="text-xl">{app.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-zinc-800 truncate">{app.name}</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 line-clamp-2 mt-0.5">{app.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-zinc-400">{categoryIcons[app.category]} {app.category}</span>
                      <span className="text-[10px] text-zinc-400">~{app.estimatedInstallMin}min</span>
                    </div>
                  </div>
                </div>

                {/* Installing indicator */}
                {isInstalling && (
                  <div className="absolute inset-0 flex items-center justify-center bg-amber-50/80 rounded-xl">
                    <div className="flex items-center gap-2 text-amber-700">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="text-xs font-medium">Installing...</span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Empty state */}
        {availableApps.length === 0 && installedApps.length === 0 && (
          <div className="text-center py-4 text-zinc-500 text-sm">
            No apps available yet
          </div>
        )}
      </div>
    </div>
  );
}
