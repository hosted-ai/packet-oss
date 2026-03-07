"use client";

import type { PayoutSummary } from "../types";

interface PayoutsTabProps {
  data: PayoutSummary | null;
  loading: boolean;
  onRefresh: () => void;
}

export function PayoutsTab({ data, loading, onRefresh }: PayoutsTabProps) {
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      processing: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          styles[status] || "bg-gray-100 text-gray-800"
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading && !data) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
        <p className="text-[#5b6476]">Loading payouts...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
        <p className="text-[#5b6476]">No payout data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-semibold text-[#0b0f1c]">Payouts</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[#5b6476] hover:text-[#0b0f1c] disabled:opacity-50"
            title="Refresh"
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Total Paid</p>
          <p className="text-2xl font-bold text-green-600">
            ${data.summary.totalPaid.toFixed(2)}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">
            ${data.summary.totalPending.toFixed(2)}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Total Payouts</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            {data.summary.payoutCount}
          </p>
        </div>
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
          <p className="text-[#5b6476] text-sm">Lifetime Earnings</p>
          <p className="text-2xl font-bold text-[#0b0f1c]">
            ${data.summary.totalGrossEarnings.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Current Period */}
      <div className="bg-gradient-to-r from-[#1a4fff]/10 to-[#1a4fff]/5 border border-[#1a4fff]/20 rounded-lg p-6">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-[#0b0f1c]">
              Current Period
            </h3>
            <p className="text-[#5b6476] text-sm">
              {new Date(data.currentPeriod.periodStart).toLocaleDateString()} -{" "}
              {new Date(data.currentPeriod.periodEnd).toLocaleDateString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#1a4fff]">
              ${data.currentPeriod.estimatedPayout.toFixed(2)}
            </p>
            <p className="text-[#5b6476] text-sm">
              Payout on{" "}
              {new Date(data.currentPeriod.payoutDate).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Payout History */}
      {data.payouts.length === 0 ? (
        <div className="bg-white border border-[#e4e7ef] rounded-lg p-8 text-center">
          <svg
            className="w-16 h-16 mx-auto text-[#e4e7ef] mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-[#0b0f1c] mb-2">
            No payouts yet
          </h3>
          <p className="text-[#5b6476]">
            Your first payout will appear here once you start earning
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#e4e7ef]">
            <h3 className="text-lg font-semibold text-[#0b0f1c]">
              Payout History
            </h3>
          </div>
          <table className="w-full">
            <thead className="bg-[#f7f8fb]">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Period
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Gross
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Deductions
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Net Payout
                </th>
                <th className="text-center py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Status
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-[#5b6476]">
                  Invoice
                </th>
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((payout) => (
                <tr key={payout.id} className="border-t border-[#e4e7ef]">
                  <td className="py-3 px-4">
                    <span className="text-[#0b0f1c]">
                      {new Date(payout.periodStart).toLocaleDateString()} -{" "}
                      {new Date(payout.periodEnd).toLocaleDateString()}
                    </span>
                    {payout.paidAt && (
                      <p className="text-xs text-[#5b6476]">
                        Paid: {new Date(payout.paidAt).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-[#5b6476]">
                    ${payout.grossEarnings.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right text-[#5b6476]">
                    -${payout.deductions.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-[#0b0f1c]">
                    ${payout.netPayout.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {getStatusBadge(payout.status)}
                    {payout.failureReason && (
                      <p className="text-xs text-red-600 mt-1">
                        {payout.failureReason}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {payout.invoiceUrl ? (
                      <a
                        href={payout.invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#1a4fff] hover:underline text-sm"
                      >
                        {payout.invoiceNumber || "View"}
                      </a>
                    ) : (
                      <span className="text-[#5b6476] text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment Information Note */}
      <div className="bg-[#f7f8fb] border border-[#e4e7ef] rounded-lg p-4">
        <h4 className="font-medium text-[#0b0f1c] mb-2">Payment Information</h4>
        <p className="text-[#5b6476] text-sm">
          Payouts are processed on the 1st of each month for the previous month&apos;s
          earnings. Payments are sent via wire transfer to your registered bank
          account. If you need to update your payment details, please contact our
          support team.
        </p>
      </div>
    </div>
  );
}
