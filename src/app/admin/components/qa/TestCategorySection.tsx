/**
 * Test Category Section Component
 *
 * Collapsible section containing tests for a category.
 *
 * @module admin/components/qa/TestCategorySection
 */

"use client";

import type { TestCategory, TestResult, QAState } from "./types";
import { TestItem } from "./TestItem";

interface TestCategorySectionProps {
  category: TestCategory;
  state: QAState;
  isExpanded: boolean;
  testerName: string;
  onToggle: () => void;
  onUpdateStatus: (testId: string, status: TestResult["status"]) => void;
  onSaveComment: (testId: string, comment: string) => void;
}

export function TestCategorySection({
  category,
  state,
  isExpanded,
  testerName,
  onToggle,
  onUpdateStatus,
  onSaveComment,
}: TestCategorySectionProps) {
  const categoryTests = category.tests;
  const categoryResults = categoryTests.map((t) => state.results[t.id]);
  const categoryPassed = categoryResults.filter((r) => r?.status === "pass").length;
  const categoryFailed = categoryResults.filter((r) => r?.status === "fail").length;

  return (
    <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
      {/* Category header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-[#5b6476] transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-semibold text-[#0b0f1c]">{category.name}</span>
          <span className="text-xs text-[#5b6476]">({categoryTests.length} tests)</span>
        </div>
        <div className="flex items-center gap-2">
          {categoryPassed > 0 && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
              {categoryPassed} passed
            </span>
          )}
          {categoryFailed > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
              {categoryFailed} failed
            </span>
          )}
        </div>
      </button>

      {/* Test list */}
      {isExpanded && (
        <div className="border-t border-[#e4e7ef]">
          {categoryTests.map((test) => (
            <TestItem
              key={test.id}
              test={test}
              result={state.results[test.id]}
              testerName={testerName}
              onUpdateStatus={onUpdateStatus}
              onSaveComment={onSaveComment}
            />
          ))}
        </div>
      )}
    </div>
  );
}
