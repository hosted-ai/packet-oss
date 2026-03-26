"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import type {
  CatalogItem,
  SearchResult,
  LaunchOptions,
  FilterOptions,
  TabType,
  DeploymentStatus,
} from "./types";
import { ItemCard } from "./ItemCard";
import { DeployModal } from "./DeployModal";
import { ProgressModal } from "./ProgressModal";
import { FilterPanel } from "./FilterPanel";

function HuggingFacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Auth
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Deploy modal
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | SearchResult | null>(null);
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions | null>(null);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<number | null>(null);
  const [gpuCount, setGpuCount] = useState(1);
  const [hfToken, setHfToken] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Progress modal
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [deploymentSubscriptionId, setDeploymentSubscriptionId] = useState<string | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>("not_started");
  const [deploymentLogs, setDeploymentLogs] = useState<string>("");
  const [deploymentMessage, setDeploymentMessage] = useState<string>("");
  const [apiEndpoint, setApiEndpoint] = useState<string | null>(null);
  const [notifyRequested, setNotifyRequested] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Check auth on mount
  useEffect(() => {
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      setLoading(false);
    } else {
      router.push("/account");
    }
  }, [searchParams, router]);

  // Fetch catalog when tab changes
  useEffect(() => {
    if (!token) return;
    fetchCatalog(activeTab);
  }, [token, activeTab]);

  const fetchCatalog = async (type: TabType) => {
    setCatalogLoading(true);
    try {
      const res = await fetch(`/api/huggingface/catalog?type=${type}&checkCompatibility=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("packet_token");
          router.push("/account");
          return;
        }
        throw new Error("Failed to fetch catalog");
      }
      const data = await res.json();
      setCatalogItems(data.items || []);
    } catch (err) {
      console.error("Catalog error:", err);
      setError("Failed to load catalog");
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || searchQuery.length < 2) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: searchQuery, limit: "20" });
      if (selectedTask) params.append("task", selectedTask);
      if (selectedLibrary) params.append("library", selectedLibrary);
      if (selectedParamSize) params.append("paramSize", selectedParamSize);

      const res = await fetch(`/api/huggingface/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setSearchResults(data.results || []);
      if (data.filterOptions) setFilterOptions(data.filterOptions);
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
    setGpuCount(1);

    try {
      const res = await fetch("/api/instances/launch-options", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const products = data.products || [];
        setLaunchOptions({
          products,
          walletBalanceCents: data.walletBalanceCents || 0,
        });
        if (products.length > 0) {
          const firstAvailable = products.find((p: { available: boolean }) => p.available);
          const pick = firstAvailable || products[0];
          if (pick) {
            setSelectedProduct(pick.id);
            if (pick.regions?.length > 0) {
              setSelectedRegion(pick.regions[0].id);
            }
          }
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
    setHfToken("");
  };

  // Polling for deployment status
  const pollDeploymentStatus = useCallback(async () => {
    if (!deploymentSubscriptionId || !token) return;
    try {
      const res = await fetch(
        `/api/huggingface/deploy-status?subscriptionId=${deploymentSubscriptionId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setDeploymentStatus(data.status);
        setDeploymentMessage(data.message);
        if (data.logs) setDeploymentLogs(data.logs);
        if (data.apiEndpoint) setApiEndpoint(data.apiEndpoint);

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

  useEffect(() => {
    if (showProgressModal && deploymentSubscriptionId) {
      pollDeploymentStatus();
      pollingRef.current = setInterval(pollDeploymentStatus, 5000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [showProgressModal, deploymentSubscriptionId, pollDeploymentStatus]);

  const closeProgressModal = () => {
    setShowProgressModal(false);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const requestEmailNotification = async () => {
    if (!deploymentSubscriptionId || !token || notifyRequested) return;
    try {
      const res = await fetch("/api/huggingface/notify-complete", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: deploymentSubscriptionId,
          modelName: selectedItem?.name,
        }),
      });
      if (res.ok) setNotifyRequested(true);
    } catch (err) {
      console.error("Notification request error:", err);
    }
  };

  const handleDeploy = async () => {
    if (!selectedItem) return;
    setDeploying(true);
    setDeployError(null);

    try {
      const body: Record<string, unknown> = {
        hfItemId: selectedItem.id,
        gpuCount,
        product_id: selectedProduct || undefined,
        region_id: selectedRegion || undefined,
      };
      if (hfToken) body.hfToken = hfToken;

      const res = await fetch("/api/huggingface/deploy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

      const subId = data.deployment?.subscriptionId || data.subscriptionId;
      if (subId) {
        setDeploymentSubscriptionId(String(subId));
        setDeploymentStatus(data.installing ? "installing" : "starting");
        setDeploymentMessage(data.message || "Deployment started...");
        setDeploymentLogs(data.logs || "");
        setNotifyRequested(false);
        setApiEndpoint(null);
        closeDeployModal();
        setShowProgressModal(true);
      } else {
        router.push(`/dashboard?token=${token}&hf_deploy=${data.deployment?.id || "new"}`);
      }
    } catch (err) {
      console.error("Deploy error:", err);
      setDeployError("Failed to start deployment");
    } finally {
      setDeploying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/dashboard?token=${token}`} className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="flex items-center gap-2">
                <span className="text-2xl">&#129303;</span>
                <h1 className="text-xl font-semibold text-gray-900">Hugging Face</h1>
              </div>
            </div>
            <Link
              href={`/dashboard?token=${token}`}
              className="hidden sm:block text-sm text-gray-600 hover:text-gray-900"
            >
              Back to Dashboard
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="sm:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="sm:hidden border-t border-gray-200 bg-white">
            <div className="px-4 py-3 space-y-2">
              <Link href={`/dashboard?token=${token}`} className="block px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
              <Link href={`/dashboard?token=${token}&tab=instances`} className="block px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(false)}>My GPUs</Link>
              <Link href={`/dashboard?token=${token}&tab=billing`} className="block px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(false)}>Billing</Link>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search Hugging Face Hub for models, spaces..."
                className="w-full px-4 py-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-3 border rounded-lg transition-colors flex items-center gap-2 ${
                showFilters || selectedTask || selectedLibrary || selectedParamSize
                  ? "border-teal-500 text-teal-600 bg-teal-50"
                  : "border-gray-300 text-gray-600 hover:border-gray-400"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className="hidden sm:inline">Filters</span>
              {(selectedTask || selectedLibrary || selectedParamSize) && (
                <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
              )}
            </button>
            <button
              onClick={handleSearch}
              disabled={searching || searchQuery.length < 2}
              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {searching ? "Searching..." : "Search"}
            </button>
            {searchResults.length > 0 && (
              <button onClick={clearSearch} className="px-4 py-3 text-gray-600 hover:text-gray-900">
                Clear
              </button>
            )}
          </div>

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
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              Search Results ({searchResults.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.map((item) => (
                <ItemCard key={item.id} item={item} onDeploy={openDeployModal} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mb-6">
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                  {(["popular", "model", "docker", "space"] as TabType[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`py-4 px-1 border-b-2 font-medium text-sm ${
                        activeTab === tab
                          ? "border-teal-500 text-teal-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      {tab === "popular" ? "Popular" : tab === "model" ? "Models" : tab === "docker" ? "Docker Images" : "Spaces"}
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            {/* Catalog Grid */}
            {catalogLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-teal-500 border-t-transparent"></div>
              </div>
            ) : catalogItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No items found in this category</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {catalogItems.map((item) => (
                  <ItemCard key={item.id} item={item} onDeploy={openDeployModal} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Deploy Modal */}
      {showDeployModal && selectedItem && (
        <DeployModal
          item={selectedItem}
          launchOptions={launchOptions}
          selectedProduct={selectedProduct}
          setSelectedProduct={setSelectedProduct}
          selectedRegion={selectedRegion}
          setSelectedRegion={setSelectedRegion}
          gpuCount={gpuCount}
          setGpuCount={setGpuCount}
          hfToken={hfToken}
          setHfToken={setHfToken}
          deploying={deploying}
          deployError={deployError}
          onClose={closeDeployModal}
          onDeploy={handleDeploy}
        />
      )}

      {/* Progress Modal */}
      {showProgressModal && (
        <ProgressModal
          modelName={selectedItem?.name || "Model"}
          status={deploymentStatus}
          message={deploymentMessage}
          logs={deploymentLogs}
          apiEndpoint={apiEndpoint}
          notifyRequested={notifyRequested}
          token={token || ""}
          onClose={closeProgressModal}
          onRequestNotification={requestEmailNotification}
        />
      )}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent"></div>
    </div>
  );
}

export default function HuggingFacePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <HuggingFacePageContent />
    </Suspense>
  );
}
