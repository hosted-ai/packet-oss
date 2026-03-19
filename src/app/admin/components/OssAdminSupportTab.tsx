"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Inbox,
  Mail,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ─── Types ───

interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  priority: string;
  stripeCustomerId: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── Relative time helper ───

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ─── Component ───

export function OssAdminSupportTab() {
  // Submissions state
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Support email config state
  const [supportEmail, setSupportEmail] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailLoading, setEmailLoading] = useState(true);

  // ─── Fetch submissions ───

  const loadSubmissions = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/contact-submissions?limit=50");
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to load submissions");
        return;
      }
      setSubmissions(data.submissions);
      setPagination(data.pagination);
    } catch {
      setError("Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Fetch support email setting ───

  const loadSupportEmail = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/platform-settings");
      const data = await res.json();
      const val = data.services?.branding?.settings?.SUPPORT_EMAIL || "";
      setSupportEmail(val);
      setEmailDraft(val);
    } catch {
      // Non-critical, leave empty
    } finally {
      setEmailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubmissions();
    loadSupportEmail();
  }, [loadSubmissions, loadSupportEmail]);

  // ─── Save support email ───

  const handleSaveEmail = async () => {
    setEmailSaving(true);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { SUPPORT_EMAIL: emailDraft.trim() } }),
      });
      const data = await res.json();
      if (data.success) {
        setSupportEmail(emailDraft.trim());
        setEmailEditing(false);
        setEmailSaved(true);
        setTimeout(() => setEmailSaved(false), 2000);
      }
    } catch {
      // Silently fail -- the field is still editable
    } finally {
      setEmailSaving(false);
    }
  };

  // ─── Copy email to clipboard ───

  const handleCopyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // ─── Submission count label ───

  const countLabel =
    pagination && pagination.total > 0
      ? `${pagination.total} submission${pagination.total === 1 ? "" : "s"}`
      : "No submissions yet";

  // ─── Priority display ───

  const priorityDot = (priority: string) => {
    const isHigh = priority === "high" || priority === "urgent";
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full inline-block ${
            isHigh ? "bg-orange-500" : "bg-zinc-300"
          }`}
        />
        <span className="capitalize">{priority}</span>
      </span>
    );
  };

  // ─── Row toggle ───

  const toggleRow = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ─── Render ───

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-zinc-900">Support</h2>
        <p className="text-sm text-zinc-500 mt-1">{countLabel}</p>
      </div>

      {/* Support Email Config Card */}
      <div className="bg-white rounded-2xl border border-[var(--line)] p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4 text-teal-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900">Support Email</p>
              <p className="text-xs text-zinc-500">
                Replies to contact submissions will be sent from this address
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {emailLoading ? (
              <div className="h-9 w-48 bg-zinc-100 rounded-lg animate-pulse" />
            ) : emailEditing ? (
              <>
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="support@example.com"
                  className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                />
                <button
                  onClick={handleSaveEmail}
                  disabled={emailSaving || !emailDraft.trim()}
                  className="bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 hover:shadow-sm transition-all"
                >
                  {emailSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEmailEditing(false);
                    setEmailDraft(supportEmail);
                  }}
                  className="border border-zinc-200 text-zinc-700 rounded-xl px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-zinc-700 font-mono">
                  {supportEmail || "Not set"}
                </span>
                <button
                  onClick={() => setEmailEditing(true)}
                  className="border border-zinc-200 text-zinc-700 rounded-xl px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
                >
                  Edit
                </button>
                {emailSaved && (
                  <span className="text-sm text-green-600 font-medium animate-pulse">
                    Saved!
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Submissions */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[var(--line)] p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="h-4 bg-zinc-100 rounded w-40" />
              <div className="h-4 bg-zinc-100 rounded w-56" />
              <div className="h-4 bg-zinc-100 rounded w-16" />
              <div className="h-4 bg-zinc-100 rounded w-20 ml-auto" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-[var(--line)] p-8 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-zinc-700 font-medium mb-1">
            Failed to load submissions
          </p>
          <p className="text-xs text-zinc-500 mb-4">{error}</p>
          <button
            onClick={loadSubmissions}
            className="inline-flex items-center gap-2 border border-zinc-200 text-zinc-700 rounded-xl px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : submissions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[var(--line)] p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center mx-auto mb-4">
            <Inbox className="w-6 h-6 text-zinc-400" />
          </div>
          <p className="text-sm font-medium text-zinc-700 mb-1">
            No contact submissions yet
          </p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            When customers use the contact form, their messages will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1.5fr_100px_100px] gap-4 px-6 py-3 border-b border-[var(--line)] bg-zinc-50/50">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              From
            </span>
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Subject
            </span>
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Priority
            </span>
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide text-right">
              When
            </span>
          </div>

          {/* Rows */}
          {submissions.map((sub) => {
            const isExpanded = expandedId === sub.id;
            return (
              <div key={sub.id}>
                {/* Summary row */}
                <div
                  onClick={() => toggleRow(sub.id)}
                  className={`grid grid-cols-[1fr_1.5fr_100px_100px] gap-4 px-6 py-3.5 border-b border-[var(--line)] hover:bg-zinc-50 cursor-pointer transition-colors items-center ${
                    isExpanded ? "bg-zinc-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                    )}
                    <span className="text-sm text-zinc-900 truncate">
                      {sub.email}
                    </span>
                  </div>
                  <span className="text-sm text-zinc-700 truncate">
                    {sub.subject}
                  </span>
                  <span className="text-sm text-zinc-600">
                    {priorityDot(sub.priority)}
                  </span>
                  <span className="text-sm text-zinc-500 text-right">
                    {formatRelativeTime(sub.createdAt)}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="bg-teal-50/30 border-l-2 border-l-teal-500 px-6 py-5 border-b border-[var(--line)]">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-4 text-sm">
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wide font-medium">
                          From
                        </span>
                        <p className="text-zinc-900 mt-0.5">
                          {sub.name} &lt;{sub.email}&gt;
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wide font-medium">
                          Subject
                        </span>
                        <p className="text-zinc-900 mt-0.5">{sub.subject}</p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wide font-medium">
                          Priority
                        </span>
                        <p className="text-zinc-900 mt-0.5">
                          {priorityDot(sub.priority)}
                        </p>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-xs uppercase tracking-wide font-medium">
                          Submitted
                        </span>
                        <p className="text-zinc-900 mt-0.5">
                          {new Date(sub.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Message */}
                    <div className="mb-5">
                      <span className="text-zinc-500 text-xs uppercase tracking-wide font-medium">
                        Message
                      </span>
                      <div className="mt-1.5 p-4 bg-white rounded-xl border border-zinc-100 text-sm text-zinc-800 whitespace-pre-wrap leading-relaxed">
                        {sub.message}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3">
                      <a
                        href={`mailto:${sub.email}?subject=${encodeURIComponent(
                          `Re: ${sub.subject}`
                        )}&body=${encodeURIComponent(
                          `Hi ${sub.name},\n\nThank you for reaching out.\n\n`
                        )}`}
                        className="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:shadow-sm transition-all"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Reply via Email
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyEmail(sub.email, sub.id);
                        }}
                        className="inline-flex items-center gap-2 border border-zinc-200 text-zinc-700 rounded-xl px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
                      >
                        {copiedId === sub.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Email
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
