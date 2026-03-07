"use client";

import { useState, useCallback } from "react";
import { Download, Loader2, Calendar } from "lucide-react";

interface InvestorPayoutRow {
  email: string;
  revenueSharePercent: number;
  grossRevenueCents: number;
  payoutAmountCents: number;
}

interface PayoutsData {
  investors: InvestorPayoutRow[];
  totals: { grossRevenueCents: number; payoutAmountCents: number };
  period: { from: string; to: string };
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

type Preset = "this-month" | "last-month" | "last-3-months" | "custom";

function getPresetDates(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "this-month":
      return { from: fmt(new Date(Date.UTC(y, m, 1))), to: fmt(now) };
    case "last-month": {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0));
      return { from: fmt(start), to: fmt(end) };
    }
    case "last-3-months": {
      const start = new Date(Date.UTC(y, m - 3, 1));
      const end = new Date(Date.UTC(y, m, 0));
      return { from: fmt(start), to: fmt(end) };
    }
    default:
      return { from: "", to: "" };
  }
}

export function PayoutsTab() {
  const [preset, setPreset] = useState<Preset>("last-month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<PayoutsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  const getActiveDates = useCallback(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getPresetDates(preset);
  }, [preset, customFrom, customTo]);

  const fetchPayouts = useCallback(async () => {
    const { from, to } = getActiveDates();
    if (!from || !to) {
      setError("Please select both start and end dates.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/payouts?from=${from}&to=${to}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.data);
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payouts");
    } finally {
      setLoading(false);
    }
  }, [getActiveDates]);

  const downloadCsv = useCallback(() => {
    const { from, to } = getActiveDates();
    if (!from || !to) return;
    window.open(`/api/admin/payouts?from=${from}&to=${to}&format=csv`, "_blank");
  }, [getActiveDates]);

  const presetButtons: { id: Preset; label: string }[] = [
    { id: "this-month", label: "This Month" },
    { id: "last-month", label: "Last Month" },
    { id: "last-3-months", label: "Last 3 Months" },
    { id: "custom", label: "Custom Range" },
  ];

  return (
    <div className="space-y-6">
      {/* Date Range Controls */}
      <div className="bg-white rounded-xl border border-[#e4e7ef] p-6">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-5 h-5 text-[#4b5563]" />
          <h3 className="text-sm font-semibold text-[#0b0f1c] uppercase tracking-wide">Period</h3>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {presetButtons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => setPreset(btn.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                preset === btn.id
                  ? "bg-[#1a4fff] text-white"
                  : "bg-[#f7f8fb] text-[#4b5563] hover:bg-[#e4e7ef]"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex items-center gap-3 mb-4">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
            />
            <span className="text-sm text-[#4b5563]">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-2 border border-[#e4e7ef] rounded-lg text-sm"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={fetchPayouts}
            disabled={loading}
            className="px-5 py-2.5 bg-[#1a4fff] text-white rounded-lg text-sm font-medium hover:bg-[#1540cc] disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Loading..." : "Generate Report"}
          </button>

          {hasLoaded && (
            <button
              onClick={downloadCsv}
              className="px-5 py-2.5 bg-white border border-[#e4e7ef] text-[#0b0f1c] rounded-lg text-sm font-medium hover:bg-[#f7f8fb] flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Results Table */}
      {data && (
        <div className="bg-white rounded-xl border border-[#e4e7ef] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#e4e7ef]">
            <h3 className="text-sm font-semibold text-[#0b0f1c] uppercase tracking-wide">
              Investor Payouts — {data.period.from} to {data.period.to}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e4e7ef] bg-[#f7f8fb]">
                  <th className="px-6 py-3 text-left font-medium text-[#4b5563]">Investor</th>
                  <th className="px-6 py-3 text-right font-medium text-[#4b5563]">Revenue Share</th>
                  <th className="px-6 py-3 text-right font-medium text-[#4b5563]">Gross Revenue</th>
                  <th className="px-6 py-3 text-right font-medium text-[#4b5563]">Payout Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.investors.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-[#4b5563]">
                      No investors found for this period.
                    </td>
                  </tr>
                )}
                {data.investors.map((row) => (
                  <tr key={row.email} className="border-b border-[#e4e7ef] hover:bg-[#f7f8fb]">
                    <td className="px-6 py-3 font-medium text-[#0b0f1c]">{row.email}</td>
                    <td className="px-6 py-3 text-right text-[#4b5563]">{row.revenueSharePercent}%</td>
                    <td className="px-6 py-3 text-right text-[#0b0f1c]">{formatDollars(row.grossRevenueCents)}</td>
                    <td className="px-6 py-3 text-right font-semibold text-[#1a4fff]">
                      {formatDollars(row.payoutAmountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data.investors.length > 0 && (
                <tfoot>
                  <tr className="bg-[#f7f8fb] font-semibold">
                    <td className="px-6 py-3 text-[#0b0f1c]">TOTAL</td>
                    <td className="px-6 py-3" />
                    <td className="px-6 py-3 text-right text-[#0b0f1c]">
                      {formatDollars(data.totals.grossRevenueCents)}
                    </td>
                    <td className="px-6 py-3 text-right text-[#1a4fff]">
                      {formatDollars(data.totals.payoutAmountCents)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
