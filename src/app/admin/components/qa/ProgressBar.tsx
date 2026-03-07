/**
 * Progress Bar Component
 *
 * Visual progress indicator for QA completion.
 *
 * @module admin/components/qa/ProgressBar
 */

"use client";

interface ProgressBarProps {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
}

export function ProgressBar({ total, passed, failed, blocked }: ProgressBarProps) {
  const completionPercent = Math.round(((passed + failed + blocked) / total) * 100);

  return (
    <div className="bg-white border border-[#e4e7ef] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[#0b0f1c]">Overall Progress</span>
        <span className="text-sm text-[#5b6476]">{completionPercent}% Complete</span>
      </div>
      <div className="h-3 bg-zinc-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-green-500 transition-all"
          style={{ width: `${(passed / total) * 100}%` }}
        />
        <div
          className="h-full bg-red-500 transition-all"
          style={{ width: `${(failed / total) * 100}%` }}
        />
        <div
          className="h-full bg-amber-500 transition-all"
          style={{ width: `${(blocked / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
