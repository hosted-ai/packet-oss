// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): unit tests for the /dashboard
// page shell. dashboard/page.tsx is a thin "use client" wrapper: it renders
// the heavy <DashboardContent> inside a <Suspense> whose fallback is a
// centered teal spinner.
//
// DashboardContent has its own dedicated shell tests (dashboard-content-shell);
// here we stub it and exercise ONLY the page wrapper: that it mounts the child,
// and that the Suspense fallback (the spinner) renders while the child is
// suspended.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Resolvable suspender: lets us drive the Suspense fallback branch on demand.
let suspended = false;
let resolveSuspense: (() => void) | null = null;
let pending: Promise<void> | null = null;

vi.mock("@/app/dashboard/components", () => ({
  DashboardContent: () => {
    if (suspended) {
      if (!pending) {
        pending = new Promise<void>((res) => {
          resolveSuspense = () => {
            suspended = false;
            res();
          };
        });
      }
      throw pending;
    }
    return <div data-testid="dashboard-content">dashboard content</div>;
  },
}));

import DashboardPage from "@/app/dashboard/page";

describe("DashboardPage shell (PA-289)", () => {
  it("renders the DashboardContent child when not suspended", () => {
    suspended = false;
    pending = null;
    resolveSuspense = null;
    render(<DashboardPage />);
    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
  });

  it("renders without throwing", () => {
    suspended = false;
    pending = null;
    expect(() => render(<DashboardPage />)).not.toThrow();
  });

  it("shows the Suspense spinner fallback while the child is suspended", async () => {
    suspended = true;
    pending = null;
    resolveSuspense = null;
    const { container } = render(<DashboardPage />);

    // While suspended, the child is not visible and the spinner fallback is.
    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    // Resolving the suspender swaps the fallback for the real child.
    resolveSuspense?.();
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
    });
  });
});
