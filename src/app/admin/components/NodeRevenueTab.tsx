"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────
interface RevenueLineItem {
  id: string;
  stripeCustomerId: string;
  teamId: string | null;
  type: string;
  amountCents: number;
  description: string | null;
  subscriptionId: string | null;
  poolId: number | null;
  gpuCount: number | null;
  hourlyRateCents: number | null;
  billingMinutes: number | null;
  createdAt: string;
}

interface CustomerSummary {
  stripeCustomerId: string;
  teamId: string | null;
  totalRevenueCents: number;
  transactionCount: number;
  lastCharge: string;
}

interface NodeRevenueData {
  items: RevenueLineItem[];
  customerSummary: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
  poolIds: number[];
}

/** Pool summary from the summary endpoint */
interface PoolSummary {
  poolId: number;
  productName: string | null;
  pricePerHourCents: number | null;
  investorEmail: string | null;
  thisMonthRevenueCents: number;
  thisMonthTransactions: number;
  lastMonthRevenueCents: number;
  lastMonthTransactions: number;
  allTimeRevenueCents: number;
  allTimeTransactions: number;
}

// ─── Helpers ────────────────────────────────────────────
function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Props ──────────────────────────────────────────────
interface NodeRevenueTabProps {
  poolIds?: number[];
  investorEmail?: string;
  investorLabel?: string;
  onBack?: () => void;
}

// ═══════════════════════════════════════════════════════════
export function NodeRevenueTab({ poolIds: initialPoolIds, investorEmail, investorLabel, onBack }: NodeRevenueTabProps) {
  // ── Landing page state ──
  const [poolSummaries, setPoolSummaries] = useState<PoolSummary[]>([]);
  const [summaryTotals, setSummaryTotals] = useState<{ thisMonthRevenueCents: number; lastMonthRevenueCents: number; allTimeRevenueCents: number } | null>(null);
  const [landingLoading, setLandingLoading] = useState(false);

  // ── Drill-down state ──
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);
  const [selectedPoolLabel, setSelectedPoolLabel] = useState<string>("");
  const [poolIdsInput, setPoolIdsInput] = useState(initialPoolIds?.join(",") || "");
  const [data, setData] = useState<NodeRevenueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<"summary" | "details">("summary");
  const [filterCustomer, setFilterCustomer] = useState<string | null>(null);

  // Whether we're in "drill-down" mode
  const isDrillDown = !!(selectedPoolId || investorEmail || initialPoolIds);

  // ── Load all pool revenue summaries for the landing page ──
  const loadPoolSummaries = useCallback(async () => {
    setLandingLoading(true);
    try {
      const res = await fetch("/api/admin/node-revenue?summary=true");
      if (res.ok) {
        const json = await res.json();
        setPoolSummaries(json.pools || []);
        setSummaryTotals(json.totals || null);
      }
    } catch (e) {
      console.error("Failed to load pool summaries:", e);
    } finally {
      setLandingLoading(false);
    }
  }, []);

  // Load landing page on mount if no pre-selected context
  useEffect(() => {
    if (!investorEmail && !initialPoolIds) {
      loadPoolSummaries();
    }
  }, [investorEmail, initialPoolIds, loadPoolSummaries]);

  // ── Revenue drill-down loader ──
  const loadRevenue = useCallback(async (poolIdsOrEmail: string, pageNum: number, isEmail?: boolean) => {
    if (!poolIdsOrEmail.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: "200" });
      if (isEmail) {
        params.set("investorEmail", poolIdsOrEmail);
      } else {
        params.set("poolIds", poolIdsOrEmail);
      }
      const res = await fetch(`/api/admin/node-revenue?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      if (json.poolIds) setPoolIdsInput(json.poolIds.join(","));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load revenue data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load drill-down if investorEmail or poolIds are provided
  useEffect(() => {
    if (investorEmail) {
      loadRevenue(investorEmail, 0, true);
    } else if (initialPoolIds && initialPoolIds.length > 0) {
      loadRevenue(initialPoolIds.join(","), 0);
    }
  }, [initialPoolIds, investorEmail, loadRevenue]);

  const handlePoolClick = (pool: PoolSummary) => {
    setSelectedPoolId(pool.poolId);
    setSelectedPoolLabel(pool.productName ? `${pool.productName} (Pool ${pool.poolId})` : `Pool ${pool.poolId}`);
    setPoolIdsInput(String(pool.poolId));
    setData(null);
    setPage(0);
    setViewMode("summary");
    setFilterCustomer(null);
    loadRevenue(String(pool.poolId), 0);
  };

  const handleBackToLanding = () => {
    setSelectedPoolId(null);
    setSelectedPoolLabel("");
    setData(null);
    setError(null);
    setPoolIdsInput("");
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setFilterCustomer(null);
    loadRevenue(poolIdsInput, 0);
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    loadRevenue(poolIdsInput, newPage);
  };

  const filteredItems = data?.items.filter((item) => {
    if (!filterCustomer) return true;
    return item.stripeCustomerId === filterCustomer;
  }) || [];

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;
  const grandTotal = data?.customerSummary.reduce((sum, c) => sum + c.totalRevenueCents, 0) || 0;

  // Group pools by product name for the landing page
  const poolsByProduct = new Map<string, PoolSummary[]>();
  for (const pool of poolSummaries) {
    const key = pool.productName || "Unknown";
    const existing = poolsByProduct.get(key) || [];
    existing.push(pool);
    poolsByProduct.set(key, existing);
  }

  // ═════════════════════════════════════════════════════════
  // LANDING PAGE — All pools with revenue
  // ═════════════════════════════════════════════════════════
  if (!isDrillDown) {
    return (
      <div>
        {/* Summary totals */}
        {summaryTotals && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">This Month</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{formatDollars(summaryTotals.thisMonthRevenueCents)}</p>
            </div>
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">Last Month</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{formatDollars(summaryTotals.lastMonthRevenueCents)}</p>
            </div>
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">All Time</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{formatDollars(summaryTotals.allTimeRevenueCents)}</p>
            </div>
          </div>
        )}

        {landingLoading && (
          <div className="py-12 text-center text-[#5b6476]">Loading pool revenue data...</div>
        )}

        {!landingLoading && poolSummaries.length === 0 && (
          <div className="py-12 text-center text-[#5b6476]">
            No pools with revenue found. Revenue is recorded when customers are billed for GPU usage.
          </div>
        )}

        {/* Pool revenue table */}
        {!landingLoading && poolSummaries.length > 0 && (
          <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden mb-6">
            <table className="w-full">
              <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Pool</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">GPU Type</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Rate/hr</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">This Month</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Last Month</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">All Time</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Investor</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Txns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e7ef]">
                {poolSummaries.map((pool) => (
                  <tr
                    key={pool.poolId}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => handlePoolClick(pool)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-[#0b0f1c]">Pool {pool.poolId}</td>
                    <td className="px-4 py-3 text-sm text-[#5b6476]">{pool.productName || "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-[#5b6476] text-right">
                      {pool.pricePerHourCents != null ? formatDollars(pool.pricePerHourCents) : "\u2014"}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right ${pool.thisMonthRevenueCents > 0 ? "text-[#0b0f1c]" : "text-[#9ca3af]"}`}>
                      {formatDollars(pool.thisMonthRevenueCents)}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right ${pool.lastMonthRevenueCents > 0 ? "text-[#5b6476]" : "text-[#9ca3af]"}`}>
                      {formatDollars(pool.lastMonthRevenueCents)}
                    </td>
                    <td className={`px-4 py-3 text-sm font-medium text-right ${pool.allTimeRevenueCents > 0 ? "text-[#0b0f1c]" : "text-[#9ca3af]"}`}>
                      {formatDollars(pool.allTimeRevenueCents)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5b6476]">
                      {pool.investorEmail || <span className="text-[#9ca3af]">unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#5b6476] text-right">{pool.allTimeTransactions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Group by product summary */}
        {!landingLoading && poolsByProduct.size > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[#0b0f1c] mb-3">Revenue by GPU Type</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from(poolsByProduct.entries()).map(([productName, pools]) => {
                const thisMonth = pools.reduce((s, p) => s + p.thisMonthRevenueCents, 0);
                const allTime = pools.reduce((s, p) => s + p.allTimeRevenueCents, 0);
                return (
                  <div key={productName} className="bg-white border border-[#e4e7ef] rounded-xl p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-[#0b0f1c]">{productName}</span>
                      <span className="text-xs text-[#5b6476]">{pools.length} pool{pools.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[#f0f0f0]">
                      <div>
                        <p className="text-xs text-[#5b6476]">This month</p>
                        <p className="text-sm font-semibold text-[#0b0f1c]">{formatDollars(thisMonth)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-[#5b6476]">All time</p>
                        <p className="text-sm font-semibold text-[#0b0f1c]">{formatDollars(allTime)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Manual pool ID search */}
        <div className="mt-8 pt-6 border-t border-[#e4e7ef]">
          <h3 className="text-sm font-medium text-[#5b6476] mb-2">Manual lookup</h3>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (poolIdsInput.trim()) {
              const pids = poolIdsInput.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
              if (pids.length > 0) {
                setSelectedPoolId(pids[0]);
                setSelectedPoolLabel(`Pools ${poolIdsInput}`);
                loadRevenue(poolIdsInput, 0);
              }
            }
          }} className="flex gap-2">
            <input
              type="text"
              placeholder="Enter pool IDs (comma-separated, e.g. 12,13,14,15)"
              value={poolIdsInput}
              onChange={(e) => setPoolIdsInput(e.target.value)}
              className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-sm"
            />
            <button
              type="submit"
              disabled={!poolIdsInput.trim()}
              className="px-4 py-2 bg-[#1a4fff] text-white hover:bg-[#1238c9] rounded-lg font-medium text-sm disabled:opacity-50"
            >
              Look Up
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════
  // DRILL-DOWN — Revenue details for a specific node/investor
  // ═════════════════════════════════════════════════════════
  const drillLabel = selectedPoolLabel || investorLabel || "Selected Pools";
  const showBackToLanding = !!selectedPoolId;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        {showBackToLanding && (
          <button onClick={handleBackToLanding} className="text-sm text-[#1a4fff] hover:underline">
            &larr; Back to all nodes
          </button>
        )}
        {onBack && !showBackToLanding && (
          <button onClick={onBack} className="text-sm text-[#1a4fff] hover:underline">
            &larr; Back to Investors
          </button>
        )}
        <span className="text-sm text-[#5b6476]">
          Revenue for: <span className="font-medium text-[#0b0f1c]">{drillLabel}</span>
          {investorEmail && (
            <span className="ml-2 text-xs text-[#9ca3af]">({investorEmail})</span>
          )}
        </span>
      </div>

      {/* Manual pool ID search if no context */}
      {!investorEmail && !initialPoolIds && !selectedPoolId && (
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Enter pool IDs (comma-separated)"
            value={poolIdsInput}
            onChange={(e) => setPoolIdsInput(e.target.value)}
            className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff] text-sm"
          />
          <button
            type="submit"
            disabled={loading || !poolIdsInput.trim()}
            className="px-4 py-2 bg-[#1a4fff] text-white hover:bg-[#1238c9] rounded-lg font-medium text-sm disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Revenue"}
          </button>
        </form>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-[#5b6476]">Loading revenue data...</div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">Total Revenue</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{formatDollars(grandTotal)}</p>
            </div>
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">Transactions</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{data.total.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">Unique Customers</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{data.customerSummary.length}</p>
            </div>
            <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
              <p className="text-xs text-[#5b6476]">Pools</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{data.poolIds.join(", ")}</p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { setViewMode("summary"); setFilterCustomer(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "summary" ? "bg-[#1a4fff] text-white" : "bg-gray-100 text-[#5b6476] hover:bg-gray-200"
              }`}
            >
              By Customer
            </button>
            <button
              onClick={() => { setViewMode("details"); setFilterCustomer(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "details" ? "bg-[#1a4fff] text-white" : "bg-gray-100 text-[#5b6476] hover:bg-gray-200"
              }`}
            >
              All Transactions
            </button>
            {filterCustomer && (
              <button
                onClick={() => setFilterCustomer(null)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
              >
                Clear filter: {filterCustomer.slice(0, 20)}...
              </button>
            )}
          </div>

          {/* Customer Summary Table */}
          {viewMode === "summary" && (
            <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Customer</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Team</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Total Revenue</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Transactions</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Last Charge</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e7ef]">
                  {data.customerSummary.map((cust) => (
                    <tr key={cust.stripeCustomerId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-[#0b0f1c]">{cust.stripeCustomerId}</td>
                      <td className="px-4 py-3 text-sm text-[#5b6476]">{cust.teamId || "-"}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[#0b0f1c] text-right">{formatDollars(cust.totalRevenueCents)}</td>
                      <td className="px-4 py-3 text-sm text-[#5b6476] text-right">{cust.transactionCount}</td>
                      <td className="px-4 py-3 text-sm text-[#5b6476]">{formatDate(cust.lastCharge)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => { setFilterCustomer(cust.stripeCustomerId); setViewMode("details"); }}
                          className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                        >
                          View Transactions
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.customerSummary.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[#5b6476]">No revenue data found for these pools.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Transaction Details Table */}
          {viewMode === "details" && (
            <>
              <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Date</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Customer</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Type</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Amount</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Pool</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">GPUs</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Rate/hr</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Minutes</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4e7ef]">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-[#5b6476] whitespace-nowrap">{formatDate(item.createdAt)}</td>
                        <td className="px-4 py-2 text-xs font-mono text-[#0b0f1c]">
                          <span title={item.stripeCustomerId}>{item.stripeCustomerId.slice(0, 20)}...</span>
                          {item.teamId && <div className="text-[10px] text-[#5b6476]">{item.teamId.slice(0, 16)}...</div>}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            item.type === "gpu_usage" ? "bg-blue-100 text-blue-700"
                            : item.type === "gpu_deploy" ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                          }`}>{item.type}</span>
                        </td>
                        <td className="px-4 py-2 text-sm font-medium text-[#0b0f1c] text-right">{formatDollars(item.amountCents)}</td>
                        <td className="px-4 py-2 text-xs text-[#5b6476] text-right">{item.poolId ?? "-"}</td>
                        <td className="px-4 py-2 text-xs text-[#5b6476] text-right">{item.gpuCount ?? "-"}</td>
                        <td className="px-4 py-2 text-xs text-[#5b6476] text-right">{item.hourlyRateCents != null ? formatDollars(item.hourlyRateCents) : "-"}</td>
                        <td className="px-4 py-2 text-xs text-[#5b6476] text-right">{item.billingMinutes ?? "-"}</td>
                        <td className="px-4 py-2 text-xs text-[#5b6476] max-w-[200px] truncate" title={item.description || ""}>{item.description || "-"}</td>
                      </tr>
                    ))}
                    {filteredItems.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-[#5b6476]">No transactions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && !filterCustomer && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-[#5b6476]">Page {page + 1} of {totalPages} ({data.total} total)</span>
                  <div className="flex gap-2">
                    <button onClick={() => goToPage(page - 1)} disabled={page === 0} className="px-3 py-1.5 text-sm bg-white border border-[#e4e7ef] rounded hover:bg-gray-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-sm bg-white border border-[#e4e7ef] rounded hover:bg-gray-50 disabled:opacity-50">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
