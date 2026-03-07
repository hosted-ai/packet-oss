"use client";

import { useState, useEffect, useCallback } from "react";

interface Region {
  id: number;
  name: string;
  city: string;
  country: string;
  gpuaasEnabled: boolean;
}

interface Cluster {
  id: number;
  regionId: number;
  status: string;
  statusLabel: string;
}

interface NodeData {
  id: string;
  hostname: string;
  ipAddress: string;
  sshPort: number;
  sshUsername: string;
  externalServiceIp: string | null;
  gpuaasNodeId: number | null;
  gpuaasRegionId: number | null;
  gpuaasClusterId: number | null;
  gpuaasPoolId: number | null;
  gpuaasInitStatus: string | null;
  gpuaasSshKeysInstalled: boolean;
  status: string;
  provider: {
    id: string;
    companyName: string;
  };
}

interface GpuaasNodeStatus {
  id?: number;
  name?: string;
  initStatus?: number;
  initStatusLabel?: string;
  role?: {
    is_controller_node: boolean;
    is_worker_node: boolean;
    is_gateway_service: boolean;
    is_storage_service: boolean;
  };
  error?: string;
}

interface GpuaasProvisioningModalProps {
  nodeId: string;
  onClose: () => void;
  onComplete: () => void;
}

export function GpuaasProvisioningModal({
  nodeId,
  onClose,
  onComplete,
}: GpuaasProvisioningModalProps) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState<NodeData | null>(null);
  const [gpuaasStatus, setGpuaasStatus] = useState<GpuaasNodeStatus | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [sshKeys, setSshKeys] = useState<string[]>([]);

  // Form state
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [externalServiceIp, setExternalServiceIp] = useState("");
  const [isController, setIsController] = useState(false);
  const [isWorker, setIsWorker] = useState(true);
  const [isGateway, setIsGateway] = useState(false);
  const [isStorage, setIsStorage] = useState(false);
  const [sshPassword, setSshPassword] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/providers/nodes/${nodeId}/gpuaas`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch data");
      }

      setNode(data.data.node);
      setGpuaasStatus(data.data.gpuaasNodeStatus);
      setRegions(data.data.regions || []);
      setClusters(data.data.clusters || []);

      // Set defaults from node data
      if (data.data.node.gpuaasRegionId) {
        setSelectedRegionId(data.data.node.gpuaasRegionId);
      }
      if (data.data.node.externalServiceIp) {
        setExternalServiceIp(data.data.node.externalServiceIp);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const performAction = async (action: string, params: Record<string, unknown> = {}) => {
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/providers/nodes/${nodeId}/gpuaas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Action failed");
      }

      // Handle specific action results
      if (action === "get-ssh-keys" && data.data.publicKeys) {
        setSshKeys(data.data.publicKeys);
      }

      // Refresh data after action
      await fetchData();

      return data.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      return null;
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegister = () => {
    if (!selectedRegionId || !externalServiceIp) {
      setError("Please select a region and enter the external service IP");
      return;
    }

    performAction("register", {
      regionId: selectedRegionId,
      externalServiceIp,
      isController,
      isWorker,
      isGateway,
      isStorage,
    });
  };

  const handleGetSshKeys = () => performAction("get-ssh-keys");
  const handleInstallSshKey = () => {
    if (!sshPassword) {
      setError("Please enter the SSH password");
      return;
    }
    performAction("install-ssh-key", { sshPassword });
  };
  const handleMarkSshDone = () => performAction("mark-ssh-done");
  const handleInitialize = () => performAction("initialize");
  const handleCheckStatus = () => performAction("check-status");
  const handleJoinCluster = () => performAction("join-cluster");
  const handleScanGpus = () => performAction("scan-gpus");

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin w-8 h-8 border-2 border-[#1a4fff] border-t-transparent rounded-full mx-auto" />
          <p className="text-[#5b6476] mt-4">Loading GPUaaS data...</p>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-red-600">Node not found</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-100 rounded">
            Close
          </button>
        </div>
      </div>
    );
  }

  // Determine current step
  const currentStep = !node.gpuaasNodeId
    ? "register"
    : !node.gpuaasSshKeysInstalled
    ? "ssh-keys"
    : node.gpuaasInitStatus === "not_init"
    ? "initialize"
    : node.gpuaasInitStatus === "in_progress"
    ? "waiting"
    : node.gpuaasInitStatus === "completed"
    ? "complete"
    : node.gpuaasInitStatus === "error"
    ? "error"
    : "unknown";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#e4e7ef] px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-[#0b0f1c]">GPUaaS Provisioning</h2>
            <p className="text-sm text-[#5b6476]">
              {node.hostname || node.ipAddress} ({node.provider.companyName})
            </p>
          </div>
          <button onClick={onClose} className="text-[#5b6476] hover:text-[#0b0f1c]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {["Register", "SSH Keys", "Initialize", "Complete"].map((step, i) => {
              const stepIndex = i;
              const currentIndex =
                currentStep === "register" ? 0 :
                currentStep === "ssh-keys" ? 1 :
                ["initialize", "waiting", "error"].includes(currentStep) ? 2 : 3;

              const isActive = stepIndex === currentIndex;
              const isComplete = stepIndex < currentIndex;
              const isError = currentStep === "error" && stepIndex === 2;

              return (
                <div key={step} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      isError
                        ? "bg-red-100 text-red-600"
                        : isComplete
                        ? "bg-green-100 text-green-600"
                        : isActive
                        ? "bg-[#1a4fff] text-white"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {isComplete ? "✓" : isError ? "!" : i + 1}
                  </div>
                  <span
                    className={`ml-2 text-sm ${
                      isActive ? "text-[#0b0f1c] font-medium" : "text-[#5b6476]"
                    }`}
                  >
                    {step}
                  </span>
                  {i < 3 && (
                    <div
                      className={`w-12 h-0.5 mx-3 ${
                        isComplete ? "bg-green-300" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Node Info */}
          <div className="bg-[#f7f8fb] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#0b0f1c] mb-2">Node Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[#5b6476]">IP Address:</span>{" "}
                <span className="text-[#0b0f1c]">{node.ipAddress}:{node.sshPort}</span>
              </div>
              <div>
                <span className="text-[#5b6476]">Username:</span>{" "}
                <span className="text-[#0b0f1c]">{node.sshUsername}</span>
              </div>
              <div>
                <span className="text-[#5b6476]">Status:</span>{" "}
                <span className="text-[#0b0f1c]">{node.status}</span>
              </div>
              <div>
                <span className="text-[#5b6476]">GPUaaS ID:</span>{" "}
                <span className="text-[#0b0f1c]">{node.gpuaasNodeId || "Not registered"}</span>
              </div>
            </div>
            {gpuaasStatus && !gpuaasStatus.error && (
              <div className="mt-3 pt-3 border-t border-[#e4e7ef] text-sm">
                <span className="text-[#5b6476]">Init Status:</span>{" "}
                <span
                  className={`font-medium ${
                    gpuaasStatus.initStatusLabel === "Completed"
                      ? "text-green-600"
                      : gpuaasStatus.initStatusLabel === "Error"
                      ? "text-red-600"
                      : gpuaasStatus.initStatusLabel === "In Progress"
                      ? "text-yellow-600"
                      : "text-gray-600"
                  }`}
                >
                  {gpuaasStatus.initStatusLabel}
                </span>
              </div>
            )}
          </div>

          {/* Step Content */}
          {currentStep === "register" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">Step 1: Register with GPUaaS</h3>
              <p className="text-sm text-[#5b6476]">
                Register this node with the GPUaaS Admin system. Select a region and provide
                the external IP address for customer access.
              </p>

              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">Region *</label>
                <select
                  value={selectedRegionId || ""}
                  onChange={(e) => setSelectedRegionId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                >
                  <option value="">Select a region...</option>
                  {regions.filter((r) => r.gpuaasEnabled).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.city}, {r.country})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  External Service IP *
                </label>
                <input
                  type="text"
                  value={externalServiceIp}
                  onChange={(e) => setExternalServiceIp(e.target.value)}
                  placeholder="e.g., 203.0.113.100"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                />
                <p className="text-xs text-[#5b6476] mt-1">
                  Public IP address that customers will use to connect to this node
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#0b0f1c] mb-2">Node Roles</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isWorker}
                      onChange={(e) => setIsWorker(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Worker Node (runs GPU workloads)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isController}
                      onChange={(e) => setIsController(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Controller Node (manages cluster)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isGateway}
                      onChange={(e) => setIsGateway(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Gateway Service</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isStorage}
                      onChange={(e) => setIsStorage(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Storage Service</span>
                  </label>
                </div>
              </div>

              <button
                onClick={handleRegister}
                disabled={actionLoading || !selectedRegionId || !externalServiceIp}
                className="w-full py-3 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1238c9] disabled:opacity-50"
              >
                {actionLoading ? "Registering..." : "Register Node"}
              </button>
            </div>
          )}

          {currentStep === "ssh-keys" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">Step 2: Install SSH Keys</h3>
              <p className="text-sm text-[#5b6476]">
                Install the GPUaaS SSH key on the node to allow remote management.
              </p>

              {/* Auto-install option */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-medium text-purple-800 mb-2">Auto-Install (Recommended)</h4>
                <p className="text-sm text-purple-700 mb-3">
                  Enter the SSH password and we&apos;ll automatically install the key on the server.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    placeholder="SSH Password"
                    className="flex-1 px-3 py-2 border border-purple-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleInstallSshKey}
                    disabled={actionLoading || !sshPassword}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 text-sm"
                  >
                    {actionLoading ? "Installing..." : "Install Key"}
                  </button>
                </div>
                <p className="text-xs text-purple-600 mt-2">
                  Password is not stored and only used for this one-time key installation.
                </p>
              </div>

              <div className="text-center text-sm text-[#5b6476]">— or —</div>

              {/* Manual option */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 mb-2">Manual Installation</h4>
                {sshKeys.length === 0 ? (
                  <button
                    onClick={handleGetSshKeys}
                    disabled={actionLoading}
                    className="w-full py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 text-sm"
                  >
                    {actionLoading ? "Fetching..." : "Get SSH Keys to Install Manually"}
                  </button>
                ) : (
                  <>
                    <div className="bg-gray-900 rounded-lg p-3 mb-3">
                      <p className="text-xs text-gray-400 mb-2">
                        Add to ~/.ssh/authorized_keys on {node.sshUsername}@{node.ipAddress}:
                      </p>
                      <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap">
                        {sshKeys.join("\n\n")}
                      </pre>
                    </div>

                    <button
                      onClick={handleMarkSshDone}
                      disabled={actionLoading}
                      className="w-full py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 text-sm"
                    >
                      {actionLoading ? "Confirming..." : "I've Installed Keys Manually - Continue"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {currentStep === "initialize" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">Step 3: Initialize Node</h3>
              <p className="text-sm text-[#5b6476]">
                Start the node initialization process. This will install required software
                and configure the node for GPU workloads.
              </p>

              <button
                onClick={handleInitialize}
                disabled={actionLoading}
                className="w-full py-3 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1238c9] disabled:opacity-50"
              >
                {actionLoading ? "Starting..." : "Start Initialization"}
              </button>
            </div>
          )}

          {currentStep === "waiting" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">Initialization In Progress</h3>
              <p className="text-sm text-[#5b6476]">
                The node is being initialized. This may take several minutes.
              </p>

              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-12 h-12 border-4 border-[#1a4fff] border-t-transparent rounded-full" />
              </div>

              <button
                onClick={handleCheckStatus}
                disabled={actionLoading}
                className="w-full py-3 bg-gray-100 text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                {actionLoading ? "Checking..." : "Check Status"}
              </button>
            </div>
          )}

          {currentStep === "error" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-red-600">Initialization Failed</h3>
              <p className="text-sm text-[#5b6476]">
                The node initialization encountered an error. Check the node logs for details.
              </p>

              <div className="flex gap-4">
                <button
                  onClick={handleInitialize}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1238c9] disabled:opacity-50"
                >
                  {actionLoading ? "Retrying..." : "Retry Initialization"}
                </button>
                <button
                  onClick={handleCheckStatus}
                  disabled={actionLoading}
                  className="flex-1 py-3 bg-gray-100 text-[#0b0f1c] rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          )}

          {currentStep === "complete" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-green-600">Node Ready!</h3>
              <p className="text-sm text-[#5b6476]">
                The node has been initialized successfully. You can now:
              </p>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleJoinCluster}
                  disabled={actionLoading}
                  className="py-3 bg-[#1a4fff] text-white rounded-lg font-medium hover:bg-[#1238c9] disabled:opacity-50"
                >
                  {actionLoading ? "Joining..." : "Join Cluster"}
                </button>
                <button
                  onClick={handleScanGpus}
                  disabled={actionLoading}
                  className="py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
                >
                  {actionLoading ? "Scanning..." : "Scan GPUs"}
                </button>
              </div>

              <button
                onClick={() => {
                  onComplete();
                  onClose();
                }}
                className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
