"use client";

import { useState, useEffect, useCallback } from "react";
import type { QAState, TestResult } from "./qa/types";
import { TEST_PLAN } from "./qa/test-data";
import { StatsBar } from "./qa/StatsBar";
import { ProgressBar } from "./qa/ProgressBar";
import { TestCategorySection } from "./qa/TestCategorySection";

interface QATabProps {
  adminEmail: string;
}

export function QATab({ adminEmail }: QATabProps) {
  const [state, setState] = useState<QAState>({ results: {}, lastUpdated: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(TEST_PLAN.map((c) => c.id))
  );

  // Use admin email as tester name
  const testerName = adminEmail.split("@")[0];

  // Load saved state
  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/qa");
      const data = await res.json();
      if (data.results) {
        setState(data);
      }
    } catch (err) {
      console.error("Failed to load QA state:", err);
    }
  }, []);

  useEffect(() => {
    loadState().finally(() => setLoading(false));

    // Poll for updates every 10 seconds to see other testers' changes
    const interval = setInterval(loadState, 10000);
    return () => clearInterval(interval);
  }, [loadState]);

  // Save state
  const saveState = useCallback(async (newState: QAState) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newState),
      });
      const data = await res.json();
      // Update local state with merged result from server
      if (data.state) {
        setState(data.state);
      }
    } catch (error) {
      console.error("Failed to save QA state:", error);
    } finally {
      setSaving(false);
    }
  }, []);

  const updateTestResult = (testId: string, status: TestResult["status"]) => {
    const newResults = {
      ...state.results,
      [testId]: {
        ...state.results[testId],
        status,
        testedBy: testerName,
        testedAt: new Date().toISOString(),
        comment: state.results[testId]?.comment || "",
      },
    };
    const newState = { results: newResults, lastUpdated: new Date().toISOString() };
    setState(newState);
    saveState(newState);
  };

  const saveComment = (testId: string, comment: string) => {
    const newResults = {
      ...state.results,
      [testId]: {
        ...state.results[testId],
        comment,
        status: state.results[testId]?.status || "pending",
        testedBy: state.results[testId]?.testedBy || testerName || "",
        testedAt: state.results[testId]?.testedAt || new Date().toISOString(),
      },
    };
    const newState = { results: newResults, lastUpdated: new Date().toISOString() };
    setState(newState);
    saveState(newState);
  };

  const toggleCategory = (categoryId: string) => {
    const newSet = new Set(expandedCategories);
    if (newSet.has(categoryId)) {
      newSet.delete(categoryId);
    } else {
      newSet.add(categoryId);
    }
    setExpandedCategories(newSet);
  };

  const getStats = () => {
    const total = TEST_PLAN.reduce((sum, cat) => sum + cat.tests.length, 0);
    const results = Object.values(state.results);
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const blocked = results.filter((r) => r.status === "blocked").length;
    const pending = total - passed - failed - blocked;
    return { total, passed, failed, blocked, pending };
  };

  const stats = getStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#0b0f1c]">QA Test Plan</h2>
          <p className="text-sm text-[#5b6476]">
            End-to-end testing checklist for the platform
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[#5b6476]">
            Testing as: <span className="font-medium text-[#0b0f1c]">{adminEmail}</span>
          </span>
          {saving && <span className="text-xs text-[#5b6476]">Saving...</span>}
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar {...stats} />

      {/* Progress bar */}
      <ProgressBar {...stats} />

      {/* Test categories */}
      <div className="space-y-4">
        {TEST_PLAN.map((category) => (
          <TestCategorySection
            key={category.id}
            category={category}
            state={state}
            isExpanded={expandedCategories.has(category.id)}
            testerName={testerName}
            onToggle={() => toggleCategory(category.id)}
            onUpdateStatus={updateTestResult}
            onSaveComment={saveComment}
          />
        ))}
      </div>

      {/* Last updated */}
      {state.lastUpdated && (
        <p className="text-xs text-[#5b6476] text-center">
          Last updated: {new Date(state.lastUpdated).toLocaleString()}
        </p>
      )}
    </div>
  );
}
