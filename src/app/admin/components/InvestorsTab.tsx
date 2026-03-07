"use client";

import { useState, useEffect } from "react";
import type { Investor } from "../types";

interface NodeOption {
  id: string;
  hostname: string;
  ip: string;
  gpuModel: string | null;
  gpuCount: number;
  gpuaasPoolId: number | null;
  /** ALL pool IDs on this node (from node.pools[].id) */
  poolIds: number[];
  poolNames: string[];
  status: string;
  providerName: string;
}

interface InvestorsTabProps {
  investors: Investor[];
  newInvestorEmail: string;
  actionLoading: string | null;
  onNewInvestorEmailChange: (email: string) => void;
  onAddInvestor: (e: React.FormEvent) => void;
  onRemoveInvestor: (email: string) => void;
  onResendInvite: (email: string) => void;
  onLoginAs: (email: string) => void;
  onViewRevenue?: (investor: Investor) => void;
}

export function InvestorsTab({
  investors,
  newInvestorEmail,
  actionLoading,
  onNewInvestorEmailChange,
  onAddInvestor,
  onRemoveInvestor,
  onResendInvite,
  onLoginAs,
  onViewRevenue,
}: InvestorsTabProps) {
  const [assigningEmail, setAssigningEmail] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [savingShare, setSavingShare] = useState<string | null>(null);
  // Temporary state to resolve saved pool IDs -> nodes after nodes load
  const [savedPoolIdsForResolve, setSavedPoolIdsForResolve] = useState<Set<number>>(new Set());

  async function saveRevenueShare(email: string, value: string) {
    setSavingShare(email);
    try {
      const percent = value.trim() === "" ? null : Number(value);
      await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-revenue-share", email, revenueSharePercent: percent }),
      });
      const inv = investors.find((i) => i.email.toLowerCase() === email.toLowerCase());
      if (inv) inv.revenueSharePercent = percent;
    } catch { /* ignore */ } finally {
      setSavingShare(null);
    }
  }

  // Load all nodes (ProviderNodes + GPUaaS nodes) with their pools when modal opens
  useEffect(() => {
    if (!assigningEmail) return;
    setNodesLoading(true);
    fetch("/api/admin/nodes")
      .then((r) => r.json())
      .then((data) => {
        const raw = data.data?.nodes || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setNodes(raw.map((n: any) => ({
          id: n.id,
          hostname: n.hostname,
          ip: n.ip,
          gpuModel: n.gpuModel,
          gpuCount: n.gpuCount,
          gpuaasPoolId: n.gpuaasPoolId,
          // Collect ALL pool IDs from node.pools[]
          poolIds: (n.pools || []).map((p: { id: number }) => p.id),
          poolNames: (n.pools || []).map((p: { id: number; name: string }) => p.name || `Pool #${p.id}`),
          status: n.status,
          providerName: n.providerName,
        })));
      })
      .catch(() => setNodes([]))
      .finally(() => setNodesLoading(false));
  }, [assigningEmail]);

  // Once nodes are loaded, reverse-map saved pool IDs to node selections
  useEffect(() => {
    if (savedPoolIdsForResolve.size === 0 || nodes.length === 0) return;
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      for (const node of nodes) {
        // If ANY of this node's pools are in the saved set, select the node
        if (node.poolIds.some((pid) => savedPoolIdsForResolve.has(pid))) {
          next.add(node.id);
        }
      }
      return next;
    });
    setSavedPoolIdsForResolve(new Set()); // Clear after resolving
  }, [nodes, savedPoolIdsForResolve]);

  function openAssignModal(investor: Investor) {
    setAssigningEmail(investor.email);
    setNodeSearch("");

    // Parse existing assignedNodeIds to pre-select matching nodes.
    // Format is "pools:X,Y,Z" — we reverse-map pool IDs back to nodes.
    // Also handle legacy direct node IDs.
    const savedPoolIds = new Set<number>();
    const directNodeIds = new Set<string>();
    for (const nid of investor.assignedNodeIds || []) {
      const poolsMatch = nid.match(/^pools:(.+)$/);
      if (poolsMatch) {
        poolsMatch[1].split(",").map(Number).filter((n) => !isNaN(n) && n > 0).forEach((pid) => savedPoolIds.add(pid));
      } else {
        directNodeIds.add(nid);
      }
    }
    // We'll resolve savedPoolIds to nodes once nodes are loaded (see useEffect below).
    // For now, store pool IDs to resolve after nodes load.
    setSavedPoolIdsForResolve(savedPoolIds);
    setSelectedNodeIds(directNodeIds);
  }

  function toggleNode(id: string) {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveAssignment() {
    if (!assigningEmail) return;
    setSaving(true);
    try {
      // Auto-resolve: collect ALL pool IDs from selected nodes
      const allPoolIds = new Set<number>();
      for (const node of nodes) {
        if (selectedNodeIds.has(node.id)) {
          for (const pid of node.poolIds) allPoolIds.add(pid);
        }
      }

      // Save as "pools:X,Y,Z" format (the investor stats API handles this)
      const allIds: string[] = [];
      if (allPoolIds.size > 0) {
        allIds.push(`pools:${Array.from(allPoolIds).sort((a, b) => a - b).join(",")}`);
      }

      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign-nodes",
          email: assigningEmail,
          nodeIds: allIds,
        }),
      });
      if (res.ok) {
        const inv = investors.find(
          (i) => i.email.toLowerCase() === assigningEmail.toLowerCase()
        );
        if (inv) {
          inv.assignedNodeIds = allIds;
        }
        setAssigningEmail(null);
      }
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  }

  const filteredNodes = nodes.filter((node) => {
    if (!nodeSearch) return true;
    const s = nodeSearch.toLowerCase();
    return (
      node.hostname.toLowerCase().includes(s) ||
      node.ip.toLowerCase().includes(s) ||
      (node.gpuModel?.toLowerCase().includes(s)) ||
      node.id.toLowerCase().includes(s) ||
      node.providerName.toLowerCase().includes(s)
    );
  });

  /** Count pools assigned to this investor (from pools:X,Y,Z entries) */
  function getAssignmentLabel(inv: Investor): string {
    const ids = inv.assignedNodeIds || [];
    if (ids.length === 0) return "Assign Nodes";
    let poolCount = 0;
    for (const nid of ids) {
      const m = nid.match(/^pools:(.+)$/);
      if (m) poolCount += m[1].split(",").filter(Boolean).length;
    }
    if (poolCount > 0) return `${poolCount} pool${poolCount !== 1 ? "s" : ""}`;
    return `${ids.length} assigned`;
  }

  /** Count total pools that will be saved from selected nodes */
  const resolvedPoolCount = (() => {
    const pids = new Set<number>();
    for (const node of nodes) {
      if (selectedNodeIds.has(node.id)) {
        for (const pid of node.poolIds) pids.add(pid);
      }
    }
    return pids.size;
  })();

  return (
    <div>
      <form onSubmit={onAddInvestor} className="flex gap-2 mb-4">
        <input
          type="email"
          placeholder="Add investor email..."
          value={newInvestorEmail}
          onChange={(e) => onNewInvestorEmailChange(e.target.value)}
          className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[#1a4fff] text-white hover:bg-[#1238c9] rounded-lg font-medium"
        >
          Add Investor
        </button>
      </form>

      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Email</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Nodes</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Rev Share</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Added</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Last Login</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {investors.map((investor) => (
              <tr key={investor.email} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#0b0f1c]">{investor.email}</span>
                    {investor.isOwner && (
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">Owner</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {investor.acceptedAt ? (
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                      Active
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                      Pending
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => openAssignModal(investor)}
                    className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                  >
                    {getAssignmentLabel(investor)}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="-"
                      defaultValue={investor.revenueSharePercent ?? ""}
                      onBlur={(e) => saveRevenueShare(investor.email, e.target.value)}
                      disabled={savingShare === investor.email}
                      className="w-16 px-2 py-1 text-sm bg-white border border-[#e4e7ef] rounded text-[#0b0f1c] text-center focus:outline-none focus:ring-1 focus:ring-[#1a4fff] disabled:opacity-50"
                    />
                    <span className="text-xs text-[#5b6476]">%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[#5b6476]">
                  <div>{new Date(investor.addedAt).toLocaleDateString()}</div>
                  <div className="text-xs text-[#8b93a4]">by {investor.addedBy}</div>
                </td>
                <td className="px-4 py-3 text-sm text-[#5b6476]">
                  {investor.lastLoginAt
                    ? new Date(investor.lastLoginAt).toLocaleDateString()
                    : "-"}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {onViewRevenue && (investor.assignedNodeIds?.length || 0) > 0 && (
                    <button
                      onClick={() => onViewRevenue(investor)}
                      className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded"
                    >
                      Revenue
                    </button>
                  )}
                  <button
                    onClick={() => onLoginAs(investor.email)}
                    disabled={actionLoading === `login-${investor.email}`}
                    className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
                  >
                    {actionLoading === `login-${investor.email}` ? "Loading..." : "Login As"}
                  </button>
                  <button
                    onClick={() => onResendInvite(investor.email)}
                    disabled={actionLoading === `resend-${investor.email}`}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded disabled:opacity-50"
                  >
                    {actionLoading === `resend-${investor.email}` ? "Sending..." : "Resend Invite"}
                  </button>
                  {!investor.isOwner && (
                    <button
                      onClick={() => onRemoveInvestor(investor.email)}
                      disabled={actionLoading === `remove-${investor.email}`}
                      className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                    >
                      {actionLoading === `remove-${investor.email}` ? "Removing..." : "Remove"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {investors.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                  No investors yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Node Assignment Modal */}
      {assigningEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[#e4e7ef]">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">
                Assign Nodes to {assigningEmail}
              </h3>
              <p className="text-sm text-[#5b6476] mt-1">
                Select the physical nodes this investor owns. All GPU pools on those nodes will be automatically included for revenue tracking.
              </p>
            </div>

            <div className="px-6 py-3 border-b border-[#e4e7ef]">
              <input
                type="text"
                placeholder="Search by hostname, IP, GPU, provider..."
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-[#1a4fff]"
              />
              <div className="flex items-center justify-between mt-2 text-xs text-[#5b6476]">
                <span>
                  {selectedNodeIds.size} node{selectedNodeIds.size !== 1 ? "s" : ""} selected
                  {resolvedPoolCount > 0 && (
                    <span className="ml-1 text-[#1a4fff]">
                      ({resolvedPoolCount} pool{resolvedPoolCount !== 1 ? "s" : ""} resolved)
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedNodeIds(new Set(filteredNodes.map((n) => n.id)))}
                    className="text-[#1a4fff] hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedNodeIds(new Set())}
                    className="text-[#1a4fff] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3">
              {nodesLoading ? (
                <div className="py-8 text-center text-[#5b6476]">Loading nodes...</div>
              ) : filteredNodes.length === 0 ? (
                <div className="py-8 text-center text-[#5b6476]">No nodes found</div>
              ) : (
                <div className="space-y-1">
                  {filteredNodes.map((node) => (
                    <label
                      key={node.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                        selectedNodeIds.has(node.id)
                          ? "bg-blue-50 border border-blue-200"
                          : "hover:bg-gray-50 border border-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNodeIds.has(node.id)}
                        onChange={() => toggleNode(node.id)}
                        className="w-4 h-4 rounded border-gray-300 text-[#1a4fff] focus:ring-[#1a4fff]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#0b0f1c] truncate">
                            {node.hostname || node.ip}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            node.status === "online" || node.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}>
                            {node.status}
                          </span>
                          {node.gpuModel && (
                            <span className="text-[10px] text-[#5b6476]">
                              {node.gpuModel}
                            </span>
                          )}
                          {node.gpuCount > 0 && (
                            <span className="text-[10px] text-[#9ca3af]">
                              {node.gpuCount} GPU{node.gpuCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#5b6476] mt-0.5">
                          {node.providerName}
                          {" \u2014 "}
                          <span className="font-mono">{node.id.length > 20 ? `${node.id.slice(0, 20)}...` : node.id}</span>
                        </div>
                        {/* Show pools on this node */}
                        {node.poolIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {node.poolIds.map((pid, idx) => (
                              <span key={pid} className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                                Pool #{pid}{node.poolNames[idx] && node.poolNames[idx] !== `Pool #${pid}` ? ` (${node.poolNames[idx]})` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {node.poolIds.length === 0 && (
                          <div className="text-[10px] text-amber-600 mt-1">No pools detected on this node</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#e4e7ef] flex items-center justify-between">
              <div className="text-xs text-[#5b6476]">
                {resolvedPoolCount > 0 && (
                  <span>Will track revenue for {resolvedPoolCount} pool{resolvedPoolCount !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAssigningEmail(null)}
                  className="px-4 py-2 text-sm text-[#5b6476] hover:text-[#0b0f1c] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveAssignment}
                  disabled={saving || selectedNodeIds.size === 0}
                  className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg text-sm font-medium transition-colors disabled:bg-gray-400"
                >
                  {saving ? "Saving..." : `Save (${selectedNodeIds.size} node${selectedNodeIds.size !== 1 ? "s" : ""})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
