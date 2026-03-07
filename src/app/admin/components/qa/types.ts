/**
 * QA Tab Types
 *
 * Type definitions for the QA testing system.
 *
 * @module admin/components/qa/types
 */

export interface TestCase {
  id: string;
  name: string;
  description: string;
  steps?: string[];
}

export interface TestCategory {
  id: string;
  name: string;
  tests: TestCase[];
}

export interface TestResult {
  status: "pending" | "pass" | "fail" | "blocked";
  comment: string;
  testedBy: string;
  testedAt: string;
}

export interface QAState {
  results: Record<string, TestResult>;
  lastUpdated: string;
}
