// @vitest-environment jsdom
//
// PA-288 Phase 3 batch 4 — AdminsTab.
// Presentational: renders the admin list table + add form and invokes the
// supplied callbacks. No fetch of its own.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AdminsTab } from "@/app/admin/components/AdminsTab";
import type { Admin } from "@/app/admin/types";

const admins: Admin[] = [
  { email: "owner@example.com", addedAt: "2026-01-01T00:00:00Z", addedBy: "system" },
  { email: "second@example.com", addedAt: "2026-02-01T00:00:00Z", addedBy: "owner@example.com" },
];

function renderTab(overrides: Partial<React.ComponentProps<typeof AdminsTab>> = {}) {
  const props = {
    admins,
    adminEmail: "owner@example.com",
    newAdminEmail: "",
    actionLoading: null,
    canResetPin: false,
    setupUrl: null,
    onNewAdminEmailChange: vi.fn(),
    onAddAdmin: vi.fn((e: React.FormEvent) => e.preventDefault()),
    onRemoveAdmin: vi.fn(),
    onResendInvite: vi.fn(),
    onResetPin: vi.fn(),
    onReset2FA: vi.fn(),
    ...overrides,
  };
  render(<AdminsTab {...props} />);
  return props;
}

beforeEach(() => {
  // jsdom lacks clipboard by default; not needed unless setupUrl is set.
});

describe("AdminsTab", () => {
  it("renders a row per admin with email and added-by", () => {
    renderTab();
    // owner@example.com appears twice (its own email cell + the addedBy of the
    // second row), so assert at least one match.
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("second@example.com")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
  });

  it("renders the column headers", () => {
    renderTab();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Added By")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  it("fires onNewAdminEmailChange when typing in the add field", () => {
    const props = renderTab();
    fireEvent.change(screen.getByPlaceholderText(/add admin email/i), {
      target: { value: "new@example.com" },
    });
    expect(props.onNewAdminEmailChange).toHaveBeenCalledWith("new@example.com");
  });

  it("fires onAddAdmin when the add form is submitted", () => {
    const props = renderTab({ newAdminEmail: "new@example.com" });
    const input = screen.getByPlaceholderText(/add admin email/i);
    fireEvent.submit(input.closest("form")!);
    expect(props.onAddAdmin).toHaveBeenCalled();
  });

  it("fires onResendInvite with the admin email", () => {
    const props = renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: /resend invite/i })[0]);
    expect(props.onResendInvite).toHaveBeenCalledWith("owner@example.com");
  });

  it("shows a Remove button only for admins other than the current admin", () => {
    renderTab();
    // owner@example.com is the current admin → no Remove; second@example.com → Remove present
    const removeButtons = screen.getAllByRole("button", { name: /^remove$/i });
    expect(removeButtons).toHaveLength(1);
  });

  it("fires onRemoveAdmin with the target email", () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(props.onRemoveAdmin).toHaveBeenCalledWith("second@example.com");
  });

  it("hides Reset PIN / Reset 2FA unless canResetPin is true", () => {
    renderTab({ canResetPin: false });
    expect(screen.queryByRole("button", { name: /reset pin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset 2fa/i })).not.toBeInTheDocument();
  });

  it("shows Reset PIN / Reset 2FA and fires their callbacks when canResetPin is true", () => {
    const props = renderTab({ canResetPin: true });
    fireEvent.click(screen.getAllByRole("button", { name: /reset pin/i })[0]);
    expect(props.onResetPin).toHaveBeenCalledWith("owner@example.com");
    fireEvent.click(screen.getAllByRole("button", { name: /reset 2fa/i })[0]);
    expect(props.onReset2FA).toHaveBeenCalledWith("owner@example.com");
  });

  it("disables row actions while that admin's action is loading", () => {
    renderTab({ actionLoading: "owner@example.com" });
    // The resend button for the loading admin shows "Sending..." and is disabled.
    const sending = screen.getByRole("button", { name: /sending\.\.\./i });
    expect(sending).toBeDisabled();
  });

  it("renders the setup URL block with a copy button when setupUrl is provided", () => {
    renderTab({ setupUrl: "/admin/setup?token=abc" });
    expect(screen.getByText(/email is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.getByText(/expires in 24 hours/i)).toBeInTheDocument();
  });
});
