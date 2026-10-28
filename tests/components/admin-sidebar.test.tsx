// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 5 — shell/orchestrator tier): unit tests for the
// admin sidebar shell. AdminSidebar is a presentational nav: it renders the
// grouped nav items, highlights the active tab, fires onTabChange with the
// item id on click, hides premium/OSS-gated items per edition, and exposes
// the collapse/logout affordances.
//
// The edition module is mocked to the OSS branch so the premium tabs
// (PREMIUM_ADMIN_TABS) are filtered OUT of the rendered nav — this proves the
// edition gate works without pulling any premium tab source into the graph.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// OSS edition: isPro() === false, isOSS() === true. Premium nav items hidden.
vi.mock("@/lib/edition", () => ({
  isPro: () => false,
  isOSS: () => true,
  hasPremiumFeature: () => false,
}));

// The sidebar reads a security-health hook for the brand dot. Stub it so the
// test controls the score branch and avoids a real fetch.
const securityHealthMock = vi.fn();
vi.mock("@/hooks/useSecurityHealth", () => ({
  useSecurityHealth: () => securityHealthMock(),
}));

import { AdminSidebar } from "@/app/admin/components/AdminSidebar";
import type { AdminTab } from "@/app/admin/types";

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AdminSidebar>> = {}) {
  const onTabChange = vi.fn();
  const onLogout = vi.fn();
  const onToggleCollapse = vi.fn();
  const props = {
    activeTab: "customers" as AdminTab,
    onTabChange,
    onLogout,
    adminEmail: "admin@example.com",
    isCollapsed: false,
    onToggleCollapse,
    ...overrides,
  };
  render(<AdminSidebar {...props} />);
  return { onTabChange, onLogout, onToggleCollapse };
}

beforeEach(() => {
  // Default: no security health data (loading=false, data=null) so the dot
  // branch is skipped and the email still renders.
  securityHealthMock.mockReturnValue({ data: null, loading: false });
});

describe("AdminSidebar (PA-288)", () => {
  it("renders the admin email and the expanded brand header", () => {
    renderSidebar({ adminEmail: "ops@example.com" });
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
  });

  it("renders core OSS nav items as buttons", () => {
    renderSidebar();
    // Representative always-on items across groups.
    expect(screen.getByRole("button", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admins" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GPU Pods" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vouchers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders the group headers that have at least one visible item", () => {
    renderSidebar();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Infrastructure")).toBeInTheDocument();
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });

  it("hides premium-gated items and their now-empty group in OSS", () => {
    renderSidebar();
    // Premium items must not render in OSS.
    expect(screen.queryByRole("button", { name: "Tenants" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Investors" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quotes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bare Metal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "QA" })).not.toBeInTheDocument();
    // "White Label" group only contains Tenants (premium) -> whole group hidden.
    expect(screen.queryByText("White Label")).not.toBeInTheDocument();
  });

  it("fires onTabChange with the item id when a nav button is clicked", () => {
    const { onTabChange } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "GPU Pods" }));
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("pods");
  });

  it("applies the active styling to the active tab's button", () => {
    renderSidebar({ activeTab: "vouchers" as AdminTab });
    const activeBtn = screen.getByRole("button", { name: "Vouchers" });
    expect(activeBtn.className).toContain("bg-[#1a4fff]");
    const inactiveBtn = screen.getByRole("button", { name: "Customers" });
    expect(inactiveBtn.className).not.toContain("bg-[#1a4fff]");
  });

  it("fires onLogout when the logout button is clicked", () => {
    const { onLogout } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("fires onToggleCollapse when the collapse button is clicked", () => {
    const { onToggleCollapse } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("hides text labels and group headers when collapsed", () => {
    renderSidebar({ isCollapsed: true });
    // Brand header switches to the single-letter mark; group headers/labels gone.
    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    // The Logout button text is hidden, but the button (with title) still exists.
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
  });

  it("renders a healthy security dot when score is high", () => {
    securityHealthMock.mockReturnValue({
      data: { score: 3, maxScore: 3 },
      loading: false,
    });
    renderSidebar();
    const dot = document.querySelector('[title="Security: 3/3"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-green-500");
  });

  it("renders a red security dot when score is low", () => {
    securityHealthMock.mockReturnValue({
      data: { score: 1, maxScore: 3 },
      loading: false,
    });
    renderSidebar();
    const dot = document.querySelector('[title="Security: 1/3"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("bg-red-500");
  });
});
