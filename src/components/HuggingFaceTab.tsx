"use client";

/**
 * HuggingFace Tab Component
 *
 * Main component for the HuggingFace deployment interface.
 * Displays catalog items, search functionality, and deployment options.
 *
 * @module components/HuggingFaceTab
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  CatalogItem,
  SearchResult,
  LaunchOptions,
  ExistingSubscription,
  TabType,
  DeployMode,
  DeploymentStatus,
  HfMemResult,
} from "./huggingface-tab/types";
import { DeployModal } from "./huggingface-tab/DeployModal";
import { MemoryModal } from "./huggingface-tab/MemoryModal";
import { ItemCard } from "./huggingface-tab/ItemCard";
import { FilterPanel } from "./huggingface-tab/FilterPanel";

interface HuggingFaceTabProps {
  token: string;
  onDeploymentStarted?: () => void;
}

export default function HuggingFaceTab({
  token,
  onDeploymentStarted,
}: HuggingFaceTabProps) {
  // Catalog
  const [activeTab, setActiveTab] = useState<TabType>("popular");
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Filters
  const [selectedTask, setSelectedTask] = useState<string>("");
  const [selectedLibrary, setSelectedLibrary] = useState<string>("");
  const [selectedParamSize, setSelectedParamSize] = useState<string>("");
  const [filterOptions, setFilterOptions] = useState<{
    tasks: Array<{ value: string; label: string }>;
    libraries: Array<{ value: string; label: string }>;
    paramSizes: Array<{ value: string; label: string }>;
  } | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Deploy modal
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<
    CatalogItem | SearchResult | null
  >(null);
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions | null>(
    null
  );
  const [existingSubscriptions, setExistingSubscriptions] = useState<
    ExistingSubscription[]
  >([]);
  const [deployMode, setDeployMode] = useState<DeployMode>("existing");
  const [selectedSubscription, setSelectedSubscription] = useState("");
  const [selectedPool, setSelectedPool] = useState("");
  const [selectedStorage, setSelectedStorage] = useState("");
  const [gpuCount, setGpuCount] = useState(1);
  const [hfToken, setHfToken] = useState("");
  const [addOpenWebUI, setAddOpenWebUI] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploySuccess, setDeploySuccess] = useState<string | null>(null);
  const [deployLogs, setDeployLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    serviceHost?: string;
    servicePort?: number;
  } | null>(null);

  // Progress tracking for installations
  const [isPolling, setIsPolling] = useState(false);
  const [deploymentSubscriptionId, setDeploymentSubscriptionId] = useState<
    string | null
  >(null);
  const [deploymentStatus, setDeploymentStatus] =
    useState<DeploymentStatus>("not_started");
  const [deploymentMessage, setDeploymentMessage] = useState<string>("");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Memory modal state
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryModalData, setMemoryModalData] = useState<HfMemResult | null>(
    null
  );
  const [memoryModalLoading, setMemoryModalLoading] = useState(false);
  const [memoryCache, setMemoryCache] = useState<Record<string, HfMemResult>>(
    {}
  );

  // Polling function for deployment status
  const pollDeploymentStatus = useCallback(async () => {
    if (!deploymentSubscriptionId || !token) return;

    try {
      const res = await fetch(
        `/api/huggingface/deploy-status?subscriptionId=${deploymentSubscriptionId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setDeploymentStatus(data.status);
        setDeploymentMessage(data.message);
        if (data.logs) setDeployLogs(data.logs);

        // Update success message based on status
        if (data.status === "running") {
          setDeploySuccess("Model is running and ready!");
          setIsPolling(false);
        } else if (data.status === "failed") {
          setDeployError(data.message || "Deployment failed");
          setIsPolling(false);
        }

        // Stop polling if complete or failed
        if (data.status === "running" || data.status === "failed") {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      }
    } catch (err) {
      console.error("Status poll error:", err);
    }
  }, [deploymentSubscriptionId, token]);

  // Start/stop polling based on isPolling state
  useEffect(() => {
    if (isPolling && deploymentSubscriptionId) {
      pollDeploymentStatus();
      pollingRef.current = setInterval(pollDeploymentStatus, 5000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isPolling, deploymentSubscriptionId, pollDeploymentStatus]);

  // Fetch catalog when tab changes
  useEffect(() => {
    fetchCatalog(activeTab);
  }, [activeTab]);

  const fetchCatalog = async (type: TabType) => {
    setCatalogLoading(true);
    try {
      const res = await fetch(
        `/api/huggingface/catalog?type=${type}&checkCompatibility=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (res.ok) {
        const data = await res.json();
        setCatalogItems(data.items || []);
      }
    } catch (err) {
      console.error("Catalog error:", err);
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;

    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        limit: "20",
      });
      if (selectedTask) params.append("task", selectedTask);
      if (selectedLibrary) params.append("library", selectedLibrary);
      if (selectedParamSize) params.append("paramSize", selectedParamSize);

      const res = await fetch(`/api/huggingface/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        if (data.filterOptions && !filterOptions) {
          setFilterOptions(data.filterOptions);
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedTask("");
    setSelectedLibrary("");
    setSelectedParamSize("");
    setShowFilters(false);
  };

  const openDeployModal = async (item: CatalogItem | SearchResult) => {
    setSelectedItem(item);
    setShowDeployModal(true);
    setDeployError(null);
    setDeploySuccess(null);
    setGpuCount(1);

    try {
      const [launchRes, instancesRes] = await Promise.all([
        fetch("/api/instances/launch-options", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/instances", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (launchRes.ok) {
        const data = await launchRes.json();
        setLaunchOptions({
          pools: data.pools || [],
          ephemeralStorageBlocks: data.ephemeralStorageBlocks || [],
        });

        if (data.pools?.length > 0) {
          const availablePool = data.pools.find(
            (p: { available_gpus?: number }) =>
              p.available_gpus === undefined || p.available_gpus > 0
          );
          if (availablePool) {
            setSelectedPool(availablePool.id);
          } else {
            setSelectedPool(data.pools[0].id);
          }
        }
        if (data.ephemeralStorageBlocks?.length > 0) {
          setSelectedStorage(data.ephemeralStorageBlocks[0].id);
        }
      }

      if (instancesRes.ok) {
        const data = await instancesRes.json();
        const running = (data.poolSubscriptions || [])
          .filter(
            (sub: { status?: string }) =>
              sub.status === "subscribed" || sub.status === "active"
          )
          .map(
            (sub: {
              id: string;
              pool_name?: string;
              per_pod_info?: { vgpu_count?: number };
              status?: string;
            }) => ({
              id: sub.id,
              pool_name: sub.pool_name || "Unknown Pool",
              gpu_model: undefined,
              vgpus: sub.per_pod_info?.vgpu_count || 1,
              status: sub.status || "unknown",
            })
          );

        setExistingSubscriptions(running);

        if (running.length > 0) {
          setDeployMode("existing");
          setSelectedSubscription(running[0].id);
        } else {
          setDeployMode("new");
        }
      }
    } catch (err) {
      console.error("Error fetching launch options:", err);
    }
  };

  const closeDeployModal = () => {
    setShowDeployModal(false);
    setSelectedItem(null);
    setDeployError(null);
    setDeploySuccess(null);
    setDeployLogs(null);
    setDeployResult(null);
    setShowLogs(false);
    setHfToken("");
    setAddOpenWebUI(false);
    setIsPolling(false);
    setDeploymentSubscriptionId(null);
    setDeploymentStatus("not_started");
    setDeploymentMessage("");
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleDeploy = async () => {
    if (!selectedItem) return;

    // Pool is auto-selected by the backend — no need for frontend validation
    if (deployMode === "existing" && !selectedSubscription) {
      setDeployError("Please select an existing GPU");
      return;
    }

    setDeploying(true);
    setDeployError(null);
    setDeploySuccess(null);
    setDeployLogs(null);
    setDeployResult(null);

    try {
      if (deployMode === "existing") {
        const body: Record<string, unknown> = {
          hfItemId: selectedItem.id,
          subscriptionId: selectedSubscription,
          openWebUI: addOpenWebUI,
          netdata: true,
        };

        if (hfToken) {
          body.hfToken = hfToken;
        }

        const res = await fetch("/api/huggingface/deploy-existing", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (data.logs) {
          setDeployLogs(data.logs);
        }

        if (!res.ok) {
          if (data.requiresToken) {
            setDeployError(
              `This model requires a HuggingFace token. Get yours at huggingface.co/settings/tokens`
            );
          } else {
            setDeployError(data.error || "Failed to deploy");
          }
          return;
        }

        setDeployResult({
          serviceHost: data.serviceHost,
          servicePort: data.servicePort,
        });

        closeDeployModal();
        onDeploymentStarted?.();
      } else {
        const body: Record<string, unknown> = {
          hfItemId: selectedItem.id,
          gpuCount,
          ephemeralStorageId: selectedStorage || undefined,
          openWebUI: addOpenWebUI,
          netdata: true,
        };

        if (hfToken) {
          body.hfToken = hfToken;
        }

        const res = await fetch("/api/huggingface/deploy", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          if (data.requiresToken) {
            setDeployError(
              `This model requires a HuggingFace token. Get yours at huggingface.co/settings/tokens`
            );
          } else {
            setDeployError(data.error || "Failed to deploy");
          }
          return;
        }

        closeDeployModal();
        onDeploymentStarted?.();
      }
    } catch (err) {
      console.error("Deploy error:", err);
      setDeployError("Failed to start deployment");
    } finally {
      setDeploying(false);
    }
  };

  // Fetch memory data for a model
  const fetchMemoryData = async (
    modelId: string
  ): Promise<HfMemResult | null> => {
    if (memoryCache[modelId]) {
      return memoryCache[modelId];
    }

    try {
      const res = await fetch(
        `/api/huggingface/model-memory?modelId=${encodeURIComponent(modelId)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setMemoryCache((prev) => ({ ...prev, [modelId]: data.data }));
          return data.data;
        }
      }
    } catch (err) {
      console.error("Error fetching memory data:", err);
    }
    return null;
  };

  // Open memory modal
  const openMemoryModal = async (modelId: string) => {
    setShowMemoryModal(true);
    setMemoryModalLoading(true);
    setMemoryModalData(null);

    const data = await fetchMemoryData(modelId);
    setMemoryModalData(data);
    setMemoryModalLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--ink)]">Hugging Face</h1>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search Hugging Face Hub for models, spaces..."
              className="w-full px-4 py-2.5 pl-10 border border-[var(--line)] rounded-lg focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent bg-white"
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[var(--muted)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2.5 border rounded-lg flex items-center gap-2 transition-colors ${
              showFilters || selectedTask || selectedLibrary || selectedParamSize
                ? "border-[var(--blue)] bg-blue-50 text-[var(--blue)]"
                : "border-[var(--line)] text-[var(--muted)] hover:bg-zinc-50"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            <span>Filters</span>
            {(selectedTask || selectedLibrary || selectedParamSize) && (
              <span className="ml-1 bg-[var(--blue)] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {
                  [selectedTask, selectedLibrary, selectedParamSize].filter(
                    Boolean
                  ).length
                }
              </span>
            )}
          </button>
          <button
            onClick={handleSearch}
            disabled={searching || searchQuery.length < 2}
            className="px-5 py-2.5 bg-[var(--blue)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-medium"
          >
            {searching ? "..." : "Search"}
          </button>
          {searchResults.length > 0 && (
            <button
              onClick={clearSearch}
              className="px-4 py-2.5 text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Clear
            </button>
          )}
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <FilterPanel
            selectedTask={selectedTask}
            setSelectedTask={setSelectedTask}
            selectedLibrary={selectedLibrary}
            setSelectedLibrary={setSelectedLibrary}
            selectedParamSize={selectedParamSize}
            setSelectedParamSize={setSelectedParamSize}
            filterOptions={filterOptions}
          />
        )}
      </div>

      {/* Search Results */}
      {searchResults.length > 0 ? (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--ink)] mb-4">
            Search Results ({searchResults.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {searchResults.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onDeploy={openDeployModal}
                onOpenMemoryModal={openMemoryModal}
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="mb-6">
            <div className="border-b border-[var(--line)]">
              <nav className="-mb-px flex space-x-6">
                {(["popular", "rtx", "model", "space"] as TabType[]).map(
                  (tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                        activeTab === tab
                          ? "border-[var(--blue)] text-[var(--blue)]"
                          : "border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:border-zinc-300"
                      }`}
                    >
                      {tab === "popular"
                        ? "Popular"
                        : tab === "rtx"
                        ? "⚡ Pro 6000 Blackwell"
                        : tab === "model"
                        ? "All Models"
                        : "Spaces"}
                    </button>
                  )
                )}
              </nav>
            </div>
          </div>

          {/* Pro 6000 Blackwell Banner */}
          {activeTab === "rtx" && (
            <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <span className="text-xl">⚡</span>
                </div>
                <div>
                  <h3 className="font-semibold text-green-900">
                    Pro 6000 Blackwell Optimized
                  </h3>
                  <p className="text-sm text-green-700 mt-1">
                    These models are pre-configured for NVIDIA RTX PRO 6000
                    Blackwell GPUs with 96GB GDDR7 VRAM. Run 70B+ parameter
                    models with full precision. Optimized for fast inference
                    with vLLM. Perfect for production AI deployments.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                      96GB VRAM
                    </span>
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                      Blackwell Architecture
                    </span>
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                      vLLM Optimized
                    </span>
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                      70B+ Models
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Catalog Grid */}
          {catalogLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--blue)] border-t-transparent"></div>
            </div>
          ) : catalogItems.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              No items found in this category
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {catalogItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onDeploy={openDeployModal}
                  onOpenMemoryModal={openMemoryModal}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Deploy Modal */}
      {showDeployModal && selectedItem && (
        <DeployModal
          selectedItem={selectedItem}
          launchOptions={launchOptions}
          existingSubscriptions={existingSubscriptions}
          deployMode={deployMode}
          setDeployMode={setDeployMode}
          selectedSubscription={selectedSubscription}
          setSelectedSubscription={setSelectedSubscription}
          selectedPool={selectedPool}
          setSelectedPool={setSelectedPool}
          selectedStorage={selectedStorage}
          setSelectedStorage={setSelectedStorage}
          gpuCount={gpuCount}
          setGpuCount={setGpuCount}
          hfToken={hfToken}
          setHfToken={setHfToken}
          addOpenWebUI={addOpenWebUI}
          setAddOpenWebUI={setAddOpenWebUI}
          deploying={deploying}
          deployError={deployError}
          deploySuccess={deploySuccess}
          deployLogs={deployLogs}
          showLogs={showLogs}
          setShowLogs={setShowLogs}
          deployResult={deployResult}
          isPolling={isPolling}
          deploymentStatus={deploymentStatus}
          deploymentMessage={deploymentMessage}
          onClose={closeDeployModal}
          onDeploy={handleDeploy}
        />
      )}

      {/* Memory Detail Modal */}
      {showMemoryModal && (
        <MemoryModal
          memoryData={memoryModalData}
          loading={memoryModalLoading}
          onClose={() => setShowMemoryModal(false)}
        />
      )}
    </div>
  );
}
