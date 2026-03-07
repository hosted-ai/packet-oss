"use client";

import { useState } from "react";
import type { InvestorDashboardData, InvestorNode, BusinessHealth } from "../types";
import { RevenueCharts } from "./RevenueCharts";

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDollarsPrecise(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.floor(hours / 24);
  const remainHours = Math.round(hours % 24);
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

type SortField = "revenue" | "occupancy" | "customers" | "name" | "gpu";

export function StatsDisplay({ data }: { data: InvestorDashboardData }) {
  const nodes = data.nodes || [];
  const summary = data.summary || {
    totalNodes: 0, activeNodes: 0, nodesWithPool: 0, totalPhysicalGpus: 0,
    totalVgpuSlots: 0, totalOccupiedSlots: 0, totalCustomers: 0,
    avgOccupancyPercent: 0, avgOvercommitRatio: 0,
    avgGpuUtilization: null, avgTemperature: null, avgMemoryPercent: null,
  };
  const revenue = data.revenue || {
    grossRevenueThisMonthCents: 0, grossRevenueLastMonthCents: 0,
    grossRevenueDailyRateCents: 0, grossRevenueProjectedMonthCents: 0,
    revenueSharePercent: 0,
    investorRevenueThisMonthCents: 0, investorRevenueLastMonthCents: 0,
    investorRevenueDailyRateCents: 0, investorRevenueProjectedMonthCents: 0,
    monthOverMonthChangePercent: null, fleetUtilizationPercent: 0,
  };
  const dailyRevenue = data.dailyRevenue || [];
  const lastUpdated = data.lastUpdated || new Date().toISOString();
  const businessHealth = data.businessHealth || {
    revenuePerGpuPerDayCents: 0, arpcCents: 0, sellThroughPercent: 0,
    churnPercent: null, topCustomerPercent: null, avgSessionDurationHours: null,
  };
  const [sortBy, setSortBy] = useState<SortField>("revenue");
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  const sortedNodes = [...nodes].sort((a, b) => {
    switch (sortBy) {
      case "revenue": return b.revenueThisMonthCents - a.revenueThisMonthCents;
      case "occupancy": return b.occupancyPercent - a.occupancyPercent;
      case "customers": return b.customerCount - a.customerCount;
      case "gpu": return (b.avgGpuUtilization ?? -1) - (a.avgGpuUtilization ?? -1);
      case "name": return (a.hostname || "").localeCompare(b.hostname || "");
      default: return 0;
    }
  });

  return (
    <>
      {/* Revenue Hero */}
      <section className="mb-8">
        <div className="bg-gradient-to-br from-[#0b0f1c] via-[#131a35] to-[#1a2854] rounded-2xl p-8 text-white">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-white/60 text-sm font-medium uppercase tracking-wider">Your Revenue This Month</p>
              <h2 className="text-4xl font-bold mt-1">{formatDollars(revenue.investorRevenueThisMonthCents)}</h2>
              <p className="text-white/50 text-sm mt-1">
                {revenue.revenueSharePercent}% of {formatDollars(revenue.grossRevenueThisMonthCents)} gross
              </p>
            </div>
            <div className="text-right">
              {revenue.monthOverMonthChangePercent !== null && (
                <div className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium ${
                  revenue.monthOverMonthChangePercent >= 0
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-red-500/20 text-red-300"
                }`}>
                  <span>{revenue.monthOverMonthChangePercent >= 0 ? "+" : ""}{revenue.monthOverMonthChangePercent}%</span>
                  <span className="text-white/40 text-xs">vs last month</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Per GPU / Day</p>
              <p className="text-xl font-semibold">{formatDollarsPrecise(businessHealth.revenuePerGpuPerDayCents)}</p>
              <p className="text-white/30 text-xs">your share</p>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Daily Rate</p>
              <p className="text-xl font-semibold">{formatDollarsPrecise(revenue.investorRevenueDailyRateCents)}</p>
              <p className="text-white/30 text-xs">all GPUs</p>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Projected Month</p>
              <p className="text-xl font-semibold">{formatDollars(revenue.investorRevenueProjectedMonthCents)}</p>
              <p className="text-white/30 text-xs">at current pace</p>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Last Month</p>
              <p className="text-xl font-semibold">{formatDollars(revenue.investorRevenueLastMonthCents)}</p>
              <p className="text-white/30 text-xs">total earned</p>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Fleet Utilization</p>
              <p className="text-xl font-semibold">{revenue.fleetUtilizationPercent}%</p>
              <p className="text-white/30 text-xs">of capacity</p>
            </div>
          </div>
        </div>
      </section>

      {/* Fleet & Business Health — unified section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#0b0f1c] mb-4">Fleet Overview</h2>
        <div className="bg-white border border-[#e4e7ef] rounded-xl p-5">
          {/* Row 1: Infrastructure capacity */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-4">
            <MiniKpi label="Physical GPUs" value={String(summary.totalPhysicalGpus)} sub={`${summary.totalVgpuSlots} vGPU slots`} />
            <MiniKpi
              label="Occupancy"
              value={`${summary.avgOccupancyPercent}%`}
              sub={`${summary.totalOccupiedSlots}/${summary.totalVgpuSlots} filled`}
              signal={summary.avgOccupancyPercent >= 80 ? "good" : summary.avgOccupancyPercent >= 50 ? "neutral" : "warn"}
            />
            <MiniKpi label="Customers" value={String(summary.totalCustomers)} sub={`across ${summary.totalNodes} node${summary.totalNodes !== 1 ? "s" : ""}`} />
            <MiniKpi
              label="Avg GPU Load"
              value={summary.avgGpuUtilization !== null ? `${summary.avgGpuUtilization}%` : "--"}
              sub={summary.avgTemperature !== null ? `${summary.avgTemperature}\u00B0C avg` : undefined}
            />
            <MiniKpi
              label="Active Nodes"
              value={`${summary.activeNodes}/${summary.totalNodes}`}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-[#e4e7ef] my-5" />

          {/* Row 2: Business intelligence */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-4">
            <MiniKpi
              label="Revenue / GPU / Day"
              value={formatDollarsPrecise(businessHealth.revenuePerGpuPerDayCents)}
              sub="your share per GPU"
            />
            <MiniKpi
              label="Avg Per Customer"
              value={formatDollars(businessHealth.arpcCents)}
              sub="this month"
            />
            <MiniKpi
              label="Sell-Through"
              value={`${businessHealth.sellThroughPercent}%`}
              sub="of GPU-hours sold"
              signal={businessHealth.sellThroughPercent >= 70 ? "good" : businessHealth.sellThroughPercent >= 40 ? "neutral" : "warn"}
            />
            <MiniKpi
              label="Customer Churn"
              value={businessHealth.churnPercent !== null ? `${businessHealth.churnPercent}%` : "--"}
              sub={businessHealth.churnPercent !== null ? "vs last month" : "not enough data"}
              signal={businessHealth.churnPercent !== null ? (businessHealth.churnPercent <= 10 ? "good" : businessHealth.churnPercent <= 25 ? "neutral" : "bad") : undefined}
            />
            <MiniKpi
              label="Top Customer"
              value={businessHealth.topCustomerPercent !== null ? `${businessHealth.topCustomerPercent}%` : "--"}
              sub={businessHealth.topCustomerPercent !== null ? "of total revenue" : "no revenue data"}
              signal={businessHealth.topCustomerPercent !== null ? (businessHealth.topCustomerPercent <= 40 ? "good" : businessHealth.topCustomerPercent <= 60 ? "neutral" : "bad") : undefined}
            />
          </div>
        </div>
      </section>

      {/* Revenue & Customer Charts */}
      <RevenueCharts
        dailyRevenue={dailyRevenue}
        nodes={nodes}
        revenueSharePercent={revenue.revenueSharePercent}
      />

      {/* Node Revenue & Performance Table */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#0b0f1c]">Node Performance</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#5b6476]">Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              className="text-xs border border-[#e4e7ef] rounded-lg px-2 py-1.5 bg-white text-[#0b0f1c] focus:outline-none focus:ring-1 focus:ring-[#1a4fff]"
            >
              <option value="revenue">Revenue</option>
              <option value="occupancy">Occupancy</option>
              <option value="customers">Customers</option>
              <option value="gpu">GPU Load</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {nodes.length === 0 ? (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-12 text-center">
            <div className="w-16 h-16 bg-[#f7f8fb] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#5b6476]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <p className="text-[#5b6476] font-medium">No nodes assigned yet</p>
            <p className="text-[#9ca3af] text-sm mt-1">Contact your administrator to get nodes assigned to your portfolio.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e4e7ef] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">Node</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">Revenue (MTD)</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">Occupancy</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">Customers</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">GPU Load</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[#5b6476] uppercase tracking-wider">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e7ef]">
                  {sortedNodes.map((node) => (
                    <NodeRow
                      key={node.nodeId}
                      node={node}
                      revenueSharePercent={revenue.revenueSharePercent}
                      avgSessionDurationHours={businessHealth.avgSessionDurationHours}
                      expanded={expandedNode === node.nodeId}
                      onToggle={() => setExpandedNode(expandedNode === node.nodeId ? null : node.nodeId)}
                    />
                  ))}
                </tbody>
                <tfoot className="bg-[#f7f8fb] border-t border-[#e4e7ef]">
                  <tr>
                    <td className="px-4 py-3 text-sm font-semibold text-[#0b0f1c]">
                      Total ({nodes.length} nodes)
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-[#0b0f1c]">
                      {formatDollars(revenue.investorRevenueThisMonthCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-[#5b6476]">
                      {summary.totalOccupiedSlots}/{summary.totalVgpuSlots}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-[#5b6476]">
                      {summary.totalCustomers}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right text-sm text-[#5b6476]">
                      --
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Last Updated */}
      <div className="text-center text-[#9ca3af] text-xs mb-8">
        Data computed {new Date(data._cachedAt || lastUpdated).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        {data._nextUpdateAt && (
          <> &middot; Refreshes hourly</>
        )}
      </div>
    </>
  );
}

/** Compact KPI display used inside the Fleet Overview card */
function MiniKpi({ label, value, sub, signal }: {
  label: string; value: string; sub?: string;
  signal?: "good" | "neutral" | "warn" | "bad";
}) {
  const dotColor = signal === "good" ? "bg-emerald-500"
    : signal === "bad" ? "bg-red-500"
    : signal === "warn" ? "bg-amber-500"
    : undefined;
  return (
    <div className="min-w-0">
      <p className="text-[#9ca3af] text-[11px] uppercase tracking-wider mb-1 truncate">{label}</p>
      <div className="flex items-center gap-1.5">
        {dotColor && <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />}
        <p className="text-lg font-bold text-[#0b0f1c] truncate">{value}</p>
      </div>
      {sub && <p className="text-[#9ca3af] text-[11px] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function NodeRow({ node, revenueSharePercent, avgSessionDurationHours, expanded, onToggle }: {
  node: InvestorNode; revenueSharePercent: number; avgSessionDurationHours: number | null;
  expanded: boolean; onToggle: () => void;
}) {
  const investorRevenue = Math.round(node.revenueThisMonthCents * revenueSharePercent / 100);
  const displayName = node.hostname || node.gpuModel || "GPU Node";

  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className={`w-4 h-4 text-[#9ca3af] transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <div className="font-medium text-sm text-[#0b0f1c]">{displayName}</div>
              <div className="text-xs text-[#9ca3af]">
                {node.gpuModel || "Unknown GPU"}
                {node.gpuCount ? ` \u00B7 ${node.gpuCount} GPU${node.gpuCount !== 1 ? "s" : ""}` : ""}
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="text-sm font-semibold text-[#0b0f1c]">{formatDollars(investorRevenue)}</div>
          <div className="text-xs text-[#9ca3af]">{formatDollars(node.revenueThisMonthCents)} gross</div>
        </td>
        <td className="px-4 py-3 text-right">
          <div>
            <div className="flex items-center justify-end gap-2">
              <div className="w-16 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    node.occupancyPercent >= 90 ? "bg-emerald-500" :
                    node.occupancyPercent >= 60 ? "bg-blue-500" :
                    node.occupancyPercent >= 30 ? "bg-amber-500" :
                    "bg-red-400"
                  }`}
                  style={{ width: `${Math.min(100, node.occupancyPercent)}%` }}
                />
              </div>
              <span className="text-xs text-[#0b0f1c] w-10 text-right">{node.occupancyPercent}%</span>
            </div>
            <div className="text-xs text-[#9ca3af]">{node.occupiedSlots}/{node.totalVgpuSlots} slots</div>
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="text-sm font-medium text-[#0b0f1c]">{node.customerCount}</div>
          {node.gpuCount && node.gpuCount > 0 && (
            <div className="text-xs text-[#9ca3af]">{node.customersPerGpu}/GPU</div>
          )}
        </td>
        <td className="px-4 py-3">
          {node.avgGpuUtilization !== null ? (
            <div className="flex items-center gap-2">
              <div className="w-16 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    node.avgGpuUtilization > 90 ? "bg-red-500" :
                    node.avgGpuUtilization > 70 ? "bg-amber-500" :
                    node.avgGpuUtilization > 30 ? "bg-emerald-500" :
                    "bg-blue-500"
                  }`}
                  style={{ width: `${Math.min(100, node.avgGpuUtilization)}%` }}
                />
              </div>
              <span className="text-xs text-[#0b0f1c] w-10 text-right">{node.avgGpuUtilization}%</span>
            </div>
          ) : (
            <span className="text-xs text-[#9ca3af]">--</span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-sm text-[#5b6476]">
          {node.billingType === "monthly" && node.monthlyRateCents
            ? <>{formatDollarsPrecise(node.monthlyRateCents)}<span className="text-xs text-[#9ca3af]">/mo</span></>
            : <>{formatDollarsPrecise(node.hourlyRateCents)}<span className="text-xs text-[#9ca3af]">/hr</span></>
          }
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#f7f8fb]">
          <td colSpan={6} className="px-4 py-4">
            {/* Node Detail KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm mb-4">
              <DetailItem label="Last Month Rev" value={formatDollars(Math.round(node.revenueLastMonthCents * revenueSharePercent / 100))} sub={`${formatDollars(node.revenueLastMonthCents)} gross`} />
              <DetailItem label="Customers / GPU" value={String(node.customersPerGpu)} />
              <DetailItem label="Overcommit Ratio" value={`${node.overcommitRatio}x`} />
              {avgSessionDurationHours !== null && (
                <DetailItem label="Avg Session" value={formatHours(avgSessionDurationHours)} sub="across fleet" />
              )}
              {node.metrics && (
                <>
                  <DetailItem label="VRAM Usage" value={`${formatMb(node.metrics.memoryUsedMb)} / ${formatMb(node.metrics.memoryTotalMb)}`} sub={`${node.metrics.memoryPercent}%`} />
                  <DetailItem label="Power Draw" value={`${node.metrics.powerDraw}W / ${node.metrics.powerLimit}W`} sub={`${Math.round(node.metrics.powerDraw / node.metrics.powerLimit * 100)}%`} />
                </>
              )}
              {!node.metrics && node.avgTemperature !== null && (
                <DetailItem label="Avg Temperature" value={`${node.avgTemperature}\u00B0C`} />
              )}
            </div>

            {/* Subscription summary (no per-pod details for privacy) */}
            <div className="text-xs text-[#5b6476]">
              {node.subscriptions.length > 0
                ? <p>{node.subscriptions.length} active subscription{node.subscriptions.length !== 1 ? "s" : ""} on this node</p>
                : <p className="text-[#9ca3af]">No active subscriptions on this node.</p>
              }
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[#9ca3af] text-xs mb-0.5">{label}</p>
      <p className="text-[#0b0f1c] font-medium">{value}</p>
      {sub && <p className="text-[#9ca3af] text-xs">{sub}</p>}
    </div>
  );
}
