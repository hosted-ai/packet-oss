"use client";

import { useState, useEffect, useCallback } from "react";

interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  status: "sent" | "failed";
  provider: string;
  error: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function EmailLogTab() {
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/email-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setPagination(data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch email logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-[#0b0f1c] mb-1">Email Delivery Log</h2>
        <p className="text-sm text-[#5b6476]">
          Recent email delivery history. Logs are retained for 90 days.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <input
          type="text"
          placeholder="Search by recipient or subject..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c] placeholder-[#5b6476]/50 focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-sm text-[#0b0f1c]"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <button
          onClick={fetchLogs}
          className="px-3 py-2 bg-white border border-[#e4e7ef] hover:bg-zinc-50 rounded-lg text-sm"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4e7ef] bg-zinc-50/50">
              <th className="text-left px-4 py-3 font-medium text-[#5b6476]">Status</th>
              <th className="text-left px-4 py-3 font-medium text-[#5b6476]">To</th>
              <th className="text-left px-4 py-3 font-medium text-[#5b6476]">Subject</th>
              <th className="text-left px-4 py-3 font-medium text-[#5b6476]">Provider</th>
              <th className="text-left px-4 py-3 font-medium text-[#5b6476]">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[#5b6476]">Loading...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[#5b6476]">
                  {search || statusFilter ? "No matching logs found." : "No email logs yet."}
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-[#e4e7ef] last:border-0 hover:bg-zinc-50/50">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                      log.status === "sent"
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}>
                      {log.status === "sent" ? "✓ Sent" : "✗ Failed"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#0b0f1c] font-mono text-xs truncate max-w-48">{log.to}</td>
                  <td className="px-4 py-3 text-[#0b0f1c] truncate max-w-64" title={log.subject}>{log.subject}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[#5b6476] uppercase">{log.provider}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#5b6476] whitespace-nowrap">{formatDate(log.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Error details (shown on hover/click would be nice, but keeping it simple) */}
      {logs.some((l) => l.error) && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-[#0b0f1c]">Failed Deliveries</h3>
          {logs.filter((l) => l.error).map((log) => (
            <div key={log.id} className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs">
              <p className="font-medium text-red-800">{log.to} — {log.subject}</p>
              <p className="text-red-600 mt-1 font-mono">{log.error}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-[#5b6476]">
          <span>
            Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 bg-white border border-[#e4e7ef] rounded text-sm disabled:opacity-50 hover:bg-zinc-50"
            >
              Previous
            </button>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 bg-white border border-[#e4e7ef] rounded text-sm disabled:opacity-50 hover:bg-zinc-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
