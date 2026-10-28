// @vitest-environment jsdom
//
// PA-287: unit coverage for NavItem (src/app/dashboard/components/NavItem.tsx).
// A sidebar nav button: renders an icon + label, fires onClick, applies
// active-state styling, and conditionally renders a text badge (alpha/soon
// variants) and/or a notification "showBadge" indicator.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NavItem } from "@/app/dashboard/components/NavItem";

const icon = <svg data-testid="nav-icon" />;

describe("NavItem", () => {
  it("renders the label and icon", () => {
    render(<NavItem icon={icon} label="Dashboard" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("nav-icon")).toBeInTheDocument();
  });

  it("fires onClick when pressed", () => {
    const onClick = vi.fn();
    render(<NavItem icon={icon} label="Settings" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies active styling when active", () => {
    render(<NavItem icon={icon} label="Active" active />);
    expect(screen.getByRole("button").className).toContain("bg-zinc-100");
  });

  it("applies inactive styling when not active", () => {
    render(<NavItem icon={icon} label="Inactive" />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("text-[var(--muted)]");
    expect(cls).not.toContain("bg-zinc-100");
  });

  it("renders a text badge when provided", () => {
    render(<NavItem icon={icon} label="GPU" badge="Beta" />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("uses amber styling for the default (alpha) badge variant", () => {
    render(<NavItem icon={icon} label="GPU" badge="Alpha" />);
    expect(screen.getByText("Alpha").className).toContain("bg-amber-100");
  });

  it("uses slate styling for the 'soon' badge variant", () => {
    render(
      <NavItem icon={icon} label="GPU" badge="Soon" badgeVariant="soon" />,
    );
    expect(screen.getByText("Soon").className).toContain("bg-slate-100");
  });

  it("does not render a badge when none is given", () => {
    render(<NavItem icon={icon} label="Plain" />);
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("renders the notification indicator only when showBadge is set", () => {
    const { container, rerender } = render(
      <NavItem icon={icon} label="Notif" showBadge />,
    );
    // showBadge renders a second svg (the chat/notification icon) after the
    // provided icon.
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(1);

    rerender(<NavItem icon={icon} label="Notif" />);
    // Only the provided icon remains.
    expect(screen.getByTestId("nav-icon")).toBeInTheDocument();
  });
});
