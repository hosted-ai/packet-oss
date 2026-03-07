"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  Users,
  Eye,
  DollarSign,
  ArrowRight,
  RefreshCw,
  Globe,
  Target,
  Crown,
  Layers,
  Camera,
  Percent,
  Zap,
  Clock,
} from "lucide-react";

// ─── Types ───

interface OverviewData {
  totalPageViews: number;
  pageViewsToday: number;
  pageViews7d: number;
  pageViews30d: number;
  uniqueSessions30d: number;
  totalLifecycles: number;
  lifecyclesPaid: number;
  lifecyclesChurned: number;
  uniqueVisitors: number;
  convertedVisitors: number;
}

interface RevenueData {
  totalDepositsCents: number;
  totalSpendCents: number;
  avgDepositsCents: number;
  avgSpendCents: number;
  avgGpuHours: number;
}

interface BillingRow {
  billingType: string;
  customers: number;
  totalDeposits: number;
  totalSpend: number;
  avgDeposits: number;
}

interface TopCustomer {
  email: string;
  totalDepositsCents: number;
  totalSpendCents: number;
  depositCount: number;
  gpuHoursTotal: number;
  inferenceTokens: number;
  currentBillingType: string;
  signedUpAt: string;
  firstDepositAt: string | null;
  firstGpuDeployAt: string | null;
  subscribedAt: string | null;
  utmSource: string | null;
}

interface AttributionRow {
  source?: string;
  campaign?: string;
  medium?: string;
  customers: number;
  deposits: number;
  spend: number;
}

interface FunnelStage {
  stage: string;
  count: number;
}

interface TopPage {
  page: string;
  views: number;
}

interface DailyPoint {
  day: string;
  count: number;
}

interface Conversion {
  email: string;
  utmSource: string | null;
  utmCampaign: string | null;
  utmMedium: string | null;
  signedUpAt: string;
  firstDepositAt: string | null;
  firstGpuDeployAt: string | null;
  subscribedAt: string | null;
  totalDepositsCents: number;
  totalSpendCents: number;
  currentBillingType: string;
  landingPage: string | null;
  depositCount: number;
  gpuHoursTotal: number;
}

interface MarketingData {
  overview: OverviewData;
  revenue: RevenueData;
  billingBreakdown: BillingRow[];
  topCustomers: TopCustomer[];
  attribution: {
    utmTrackedCount: number;
    bySource: AttributionRow[];
    byCampaign: AttributionRow[];
    byMedium: AttributionRow[];
  };
  funnel: FunnelStage[];
  topPages: TopPage[];
  trends: {
    dailyPageViews: DailyPoint[];
    dailySignups: DailyPoint[];
  };
  recentConversions: Conversion[];
}

type SubTab = "overview" | "funnel" | "customers" | "revenue" | "attribution" | "traffic" | "linkedin";

const cents = (v: number) => `$${(v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const billingLabel: Record<string, string> = {
  free: "Free",
  hourly: "Hourly",
  monthly: "Monthly",
  prepaid: "Prepaid",
};

const billingColor: Record<string, string> = {
  free: "bg-gray-100 text-gray-600",
  hourly: "bg-blue-100 text-blue-700",
  monthly: "bg-green-100 text-green-700",
  prepaid: "bg-purple-100 text-purple-700",
};

function MiniBar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function MarketingTab() {
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>("overview");
  const [attrView, setAttrView] = useState<"source" | "campaign" | "medium">("source");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/marketing");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Failed to load marketing data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading marketing data...
      </div>
    );
  }

  const { overview, revenue, billingBreakdown, topCustomers, attribution, funnel, topPages, trends, recentConversions } = data;

  const subTabs: { id: SubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "funnel", label: "Funnel", icon: Target },
    { id: "customers", label: "Customers", icon: Users },
    { id: "revenue", label: "Revenue", icon: DollarSign },
    { id: "traffic", label: "Traffic", icon: Eye },
    { id: "attribution", label: "Attribution", icon: Globe },
    { id: "linkedin", label: "LinkedIn", icon: Camera },
  ];

  const funnelMax = funnel[0]?.count || 1;

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {subTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                subTab === t.id
                  ? "bg-white text-[#0b0f1c] shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
        <button
          onClick={load}
          className="ml-2 p-2 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ─── OVERVIEW ─── */}
      {subTab === "overview" && (
        <div className="space-y-6">
          {/* Revenue KPIs */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard icon={DollarSign} label="Total Deposits" value={cents(revenue.totalDepositsCents)} sub={`${overview.lifecyclesPaid} paying customers`} />
            <KpiCard icon={TrendingUp} label="Platform Usage" value={cents(revenue.totalSpendCents)} sub={`Avg ${cents(revenue.avgSpendCents)} per paid customer`} />
            <KpiCard icon={Users} label="Total Signups" value={overview.totalLifecycles.toLocaleString()} sub={`${overview.lifecyclesChurned} churned`} />
            <KpiCard icon={Eye} label="Page Views (30d)" value={overview.pageViews30d.toLocaleString()} sub={`${overview.uniqueSessions30d} unique sessions`} />
          </div>

          {/* Conversion summary */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard
              label="Visit → Signup"
              value={overview.uniqueVisitors > 0 ? `${((overview.totalLifecycles / overview.uniqueVisitors) * 100).toFixed(1)}%` : "–"}
              desc={`${overview.totalLifecycles} signups from ${overview.uniqueVisitors.toLocaleString()} unique visitors`}
            />
            <MetricCard
              label="Signup → Paid"
              value={overview.totalLifecycles > 0 ? `${((overview.lifecyclesPaid / overview.totalLifecycles) * 100).toFixed(1)}%` : "–"}
              desc={`${overview.lifecyclesPaid} of ${overview.totalLifecycles} signups made a deposit`}
            />
            <MetricCard
              label="Avg Revenue per Paid Customer"
              value={cents(revenue.avgDepositsCents)}
              desc={`Avg GPU hours: ${revenue.avgGpuHours}`}
            />
            <MetricCard
              label="Churn Rate"
              value={overview.lifecyclesPaid > 0 ? `${((overview.lifecyclesChurned / overview.lifecyclesPaid) * 100).toFixed(1)}%` : "–"}
              desc={`${overview.lifecyclesChurned} of ${overview.lifecyclesPaid} paid customers churned`}
            />
          </div>

          {/* Billing type breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Customers by Billing Type</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {billingBreakdown.map((row) => (
                <div key={row.billingType} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${billingColor[row.billingType] || "bg-gray-100 text-gray-600"}`}>
                      {billingLabel[row.billingType] || row.billingType}
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-[#0b0f1c]">{row.customers}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {row.totalDeposits > 0 ? `${cents(row.totalDeposits)} deposited` : "No deposits"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Quick funnel */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Conversion Funnel</h3>
            <div className="flex items-center gap-2">
              {funnel.map((stage, i) => {
                const pct = funnelMax > 0 ? (stage.count / funnelMax) * 100 : 0;
                return (
                  <div key={stage.stage} className="flex items-center gap-2">
                    <div className="text-center">
                      <p className="text-lg font-bold text-[#0b0f1c]">{stage.count}</p>
                      <p className="text-[10px] text-gray-500 max-w-[80px] leading-tight">{stage.stage}</p>
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                    </div>
                    {i < funnel.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── FUNNEL ─── */}
      {subTab === "funnel" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-6">Customer Lifecycle Funnel</h3>
            <div className="space-y-3">
              {funnel.map((stage, i) => {
                const pct = funnelMax > 0 ? (stage.count / funnelMax) * 100 : 0;
                const prevCount = i > 0 ? funnel[i - 1].count : stage.count;
                const dropoff = prevCount > 0 ? ((prevCount - stage.count) / prevCount) * 100 : 0;
                const convRate = prevCount > 0 ? ((stage.count / prevCount) * 100) : 100;
                return (
                  <div key={stage.stage}>
                    <div className="flex items-center gap-4 mb-1">
                      <span className="w-44 text-sm font-medium text-gray-700">{stage.stage}</span>
                      <div className="flex-1 h-8 bg-gray-100 rounded-md overflow-hidden relative">
                        <div
                          className="h-full bg-blue-500 rounded-md transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-800">
                          {stage.count.toLocaleString()}
                        </span>
                      </div>
                      <span className="w-16 text-xs text-right text-gray-500">{pct.toFixed(1)}%</span>
                      {i > 0 && (
                        <span className={`w-24 text-xs text-right ${dropoff > 50 ? "text-red-500" : "text-gray-400"}`}>
                          {convRate.toFixed(0)}% conv
                        </span>
                      )}
                    </div>
                    {i < funnel.length - 1 && (
                      <div className="flex items-center ml-44 pl-4 py-0.5">
                        <ArrowRight className="w-3 h-3 text-gray-300 mr-1" />
                        <span className="text-xs text-gray-400">
                          {dropoff > 0 ? `${dropoff.toFixed(0)}% drop-off` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── CUSTOMERS ─── */}
      {subTab === "customers" && (
        <div className="space-y-6">
          {/* Top customers by revenue */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-900">Top Customers by Revenue</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">#</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Billing</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Deposits</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Spend</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right"># Topups</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">GPU Hours</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Milestones</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((c, i) => (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${billingColor[c.currentBillingType] || "bg-gray-100 text-gray-600"}`}>
                          {billingLabel[c.currentBillingType] || c.currentBillingType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{c.totalDepositsCents > 0 ? cents(c.totalDepositsCents) : "–"}</td>
                      <td className="px-4 py-3 text-right">{c.totalSpendCents > 0 ? cents(c.totalSpendCents) : "–"}</td>
                      <td className="px-4 py-3 text-right">{c.depositCount || "–"}</td>
                      <td className="px-4 py-3 text-right">{c.gpuHoursTotal > 0 ? c.gpuHoursTotal.toFixed(1) : "–"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {c.firstDepositAt && <span className="w-2 h-2 rounded-full bg-green-400" title="Deposited" />}
                          {c.firstGpuDeployAt && <span className="w-2 h-2 rounded-full bg-blue-400" title="Deployed" />}
                          {c.subscribedAt && <span className="w-2 h-2 rounded-full bg-purple-400" title="Subscribed" />}
                          {!c.firstDepositAt && <span className="text-xs text-gray-400">free</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.utmSource || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent signups */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Recent Signups</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Billing</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 font-medium text-gray-600 text-right">Deposits</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Source</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Signed Up</th>
                  </tr>
                </thead>
                <tbody>
                  {recentConversions.map((c, i) => {
                    const status = c.subscribedAt
                      ? "subscribed"
                      : c.firstGpuDeployAt
                      ? "deployed"
                      : c.firstDepositAt
                      ? "deposited"
                      : "free";
                    const statusColors: Record<string, string> = {
                      subscribed: "bg-purple-100 text-purple-700",
                      deployed: "bg-green-100 text-green-700",
                      deposited: "bg-blue-100 text-blue-700",
                      free: "bg-gray-100 text-gray-600",
                    };
                    return (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{c.email}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${billingColor[c.currentBillingType] || "bg-gray-100 text-gray-600"}`}>
                            {billingLabel[c.currentBillingType] || c.currentBillingType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[status]}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{c.totalDepositsCents > 0 ? cents(c.totalDepositsCents) : "–"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{c.utmSource || "–"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(c.signedUpAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── REVENUE ─── */}
      {subTab === "revenue" && (
        <div className="space-y-6">
          {/* Revenue KPIs */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard icon={DollarSign} label="Lifetime Deposits" value={cents(revenue.totalDepositsCents)} />
            <KpiCard icon={TrendingUp} label="Lifetime Usage" value={cents(revenue.totalSpendCents)} />
            <KpiCard icon={Users} label="Avg per Paid Customer" value={cents(revenue.avgDepositsCents)} sub={`${overview.lifecyclesPaid} paying customers`} />
            <KpiCard icon={BarChart3} label="Avg GPU Hours (paid)" value={`${revenue.avgGpuHours}h`} />
          </div>

          {/* By billing type */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Revenue by Billing Type</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Billing Type</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Customers</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Total Deposits</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Usage</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Avg Deposits</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Share</th>
                </tr>
              </thead>
              <tbody>
                {billingBreakdown.map((row) => {
                  const maxDep = Math.max(...billingBreakdown.map((r) => r.totalDeposits), 1);
                  return (
                    <tr key={row.billingType} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${billingColor[row.billingType] || "bg-gray-100 text-gray-600"}`}>
                          {billingLabel[row.billingType] || row.billingType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{row.customers}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{cents(row.totalDeposits)}</td>
                      <td className="px-4 py-3 text-right">{cents(row.totalSpend)}</td>
                      <td className="px-4 py-3 text-right">{cents(row.avgDeposits)}</td>
                      <td className="px-4 py-3">
                        <MiniBar value={row.totalDeposits} max={maxDep} color="bg-green-500" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── TRAFFIC ─── */}
      {subTab === "traffic" && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <KpiCard icon={Eye} label="Total Page Views" value={overview.totalPageViews.toLocaleString()} />
            <KpiCard icon={Eye} label="Today" value={overview.pageViewsToday.toLocaleString()} />
            <KpiCard icon={Eye} label="Last 7 Days" value={overview.pageViews7d.toLocaleString()} />
            <KpiCard icon={Users} label="Unique Sessions (30d)" value={overview.uniqueSessions30d.toLocaleString()} />
          </div>

          <TrendChart
            title="Daily Page Views (30d)"
            data={trends.dailyPageViews}
            color="#3b82f6"
          />

          <TrendChart
            title="Daily Signups (30d)"
            data={trends.dailySignups}
            color="#10b981"
          />

          {/* Top pages */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Top Pages (30d)</h3>
            <div className="space-y-2">
              {topPages.slice(0, 10).map((p, i) => {
                const maxViews = topPages[0]?.views || 1;
                return (
                  <div key={i} className="flex items-center gap-4 text-sm">
                    <span className="w-5 text-gray-400 text-right">{i + 1}</span>
                    <span className="flex-1 font-mono text-gray-700 truncate">{p.page}</span>
                    <MiniBar value={p.views} max={maxViews} />
                    <span className="w-16 text-right text-gray-600">{p.views.toLocaleString()}</span>
                  </div>
                );
              })}
              {topPages.length === 0 && (
                <p className="text-gray-400 text-sm py-4 text-center">No page view data yet. Views will appear as visitors browse the site.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── ATTRIBUTION ─── */}
      {subTab === "attribution" && (
        <div className="space-y-4">
          {attribution.utmTrackedCount === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              No customers have UTM attribution yet. UTM tracking was recently enabled — data will populate as new customers sign up through tracked links
              (e.g. <code className="bg-amber-100 px-1 rounded">the platform/?utm_source=google&utm_medium=cpc</code>).
            </div>
          )}
          {attribution.utmTrackedCount > 0 && attribution.utmTrackedCount < overview.totalLifecycles && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
              {attribution.utmTrackedCount} of {overview.totalLifecycles} customers have UTM attribution. Historical customers show as &quot;(direct)&quot; since tracking was added after their signup.
            </div>
          )}

          <div className="flex gap-2">
            {(["source", "campaign", "medium"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setAttrView(v)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  attrView === v ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                By {v}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">{attrView === "source" ? "Source" : attrView === "campaign" ? "Campaign" : "Medium"}</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Customers</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Total Deposits</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Usage</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {(attrView === "source"
                  ? attribution.bySource
                  : attrView === "campaign"
                  ? attribution.byCampaign
                  : attribution.byMedium
                ).map((row, i) => {
                  const label = (row as AttributionRow).source || (row as AttributionRow).campaign || (row as AttributionRow).medium || "(none)";
                  const avgLtv = row.customers > 0 ? row.deposits / row.customers : 0;
                  return (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{label}</td>
                      <td className="px-4 py-3 text-right">{row.customers}</td>
                      <td className="px-4 py-3 text-right text-green-700">{cents(row.deposits)}</td>
                      <td className="px-4 py-3 text-right">{cents(row.spend)}</td>
                      <td className="px-4 py-3 text-right font-medium">{cents(avgLtv)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── LINKEDIN SCREENSHOT ─── */}
      {subTab === "linkedin" && (
        <LinkedInScreenshot
          overview={overview}
          revenue={revenue}
          funnel={funnel}
          billingBreakdown={billingBreakdown}
        />
      )}
    </div>
  );
}

// ─── LinkedIn Screenshot Component ───

function LinkedInScreenshot({
  overview,
  revenue,
  funnel,
  billingBreakdown,
}: {
  overview: OverviewData;
  revenue: RevenueData;
  funnel: FunnelStage[];
  billingBreakdown: BillingRow[];
}) {
  const visitToSignup = overview.uniqueVisitors > 0
    ? ((overview.totalLifecycles / overview.uniqueVisitors) * 100)
    : 0;
  const signupToPaid = overview.totalLifecycles > 0
    ? ((overview.lifecyclesPaid / overview.totalLifecycles) * 100)
    : 0;
  const visitToPaid = overview.uniqueVisitors > 0
    ? ((overview.lifecyclesPaid / overview.uniqueVisitors) * 100)
    : 0;
  const churnRate = overview.lifecyclesPaid > 0
    ? ((overview.lifecyclesChurned / overview.lifecyclesPaid) * 100)
    : 0;
  const retentionRate = 100 - churnRate;

  const arpu = revenue.avgDepositsCents;
  const avgGpuHours = revenue.avgGpuHours;

  // Billing mix as percentages
  const totalCustomers = billingBreakdown.reduce((s, r) => s + r.customers, 0);
  const billingMix = billingBreakdown
    .filter((r) => r.customers > 0)
    .map((r) => ({
      type: billingLabel[r.billingType] || r.billingType,
      pct: totalCustomers > 0 ? (r.customers / totalCustomers) * 100 : 0,
      color: billingColor[r.billingType] || "bg-gray-100 text-gray-600",
    }))
    .sort((a, b) => b.pct - a.pct);

  // Funnel as stage-to-stage conversion percentages
  const funnelRates = funnel.map((stage, i) => {
    const prevCount = i > 0 ? funnel[i - 1].count : stage.count;
    const rate = prevCount > 0 ? (stage.count / prevCount) * 100 : 100;
    const fromTop = funnel[0]?.count > 0 ? (stage.count / funnel[0].count) * 100 : 100;
    return { stage: stage.stage, rate, fromTop };
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">Screenshot-ready view. No absolute revenue or customer counts shown.</p>

      {/* Main screenshot card */}
      <div className="bg-[#0b0f1c] rounded-2xl p-8 max-w-3xl" id="linkedin-screenshot">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-[#1a4fff] flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-white text-lg font-bold tracking-tight">GPU Cloud Platform Metrics</h2>
            <p className="text-gray-500 text-xs">GPU Cloud Infrastructure</p>
          </div>
        </div>

        {/* Conversion Funnel Rates */}
        <div className="mb-8">
          <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Conversion Funnel</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-gray-400 text-xs">Visit &rarr; Signup</span>
              </div>
              <p className="text-3xl font-bold text-white">{visitToSignup.toFixed(1)}%</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-gray-400 text-xs">Signup &rarr; Paid</span>
              </div>
              <p className="text-3xl font-bold text-white">{signupToPaid.toFixed(1)}%</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-gray-400 text-xs">Visit &rarr; Paid</span>
              </div>
              <p className="text-3xl font-bold text-white">{visitToPaid.toFixed(1)}%</p>
            </div>
          </div>
        </div>

        {/* Unit Economics */}
        <div className="mb-8">
          <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Unit Economics</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-gray-400 text-xs">ARPU</span>
              </div>
              <p className="text-3xl font-bold text-white">{cents(arpu)}</p>
              <p className="text-gray-500 text-xs mt-1">per paid customer</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-gray-400 text-xs">Avg GPU Hours</span>
              </div>
              <p className="text-3xl font-bold text-white">{avgGpuHours > 0 ? `${avgGpuHours}h` : "–"}</p>
              <p className="text-gray-500 text-xs mt-1">per paid customer</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-gray-400 text-xs">Retention Rate</span>
              </div>
              <p className="text-3xl font-bold text-white">{retentionRate.toFixed(1)}%</p>
              <p className="text-gray-500 text-xs mt-1">{churnRate.toFixed(1)}% churn</p>
            </div>
          </div>
        </div>

        {/* Lifecycle Funnel (percentages only) */}
        {funnelRates.length > 0 && (
          <div className="mb-8">
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Lifecycle Stages</h3>
            <div className="space-y-2">
              {funnelRates.map((stage, i) => (
                <div key={stage.stage} className="flex items-center gap-3">
                  <span className="w-36 text-xs text-gray-400 text-right truncate">{stage.stage}</span>
                  <div className="flex-1 h-6 bg-white/5 rounded-md overflow-hidden relative">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{
                        width: `${Math.max(stage.fromTop, 2)}%`,
                        backgroundColor: i === 0 ? "#3b82f6" : i === funnelRates.length - 1 ? "#8b5cf6" : "#6366f1",
                      }}
                    />
                  </div>
                  <span className="w-14 text-xs text-gray-300 text-right">{stage.fromTop.toFixed(1)}%</span>
                  {i > 0 && (
                    <span className="w-20 text-xs text-gray-500 text-right">
                      {stage.rate.toFixed(0)}% conv
                    </span>
                  )}
                  {i === 0 && <span className="w-20" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer Mix */}
        {billingMix.length > 0 && (
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Customer Mix</h3>
            <div className="flex gap-2 items-end h-20">
              {billingMix.map((b) => (
                <div key={b.type} className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-white text-sm font-bold">{b.pct.toFixed(0)}%</span>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400"
                    style={{ height: `${Math.max(b.pct, 4)}%` }}
                  />
                  <span className="text-gray-500 text-[10px]">{b.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-400" />
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[#0b0f1c]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function MetricCard({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <p className="text-3xl font-bold text-[#0b0f1c]">{value}</p>
      <p className="text-xs text-gray-400 mt-2">{desc}</p>
    </div>
  );
}

function TrendChart({
  title,
  data,
  color,
}: {
  title: string;
  data: DailyPoint[];
  color: string;
}) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
        <p className="text-gray-400 text-sm py-8 text-center">No data yet</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">Total: {total.toLocaleString()}</span>
      </div>
      <div className="flex items-end gap-[2px] h-32">
        {data.map((d, i) => {
          const height = max > 0 ? (d.count / max) * 100 : 0;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all hover:opacity-80 group relative"
              style={{ height: `${Math.max(height, 2)}%`, backgroundColor: color }}
              title={`${d.day}: ${d.count}`}
            >
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                {d.day.slice(5)}: {d.count}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-gray-400">
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data[data.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}
