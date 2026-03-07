"use client";

import { useState, useEffect, useCallback } from "react";

interface ReferralSettings {
  enabled: boolean;
  rewardAmountCents: number;
  minTopupCents: number;
  maxReferralsPerCustomer: number;
}

interface ReferralClaim {
  id: string;
  code: string;
  referrerEmail: string;
  referrerCustomerId: string;
  refereeEmail: string;
  refereeCustomerId: string;
  status: "pending" | "qualified" | "credited" | "expired";
  qualifiedAt: string | null;
  creditedAt: string | null;
  referrerCredited: boolean;
  refereeCredited: boolean;
  createdAt: string;
}

interface ReferralStats {
  totalCodes: number;
  totalClaims: number;
  pendingClaims: number;
  creditedClaims: number;
  totalRewardsIssuedCents: number;
}

export function ReferralsTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [claims, setClaims] = useState<ReferralClaim[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/referrals?status=${statusFilter}`);
      const data = await res.json();
      if (data.error) {
        console.error("Failed to load referrals:", data.error);
        return;
      }
      setSettings(data.settings);
      setClaims(data.claims || []);
      setStats(data.stats);
    } catch (error) {
      console.error("Failed to load referrals:", error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleEnabled = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/referrals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !settings.enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<ReferralSettings>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/referrals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleClaimAction = async (claimId: string, action: "void" | "credit") => {
    setActionLoading(claimId);
    try {
      const res = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId, action }),
      });
      const data = await res.json();
      if (data.success) {
        await loadData();
      } else {
        alert(data.error || "Action failed");
      }
    } catch (error) {
      console.error("Failed to perform action:", error);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return <div className="text-[#5b6476]">Loading referrals...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Codes</p>
            <p className="text-2xl font-bold text-[#0b0f1c]">{stats.totalCodes}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Claims</p>
            <p className="text-2xl font-bold text-[#0b0f1c]">{stats.totalClaims}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pendingClaims}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Credited</p>
            <p className="text-2xl font-bold text-green-600">{stats.creditedClaims}</p>
          </div>
          <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
            <p className="text-[#5b6476] text-sm">Total Rewards</p>
            <p className="text-2xl font-bold text-[#1a4fff]">${(stats.totalRewardsIssuedCents / 100).toFixed(0)}</p>
          </div>
        </div>
      )}

      {/* Settings */}
      {settings && (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-[#0b0f1c]">Referral Program Settings</h3>
              <p className="text-sm text-[#5b6476]">Configure the referral program parameters</p>
            </div>
            <button
              onClick={handleToggleEnabled}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.enabled ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Reward Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6476]">$</span>
                <input
                  type="number"
                  value={settings.rewardAmountCents / 100}
                  onChange={(e) => handleUpdateSettings({ rewardAmountCents: parseFloat(e.target.value) * 100 })}
                  className="w-full pl-7 pr-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c]"
                />
              </div>
              <p className="text-xs text-[#5b6476] mt-1">Reward for both parties</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Min Top-up Required</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5b6476]">$</span>
                <input
                  type="number"
                  value={settings.minTopupCents / 100}
                  onChange={(e) => handleUpdateSettings({ minTopupCents: parseFloat(e.target.value) * 100 })}
                  className="w-full pl-7 pr-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c]"
                />
              </div>
              <p className="text-xs text-[#5b6476] mt-1">Min amount to qualify</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-[#0b0f1c]">Max Referrals per Customer</label>
              <input
                type="number"
                value={settings.maxReferralsPerCustomer}
                onChange={(e) => handleUpdateSettings({ maxReferralsPerCustomer: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c]"
              />
              <p className="text-xs text-[#5b6476] mt-1">0 = unlimited</p>
            </div>
          </div>
        </div>
      )}

      {/* Claims Table */}
      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[#e4e7ef] flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#0b0f1c]">Referral Claims</h3>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-[#e4e7ef] rounded-lg text-sm"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="credited">Credited</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {claims.length === 0 ? (
          <div className="p-8 text-center text-[#5b6476]">
            No referral claims found
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Referrer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Referee</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#5b6476] uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#5b6476] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-[#1a4fff]">{claim.code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[#0b0f1c]">{claim.referrerEmail}</div>
                    <div className="text-xs text-[#5b6476]">
                      {claim.referrerCredited ? "Credited" : "Pending credit"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[#0b0f1c]">{claim.refereeEmail}</div>
                    <div className="text-xs text-[#5b6476]">
                      {claim.refereeCredited ? "Credited" : "Pending credit"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        claim.status === "credited"
                          ? "bg-green-100 text-green-800"
                          : claim.status === "pending"
                          ? "bg-amber-100 text-amber-800"
                          : claim.status === "expired"
                          ? "bg-gray-100 text-gray-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {formatDate(claim.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {claim.status === "pending" && (
                        <>
                          <button
                            onClick={() => handleClaimAction(claim.id, "credit")}
                            disabled={actionLoading === claim.id}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded disabled:opacity-50"
                          >
                            {actionLoading === claim.id ? "..." : "Credit Now"}
                          </button>
                          <button
                            onClick={() => handleClaimAction(claim.id, "void")}
                            disabled={actionLoading === claim.id}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded disabled:opacity-50"
                          >
                            Void
                          </button>
                        </>
                      )}
                      {claim.status === "credited" && (
                        <span className="text-xs text-green-600">
                          {claim.creditedAt && formatDate(claim.creditedAt)}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
