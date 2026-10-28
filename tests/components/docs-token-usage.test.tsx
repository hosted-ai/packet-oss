// @vitest-environment jsdom
//
// PA-287: TokenUsageDoc is a static documentation panel covering the token
// usage dashboard. These tests pin the title, the token-metric definitions,
// the dashboard sections and time-range options, the GPU-hour cost-estimation
// note, the vLLM-sourced token counting, the export formats, and the usage
// API endpoints.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TokenUsageDoc } from "@/app/dashboard/components/docs/TokenUsageDoc";

describe("TokenUsageDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<TokenUsageDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/track and analyze token consumption/i),
    ).toBeInTheDocument();
  });

  it("defines the core token metrics", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /understanding token metrics/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Prompt Tokens")).toBeInTheDocument();
    expect(screen.getByText("Generation Tokens")).toBeInTheDocument();
    expect(screen.getByText("Total Tokens")).toBeInTheDocument();
    expect(
      screen.getByText(/approximate cost based on total token volume/i),
    ).toBeInTheDocument();
  });

  it("describes the dashboard sections and time-range options", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /summary cards/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/stacked bar chart showing token usage per period/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/donut chart showing usage distribution by GPU instance/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/top five instances by usage/i),
    ).toBeInTheDocument();
    expect(screen.getByText("7 Days")).toBeInTheDocument();
    expect(screen.getByText("30 Days")).toBeInTheDocument();
    expect(screen.getByText("90 Days")).toBeInTheDocument();
    expect(screen.getByText("Week of 2026-06-28")).toBeInTheDocument();
  });

  it("explains GPU-hour billing with the flat indicative token rate", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /cost estimation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/charges by GPU-hour, not per token/i),
    ).toBeInTheDocument();
    expect(screen.getByText("$0.04 per 1,000 tokens")).toBeInTheDocument();
  });

  it("explains vLLM-sourced counting and includes the tiktoken estimation snippet", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByText(/publishes cumulative counters on its Prometheus metrics endpoint/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/import tiktoken/)).toBeInTheDocument();
    expect(
      screen.getByText(/encoding = tiktoken\.get_encoding\("cl100k_base"\)/),
    ).toBeInTheDocument();
  });

  it("documents CSV and JSON export formats", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /data export/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
    expect(
      screen.getByText(/Period,Prompt Tokens,Generation Tokens,Total Tokens,Estimated Cost \(\$\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Instance,Display Name,Prompt Tokens,Generation Tokens/),
    ).toBeInTheDocument();
    expect(screen.getByText(/"totalPromptTokens"/)).toBeInTheDocument();
  });

  it("documents the usage API endpoints", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByText(/GET \/api\/token-usage\?period=day/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/GET \/api\/token-usage\?format=csv/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/GET \/api\/vllm-metrics\?subscriptionId=SUBSCRIPTION_ID/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Authorization: Bearer YOUR_SESSION_TOKEN/),
    ).toHaveLength(3);
  });

  it("states token-based alerts are unavailable and points to budget alerts", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByText(/token-based usage alerts are not currently available/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Settings → Budget Controls")).toBeInTheDocument();
    expect(
      screen.getByText(/email alerts at 50%, 80%, and 100% of the limit/i),
    ).toBeInTheDocument();
  });

  it("provides a usage-reduction best-practices list", () => {
    render(<TokenUsageDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /reducing token usage/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/concise prompts/i)).toBeInTheDocument();
  });
});
