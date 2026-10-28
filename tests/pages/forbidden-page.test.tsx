// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /forbidden 403 page. A
// "use client" component wrapped in <Suspense>; the inner component reads
// permission / role / accountId / reason from the query string, optionally
// fetches the team's members (only when an accountId AND a customerToken in
// localStorage are present) to surface a "Request access" mailto, and always
// renders a "Back to dashboard" link.
//
// We drive useSearchParams via a mutable map and stub fetch. The default
// (no-account) branch must NOT fetch and must show the generic contact copy.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mutable param store, swapped per test before render.
let currentParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k in currentParams ? currentParams[k] : null),
  }),
}));

// Stable brand name so copy assertions don't depend on edition env.
vi.mock("@/lib/branding-client", () => ({
  getBrandName: () => "Test Brand",
}));

import ForbiddenPage from "@/app/forbidden/page";

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("ForbiddenPage (PA-289)", () => {
  it("renders the generic 403 heading", () => {
    render(<ForbiddenPage />);
    expect(
      screen.getByRole("heading", { name: /don't have permission/i }),
    ).toBeInTheDocument();
  });

  it("renders a back-to-dashboard link", () => {
    render(<ForbiddenPage />);
    const link = screen.getByRole("link", { name: /back to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("names the required permission when ?permission is set", () => {
    currentParams = { permission: "billing.view" };
    render(<ForbiddenPage />);
    expect(screen.getByText(/"billing.view" permission/i)).toBeInTheDocument();
  });

  it("shows the user's role when ?role is set", () => {
    currentParams = { role: "member" };
    render(<ForbiddenPage />);
    expect(screen.getByText(/Your role: member/i)).toBeInTheDocument();
  });

  it("prefers the explicit ?reason message over the permission/role copy", () => {
    currentParams = { reason: "Your trial has ended", permission: "gpu.access" };
    render(<ForbiddenPage />);
    expect(screen.getByText("Your trial has ended")).toBeInTheDocument();
    expect(screen.queryByText(/"gpu.access" permission/i)).not.toBeInTheDocument();
  });

  it("does not fetch members and shows the generic fallback when no accountId is present", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ForbiddenPage />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/contact your team admin to request the necessary permission/i),
    ).toBeInTheDocument();
  });

  it("does not fetch when accountId is present but no customerToken is stored", () => {
    currentParams = { accountId: "acct_1" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ForbiddenPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a Request-access mailto for the team owner when members load", async () => {
    currentParams = { accountId: "acct_1", permission: "billing.view" };
    window.localStorage.setItem("customerToken", "jwt-123");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        members: [
          { email: "owner@example.com", displayName: "Owner", isOwner: true, role: "teamAdmin" },
          { email: "member@example.com", displayName: "Member", isOwner: false, role: "member" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ForbiddenPage />);

    const link = await screen.findByRole("link", { name: /request access/i });
    expect(link.getAttribute("href")).toMatch(/^mailto:owner@example\.com\?/);
    // The owner's email is shown alongside the button.
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/acct_1/members",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer jwt-123" }),
      }),
    );
  });

  it("keeps the generic fallback when the members fetch fails", async () => {
    currentParams = { accountId: "acct_1" };
    window.localStorage.setItem("customerToken", "jwt-123");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(<ForbiddenPage />);

    // No owner row → the page must keep showing the no-contact fallback.
    await waitFor(() => {
      expect(
        screen.getByText(/contact your team admin to request the necessary permission/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: /request access/i })).not.toBeInTheDocument();
  });
});
