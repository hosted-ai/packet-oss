"use client";

import { useState, useEffect, useCallback } from "react";

interface Referral {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  creditedAt: string | null;
}

interface ReferralData {
  enabled: boolean;
  code: string | null;
  stats: {
    code: string;
    totalReferrals: number;
    pendingReferrals: number;
    creditedReferrals: number;
    totalEarned: number;
  } | null;
  referrals: Referral[];
  rewardAmount: number;
  rewardHours: number;
  minTopupRequired: number;
  maxReferrals: number; // 0 = unlimited
  usedReferralCode: string | null;
  usedReferralStatus: string | null;
}

interface ReferralCardProps {
  token: string;
}

export default function ReferralCard({ token }: ReferralCardProps) {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For applying a code
  const [inputCode, setInputCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  // For copying
  const [copied, setCopied] = useState(false);

  const fetchReferralData = useCallback(async () => {
    try {
      const response = await fetch("/api/account/referral", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch {
      setError("Failed to load referral data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReferralData();
  }, [fetchReferralData]);

  const copyCode = async () => {
    if (data?.code) {
      await navigator.clipboard.writeText(data.code.toUpperCase());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const applyCode = async () => {
    if (!inputCode.trim()) {
      setApplyError("Please enter a referral code");
      return;
    }

    setApplying(true);
    setApplyError(null);
    setApplySuccess(null);

    try {
      const response = await fetch("/api/account/referral", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: inputCode.trim(), action: "apply" }),
      });

      const result = await response.json();

      if (result.success) {
        setApplySuccess(result.message);
        setInputCode("");
        // Refresh data
        fetchReferralData();
      } else {
        setApplyError(result.error || "Failed to apply code");
      }
    } catch {
      setApplyError("Failed to apply referral code");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-[var(--line)]">
        <div className="animate-pulse">
          <div className="h-4 bg-zinc-200 rounded w-1/3 mb-4"></div>
          <div className="h-8 bg-zinc-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error || !data?.enabled) {
    return null; // Hide card if referrals are disabled
  }

  const hasUsedCode = !!data.usedReferralCode;
  const hasReferrals = (data.stats?.totalReferrals || 0) > 0;

  return (
    <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl p-6 border border-teal-100">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-[var(--ink)] flex items-center gap-2">
            <span className="text-xl">🎁</span>
            Refer a Friend
          </h3>
          <p className="text-sm text-[var(--muted)] mt-1">
            Share your code and you both get {data.rewardHours} hours free!
          </p>
        </div>
      </div>

      {/* Your referral code */}
      <div className="mb-4">
        <label className="text-xs text-[var(--muted)] block mb-2">Your referral code</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-white rounded-xl px-4 py-3 font-mono text-lg font-bold text-teal-700 border border-teal-200 text-center tracking-wider">
            {data.code?.toUpperCase()}
          </div>
          <button
            onClick={copyCode}
            className="px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition-colors flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats section - always show to encourage referrals */}
      <div className="mb-4 bg-white/50 rounded-xl p-4">
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-xl font-bold text-teal-700">
              {data.maxReferrals > 0
                ? `${Math.max(0, data.maxReferrals - (data.stats?.totalReferrals || 0))}`
                : "∞"}
            </div>
            <div className="text-xs text-[var(--muted)]">Available</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-[var(--ink)]">
              {data.stats?.totalReferrals || 0}
            </div>
            <div className="text-xs text-[var(--muted)]">Shared</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-600">
              {data.stats?.creditedReferrals || 0}
            </div>
            <div className="text-xs text-[var(--muted)]">Activated</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-teal-600">
              ${((data.stats?.totalEarned || 0) / 100).toFixed(0)}
            </div>
            <div className="text-xs text-[var(--muted)]">
              ~{Math.floor((data.stats?.totalEarned || 0) / 200)}h
            </div>
          </div>
        </div>
        {data.stats && data.stats.pendingReferrals > 0 && (
          <div className="mt-3 pt-3 border-t border-teal-100 text-center">
            <span className="text-xs text-amber-600 font-medium">
              {data.stats.pendingReferrals} friend{data.stats.pendingReferrals > 1 ? "s" : ""} waiting to top up
            </span>
          </div>
        )}
        {data.maxReferrals > 0 && data.stats && data.stats.totalReferrals >= data.maxReferrals && (
          <div className="mt-3 pt-3 border-t border-teal-100 text-center">
            <span className="text-xs text-[var(--muted)]">
              You&apos;ve reached your referral limit
            </span>
          </div>
        )}
      </div>

      {/* Referrals table - show if there are any */}
      {data.referrals && data.referrals.length > 0 && (
        <div className="mb-4">
          <label className="text-xs text-[var(--muted)] block mb-2">Your referrals</label>
          <div className="bg-white rounded-xl border border-teal-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-teal-50/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Email</th>
                  <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((referral) => (
                  <tr key={referral.id} className="border-t border-teal-50">
                    <td className="px-4 py-2 text-[var(--ink)]">
                      {referral.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")}
                    </td>
                    <td className="px-4 py-2">
                      {referral.status === "credited" ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          Activated
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[var(--muted)]">
                      {new Date(referral.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Apply a friend's code section - only show if they haven't used one */}
      {!hasUsedCode && (
        <div className="border-t border-teal-100 pt-4 mt-4">
          <label className="text-xs text-[var(--muted)] block mb-2">
            Have a friend&apos;s code? Enter it to get ${data.rewardAmount} bonus
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputCode}
              onChange={(e) => {
                setInputCode(e.target.value);
                setApplyError(null);
                setApplySuccess(null);
              }}
              placeholder="e.g., cosmic-penguin"
              className="flex-1 px-4 py-2.5 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent font-mono"
            />
            <button
              onClick={applyCode}
              disabled={applying || !inputCode.trim()}
              className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white rounded-xl transition-colors text-sm font-medium"
            >
              {applying ? "Applying..." : "Apply"}
            </button>
          </div>
          {applyError && (
            <p className="text-xs text-rose-600 mt-2">{applyError}</p>
          )}
          {applySuccess && (
            <p className="text-xs text-green-600 mt-2">{applySuccess}</p>
          )}
        </div>
      )}

      {/* Show status if they've used a code */}
      {hasUsedCode && (
        <div className="border-t border-teal-100 pt-4 mt-4">
          <div className="flex items-center gap-2 text-sm">
            {data.usedReferralStatus === "credited" ? (
              <>
                <span className="text-green-600">✓</span>
                <span className="text-[var(--muted)]">
                  You used code <span className="font-mono font-medium">{data.usedReferralCode?.toUpperCase()}</span> and received ${data.rewardAmount} bonus!
                </span>
              </>
            ) : (
              <>
                <span className="text-amber-500">⏳</span>
                <span className="text-[var(--muted)]">
                  Code <span className="font-mono font-medium">{data.usedReferralCode?.toUpperCase()}</span> applied. Top up $100+ to unlock your ${data.rewardAmount} bonus!
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="text-xs text-[var(--muted)] mt-4 pt-4 border-t border-teal-100">
        <strong>How it works:</strong> Share your code. When your friend signs up and tops up $100+, you both get ${data.rewardAmount} credit (~{data.rewardHours}h of GPU time).
      </div>
    </div>
  );
}
