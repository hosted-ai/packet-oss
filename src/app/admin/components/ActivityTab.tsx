"use client";

import { useState, useEffect, useCallback } from "react";
import type { Quote } from "../types";
import { getTimeAgo } from "../utils";

interface UnifiedActivity {
  id: string;
  source: "admin" | "customer";
  type: string;
  actor: string;
  customerId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created: number;
}

interface ActivityTabProps {
  activities: unknown[];
  activitiesLoading: boolean;
  quotes: Quote[];
  onRefresh: () => void;
  onViewQuote: (quote: Quote) => void;
  onSwitchToQuotes: () => void;
}

const SOURCE_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "admin", label: "Admin Only" },
  { value: "customer", label: "Customer Only" },
];

const TYPE_CATEGORIES: Record<string, string[]> = {
  "Account": ["account_created", "account_login", "login_link_requested", "settings_updated", "two_factor_enabled", "two_factor_disabled"],
  "GPU Pods": ["gpu_launched", "gpu_scaled", "gpu_restarted", "gpu_stopped", "gpu_started", "gpu_terminated", "gpu_error"],
  "Bare Metal": ["bare_metal_deployed", "bare_metal_terminated"],
  "Storage": ["volume_created", "volume_updated", "volume_deleted", "volume_attached", "volume_detached"],
  "Billing": ["payment_received", "wallet_charged", "wallet_topup", "voucher_redeemed", "budget_set"],
  "API/SSH Keys": ["api_key_created", "api_key_deleted", "ssh_key_added", "ssh_key_deleted"],
  "Team": ["team_member_invited", "team_member_removed", "team_member_joined"],
  "Token Factory": ["inference", "batch_created", "batch_cancelled", "lora_created", "lora_training_started", "lora_training_completed", "lora_deleted"],
  "Admin": ["admin_login", "admin_added", "admin_removed", "customer_viewed", "customer_credit_added", "wallet_adjustment", "login_link_sent", "customer_login"],
  "Quotes": ["quote_created", "quote_updated", "quote_deleted", "quote_sent", "quote_reminder_sent", "quote_request_received"],
  "Snapshots": ["snapshot_created", "snapshot_restored", "snapshot_deleted"],
  "HuggingFace": ["hf_deployment_started", "hf_deployment_running", "hf_deployment_failed", "hf_deployment_deleted"],
  "Pods (Admin)": ["pod_stop", "pod_start", "pod_restart", "pod_terminate"],
};

export function ActivityTab({
  quotes,
  onViewQuote,
  onSwitchToQuotes,
}: ActivityTabProps) {
  const [data, setData] = useState<UnifiedActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/admin/activity?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.activities || []);
      }
    } catch (error) {
      console.error("Failed to load activities:", error);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, typeFilter, searchQuery]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
  };

  const clearFilters = () => {
    setSourceFilter("all");
    setTypeFilter("");
    setSearchQuery("");
    setSearchInput("");
  };

  const getActivityColor = (type: string, source: string) => {
    if (source === "admin") {
      if (type === "admin_login") return "bg-blue-100 text-blue-700";
      if (type === "wallet_adjustment") return "bg-amber-100 text-amber-700";
      if (type.includes("quote_request")) return "bg-amber-100 text-amber-700";
      if (type.includes("quote")) return "bg-purple-100 text-purple-700";
      if (type.includes("customer")) return "bg-emerald-100 text-emerald-700";
      if (type.includes("pod")) return "bg-orange-100 text-orange-700";
      if (type.includes("admin")) return "bg-red-100 text-red-700";
      return "bg-gray-100 text-gray-600";
    }
    // Customer events
    if (type.includes("gpu") || type.includes("bare_metal")) return "bg-orange-100 text-orange-700";
    if (type.includes("volume")) return "bg-cyan-100 text-cyan-700";
    if (type.includes("payment") || type.includes("wallet") || type.includes("topup") || type.includes("voucher") || type.includes("budget")) return "bg-green-100 text-green-700";
    if (type.includes("api_key") || type.includes("ssh_key")) return "bg-yellow-100 text-yellow-700";
    if (type.includes("team")) return "bg-indigo-100 text-indigo-700";
    if (type.includes("account") || type.includes("login") || type.includes("settings") || type.includes("two_factor")) return "bg-blue-100 text-blue-700";
    if (type.includes("snapshot")) return "bg-violet-100 text-violet-700";
    if (type.includes("lora") || type.includes("batch") || type.includes("inference")) return "bg-pink-100 text-pink-700";
    if (type.includes("hf_")) return "bg-teal-100 text-teal-700";
    return "bg-gray-100 text-gray-600";
  };

  const getSourceBadge = (source: string) => {
    if (source === "admin") return "bg-red-50 text-red-600 border-red-200";
    return "bg-blue-50 text-blue-600 border-blue-200";
  };

  const hasActiveFilters = sourceFilter !== "all" || typeFilter || searchQuery;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-[#0b0f1c]">Platform Activity Log</h2>
        <button
          onClick={fetchActivities}
          className="px-4 py-2 bg-white border border-[#e4e7ef] hover:bg-gray-50 text-[#0b0f1c] rounded-lg text-sm"
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[#e4e7ef] rounded-lg bg-white text-[#0b0f1c]"
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Type filter (grouped) */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[#e4e7ef] rounded-lg bg-white text-[#0b0f1c] min-w-[180px]"
          >
            <option value="">All Event Types</option>
            {Object.entries(TYPE_CATEGORIES).map(([category, types]) => (
              <optgroup key={category} label={category}>
                {types.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search descriptions, actors, IDs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-[#e4e7ef] rounded-lg bg-white text-[#0b0f1c] placeholder:text-[#5b6476]"
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-[#0b0f1c] text-white rounded-lg hover:bg-[#1a1f2e]"
            >
              Search
            </button>
          </form>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg border border-transparent"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="text-xs text-[#5b6476]">
          Showing {data.length} events
          {hasActiveFilters && " (filtered)"}
        </div>
      </div>

      {/* Results */}
      {loading && data.length === 0 ? (
        <div className="text-center py-8 text-[#5b6476]">Loading activities...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-8 text-[#5b6476]">
          {hasActiveFilters ? "No activities match the current filters" : "No activities logged yet"}
        </div>
      ) : (
        <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
          <div className="space-y-0 divide-y divide-[#e4e7ef]">
            {data.map((activity) => {
              const time = new Date(activity.created * 1000);
              const timeAgo = getTimeAgo(time);
              const isQuoteRelated = activity.type.includes("quote");
              const quoteId = activity.metadata?.quoteId as string | undefined;
              const quoteNumber = activity.metadata?.quoteNumber as string | undefined;

              return (
                <div key={activity.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${getSourceBadge(activity.source)}`}>
                          {activity.source}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getActivityColor(activity.type, activity.source)}`}>
                          {activity.type.replace(/_/g, " ")}
                        </span>
                        <span className="text-[#5b6476]">by</span>
                        <span className="text-[#0b0f1c] font-medium truncate max-w-[200px]" title={activity.actor}>
                          {activity.actor}
                        </span>
                      </div>
                      <p className="mt-1 text-[#0b0f1c] text-sm">{activity.description}</p>
                      {isQuoteRelated && quoteId && quoteNumber && (
                        <button
                          onClick={() => {
                            const quote = quotes.find(q => q.id === quoteId);
                            if (quote) {
                              onViewQuote(quote);
                            } else {
                              onSwitchToQuotes();
                            }
                          }}
                          className="mt-1 text-xs text-[#1a4fff] hover:text-[#1238c9] underline"
                        >
                          View Quote {quoteNumber}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-[#5b6476] whitespace-nowrap">
                      {timeAgo}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
