/**
 * Test Item Component
 *
 * Individual test case with status controls and comments.
 *
 * @module admin/components/qa/TestItem
 */

"use client";

import { useState } from "react";
import type { TestCase, TestResult } from "./types";

interface TestItemProps {
  test: TestCase;
  result?: TestResult;
  testerName: string;
  onUpdateStatus: (testId: string, status: TestResult["status"]) => void;
  onSaveComment: (testId: string, comment: string) => void;
}

export function TestItem({
  test,
  result,
  testerName,
  onUpdateStatus,
  onSaveComment,
}: TestItemProps) {
  const [editingComment, setEditingComment] = useState(false);
  const [commentText, setCommentText] = useState(result?.comment || "");

  const status = result?.status || "pending";

  const handleSaveComment = () => {
    onSaveComment(test.id, commentText);
    setEditingComment(false);
  };

  return (
    <div className="border-b border-[#e4e7ef] last:border-b-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#0b0f1c]">{test.name}</span>
            <span className="text-xs text-[#5b6476]">({test.id})</span>
          </div>
          <p className="text-sm text-[#5b6476] mt-1">{test.description}</p>
          {test.steps && (
            <ol className="mt-2 ml-4 text-xs text-[#5b6476] list-decimal space-y-0.5">
              {test.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          {result?.comment && (
            <div className="mt-2 p-2 bg-zinc-50 rounded text-xs text-[#5b6476]">
              <span className="font-medium">Comment:</span> {result.comment}
            </div>
          )}
          {result?.testedBy && (
            <p className="mt-1 text-xs text-[#5b6476]">
              Tested by {result.testedBy} on{" "}
              {new Date(result.testedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Status buttons */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => onUpdateStatus(test.id, "pass")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                status === "pass"
                  ? "bg-green-500 text-white"
                  : "bg-green-50 text-green-600 hover:bg-green-100"
              }`}
            >
              Pass
            </button>
            <button
              onClick={() => onUpdateStatus(test.id, "fail")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                status === "fail"
                  ? "bg-red-500 text-white"
                  : "bg-red-50 text-red-600 hover:bg-red-100"
              }`}
            >
              Fail
            </button>
            <button
              onClick={() => onUpdateStatus(test.id, "blocked")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                status === "blocked"
                  ? "bg-amber-500 text-white"
                  : "bg-amber-50 text-amber-600 hover:bg-amber-100"
              }`}
            >
              Blocked
            </button>
          </div>
          {editingComment ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add comment..."
                className="px-2 py-1 text-xs border border-[#e4e7ef] rounded w-48"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveComment();
                  if (e.key === "Escape") setEditingComment(false);
                }}
              />
              <button
                onClick={handleSaveComment}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditingComment(true);
                setCommentText(result?.comment || "");
              }}
              className="text-xs text-[#5b6476] hover:text-[#0b0f1c]"
            >
              {result?.comment ? "Edit comment" : "Add comment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
