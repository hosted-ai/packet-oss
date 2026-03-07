"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Search,
  MessageSquare,
  CheckCircle,
  Clock,
  AlertCircle,
  Send,
  ExternalLink,
  User,
  Loader2,
  ChevronLeft,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  BarChart3,
  Inbox,
} from "lucide-react";

// ─── Stats Types ───

interface SupportStatsData {
  overview: {
    total: number;
    periodTotal: number;
    open: number;
    closed: number;
    needsReply: number;
    avgFirstResponseMin: number;
    avgFirstResponseFormatted: string;
    avgResolutionMin: number;
    avgResolutionFormatted: string;
    firstContactResolutionPct: number;
  };
  volumeByDay: { day: string; created: number; closed: number }[];
  responseTimeBuckets: {
    firstResponse: Record<string, number>;
    resolution: Record<string, number>;
  };
  statusBreakdown: { status: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  topCustomers: { email: string; name: string; ticketCount: number }[];
  recentTickets: {
    number: string;
    title: string;
    customer: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

type SupportSubTab = "tickets" | "stats";
type StatsPeriod = "7" | "30" | "90" | "all";

import DOMPurify from "isomorphic-dompurify";

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

interface SupportTicket {
  id: number;
  number: string;
  title: string;
  status: string;
  priority: string;
  customerId: number;
  customerEmail?: string;
  customerName?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
  hasUnreadCustomerReply: boolean;
  isClosed?: boolean;
}

interface TicketMessage {
  id: number;
  content: string;
  sender: string;
  senderName?: string;
  isFromCustomer: boolean;
  isInternal: boolean;
  createdAt: string;
}

interface TicketDetail {
  id: number;
  number: string;
  title: string;
  status: string;
  priority: string;
  customerId: number;
  customerEmail?: string;
  customerName?: string;
  stripeCustomerId?: string;
  createdAt: string;
  updatedAt: string;
  isClosed: boolean;
}

// ─── Stats Dashboard Component ───

function StatsView() {
  const [stats, setStats] = useState<SupportStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<StatsPeriod>("30");

  const loadStats = async (p: StatsPeriod) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/support/stats?period=${p}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
    } catch (e) {
      console.error("Failed to load stats:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats(period);
  }, [period]);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading support stats...
      </div>
    );
  }

  const { overview, volumeByDay, responseTimeBuckets, statusBreakdown, priorityBreakdown, topCustomers, recentTickets } = stats;

  // Volume chart max for scaling
  const volumeMax = Math.max(...volumeByDay.map((d) => Math.max(d.created, d.closed)), 1);

  // Response bucket max
  const frBuckets = Object.entries(responseTimeBuckets.firstResponse);
  const resBuckets = Object.entries(responseTimeBuckets.resolution);
  const frMax = Math.max(...frBuckets.map(([, v]) => v), 1);
  const resMax = Math.max(...resBuckets.map(([, v]) => v), 1);

  // Status total for percentages
  const statusTotal = statusBreakdown.reduce((s, b) => s + b.count, 0) || 1;
  const priorityTotal = priorityBreakdown.reduce((s, b) => s + b.count, 0) || 1;

  const statusColors: Record<string, string> = {
    new: "bg-green-500",
    open: "bg-blue-500",
    "pending reminder": "bg-yellow-500",
    "pending close": "bg-orange-500",
    closed: "bg-gray-400",
    merged: "bg-purple-400",
  };

  const priorityColors: Record<string, string> = {
    low: "bg-gray-400",
    normal: "bg-blue-500",
    high: "bg-red-500",
  };

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      new: "bg-green-100 text-green-700",
      open: "bg-blue-100 text-blue-700",
      closed: "bg-gray-100 text-gray-600",
      "pending reminder": "bg-yellow-100 text-yellow-700",
      "pending close": "bg-orange-100 text-orange-700",
    };
    return classes[status] || "bg-gray-100 text-gray-600";
  };

  const getPriorityBadge = (priority: string) => {
    const classes: Record<string, string> = {
      low: "bg-gray-100 text-gray-600",
      normal: "bg-blue-100 text-blue-700",
      high: "bg-red-100 text-red-700",
    };
    return classes[priority] || "bg-gray-100 text-gray-600";
  };

  const formatRelativeDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Period filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["7", "30", "90", "all"] as StatsPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === p
                  ? "bg-[#0b0f1c] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {p === "all" ? "All time" : `Last ${p}d`}
            </button>
          ))}
        </div>
        <button
          onClick={() => loadStats(period)}
          className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Tickets</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{overview.total}</p>
          {period !== "all" && (
            <p className="text-xs text-gray-400 mt-1">{overview.periodTotal} in period</p>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Open</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{overview.open}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Needs Reply</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{overview.needsReply}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg First Response</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{overview.avgFirstResponseFormatted || "—"}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Resolution</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{overview.avgResolutionFormatted || "—"}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">First Contact Res.</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{overview.firstContactResolutionPct}%</p>
        </div>
      </div>

      {/* Volume Chart */}
      {volumeByDay.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Ticket Volume</h3>
          <div className="flex items-end gap-1 h-40">
            {volumeByDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5 group relative min-w-0">
                {/* Created bar */}
                <div
                  className="w-full bg-blue-400 rounded-t-sm transition-all hover:bg-blue-500 min-h-[2px]"
                  style={{ height: `${Math.max((d.created / volumeMax) * 100, 2)}%` }}
                />
                {/* Closed bar */}
                <div
                  className="w-full bg-gray-300 rounded-t-sm transition-all hover:bg-gray-400 min-h-[1px]"
                  style={{ height: `${Math.max((d.closed / volumeMax) * 100, 1)}%` }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    {d.day}: {d.created} created, {d.closed} closed
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-400" /> Created</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-300" /> Closed</span>
          </div>
        </div>
      )}

      {/* Two-column: Response Time Distribution + Status/Priority */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Response Time Distribution */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">First Response Time</h3>
          <div className="space-y-2">
            {frBuckets.map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-12 text-right">{bucket}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(count / frMax) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-700 w-8">{count}</span>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-gray-900 mt-6 mb-4">Resolution Time</h3>
          <div className="space-y-2">
            {resBuckets.map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-12 text-right">{bucket}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${(count / resMax) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-700 w-8">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status & Priority Breakdowns */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Status Breakdown</h3>
            {/* Stacked bar */}
            <div className="flex h-6 rounded-full overflow-hidden mb-3">
              {statusBreakdown.map((s) => (
                <div
                  key={s.status}
                  className={`${statusColors[s.status] || "bg-gray-300"} transition-all`}
                  style={{ width: `${(s.count / statusTotal) * 100}%` }}
                  title={`${s.status}: ${s.count}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {statusBreakdown.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${statusColors[s.status] || "bg-gray-300"}`} />
                    <span className="text-gray-700 capitalize">{s.status}</span>
                  </span>
                  <span className="font-medium text-gray-900">{s.count} <span className="text-gray-400 font-normal">({Math.round((s.count / statusTotal) * 100)}%)</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Priority Breakdown</h3>
            <div className="flex h-6 rounded-full overflow-hidden mb-3">
              {priorityBreakdown.map((p) => (
                <div
                  key={p.priority}
                  className={`${priorityColors[p.priority] || "bg-gray-300"} transition-all`}
                  style={{ width: `${(p.count / priorityTotal) * 100}%` }}
                  title={`${p.priority}: ${p.count}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {priorityBreakdown.map((p) => (
                <div key={p.priority} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${priorityColors[p.priority] || "bg-gray-300"}`} />
                    <span className="text-gray-700 capitalize">{p.priority}</span>
                  </span>
                  <span className="font-medium text-gray-900">{p.count} <span className="text-gray-400 font-normal">({Math.round((p.count / priorityTotal) * 100)}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Two-column: Top Customers + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Customers */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Busiest Customers</h3>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-gray-400">No data</p>
          ) : (
            <div className="space-y-2">
              {topCustomers.map((c, i) => (
                <div key={c.email} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-gray-400 w-5 shrink-0">{i + 1}.</span>
                    <span className="text-sm text-gray-700 truncate">{c.name || c.email}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 ml-2 shrink-0">{c.ticketCount} tickets</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Activity</h3>
          {recentTickets.length === 0 ? (
            <p className="text-sm text-gray-400">No recent tickets</p>
          ) : (
            <div className="space-y-3">
              {recentTickets.map((t) => (
                <div key={t.number} className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{t.number}</code>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getStatusBadge(t.status)}`}>
                        {t.status}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${getPriorityBadge(t.priority)}`}>
                        {t.priority}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5 truncate">{t.title}</p>
                    <p className="text-xs text-gray-400">{t.customer}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{formatRelativeDate(t.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main SupportTab ───

interface SupportTabProps {
  onOpenCustomer?: (stripeCustomerId: string) => void;
}

export function SupportTab({ onOpenCustomer }: SupportTabProps) {
  const [subTab, setSubTab] = useState<SupportSubTab>("tickets");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [needsReplyCount, setNeedsReplyCount] = useState(0);

  // Selected ticket state
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [ticketLoading, setTicketLoading] = useState(false);

  // Reply state
  const [replyMessage, setReplyMessage] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loginAsLoading, setLoginAsLoading] = useState(false);
  const [customerLookupLoading, setCustomerLookupLoading] = useState<string | null>(null);

  const handleOpenCustomer = async (email: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!email || !onOpenCustomer) return;
    setCustomerLookupLoading(email);
    try {
      const res = await fetch(`/api/admin/customers?search=${encodeURIComponent(email)}&limit=1`);
      const data = await res.json();
      const customer = data.customers?.find(
        (c: { email: string }) => c.email.toLowerCase() === email.toLowerCase()
      );
      if (customer?.id) {
        onOpenCustomer(customer.id);
      } else {
        alert("Customer not found in Stripe");
      }
    } catch {
      alert("Failed to look up customer");
    } finally {
      setCustomerLookupLoading(null);
    }
  };

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") {
        params.set("state", statusFilter);
      }
      const res = await fetch(`/api/admin/support?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setTickets(data.tickets || []);
      setNeedsReplyCount(data.needsReplyCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadTicketDetails = async (ticketId: number) => {
    setTicketLoading(true);
    try {
      const res = await fetch(`/api/admin/support/${ticketId}`);
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setSelectedTicket(data.ticket);
      setMessages(data.messages || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setTicketLoading(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || !selectedTicket) return;

    setSending(true);
    try {
      const res = await fetch(`/api/admin/support/${selectedTicket.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyMessage.trim(),
          internal: isInternal,
        }),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      // Add new message to list
      setMessages((prev) => [...prev, data.message]);
      setReplyMessage("");
      // Reload tickets to update list
      loadTickets();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleTicketAction = async (action: "close" | "reopen") => {
    if (!selectedTicket) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/support/${selectedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      // Update selected ticket
      setSelectedTicket((prev) =>
        prev ? { ...prev, isClosed: action === "close", status: action === "close" ? "closed" : "open" } : null
      );
      // Reload tickets
      loadTickets();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update ticket");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLoginAs = async () => {
    if (!selectedTicket?.stripeCustomerId) return;
    setLoginAsLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${selectedTicket.stripeCustomerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-as" }),
      });
      const result = await res.json();
      if (res.ok && result.url) {
        window.open(result.url, "_blank");
      } else {
        alert(result.error || "Failed to generate login link");
      }
    } catch {
      alert("Failed to generate login link");
    } finally {
      setLoginAsLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      search === "" ||
      ticket.number.toLowerCase().includes(search.toLowerCase()) ||
      ticket.title.toLowerCase().includes(search.toLowerCase()) ||
      ticket.customerEmail?.toLowerCase().includes(search.toLowerCase()) ||
      ticket.customerName?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const getStatusIcon = (status: string, hasUnread: boolean) => {
    if (hasUnread) {
      return <AlertCircle className="w-4 h-4 text-orange-500" />;
    }
    switch (status) {
      case "closed":
        return <CheckCircle className="w-4 h-4 text-gray-400" />;
      case "open":
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      case "new":
        return <AlertCircle className="w-4 h-4 text-green-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "closed":
        return "bg-gray-100 text-gray-600";
      case "open":
        return "bg-blue-100 text-blue-700";
      case "new":
        return "bg-green-100 text-green-700";
      default:
        return "bg-yellow-100 text-yellow-700";
    }
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-700";
      case "low":
        return "bg-gray-100 text-gray-600";
      default:
        return "bg-blue-100 text-blue-700";
    }
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    }
    return d.toLocaleDateString();
  };

  const formatFullDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  // Sub-tab toggle (always rendered at top)
  const subTabNav = (
    <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
      {([
        { id: "tickets" as SupportSubTab, label: "Tickets", icon: Inbox },
        { id: "stats" as SupportSubTab, label: "Stats", icon: BarChart3 },
      ]).map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); if (t.id === "tickets") setSelectedTicket(null); }}
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
    </div>
  );

  // Stats view
  if (subTab === "stats") {
    return (
      <div>
        {subTabNav}
        <StatsView />
      </div>
    );
  }

  if (loading && tickets.length === 0) {
    return (
      <div>
        {subTabNav}
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {subTabNav}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading support tickets</p>
          <p className="text-sm">{error}</p>
          <button onClick={loadTickets} className="mt-2 text-sm underline hover:no-underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Ticket detail view
  if (selectedTicket) {
    return (
      <div className="space-y-4">
        {subTabNav}
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedTicket(null)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="w-5 h-5" />
            Back to tickets
          </button>
          <div className="flex items-center gap-2">
            {selectedTicket.isClosed ? (
              <button
                onClick={() => handleTicketAction("reopen")}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
                Reopen Ticket
              </button>
            ) : (
              <button
                onClick={() => handleTicketAction("close")}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Close Ticket
              </button>
            )}
          </div>
        </div>

        {/* Ticket Info */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">{selectedTicket.number}</span>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusBadgeClass(selectedTicket.status)}`}>
                  {selectedTicket.status}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${getPriorityBadgeClass(selectedTicket.priority)}`}>
                  {selectedTicket.priority}
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mt-2">{selectedTicket.title}</h2>
            </div>
            <div className="text-right text-sm text-gray-500">
              <p>Created: {formatFullDate(selectedTicket.createdAt)}</p>
              <p>Updated: {formatFullDate(selectedTicket.updatedAt)}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <User className="w-4 h-4" />
            {onOpenCustomer && selectedTicket.stripeCustomerId ? (
              <button
                onClick={() => onOpenCustomer(selectedTicket.stripeCustomerId!)}
                className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
              >
                {selectedTicket.customerName || "Unknown"}
              </button>
            ) : onOpenCustomer && selectedTicket.customerEmail ? (
              <button
                onClick={(e) => handleOpenCustomer(selectedTicket.customerEmail, e)}
                disabled={customerLookupLoading === selectedTicket.customerEmail}
                className="font-medium text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
              >
                {customerLookupLoading === selectedTicket.customerEmail
                  ? "Loading..."
                  : selectedTicket.customerName || "Unknown"}
              </button>
            ) : (
              <span className="font-medium">{selectedTicket.customerName || "Unknown"}</span>
            )}
            {selectedTicket.customerEmail && (
              <a href={`mailto:${selectedTicket.customerEmail}`} className="text-blue-500 hover:underline">
                {selectedTicket.customerEmail}
              </a>
            )}
            {selectedTicket.stripeCustomerId && (
              <>
                <span className="text-gray-300">|</span>
                <button
                  onClick={handleLoginAs}
                  disabled={loginAsLoading}
                  className="text-emerald-600 hover:text-emerald-700 hover:underline disabled:opacity-50"
                >
                  {loginAsLoading ? "Generating..." : "Login as customer"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Conversation</h3>
          </div>
          <div className="max-h-[400px] overflow-y-auto p-4 space-y-4">
            {ticketLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : messages.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No messages yet</p>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isFromCustomer ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg p-3 ${
                      msg.isFromCustomer
                        ? "bg-gray-100 text-gray-900"
                        : msg.isInternal
                        ? "bg-yellow-50 border border-yellow-200 text-gray-900"
                        : "bg-blue-500 text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium ${msg.isFromCustomer ? "text-gray-600" : msg.isInternal ? "text-yellow-700" : "text-blue-100"}`}>
                        {msg.isFromCustomer ? "Customer" : "Agent"}
                        {msg.isInternal && (
                          <span className="ml-2 inline-flex items-center gap-1">
                            <EyeOff className="w-3 h-3" /> Internal
                          </span>
                        )}
                      </span>
                      <span className={`text-xs ${msg.isFromCustomer ? "text-gray-400" : msg.isInternal ? "text-yellow-600" : "text-blue-200"}`}>
                        {formatFullDate(msg.createdAt)}
                      </span>
                    </div>
                    <div
                      className="text-sm whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.content) }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Reply Form */}
          {!selectedTicket.isClosed && (
            <form onSubmit={handleSendReply} className="p-4 border-t border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setIsInternal(!isInternal)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                    isInternal ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {isInternal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {isInternal ? "Internal note" : "Public reply"}
                </button>
                {isInternal && (
                  <span className="text-xs text-yellow-600">This note is only visible to agents</span>
                )}
              </div>
              <div className="flex gap-2">
                <textarea
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder={isInternal ? "Write an internal note..." : "Write a reply..."}
                  rows={3}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={!replyMessage.trim() || sending}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed self-end"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Tickets list view
  return (
    <div className="space-y-6">
      {subTabNav}
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total Tickets</p>
          <p className="text-2xl font-bold text-gray-900">{tickets.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Needs Reply</p>
          <p className="text-2xl font-bold text-orange-600">{needsReplyCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Open</p>
          <p className="text-2xl font-bold text-blue-600">
            {tickets.filter((t) => t.status !== "closed").length}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Closed</p>
          <p className="text-2xl font-bold text-gray-600">
            {tickets.filter((t) => t.status === "closed").length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by ticket number, title, or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <button
            onClick={loadTickets}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Ticket</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Priority</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Messages</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Last Update</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No tickets found
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className={`hover:bg-gray-50 cursor-pointer ${
                      ticket.hasUnreadCustomerReply ? "bg-orange-50" : ""
                    }`}
                    onClick={() => loadTicketDetails(ticket.id)}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(ticket.status, ticket.hasUnreadCustomerReply)}
                          <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                            {ticket.number}
                          </code>
                          {ticket.hasUnreadCustomerReply && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                              Needs reply
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1 line-clamp-1">{ticket.title}</p>
                        {ticket.lastMessagePreview && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{ticket.lastMessagePreview}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <div>
                          {onOpenCustomer && ticket.customerEmail ? (
                            <button
                              onClick={(e) => handleOpenCustomer(ticket.customerEmail, e)}
                              disabled={customerLookupLoading === ticket.customerEmail}
                              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50 text-left"
                            >
                              {customerLookupLoading === ticket.customerEmail
                                ? "Loading..."
                                : ticket.customerName || "Unknown"}
                            </button>
                          ) : (
                            <p className="text-sm font-medium text-gray-900">
                              {ticket.customerName || "Unknown"}
                            </p>
                          )}
                          {ticket.customerEmail && (
                            <p className="text-xs text-gray-500">{ticket.customerEmail}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusBadgeClass(
                          ticket.status
                        )}`}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${getPriorityBadgeClass(
                          ticket.priority
                        )}`}
                      >
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{ticket.messageCount}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">
                        {ticket.lastMessageAt ? formatDate(ticket.lastMessageAt) : formatDate(ticket.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => loadTicketDetails(ticket.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
