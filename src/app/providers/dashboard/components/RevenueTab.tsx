"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RevenueSummary } from "../types";

interface TokenRevenueData {
  provider: {
    id: string;
    companyName: string;
    revenueSharePercent: number;
  };
  period: {
    start: string;
    end: string;
    type: string;
  };
  totals: {
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    requestCount: number;
    customerRevenueCents: number;
    providerEarningsCents: number;
    earningsFormatted: string;
  };
  serverBreakdown: Array<{
    serverId: string;
    hostname: string;
    loadedModel: string | null;
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    requestCount: number;
    earningsCents: number;
    earningsFormatted: string;
  }>;
  recentActivity: Array<{
    id: string;
    serverId: string;
    serverHostname: string;
    periodStart: string;
    inputTokens: string;
    outputTokens: string;
    requestCount: number;
    earningsCents: number;
  }>;
}

interface RevenueTabProps {
  revenue: RevenueSummary | null;
  loading: boolean;
  period: string;
  onPeriodChange: (period: string) => void;
  onRefresh: () => void;
}

export function RevenueTab({
  revenue,
  loading,
  period,
  onPeriodChange,
  onRefresh,
}: RevenueTabProps) {
  // Inference API earnings state
  const [tokenRevenue, setTokenRevenue] = useState<TokenRevenueData | null>(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [tokenPeriod, setTokenPeriod] = useState("month");
  const [liveEarnings, setLiveEarnings] = useState<Array<{
    serverId: string;
    serverHostname: string;
    earningsCents: number;
    timestamp: string;
  }>>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch token revenue data
  const fetchTokenRevenue = useCallback(async () => {
    setTokenLoading(true);
    try {
      const res = await fetch(`/api/providers/token-revenue?period=${tokenPeriod}`);
      if (res.ok) {
        const data = await res.json();
        setTokenRevenue(data);
      }
    } catch (error) {
      console.error("Error fetching token revenue:", error);
    } finally {
      setTokenLoading(false);
    }
  }, [tokenPeriod]);

  // Connect to SSE for real-time earnings
  useEffect(() => {
    const eventSource = new EventSource("/api/providers/earnings/stream");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "earning") {
          setLiveEarnings((prev) => [
            {
              serverId: data.serverId,
              serverHostname: data.serverHostname,
              earningsCents: data.earningsCents,
              timestamp: data.timestamp,
            },
            ...prev.slice(0, 9), // Keep last 10
          ]);
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Fetch token revenue on mount and period change
  useEffect(() => {
    fetchTokenRevenue();
  }, [fetchTokenRevenue]);
  const periods = [
    { id: "7d", label: "7 Days" },
    { id: "30d", label: "30 Days" },
    { id: "90d", label: "90 Days" },
    { id: "ytd", label: "Year to Date" },
    { id: "all", label: "All Time" },
  ];

  if (loading && !revenue) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
        <p className="text-[#5b6476]">Loading revenue data...</p>
      </div>
    );
  }

  if (!revenue) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
        <p className="text-[#5b6476]">No revenue data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Period Selector */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-[#0b0f1c]">Revenue</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[#5b6476] hover:text-[#0b0f1c] disabled:opacity-50"
            title="Refresh"
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
        <div className="flex gap-2">
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                period === p.id
                  ? "bg-[#1a4fff] text-white"
                  : "bg-white border border-[#e4e7ef] text-[#5b6476] hover:text-[#0b0f1c]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Your Earnings</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            ${revenue.summary.providerEarnings.toFixed(2)}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Customer Revenue</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            ${revenue.summary.customerRevenue.toFixed(2)}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Utilization</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            {revenue.summary.utilizationPercent}%
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Hours Occupied</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            {revenue.summary.occupiedHours.toFixed(0)}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Avg $/Hour</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            ${revenue.summary.avgRevenuePerOccupiedHour.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Current Month Estimate */}
      <div className="bg-gradient-to-r from-[#1a4fff]/10 to-[#1a4fff]/5 border border-[#1a4fff]/20 rounded-lg p-6">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-[#0b0f1c]">
              Current Month Estimate
            </h3>
            <p className="text-[#5b6476] text-sm">
              Payout date:{" "}
              {new Date(revenue.currentMonth.payoutDate).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#1a4fff]">
              ${revenue.currentMonth.estimatedPayout.toFixed(2)}
            </p>
            <p className="text-[#5b6476] text-sm">Estimated payout</p>
          </div>
        </div>
      </div>

      {/* Revenue Chart - Simple Bar Visualization */}
      {revenue.dailyRevenue.length > 0 && (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">
            Daily Revenue
          </h3>
          <div className="flex items-end gap-1 h-40">
            {revenue.dailyRevenue.slice(-30).map((day) => {
              const maxRevenue = Math.max(
                ...revenue.dailyRevenue.map((d) => d.revenue)
              );
              const height =
                maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0;

              return (
                <div
                  key={day.date}
                  className="flex-1 bg-[#1a4fff]/20 hover:bg-[#1a4fff]/40 rounded-t transition-colors relative group"
                  style={{ height: `${Math.max(height, 2)}%` }}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                    {day.date}: ${day.revenue.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-xs text-[#5b6476]">
            <span>
              {revenue.dailyRevenue.length > 0
                ? revenue.dailyRevenue[0].date
                : ""}
            </span>
            <span>
              {revenue.dailyRevenue.length > 0
                ? revenue.dailyRevenue[revenue.dailyRevenue.length - 1].date
                : ""}
            </span>
          </div>
        </div>
      )}

      {/* Revenue by Node */}
      {revenue.revenueByNode.length > 0 && (
        <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#e4e7ef]">
            <h3 className="text-lg font-semibold text-[#0b0f1c]">
              Revenue by Server
            </h3>
          </div>
          <table className="w-full">
            <thead className="bg-[#f7f8fb]">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Server
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                  GPU
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Hours
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Utilization
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Earnings
                </th>
              </tr>
            </thead>
            <tbody>
              {revenue.revenueByNode.map((node) => (
                <tr key={node.nodeId} className="border-t border-[#e4e7ef]">
                  <td className="py-3 px-4">
                    <span className="text-[#0b0f1c] font-medium">
                      {node.hostname}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-[#5b6476]">
                      {node.gpuModel || "—"} × {node.gpuCount || "?"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-[#5b6476]">
                    {node.occupiedHours.toFixed(0)} / {node.totalHours.toFixed(0)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className={`${
                        parseFloat(node.utilizationPercent) >= 70
                          ? "text-green-600"
                          : parseFloat(node.utilizationPercent) >= 40
                            ? "text-yellow-600"
                            : "text-[#5b6476]"
                      }`}
                    >
                      {node.utilizationPercent}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-[#0b0f1c]">
                    ${node.earnings.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inference API Earnings Section */}
      <div className="mt-8 pt-8 border-t border-[#e4e7ef]">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-[#0b0f1c]">Inference API Earnings</h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                sseConnected
                  ? "bg-green-100 text-green-700"
                  : "bg-yellow-100 text-yellow-700"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  sseConnected ? "bg-green-500 animate-pulse" : "bg-yellow-500"
                }`}
              />
              {sseConnected ? "Live" : "Connecting..."}
            </span>
            <button
              onClick={fetchTokenRevenue}
              disabled={tokenLoading}
              className="text-[#5b6476] hover:text-[#0b0f1c] disabled:opacity-50"
              title="Refresh"
            >
              <svg
                className={`w-5 h-5 ${tokenLoading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          <div className="flex gap-2">
            {[
              { id: "day", label: "Today" },
              { id: "week", label: "Week" },
              { id: "month", label: "Month" },
              { id: "all", label: "All" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setTokenPeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  tokenPeriod === p.id
                    ? "bg-[#1a4fff] text-white"
                    : "bg-white border border-[#e4e7ef] text-[#5b6476] hover:text-[#0b0f1c]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {tokenLoading && !tokenRevenue ? (
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
            <p className="text-[#5b6476]">Loading token earnings...</p>
          </div>
        ) : tokenRevenue ? (
          <div className="space-y-4">
            {/* Token Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
                <p className="text-[#5b6476] text-sm">Token Earnings</p>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  {tokenRevenue.totals.earningsFormatted}
                </p>
                <p className="text-xs text-[#5b6476] mt-1">
                  {tokenRevenue.provider.revenueSharePercent}% revenue share
                </p>
              </div>
              <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
                <p className="text-[#5b6476] text-sm">Total Tokens</p>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  {Number(tokenRevenue.totals.totalTokens).toLocaleString()}
                </p>
                <p className="text-xs text-[#5b6476] mt-1">
                  {Number(tokenRevenue.totals.inputTokens).toLocaleString()} in / {Number(tokenRevenue.totals.outputTokens).toLocaleString()} out
                </p>
              </div>
              <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
                <p className="text-[#5b6476] text-sm">Requests</p>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  {tokenRevenue.totals.requestCount.toLocaleString()}
                </p>
              </div>
              <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
                <p className="text-[#5b6476] text-sm">Customer Revenue</p>
                <p className="text-2xl font-bold text-[#0b0f1c]">
                  ${(tokenRevenue.totals.customerRevenueCents / 100).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Live Earnings Feed */}
            {liveEarnings.length > 0 && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-green-800 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Live Earnings
                </h4>
                <div className="space-y-1">
                  {liveEarnings.slice(0, 5).map((earning, idx) => (
                    <div
                      key={`${earning.timestamp}-${idx}`}
                      className="flex justify-between items-center text-sm"
                    >
                      <span className="text-green-700">
                        {earning.serverHostname}
                      </span>
                      <span className="font-medium text-green-800">
                        +${(earning.earningsCents / 100).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-Server Token Breakdown */}
            {tokenRevenue.serverBreakdown.length > 0 && (
              <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
                <div className="p-4 border-b border-[#e4e7ef]">
                  <h3 className="text-lg font-semibold text-[#0b0f1c]">
                    Token Earnings by Server
                  </h3>
                </div>
                <table className="w-full">
                  <thead className="bg-[#f7f8fb]">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Server
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Model
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Input Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Output Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Requests
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Earnings
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenRevenue.serverBreakdown.map((server) => (
                      <tr
                        key={server.serverId}
                        className="border-t border-[#e4e7ef]"
                      >
                        <td className="py-3 px-4">
                          <span className="text-[#0b0f1c] font-medium">
                            {server.hostname}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-[#5b6476] text-sm">
                            {server.loadedModel || "—"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-[#5b6476]">
                          {Number(server.inputTokens).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right text-[#5b6476]">
                          {Number(server.outputTokens).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right text-[#5b6476]">
                          {server.requestCount.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-[#0b0f1c]">
                          {server.earningsFormatted}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent Activity */}
            {tokenRevenue.recentActivity.length > 0 && (
              <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
                <div className="p-4 border-b border-[#e4e7ef]">
                  <h3 className="text-lg font-semibold text-[#0b0f1c]">
                    Recent Token Activity
                  </h3>
                </div>
                <table className="w-full">
                  <thead className="bg-[#f7f8fb]">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Time
                      </th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Server
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Tokens
                      </th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                        Earnings
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenRevenue.recentActivity.map((activity) => (
                      <tr
                        key={activity.id}
                        className="border-t border-[#e4e7ef]"
                      >
                        <td className="py-3 px-4 text-[#5b6476] text-sm">
                          {new Date(activity.periodStart).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-[#0b0f1c] font-medium">
                          {activity.serverHostname}
                        </td>
                        <td className="py-3 px-4 text-right text-[#5b6476]">
                          {(
                            Number(activity.inputTokens) +
                            Number(activity.outputTokens)
                          ).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-green-600">
                          +${(activity.earningsCents / 100).toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
            <p className="text-[#5b6476]">
              No token earnings data available. Your servers may not be assigned to the inference API yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
