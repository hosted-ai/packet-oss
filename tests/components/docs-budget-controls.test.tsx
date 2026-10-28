// @vitest-environment jsdom
//
// PA-287: BudgetControlsDoc is a static documentation panel covering spending
// limits, email alerts, and auto-shutdown. These tests pin the headings, the
// three alert thresholds, the auto-shutdown behaviour, and the budget API
// endpoint snippets.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BudgetControlsDoc } from "@/app/dashboard/components/docs/BudgetControlsDoc";

describe("BudgetControlsDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<BudgetControlsDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/set spending limits, receive alerts/i),
    ).toBeInTheDocument();
  });

  it("documents the major sections", () => {
    render(<BudgetControlsDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /setting up budget limits/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /email alerts/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /auto-shutdown/i }),
    ).toBeInTheDocument();
  });

  it("lists the three alert thresholds", () => {
    render(<BudgetControlsDoc />);
    // The "50% Alert" / "80% Alert" labels appear in the alerts list; the bare
    // percentages also recur in the recommended-settings table, so allow >=1.
    expect(screen.getAllByText(/50% alert/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/80% alert/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100% alert/i).length).toBeGreaterThan(0);
  });

  it("documents the GET budget settings API endpoint with cents-based fields", () => {
    render(<BudgetControlsDoc />);
    expect(screen.getByText(/GET \/api\/account\/budget/)).toBeInTheDocument();
    // monthlyLimitCents appears in both the GET and PUT example payloads.
    expect(
      screen.getAllByText(/"monthlyLimitCents": 50000/).length,
    ).toBeGreaterThan(0);
  });

  it("documents the PUT budget settings API endpoint", () => {
    render(<BudgetControlsDoc />);
    expect(screen.getByText(/PUT \/api\/account\/budget/)).toBeInTheDocument();
  });

  it("explains that auto-shutdown stops (not terminates) instances", () => {
    render(<BudgetControlsDoc />);
    expect(
      screen.getByText(/stopped instances can be restarted/i),
    ).toBeInTheDocument();
  });

  it("provides recommended-settings rows for common use cases", () => {
    render(<BudgetControlsDoc />);
    expect(screen.getByText("Personal Projects")).toBeInTheDocument();
    expect(screen.getByText("ML Training")).toBeInTheDocument();
    expect(screen.getByText("Development Team")).toBeInTheDocument();
  });

  it("has a troubleshooting section for missing alert emails", () => {
    render(<BudgetControlsDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /not receiving alert emails/i }),
    ).toBeInTheDocument();
  });
});
