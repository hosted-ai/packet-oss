"use client";

import { useState, useEffect, useCallback } from "react";

interface GpuApp {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  category: string;
  minVramGb: number;
  recommendedVramGb: number;
  defaultPort: number | null;
  webUiPort: number | null;
  displayOrder: number;
  active: boolean;
  deployable: boolean;
  serviceId: string | null;
  productId: string | null;
  recipeSlug: string | null;
  product: {
    id: string;
    name: string;
    pricePerHourCents: number;
    billingType: string;
    active: boolean;
  } | null;
}

// Known recipe slugs that exist in recipes/packet_recipes/
const AVAILABLE_RECIPES = new Set([
  "ollama", "code-server", "jupyter-pytorch", "vllm-v1-tinyllama", "comfyui",
  "vllm-server", "text-generation-webui", "open-webui", "huggingface-tgi",
  "triton-inference-server", "localai", "automatic1111", "fooocus",
  "cogvideox", "axolotl-training", "kohya-ss", "langflow", "mlflow",
]);

type SetupStep = "idle" | "uploading" | "creating" | "linking" | "done" | "error";

export function GpuAppsTab() {
  const [apps, setApps] = useState<GpuApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Setup modal state
  const [setupApp, setSetupApp] = useState<GpuApp | null>(null);
  const [execTiming, setExecTiming] = useState<"on_every_boot" | "on_first_boot_only">("on_every_boot");
  const [setupStep, setSetupStep] = useState<SetupStep>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<{ serviceId: string; serviceName: string; policyUrl: string | null } | null>(null);

  // Teardown state
  const [teardownId, setTeardownId] = useState<string | null>(null);
  const [tearingDown, setTearingDown] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gpu-apps");
      if (res.ok) {
        const data = await res.json();
        setApps(data.apps || []);
      }
    } catch (err) {
      console.error("Failed to fetch apps:", err);
    }
  }, []);

  useEffect(() => {
    fetchApps().finally(() => setLoading(false));
  }, [fetchApps]);

  // Sort: active first, then ready (has recipe), then grayed
  const sortedApps = [...apps].sort((a, b) => {
    const stateOrder = (app: GpuApp) => {
      if (app.serviceId) return 0; // active
      if (hasRecipe(app)) return 1; // ready
      return 2; // grayed
    };
    return stateOrder(a) - stateOrder(b) || a.displayOrder - b.displayOrder;
  });

  function hasRecipe(app: GpuApp): boolean {
    return AVAILABLE_RECIPES.has(app.recipeSlug || app.slug);
  }

  // --- Setup wizard ---
  const openSetup = (app: GpuApp) => {
    setSetupApp(app);
    setExecTiming("on_every_boot");
    setSetupStep("idle");
    setSetupError(null);
    setSetupResult(null);
  };

  const closeSetup = () => {
    setSetupApp(null);
    if (setupStep === "done") fetchApps();
  };

  const runSetup = async () => {
    if (!setupApp) return;
    setSetupError(null);

    try {
      setSetupStep("uploading");
      // Small delay so UI shows the step
      await new Promise(r => setTimeout(r, 300));

      setSetupStep("creating");
      const res = await fetch("/api/admin/gpu-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setup",
          id: setupApp.id,
          execTiming,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSetupStep("error");
        setSetupError(data.error || "Setup failed");
        return;
      }

      setSetupStep("linking");
      await new Promise(r => setTimeout(r, 300));

      setSetupResult({
        serviceId: data.service?.id,
        serviceName: data.service?.name,
        policyUrl: data.policyUrl,
      });
      setSetupStep("done");
    } catch (err) {
      setSetupStep("error");
      setSetupError(err instanceof Error ? err.message : "Setup failed");
    }
  };

  // --- Teardown ---
  const confirmTeardown = (appId: string) => setTeardownId(appId);
  const cancelTeardown = () => setTeardownId(null);

  const runTeardown = async () => {
    if (!teardownId) return;
    setTearingDown(true);

    try {
      const res = await fetch("/api/admin/gpu-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "teardown", id: teardownId }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "App disabled" });
        await fetchApps();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to disable" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to disable app" });
    } finally {
      setTearingDown(false);
      setTeardownId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        Loading apps...
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-zinc-500 mb-6">
        Enable GPU apps for customer deployment. Each app gets a HAI service with its recipe and exposed ports.
      </p>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"
        }`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedApps.map(app => {
          const isActive = !!app.serviceId;
          const isReady = !isActive && hasRecipe(app);
          const isGrayed = !isActive && !isReady;

          return (
            <div
              key={app.id}
              className={`bg-white border border-[var(--line)] rounded-xl p-4 flex flex-col ${
                isGrayed ? "opacity-50" : "hover:shadow-sm"
              }`}
            >
              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">{app.icon || "📦"}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-zinc-900">{app.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{app.description}</div>
                </div>
              </div>

              {/* Status badge */}
              <div className="mb-3">
                {isActive && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    Enabled
                  </span>
                )}
                {isReady && (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full" />
                    Not configured
                  </span>
                )}
                {isGrayed && (
                  <span className="text-xs text-zinc-400">No recipe available</span>
                )}
              </div>

              {/* Details (active only) */}
              {isActive && (
                <div className="text-xs text-zinc-500 space-y-1 mb-3 pb-3 border-b border-zinc-100">
                  <div>Service: <span className="font-mono text-zinc-600">{app.serviceId?.slice(0, 16)}...</span></div>
                  {app.recipeSlug && (
                    <div>Recipe: <span className="font-mono bg-zinc-100 px-1 rounded">{app.recipeSlug}</span></div>
                  )}
                  {app.defaultPort && <div>Port: {app.defaultPort}{app.webUiPort && app.webUiPort !== app.defaultPort ? `, ${app.webUiPort}` : ""}</div>}
                </div>
              )}

              {/* Ready state — show recipe info */}
              {isReady && (
                <div className="text-xs text-zinc-500 space-y-1 mb-3">
                  <div>Recipe: <span className="font-mono bg-zinc-100 px-1 rounded">{app.recipeSlug || app.slug}</span></div>
                  {app.defaultPort && <div>Port: {app.defaultPort}</div>}
                </div>
              )}

              {/* Actions */}
              <div className="mt-auto flex items-center gap-2">
                {isActive && (
                  <>
                    <button
                      onClick={() => openSetup(app)}
                      className="flex-1 px-3 py-1.5 text-xs text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50"
                    >
                      Configure
                    </button>
                    <button
                      onClick={() => confirmTeardown(app.id)}
                      className="flex-1 px-3 py-1.5 text-xs text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
                    >
                      Disable
                    </button>
                  </>
                )}
                {isReady && (
                  <button
                    onClick={() => openSetup(app)}
                    className="w-full px-3 py-1.5 text-xs text-white bg-teal-600 rounded-lg hover:bg-teal-700"
                  >
                    Enable
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {apps.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p>No GPU apps found. Run <code className="bg-zinc-100 px-1 rounded">npx prisma db seed</code> to populate.</p>
        </div>
      )}

      {/* Setup Modal */}
      {setupApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{setupApp.serviceId ? "Reconfigure" : "Enable"} {setupApp.name}</h3>
              <button onClick={closeSetup} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">&times;</button>
            </div>

            {setupStep === "idle" && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Recipe execution</label>
                  <select
                    value={execTiming}
                    onChange={e => setExecTiming(e.target.value as typeof execTiming)}
                    className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                  >
                    <option value="on_every_boot">Run on every boot</option>
                    <option value="on_first_boot_only">Run on first boot only</option>
                  </select>
                  <p className="text-xs text-zinc-400 mt-1">
                    &quot;Every boot&quot; ensures latest config. &quot;First boot only&quot; is faster on restart.
                  </p>
                </div>

                <div className="text-xs text-zinc-500 mb-4 p-3 bg-zinc-50 rounded-lg">
                  <div>Recipe: <span className="font-mono">{setupApp.recipeSlug || setupApp.slug}</span></div>
                  {setupApp.defaultPort && <div>Port: {setupApp.defaultPort}{setupApp.webUiPort && setupApp.webUiPort !== setupApp.defaultPort ? `, ${setupApp.webUiPort}` : ""}</div>}
                </div>

                <div className="flex gap-2">
                  <button onClick={closeSetup} className="flex-1 px-3 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-lg hover:bg-zinc-50">
                    Cancel
                  </button>
                  <button onClick={runSetup} className="flex-1 px-3 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700">
                    {setupApp.serviceId ? "Reconfigure" : "Set Up"}
                  </button>
                </div>
              </>
            )}

            {/* Progress stepper */}
            {(setupStep === "uploading" || setupStep === "creating" || setupStep === "linking") && (
              <div className="space-y-3 py-4">
                <StepIndicator label="Uploading recipe" status={setupStep === "uploading" ? "active" : "done"} />
                <StepIndicator label="Creating HAI service" status={setupStep === "creating" ? "active" : setupStep === "uploading" ? "waiting" : "done"} />
                <StepIndicator label="Linking to app" status={setupStep === "linking" ? "active" : (setupStep === "uploading" || setupStep === "creating") ? "waiting" : "done"} />
              </div>
            )}

            {/* Error state */}
            {setupStep === "error" && (
              <div className="py-4">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 mb-4">
                  {setupError}
                </div>
                <div className="flex gap-2">
                  <button onClick={closeSetup} className="flex-1 px-3 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-lg hover:bg-zinc-50">
                    Close
                  </button>
                  <button onClick={runSetup} className="flex-1 px-3 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700">
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Success state */}
            {setupStep === "done" && setupResult && (
              <div className="py-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 mb-4">
                  <div className="font-medium mb-1">✓ {setupApp.name} is now enabled!</div>
                  <div className="text-xs text-emerald-600">
                    Service: <span className="font-mono">{setupResult.serviceName}</span>
                  </div>
                </div>

                {setupResult.policyUrl && (
                  <div className="p-3 bg-zinc-50 rounded-lg text-sm mb-4">
                    <div className="text-zinc-600 mb-1">Add to team policies in HAI:</div>
                    <a
                      href={setupResult.policyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-600 hover:text-teal-700 text-xs underline break-all"
                    >
                      {setupResult.policyUrl}
                    </a>
                  </div>
                )}

                <button onClick={closeSetup} className="w-full px-3 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700">
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Teardown Confirmation */}
      {teardownId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold mb-2">Disable App</h3>
            <p className="text-sm text-zinc-600 mb-4">
              This will delete the HAI service and remove the app from the deployment scenario. Customers will no longer be able to deploy this app.
            </p>
            <div className="flex gap-2">
              <button onClick={cancelTeardown} className="flex-1 px-3 py-2 text-sm text-zinc-600 border border-zinc-300 rounded-lg hover:bg-zinc-50">
                Cancel
              </button>
              <button
                onClick={runTeardown}
                disabled={tearingDown}
                className="flex-1 px-3 py-2 text-sm text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {tearingDown ? "Disabling..." : "Disable"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ label, status }: { label: string; status: "waiting" | "active" | "done" }) {
  return (
    <div className="flex items-center gap-3">
      {status === "done" && <span className="text-emerald-500 text-sm">✓</span>}
      {status === "active" && (
        <span className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      )}
      {status === "waiting" && <span className="w-4 h-4 rounded-full border-2 border-zinc-200" />}
      <span className={`text-sm ${status === "waiting" ? "text-zinc-400" : status === "active" ? "text-zinc-700" : "text-zinc-600"}`}>
        {label}
      </span>
      {status === "active" && <span className="text-xs text-zinc-400 ml-auto">in progress...</span>}
      {status === "done" && <span className="text-xs text-emerald-500 ml-auto">done</span>}
    </div>
  );
}
