"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface CustomerDetails {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  created: number;
  metadata: Record<string, string>;
  billingType: string;
  walletBalance: number;
  totalSpent: number;
}

interface BalanceTransaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created: number;
  endingBalance: number;
}

interface Charge {
  id: string;
  amount: number;
  status: string;
  description: string | null;
  created: number;
  paid: boolean;
  refunded: boolean;
  paymentMethod: string | null;
}

interface Invoice {
  id: string;
  number: string | null;
  amount: number;
  status: string | null;
  created: number;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

interface VoucherRedemption {
  id: string;
  voucherCode: string;
  voucherName: string;
  creditCents: number;
  topupCents: number;
  createdAt: string;
}

interface Referral {
  code: string;
  role: string;
  rewardCents: number;
  status: string;
  createdAt: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
  created: number;
}

interface HostedAiTeam {
  id: string;
  name: string;
  suspended?: boolean;
}

interface CustomerData {
  customer: CustomerDetails;
  hostedaiTeam: HostedAiTeam | null;
  balanceTransactions: BalanceTransaction[];
  charges: Charge[];
  invoices: Invoice[];
  voucherRedemptions: VoucherRedemption[];
  referral: Referral | null;
  activityEvents: ActivityEvent[];
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "billing" | "activity" | "support">("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/details`);
      const result = await res.json();
      if (result.success) {
        setData(result);
      } else {
        setError(result.error || "Failed to load customer");
      }
    } catch (err) {
      setError("Failed to load customer details");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (action: string) => {
    if (!confirm(`Are you sure you want to ${action}?`)) return;

    setActionLoading(action);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message || "Action completed");
        fetchData();
      } else {
        alert(result.error || "Action failed");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!data) return;

    const confirmMessage = `Are you sure you want to DELETE "${data.customer.email}"?\n\nThis will:\n- Cancel all subscriptions\n- Delete their hosted.ai team\n- Delete their Stripe customer\n\nThis action cannot be undone!`;
    if (!confirm(confirmMessage)) return;

    const doubleConfirm = prompt(`Type "${data.customer.email}" to confirm deletion:`);
    if (doubleConfirm !== data.customer.email) {
      alert("Email did not match. Deletion cancelled.");
      return;
    }

    setActionLoading("delete");
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "DELETE",
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message || "Customer deleted");
        router.push("/admin?tab=customers");
      } else {
        alert(result.error || "Failed to delete customer");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleLoginAs = async () => {
    setActionLoading("login-as");
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
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
    } finally {
      setActionLoading(null);
    }
  };

  const handleHostedAiLogin = async () => {
    setActionLoading("hostedai-login");
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hostedai-login" }),
      });
      const result = await res.json();
      if (res.ok && result.url) {
        window.open(result.url, "_blank");
      } else {
        alert(result.error || "Failed to generate hosted.ai login");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (timestamp: number | string) => {
    const date = typeof timestamp === "number" ? new Date(timestamp * 1000) : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCents = (cents: number) => {
    return `$${(Math.abs(cents) / 100).toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-[#1a4fff] border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 text-center max-w-md">
          <p className="text-red-500 mb-4">{error || "Customer not found"}</p>
          <Link href="/admin?tab=customers" className="text-[#1a4fff] hover:underline">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  const { customer, hostedaiTeam, balanceTransactions, charges, invoices, voucherRedemptions, referral, activityEvents } = data;

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      {/* Header */}
      <header className="bg-white border-b border-[#e4e7ef] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin?tab=customers" className="text-[#5b6476] hover:text-[#0b0f1c]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-[#0b0f1c]">{customer.name || customer.email}</h1>
              <p className="text-sm text-[#5b6476]">{customer.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLoginAs}
              disabled={actionLoading === "login-as"}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {actionLoading === "login-as" ? "..." : "Login As"}
            </button>
            {hostedaiTeam && (
              <button
                onClick={handleHostedAiLogin}
                disabled={actionLoading === "hostedai-login"}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-50"
              >
                {actionLoading === "hostedai-login" ? "..." : "Hosted.ai"}
              </button>
            )}
            <button
              onClick={() => handleAction("send-credentials")}
              disabled={actionLoading === "send-credentials"}
              className="px-3 py-1.5 bg-[#1a4fff] hover:bg-[#1238c9] text-white text-sm rounded-lg disabled:opacity-50"
            >
              {actionLoading === "send-credentials" ? "..." : "Send Credentials"}
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading === "delete"}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {actionLoading === "delete" ? "..." : "Delete"}
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-[#e4e7ef]">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-6">
            {(["overview", "billing", "activity", "support"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[#1a4fff] text-[#1a4fff]"
                    : "border-transparent text-[#5b6476] hover:text-[#0b0f1c]"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Customer Info */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
              <h2 className="font-semibold text-[#0b0f1c] mb-4">Customer Info</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">ID</dt>
                  <dd className="text-[#0b0f1c] font-mono text-xs">{customer.id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Email</dt>
                  <dd className="text-[#0b0f1c]">{customer.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Name</dt>
                  <dd className="text-[#0b0f1c]">{customer.name || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Phone</dt>
                  <dd className="text-[#0b0f1c]">{customer.phone || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Company</dt>
                  <dd className="text-[#0b0f1c]">{customer.metadata?.company || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Billing Type</dt>
                  <dd className="text-[#0b0f1c] capitalize">{customer.billingType}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#5b6476]">Signed Up</dt>
                  <dd className="text-[#0b0f1c]">{formatDate(customer.created)}</dd>
                </div>
              </dl>
            </div>

            {/* Billing Summary */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
              <h2 className="font-semibold text-[#0b0f1c] mb-4">Billing Summary</h2>
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 rounded-lg">
                  <p className="text-sm text-emerald-600">Wallet Balance</p>
                  <p className="text-2xl font-bold text-emerald-700">{formatCents(customer.walletBalance)}</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-600">Total Spent</p>
                  <p className="text-2xl font-bold text-blue-700">{formatCents(customer.totalSpent)}</p>
                </div>
              </div>
            </div>

            {/* Hosted.ai Team */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
              <h2 className="font-semibold text-[#0b0f1c] mb-4">Hosted.ai Team</h2>
              {hostedaiTeam ? (
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-[#5b6476]">Team ID</dt>
                    <dd className="text-[#0b0f1c] font-mono text-xs">{hostedaiTeam.id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#5b6476]">Team Name</dt>
                    <dd className="text-[#0b0f1c]">{hostedaiTeam.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#5b6476]">Status</dt>
                    <dd>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        hostedaiTeam.suspended
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}>
                        {hostedaiTeam.suspended ? "Suspended" : "Active"}
                      </span>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-[#5b6476]">No hosted.ai team linked</p>
              )}

              {/* Referral Info */}
              {referral && (
                <div className="mt-6 pt-6 border-t border-[#e4e7ef]">
                  <h3 className="font-medium text-[#0b0f1c] mb-3">Referral</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-[#5b6476]">Role</dt>
                      <dd className="text-[#0b0f1c] capitalize">{referral.role}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#5b6476]">Code</dt>
                      <dd className="text-[#0b0f1c] font-mono">{referral.code}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-[#5b6476]">Reward</dt>
                      <dd className="text-[#0b0f1c]">{formatCents(referral.rewardCents)}</dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Vouchers */}
              {voucherRedemptions.length > 0 && (
                <div className="mt-6 pt-6 border-t border-[#e4e7ef]">
                  <h3 className="font-medium text-[#0b0f1c] mb-3">Vouchers Used</h3>
                  <div className="space-y-2">
                    {voucherRedemptions.map((v) => (
                      <div key={v.id} className="flex justify-between text-sm">
                        <span className="text-[#5b6476]">{v.voucherCode}</span>
                        <span className="text-emerald-600">+{formatCents(v.creditCents)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "billing" && (
          <div className="space-y-6">
            {/* Balance Transactions */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#e4e7ef]">
                <h2 className="font-semibold text-[#0b0f1c]">Wallet Transactions</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#f7f8fb]">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Description</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Amount</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4e7ef]">
                    {balanceTransactions.map((t) => (
                      <tr key={t.id}>
                        <td className="px-6 py-3 text-sm text-[#0b0f1c]">{formatDate(t.created)}</td>
                        <td className="px-6 py-3 text-sm text-[#5b6476]">{t.description || t.type}</td>
                        <td className={`px-6 py-3 text-sm text-right font-medium ${
                          t.amount < 0 ? "text-emerald-600" : "text-red-600"
                        }`}>
                          {t.amount < 0 ? "+" : "-"}{formatCents(t.amount)}
                        </td>
                        <td className="px-6 py-3 text-sm text-right text-[#0b0f1c]">
                          {formatCents(-t.endingBalance)}
                        </td>
                      </tr>
                    ))}
                    {balanceTransactions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-[#5b6476]">
                          No wallet transactions
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Charges */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#e4e7ef]">
                <h2 className="font-semibold text-[#0b0f1c]">Payments</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#f7f8fb]">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Description</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Status</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4e7ef]">
                    {charges.map((c) => (
                      <tr key={c.id}>
                        <td className="px-6 py-3 text-sm text-[#0b0f1c]">{formatDate(c.created)}</td>
                        <td className="px-6 py-3 text-sm text-[#5b6476]">{c.description || "Payment"}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            c.refunded
                              ? "bg-yellow-100 text-yellow-700"
                              : c.paid
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"
                          }`}>
                            {c.refunded ? "Refunded" : c.paid ? "Paid" : "Failed"}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm text-right font-medium text-[#0b0f1c]">
                          {formatCents(c.amount)}
                        </td>
                      </tr>
                    ))}
                    {charges.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-[#5b6476]">
                          No payments
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Invoices */}
            <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#e4e7ef]">
                <h2 className="font-semibold text-[#0b0f1c]">Invoices</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#f7f8fb]">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Number</th>
                      <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Status</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Amount</th>
                      <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e4e7ef]">
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-6 py-3 text-sm text-[#0b0f1c]">{formatDate(inv.created)}</td>
                        <td className="px-6 py-3 text-sm text-[#5b6476]">{inv.number || "—"}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            inv.status === "paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : inv.status === "open"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-700"
                          }`}>
                            {inv.status || "Unknown"}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm text-right font-medium text-[#0b0f1c]">
                          {formatCents(inv.amount)}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {inv.pdfUrl && (
                            <a
                              href={inv.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#1a4fff] hover:underline text-sm"
                            >
                              PDF
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-[#5b6476]">
                          No invoices
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e4e7ef] flex justify-between items-center">
              <h2 className="font-semibold text-[#0b0f1c]">Activity Log</h2>
              <span className="text-sm text-[#5b6476]">{activityEvents?.length || 0} events</span>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-[#f7f8fb] sticky top-0">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Type</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e7ef]">
                  {activityEvents?.map((event) => (
                    <tr key={event.id} className="hover:bg-[#f7f8fb]">
                      <td className="px-6 py-3 text-sm text-[#0b0f1c] whitespace-nowrap">
                        {formatDate(event.created)}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                          event.type.startsWith("account_") ? "bg-blue-100 text-blue-700" :
                          event.type.startsWith("gpu_") ? "bg-violet-100 text-violet-700" :
                          event.type.startsWith("payment_") || event.type.startsWith("wallet_") ? "bg-emerald-100 text-emerald-700" :
                          event.type.startsWith("api_key_") || event.type.startsWith("ssh_key_") ? "bg-amber-100 text-amber-700" :
                          event.type.startsWith("team_") ? "bg-indigo-100 text-indigo-700" :
                          event.type.startsWith("hf_") ? "bg-pink-100 text-pink-700" :
                          event.type.startsWith("lora_") || event.type.startsWith("batch_") || event.type === "inference" ? "bg-cyan-100 text-cyan-700" :
                          event.type.startsWith("snapshot_") ? "bg-orange-100 text-orange-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            event.type.startsWith("account_") ? "bg-blue-500" :
                            event.type.startsWith("gpu_") ? "bg-violet-500" :
                            event.type.startsWith("payment_") || event.type.startsWith("wallet_") ? "bg-emerald-500" :
                            event.type.startsWith("api_key_") || event.type.startsWith("ssh_key_") ? "bg-amber-500" :
                            event.type.startsWith("team_") ? "bg-indigo-500" :
                            event.type.startsWith("hf_") ? "bg-pink-500" :
                            event.type.startsWith("lora_") || event.type.startsWith("batch_") || event.type === "inference" ? "bg-cyan-500" :
                            event.type.startsWith("snapshot_") ? "bg-orange-500" :
                            "bg-gray-500"
                          }`} />
                          {event.type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-[#5b6476]">
                        {event.description}
                      </td>
                    </tr>
                  ))}
                  {(!activityEvents || activityEvents.length === 0) && (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-[#5b6476]">
                        No activity events recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "support" && (
          <div className="bg-white rounded-xl border border-[#e4e7ef] p-6 text-center">
            <p className="text-[#5b6476]">Support tickets are managed externally.</p>
            <p className="text-sm text-[#5b6476] mt-2">
              Check the customer&apos;s email in your support system.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
