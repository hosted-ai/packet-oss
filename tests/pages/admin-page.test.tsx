// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): unit tests for the /admin page
// shell. admin/page.tsx is a thin "use client" wrapper that mounts a
// <SessionGuard> (a render-null fetch-wrapper effect) and renders the heavy
// <AdminDashboard> inside a <Suspense> with a teal spinner fallback.
//
// We are NOT re-testing AdminDashboard (covered elsewhere) — we stub it and
// assert the page mounts it, that the SessionGuard is wired with the admin
// login redirect, and that the wrapper renders without crashing.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub the heavy child — the point of this test is the page wrapper, not the
// dashboard internals.
vi.mock("@/app/admin/components/AdminDashboard", () => ({
  AdminDashboard: () => <div data-testid="admin-dashboard">admin dashboard</div>,
}));

// Capture the props SessionGuard is mounted with so we can assert the page
// passes the correct admin-login redirect target. SessionGuard itself renders
// null, so a stub is behaviour-equivalent for render purposes.
const sessionGuardProps: Array<{ redirectTo: string }> = [];
vi.mock("@/components/SessionGuard", () => ({
  SessionGuard: (props: { redirectTo: string }) => {
    sessionGuardProps.push(props);
    return <div data-testid="session-guard" data-redirect={props.redirectTo} />;
  },
}));

import AdminPage from "@/app/admin/page";

describe("AdminPage shell (PA-289)", () => {
  it("renders the AdminDashboard child", () => {
    render(<AdminPage />);
    expect(screen.getByTestId("admin-dashboard")).toBeInTheDocument();
  });

  it("mounts a SessionGuard pointed at the admin login page", () => {
    render(<AdminPage />);
    const guard = screen.getByTestId("session-guard");
    expect(guard).toBeInTheDocument();
    expect(guard).toHaveAttribute("data-redirect", "/admin/login");
  });

  it("passes the admin login redirect through to SessionGuard props", () => {
    sessionGuardProps.length = 0;
    render(<AdminPage />);
    expect(sessionGuardProps).toHaveLength(1);
    expect(sessionGuardProps[0].redirectTo).toBe("/admin/login");
  });

  it("renders without throwing", () => {
    expect(() => render(<AdminPage />)).not.toThrow();
  });
});
