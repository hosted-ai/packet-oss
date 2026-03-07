"use client";

import { useState, useEffect, useCallback } from "react";

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
  totalClaims?: number;
  creditedClaims?: number;
  status?: string;
  credited?: boolean;
  createdAt: string;
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
}

interface CustomerDetailPanelProps {
  customerId: string;
  onClose: () => void;
  onCustomerUpdated: () => void;
}

export function CustomerDetailPanel({ customerId, onClose, onCustomerUpdated }: CustomerDetailPanelProps) {
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "billing" | "activity">("overview");

  // Credit adjustment state
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustReasonNote, setAdjustReasonNote] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
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
        onCustomerUpdated();
        onClose();
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

  const handleQuickAdd = async (amount: number) => {
    if (!adjustReason) {
      alert("Please select a reason before adding credits");
      return;
    }
    if (adjustReason === "other" && !adjustReasonNote.trim()) {
      alert("Please provide details for the adjustment reason");
      return;
    }
    setActionLoading(`quick-add-${amount}`);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust-credits",
          amount: amount,
          reason: adjustReason,
          reasonNote: adjustReasonNote,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        fetchData();
        onCustomerUpdated();
      } else {
        alert(result.error || "Failed to add credits");
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditAmount) return;
    if (!adjustReason) {
      alert("Please select a reason before setting balance");
      return;
    }
    if (adjustReason === "other" && !adjustReasonNote.trim()) {
      alert("Please provide details for the adjustment reason");
      return;
    }

    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount < 0) {
      alert("Please enter a valid positive amount");
      return;
    }

    setActionLoading("set-balance");
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-balance",
          amount: amount,
          reason: adjustReason,
          reasonNote: adjustReasonNote,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message || "Balance updated");
        setCreditAmount("");
        setAdjustReason("");
        setAdjustReasonNote("");
        setShowCreditModal(false);
        fetchData();
        onCustomerUpdated();
      } else {
        alert(result.error || "Failed to set balance");
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin h-8 w-8 border-2 border-[#1a4fff] border-t-transparent rounded-full mx-auto"></div>
          <p className="text-[#5b6476] mt-4">Loading customer...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 text-center max-w-md">
          <p className="text-red-500 mb-4">{error || "Customer not found"}</p>
          <button onClick={onClose} className="text-[#1a4fff] hover:underline">
            Close
          </button>
        </div>
      </div>
    );
  }

  const { customer, hostedaiTeam, balanceTransactions, charges, invoices, voucherRedemptions, referral } = data;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
      <div className="min-h-screen py-8 px-4">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-white border-b border-[#e4e7ef] px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={onClose} className="text-[#5b6476] hover:text-[#0b0f1c]">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
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
          </div>

          {/* Tabs */}
          <div className="bg-white border-b border-[#e4e7ef]">
            <div className="px-6">
              <nav className="flex gap-6">
                {(["overview", "billing", "activity"] as const).map((tab) => (
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
          <div className="p-6">
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Customer Info */}
                <div className="bg-[#f7f8fb] rounded-xl p-6">
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
                <div className="bg-[#f7f8fb] rounded-xl p-6">
                  <h2 className="font-semibold text-[#0b0f1c] mb-4">Billing Summary</h2>
                  <div className="space-y-4">
                    <div className="p-4 bg-emerald-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-emerald-600">Wallet Balance</p>
                          <p className="text-2xl font-bold text-emerald-700">{formatCents(customer.walletBalance)}</p>
                        </div>
                        <button
                          onClick={() => setShowCreditModal(true)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg"
                        >
                          Adjust
                        </button>
                      </div>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm text-blue-600">Total Spent</p>
                      <p className="text-2xl font-bold text-blue-700">{formatCents(customer.totalSpent)}</p>
                    </div>
                  </div>
                </div>

                {/* Hosted.ai Team */}
                <div className="bg-[#f7f8fb] rounded-xl p-6">
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
                        {referral.role === "referrer" && (
                          <div className="flex justify-between">
                            <dt className="text-[#5b6476]">Claims</dt>
                            <dd className="text-[#0b0f1c]">{referral.creditedClaims || 0} / {referral.totalClaims || 0}</dd>
                          </div>
                        )}
                        {referral.role === "referred" && (
                          <div className="flex justify-between">
                            <dt className="text-[#5b6476]">Status</dt>
                            <dd className="text-[#0b0f1c]">{referral.credited ? "Credited" : referral.status || "Pending"}</dd>
                          </div>
                        )}
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
                <div className="bg-[#f7f8fb] rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#e4e7ef] flex justify-between items-center">
                    <h2 className="font-semibold text-[#0b0f1c]">Wallet Transactions</h2>
                    <button
                      onClick={() => setShowCreditModal(true)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg"
                    >
                      Adjust Balance
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-white">
                        <tr>
                          <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Description</th>
                          <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Amount</th>
                          <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4e7ef]">
                        {balanceTransactions.map((t) => (
                          <tr key={t.id} className="bg-white">
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
                            <td colSpan={4} className="px-6 py-8 text-center text-[#5b6476] bg-white">
                              No wallet transactions
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Charges */}
                <div className="bg-[#f7f8fb] rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#e4e7ef]">
                    <h2 className="font-semibold text-[#0b0f1c]">Payments</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-white">
                        <tr>
                          <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Date</th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Description</th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-[#5b6476]">Status</th>
                          <th className="text-right px-6 py-3 text-xs font-medium text-[#5b6476]">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4e7ef]">
                        {charges.map((c) => (
                          <tr key={c.id} className="bg-white">
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
                            <td colSpan={4} className="px-6 py-8 text-center text-[#5b6476] bg-white">
                              No payments
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Invoices */}
                <div className="bg-[#f7f8fb] rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#e4e7ef]">
                    <h2 className="font-semibold text-[#0b0f1c]">Invoices</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-white">
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
                          <tr key={inv.id} className="bg-white">
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
                            <td colSpan={5} className="px-6 py-8 text-center text-[#5b6476] bg-white">
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
              <div className="bg-[#f7f8fb] rounded-xl p-6">
                <h2 className="font-semibold text-[#0b0f1c] mb-4">Customer Metadata</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-white">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-medium text-[#5b6476]">Key</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-[#5b6476]">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e7ef]">
                      {Object.entries(customer.metadata).map(([key, value]) => (
                        <tr key={key} className="bg-white">
                          <td className="px-4 py-2 text-sm font-mono text-[#5b6476]">{key}</td>
                          <td className="px-4 py-2 text-sm text-[#0b0f1c]">{value || "—"}</td>
                        </tr>
                      ))}
                      {Object.keys(customer.metadata).length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-4 py-8 text-center text-[#5b6476] bg-white">
                            No metadata
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Credit Adjustment Modal */}
      {showCreditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-[#0b0f1c] mb-4">Adjust Wallet Balance</h3>
            <p className="text-sm text-[#5b6476] mb-4">
              Current balance: <span className="font-medium text-emerald-600">{formatCents(customer.walletBalance)}</span>
            </p>

            {/* Reason (shared by quick-add and set-balance) */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <select
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
              >
                <option value="">Select a reason...</option>
                <option value="bug_fix">Bug / System failure</option>
                <option value="goodwill">Goodwill / Customer retention</option>
                <option value="marketing">Marketing / Promotion</option>
                <option value="overcharge">Overcharge correction</option>
                <option value="onboarding">New customer onboarding</option>
                <option value="other">Other (specify below)</option>
              </select>
            </div>
            {adjustReason === "other" ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Details <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={adjustReasonNote}
                  onChange={(e) => setAdjustReasonNote(e.target.value)}
                  placeholder="Explain the reason for this adjustment..."
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
            ) : adjustReason ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Additional notes <span className="text-[#5b6476] font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={adjustReasonNote}
                  onChange={(e) => setAdjustReasonNote(e.target.value)}
                  placeholder="Any extra context..."
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                />
              </div>
            ) : null}

            {/* Quick Add Buttons */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-[#0b0f1c] mb-2">
                Quick Add Credits
              </label>
              <div className="flex gap-2">
                {[50, 100, 200].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => handleQuickAdd(amount)}
                    disabled={actionLoading === `quick-add-${amount}` || !adjustReason || (adjustReason === "other" && !adjustReasonNote.trim())}
                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 font-medium"
                  >
                    {actionLoading === `quick-add-${amount}` ? "..." : `+$${amount}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#5b6476] mt-1">
                Adds to current balance
              </p>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#e4e7ef]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white text-[#5b6476]">or</span>
              </div>
            </div>

            {/* Set Balance Form */}
            <form onSubmit={handleSetBalance}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#0b0f1c] mb-1">
                  Set Total Balance To
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6476]">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    placeholder="100.00"
                    className="w-full pl-8 pr-4 py-2 border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
                  />
                </div>
                <p className="text-xs text-[#5b6476] mt-1">
                  Sets the wallet to this exact amount (e.g., 100 = $100.00 balance)
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreditModal(false); setCreditAmount(""); setAdjustReason(""); setAdjustReasonNote(""); }}
                  className="px-4 py-2 text-[#5b6476] hover:text-[#0b0f1c]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "set-balance" || !creditAmount || !adjustReason || (adjustReason === "other" && !adjustReasonNote.trim())}
                  className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg disabled:opacity-50"
                >
                  {actionLoading === "set-balance" ? "Saving..." : "Set Balance"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
