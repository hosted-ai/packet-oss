// @vitest-environment jsdom
//
// PA-289 (Phase 4 — front-end page coverage): the /subscribed post-checkout
// page. A "use client" component (wrapped in <Suspense>) that reads
// ?session_id, then polls /api/account/check-ready every 2s until the account
// is ready (then redirects to the dashboard) or 15 attempts elapse (then shows
// a "Subscription is processing" recovery state). With no session_id it goes
// straight to the processing/recovery state.
//
// We drive useSearchParams via a mutable map, stub useBranding to null (so the
// page falls back to client-side brand defaults) and BrandLogo to a no-op, and
// stub fetch. The happy-path redirect is exercised with fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import SubscribedPage from "@/app/subscribed/page";

beforeEach(() => {
  currentParams = {};
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SubscribedPage (PA-289)", () => {
  it("shows the in-progress 'Adding your subscription' state with a session_id", () => {
    currentParams = { session_id: "cs_test_123" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: false }) }));
    render(<SubscribedPage />);
    expect(
      screen.getByRole("heading", { name: /adding your subscription/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/finalizing/i)).toBeInTheDocument();
  });

  it("renders the brand logo header", () => {
    currentParams = { session_id: "cs_test_123" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ready: false }) }));
    render(<SubscribedPage />);
    expect(screen.getByTestId("brand-logo")).toBeInTheDocument();
  });

  it("goes straight to the processing/recovery state when session_id is missing", async () => {
    currentParams = {};
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribedPage />);
    // Effect sets pollFailed synchronously when there is no session_id.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /subscription is processing/i }),
      ).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a sign-in link and support email in the recovery state", async () => {
    currentParams = {};
    vi.stubGlobal("fetch", vi.fn());
    render(<SubscribedPage />);
    const signIn = await screen.findByRole("link", { name: /^sign in$/i });
    expect(signIn).toHaveAttribute("href", "/account");
    expect(
      screen.getByRole("link", { name: "support@test.example" }),
    ).toHaveAttribute("href", "mailto:support@test.example");
  });

  it("polls check-ready and redirects to the dashboard when the account is ready", async () => {
    currentParams = { session_id: "cs_test_xyz" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true, dashboardUrl: "/dashboard?token=abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Capture the redirect target without navigating jsdom.
    const hrefSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { hrefSpy(v); }, get href() { return ""; } },
    });

    render(<SubscribedPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account/check-ready?session_id=cs_test_xyz",
      );
    });
    await waitFor(() => {
      // dashboardUrl already has a query string, so the page appends &subscribed=1.
      expect(hrefSpy).toHaveBeenCalledWith("/dashboard?token=abc&subscribed=1");
    });
  });
});
