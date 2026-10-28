// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /success post-signup page.
// A "use client" component (wrapped in <Suspense>) that branches its copy on
// ?type (existing / free-trial / free / voucher / default checkout) and, for
// the paid-checkout path, polls /api/account/check-ready by ?session_id until
// ready (then auto-redirects to the dashboard) or 15 attempts elapse.
//
// We drive useSearchParams via a mutable map, stub useBranding/BrandLogo and
// branding-client for stable copy, and stub fetch. Each ?type branch and the
// account-ready redirect are exercised.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

let currentParams: Record<string, string> = {};
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => (k in currentParams ? currentParams[k] : null),
  }),
}));

vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));
vi.mock("@/lib/branding-client", () => ({
  getBrandName: () => "Test Brand",
  getLogoUrl: () => "/logo.svg",
  getSupportEmail: () => "support@test.example",
}));

import SuccessPage from "@/app/success/page";

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
  // Default: a fetch that never reports ready, so polling branches don't
  // accidentally redirect during copy-focused assertions.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: false }) }));
});

describe("SuccessPage (PA-289)", () => {
  it("shows the default welcome heading for a paid checkout", () => {
    currentParams = { session_id: "cs_test_1" };
    render(<SuccessPage />);
    expect(
      screen.getByRole("heading", { name: /welcome to test brand/i }),
    ).toBeInTheDocument();
  });

  it("shows the 'check your email' copy for an existing user", () => {
    currentParams = { type: "existing", email: "user@example.com" };
    render(<SuccessPage />);
    expect(
      screen.getByRole("heading", { name: /check your email/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sent you a login link/i)).toBeInTheDocument();
  });

  it("shows the free-account-ready copy and upgrade prompt for a free trial", () => {
    currentParams = { type: "free-trial" };
    render(<SuccessPage />);
    expect(
      screen.getByRole("heading", { name: /your free account is ready/i }),
    ).toBeInTheDocument();
    // Free-trial-only $50 upgrade nudge.
    expect(screen.getByText(/add \$50 to your wallet/i)).toBeInTheDocument();
  });

  it("treats type=free the same as free-trial", () => {
    currentParams = { type: "free" };
    render(<SuccessPage />);
    expect(
      screen.getByRole("heading", { name: /your free account is ready/i }),
    ).toBeInTheDocument();
  });

  it("includes the recipient email in the existing-user step copy", () => {
    currentParams = { type: "existing", email: "person@example.com" };
    render(<SuccessPage />);
    expect(screen.getByText(/person@example\.com/)).toBeInTheDocument();
  });

  it("renders the resend-login-link action and support email", () => {
    currentParams = { type: "existing" };
    render(<SuccessPage />);
    expect(
      screen.getByRole("link", { name: /resend login link/i }),
    ).toHaveAttribute("href", "/account");
    expect(
      screen.getByRole("link", { name: "support@test.example" }),
    ).toHaveAttribute("href", "mailto:support@test.example");
  });

  it("does not poll check-ready for a free trial (no session work)", () => {
    currentParams = { type: "free-trial", session_id: "cs_should_be_ignored" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: false }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SuccessPage />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls check-ready by session_id and shows the account-ready state on success", async () => {
    currentParams = { session_id: "cs_ready_1" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true, dashboardUrl: "/dashboard?token=zzz", amountCents: 5000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const hrefSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { hrefSpy(v); }, get href() { return ""; } },
    });

    render(<SuccessPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/check-ready?session_id=cs_ready_1",
      );
    });
    // The ready state swaps in the emerald "Your account is ready!" panel and a
    // "Click here if not redirected" fallback link to the dashboard URL.
    await waitFor(() => {
      expect(screen.getByText(/your account is ready/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /click here if not redirected/i }),
    ).toHaveAttribute("href", "/dashboard?token=zzz");
  });

  it("immediately redirects voucher signups using the URL token", async () => {
    currentParams = { type: "voucher", token: "voucher-token-9" };
    const hrefSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { hrefSpy(v); }, get href() { return ""; } },
    });

    render(<SuccessPage />);

    // Voucher path sets accountReady and shows the dashboard fallback link
    // built from the URL token (the actual navigation is on a 2s timeout).
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /click here if not redirected/i }),
      ).toHaveAttribute("href", "/dashboard?token=voucher-token-9");
    });
  });
});
