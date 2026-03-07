"use client";

import { useState, useEffect, useCallback } from "react";

interface Voucher {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditCents: number;
  minTopupCents: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerCustomer: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}

interface VoucherRedemption {
  id: string;
  stripeCustomerId: string;
  customerEmail: string;
  topupCents: number;
  creditCents: number;
  createdAt: string;
}

interface VoucherStats {
  totalVouchers: number;
  activeVouchers: number;
  totalRedemptions: number;
  totalCreditedCents: number;
  redemptionsThisMonth: number;
  creditedThisMonthCents: number;
  topVouchers: Array<{
    code: string;
    name: string;
    redemptionCount: number;
    totalCredited: number;
  }>;
}

interface VoucherFormData {
  code: string;
  name: string;
  description: string;
  creditCents: number;
  minTopupCents: number | null;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  startsAt: string;
  expiresAt: string;
  active: boolean;
}

const EMPTY_FORM: VoucherFormData = {
  code: "",
  name: "",
  description: "",
  creditCents: 5000,
  minTopupCents: null,
  maxRedemptions: null,
  maxPerCustomer: 1,
  startsAt: "",
  expiresAt: "",
  active: true,
};

export function VouchersTab() {
  const [loading, setLoading] = useState(true);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [stats, setStats] = useState<VoucherStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [form, setForm] = useState<VoucherFormData>(EMPTY_FORM);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [redemptions, setRedemptions] = useState<VoucherRedemption[]>([]);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vouchers");
      const data = await res.json();
      if (data.error) {
        console.error("Failed to load vouchers:", data.error);
        return;
      }
      setVouchers(data.vouchers || []);
      setStats(data.stats);
    } catch (error) {
      console.error("Failed to load vouchers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadRedemptions = async (voucherId: string) => {
    setRedemptionsLoading(true);
    try {
      const res = await fetch(`/api/admin/vouchers?id=${voucherId}`);
      const data = await res.json();
      if (data.voucher) {
        setRedemptions(data.voucher.redemptions || []);
      }
    } catch (error) {
      console.error("Failed to load redemptions:", error);
    } finally {
      setRedemptionsLoading(false);
    }
  };

  const handleCreateClick = () => {
    setEditingVoucher(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleEditClick = (voucher: Voucher) => {
    setEditingVoucher(voucher);
    setForm({
      code: voucher.code,
      name: voucher.name,
      description: voucher.description || "",
      creditCents: voucher.creditCents,
      minTopupCents: voucher.minTopupCents,
      maxRedemptions: voucher.maxRedemptions,
      maxPerCustomer: voucher.maxPerCustomer,
      startsAt: voucher.startsAt ? voucher.startsAt.split("T")[0] : "",
      expiresAt: voucher.expiresAt ? voucher.expiresAt.split("T")[0] : "",
      active: voucher.active,
    });
    setShowModal(true);
  };

  const handleViewRedemptions = (voucher: Voucher) => {
    setSelectedVoucher(voucher);
    loadRedemptions(voucher.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const endpoint = "/api/admin/vouchers";
      const method = editingVoucher ? "PATCH" : "POST";
      const body = editingVoucher
        ? { id: editingVoucher.id, ...form }
        : form;

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        await loadData();
      } else {
        alert(data.error || "Failed to save voucher");
      }
    } catch (error) {
      console.error("Failed to save voucher:", error);
      alert("Failed to save voucher");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (voucher: Voucher) => {
    if (!confirm(`Delete voucher "${voucher.code}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/vouchers?id=${voucher.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        await loadData();
      } else {
        alert(data.error || "Failed to delete voucher");
      }
    } catch (error) {
      console.error("Failed to delete voucher:", error);
    }
  };

  const handleToggleActive = async (voucher: Voucher) => {
    try {
      const res = await fetch("/api/admin/vouchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: voucher.id, active: !voucher.active }),
      });

      const data = await res.json();
      if (data.success) {
        await loadData();
      }
    } catch (error) {
      console.error("Failed to update voucher:", error);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return <div className="text-[#5b6476]">Loading vouchers...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-6 gap-4">
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Vouchers</p>
            <p className="text-2xl font-bold text-[#0b0f1c]">{stats.totalVouchers}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Active</p>
            <p className="text-2xl font-bold text-green-600">{stats.activeVouchers}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Redemptions</p>
            <p className="text-2xl font-bold text-[#0b0f1c]">{stats.totalRedemptions}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Credited</p>
            <p className="text-2xl font-bold text-[#1a4fff]">${(stats.totalCreditedCents / 100).toFixed(0)}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">This Month</p>
            <p className="text-2xl font-bold text-[#0b0f1c]">{stats.redemptionsThisMonth}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Credited This Month</p>
            <p className="text-2xl font-bold text-[#1a4fff]">${(stats.creditedThisMonthCents / 100).toFixed(0)}</p>
          </div>
        </div>
      )}

      {/* Vouchers Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[#e4e7ef] flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#0b0f1c]">Voucher Codes</h3>
          <button
            onClick={handleCreateClick}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#153acc] text-white text-sm font-medium rounded-lg"
          >
            + Create Voucher
          </button>
        </div>

        {vouchers.length === 0 ? (
          <div className="p-8 text-center text-[#5b6476]">
            No vouchers created yet
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Credit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Redemptions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Expires</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#5b6476] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {vouchers.map((voucher) => (
                <tr key={voucher.id} className={!voucher.active ? "opacity-60" : ""}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-bold text-[#1a4fff]">{voucher.code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[#0b0f1c]">{voucher.name}</div>
                    {voucher.description && (
                      <div className="text-xs text-[#5b6476]">{voucher.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-green-600">
                      +${(voucher.creditCents / 100).toFixed(0)}
                    </span>
                    {voucher.minTopupCents && (
                      <div className="text-xs text-[#5b6476]">
                        Min ${(voucher.minTopupCents / 100).toFixed(0)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleViewRedemptions(voucher)}
                      className="text-sm text-[#0b0f1c] hover:text-[#1a4fff]"
                    >
                      {voucher.redemptionCount}
                      {voucher.maxRedemptions && `/${voucher.maxRedemptions}`}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(voucher)}
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer ${
                        voucher.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {voucher.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {voucher.expiresAt ? formatDate(voucher.expiresAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEditClick(voucher)}
                        className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] text-xs rounded"
                      >
                        Edit
                      </button>
                      {voucher.redemptionCount === 0 && (
                        <button
                          onClick={() => handleDelete(voucher)}
                          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs rounded"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-[#0b0f1c]">
                {editingVoucher ? "Edit Voucher" : "Create Voucher"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Code *
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    disabled={!!editingVoucher}
                    placeholder="LAUNCH50"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg uppercase disabled:bg-gray-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Launch Promotion"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Credit Amount ($) *
                  </label>
                  <input
                    type="number"
                    value={form.creditCents / 100}
                    onChange={(e) => setForm({ ...form, creditCents: parseFloat(e.target.value) * 100 })}
                    min="1"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Min Top-up ($)
                  </label>
                  <input
                    type="number"
                    value={form.minTopupCents ? form.minTopupCents / 100 : ""}
                    onChange={(e) => setForm({ ...form, minTopupCents: e.target.value ? parseFloat(e.target.value) * 100 : null })}
                    placeholder="No minimum"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Max Redemptions
                  </label>
                  <input
                    type="number"
                    value={form.maxRedemptions || ""}
                    onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Unlimited"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Max Per Customer
                  </label>
                  <input
                    type="number"
                    value={form.maxPerCustomer}
                    onChange={(e) => setForm({ ...form, maxPerCustomer: parseInt(e.target.value) || 1 })}
                    min="1"
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Starts At
                  </label>
                  <input
                    type="date"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">
                    Expires At
                  </label>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 border border-[#e4e7ef] rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="active" className="text-sm text-[#0b0f1c]">
                  Active (can be redeemed)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-[#5b6476] hover:text-[#0b0f1c]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#1a4fff] hover:bg-[#153acc] text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingVoucher ? "Update Voucher" : "Create Voucher"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Redemptions Modal */}
      {selectedVoucher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-[#0b0f1c]">
                  Redemptions for {selectedVoucher.code}
                </h3>
                <p className="text-sm text-[#5b6476]">{selectedVoucher.name}</p>
              </div>
              <button
                onClick={() => setSelectedVoucher(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            {redemptionsLoading ? (
              <div className="text-center py-8 text-[#5b6476]">Loading...</div>
            ) : redemptions.length === 0 ? (
              <div className="text-center py-8 text-[#5b6476]">No redemptions yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">
                      Top-up Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">
                      Credit Given
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e7ef]">
                  {redemptions.map((redemption) => (
                    <tr key={redemption.id}>
                      <td className="px-4 py-3 text-sm text-[#0b0f1c]">
                        {redemption.customerEmail}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#0b0f1c]">
                        ${(redemption.topupCents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-green-600">
                        +${(redemption.creditCents / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#5b6476]">
                        {formatDate(redemption.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
