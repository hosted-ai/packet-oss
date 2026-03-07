"use client";

import { useState, useEffect, useCallback } from "react";

interface BudgetData {
  monthlyLimitCents: number | null;
  dailyLimitCents: number | null;
  alertAt50Percent: boolean;
  alertAt80Percent: boolean;
  alertAt100Percent: boolean;
  autoShutdownEnabled: boolean;
  autoShutdownThreshold: number;
}

interface BudgetSettingsProps {
  token: string;
}

function formatCurrency(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(0);
}

function parseCurrency(value: string): number | null {
  if (!value || value.trim() === "") return null;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}

export function BudgetSettings({ token }: BudgetSettingsProps) {
  const [budget, setBudget] = useState<BudgetData>({
    monthlyLimitCents: null,
    dailyLimitCents: null,
    alertAt50Percent: true,
    alertAt80Percent: true,
    alertAt100Percent: true,
    autoShutdownEnabled: false,
    autoShutdownThreshold: 100,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Local state for input values (as strings)
  const [monthlyInput, setMonthlyInput] = useState("");
  const [dailyInput, setDailyInput] = useState("");

  const fetchBudget = useCallback(async () => {
    try {
      const res = await fetch("/api/account/budget", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.error) {
        setBudget(data);
        setMonthlyInput(formatCurrency(data.monthlyLimitCents));
        setDailyInput(formatCurrency(data.dailyLimitCents));
      }
    } catch (error) {
      console.error("Failed to fetch budget:", error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const monthlyLimitCents = parseCurrency(monthlyInput);
    const dailyLimitCents = parseCurrency(dailyInput);

    // Validate
    if (monthlyLimitCents !== null && monthlyLimitCents < 0) {
      setMessage({ type: "error", text: "Monthly limit cannot be negative" });
      setSaving(false);
      return;
    }
    if (dailyLimitCents !== null && dailyLimitCents < 0) {
      setMessage({ type: "error", text: "Daily limit cannot be negative" });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/account/budget", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          monthlyLimitCents,
          dailyLimitCents,
          alertAt50Percent: budget.alertAt50Percent,
          alertAt80Percent: budget.alertAt80Percent,
          alertAt100Percent: budget.alertAt100Percent,
          autoShutdownEnabled: budget.autoShutdownEnabled,
          autoShutdownThreshold: budget.autoShutdownThreshold,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setBudget(data.settings);
        setMessage({ type: "success", text: "Budget settings saved!" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save budget settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to save budget settings" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-40 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--blue)]">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Budget Controls</h2>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Set spending limits and receive alerts before exceeding your budget
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Spending Limits */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-[var(--ink)]">Spending Limits</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">
                Monthly Limit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={monthlyInput}
                  onChange={(e) => setMonthlyInput(e.target.value)}
                  placeholder="No limit"
                  className="w-full pl-7 pr-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
                />
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">Leave empty for no limit</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--ink)] mb-1">
                Daily Limit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={dailyInput}
                  onChange={(e) => setDailyInput(e.target.value)}
                  placeholder="No limit"
                  className="w-full pl-7 pr-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
                />
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">Leave empty for no limit</p>
            </div>
          </div>
        </div>

        {/* Alert Preferences */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-[var(--ink)]">Email Alerts</h3>
          <p className="text-xs text-[var(--muted)] -mt-2">
            Receive email notifications when approaching your budget limits
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={budget.alertAt50Percent}
                onChange={(e) => setBudget({ ...budget, alertAt50Percent: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-[var(--blue)] focus:ring-[var(--blue)]"
              />
              <span className="text-sm text-[var(--ink)]">Alert at 50% of limit</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={budget.alertAt80Percent}
                onChange={(e) => setBudget({ ...budget, alertAt80Percent: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-[var(--blue)] focus:ring-[var(--blue)]"
              />
              <span className="text-sm text-[var(--ink)]">Alert at 80% of limit</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={budget.alertAt100Percent}
                onChange={(e) => setBudget({ ...budget, alertAt100Percent: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-[var(--blue)] focus:ring-[var(--blue)]"
              />
              <span className="text-sm text-[var(--ink)]">Alert at 100% of limit</span>
            </label>
          </div>
        </div>

        {/* Auto-Shutdown */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink)]">Auto-Shutdown</h3>
              <p className="text-xs text-[var(--muted)]">
                Automatically stop instances when budget threshold is reached
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={budget.autoShutdownEnabled}
                onChange={(e) => setBudget({ ...budget, autoShutdownEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--blue)]"></div>
            </label>
          </div>

          {budget.autoShutdownEnabled && (
            <div className="pl-4 border-l-2 border-[var(--line)]">
              <label className="block text-sm font-medium text-[var(--ink)] mb-2">
                Shutdown at percentage
              </label>
              <select
                value={budget.autoShutdownThreshold}
                onChange={(e) => setBudget({ ...budget, autoShutdownThreshold: parseInt(e.target.value) })}
                className="w-full sm:w-48 px-3 py-2 border border-[var(--line)] rounded-lg text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:border-transparent"
              >
                <option value="50">50% of limit</option>
                <option value="75">75% of limit</option>
                <option value="80">80% of limit</option>
                <option value="90">90% of limit</option>
                <option value="100">100% of limit</option>
              </select>
              <p className="text-xs text-[var(--muted)] mt-2">
                All running GPU instances will be automatically stopped when this threshold is reached.
              </p>
            </div>
          )}
        </div>

        {/* Warning Banner */}
        {budget.autoShutdownEnabled && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-800">Auto-shutdown is enabled</p>
                <p className="text-xs text-amber-700 mt-1">
                  Your GPU instances will be automatically stopped when you reach {budget.autoShutdownThreshold}% of your budget limit.
                  Make sure to save your work regularly.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            className={`p-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-[var(--blue)] hover:bg-[var(--blue-dark)] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Budget Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
