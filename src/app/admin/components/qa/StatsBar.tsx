/**
 * Stats Bar Component
 *
 * Displays QA test statistics in a grid layout.
 *
 * @module admin/components/qa/StatsBar
 */

"use client";

interface StatsBarProps {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
}

export function StatsBar({ total, passed, failed, blocked, pending }: StatsBarProps) {
  return (
    <div className="grid grid-cols-5 gap-4">
      <div className="bg-white border border-[#e4e7ef] rounded-lg p-4 text-center">
        <p className="text-2xl font-bold text-[#0b0f1c]">{total}</p>
        <p className="text-xs text-[#5b6476]">Total Tests</p>
      </div>
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <p className="text-2xl font-bold text-green-600">{passed}</p>
        <p className="text-xs text-green-600">Passed</p>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p className="text-2xl font-bold text-red-600">{failed}</p>
        <p className="text-xs text-red-600">Failed</p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
        <p className="text-2xl font-bold text-amber-600">{blocked}</p>
        <p className="text-xs text-amber-600">Blocked</p>
      </div>
      <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-center">
        <p className="text-2xl font-bold text-zinc-600">{pending}</p>
        <p className="text-xs text-zinc-600">Pending</p>
      </div>
    </div>
  );
}
