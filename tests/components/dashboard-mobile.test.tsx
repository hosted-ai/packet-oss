// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 5 — shell/orchestrator tier): unit tests for the
// mobile dashboard layout pieces in MobileDashboard.tsx. The module exports
// four presentational shells:
//   - MobileHeader   (hamburger + brand + optional balance pill)
//   - MobileNav      (bottom bar: Home / Billing / Settings / More)
//   - MobileMenuSheet (hamburger drawer; permission-gated compute items)
//   - MobileMoreSheet (overflow grid)
//
// These take callbacks + a permission map; the tests pin tab-switching, the
// drawer open/close behaviour, the permission gating (the `can` map vs the
// legacy isOwner fallback), the billing-pill / billing-portal billing.view
// gate (PA-271), and the bareMetalEnabled responsive branch.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// next/image (via BrandLogo) is awkward under jsdom — stub the logo to a plain img.
vi.mock("@/components/BrandLogo", () => ({
  BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} data-testid="brand-logo" />,
}));

import {
  MobileHeader,
  MobileNav,
  MobileMenuSheet,
  MobileMoreSheet,
} from "@/app/dashboard/components/MobileDashboard";

describe("MobileHeader (PA-288)", () => {
  it("renders the balance pill and fires onTopUp when a balance is provided", () => {
    const onTopUp = vi.fn();
    const onMenuOpen = vi.fn();
    render(
      <MobileHeader
        balance="$42"
        userName="Jordan"
        onMenuOpen={onMenuOpen}
        onTopUp={onTopUp}
      />,
    );
    const pill = screen.getByText("$42");
    expect(pill).toBeInTheDocument();
    fireEvent.click(pill);
    expect(onTopUp).toHaveBeenCalledTimes(1);
  });

  it("hides the balance pill when balance is undefined (PA-271 non-billing user)", () => {
    render(
      <MobileHeader
        userName="Jordan"
        onMenuOpen={vi.fn()}
        onTopUp={vi.fn()}
      />,
    );
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("fires onMenuOpen when the hamburger is clicked", () => {
    const onMenuOpen = vi.fn();
    render(
      <MobileHeader
        userName="Jordan"
        onMenuOpen={onMenuOpen}
        onTopUp={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    expect(onMenuOpen).toHaveBeenCalledTimes(1);
  });
});

describe("MobileNav (PA-288)", () => {
  it("renders the four bottom-nav tabs", () => {
    render(<MobileNav activeTab="dashboard" onTabChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /billing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
  });

  it("fires onTabChange with the tab id on click", () => {
    const onTabChange = vi.fn();
    render(<MobileNav activeTab="dashboard" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole("button", { name: /billing/i }));
    expect(onTabChange).toHaveBeenCalledWith("billing");
  });

  it("highlights Home when the dashboard tab is active", () => {
    render(<MobileNav activeTab="dashboard" onTabChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /home/i }).className).toContain(
      "text-[var(--blue)]",
    );
  });

  it("treats overflow tabs (e.g. metrics) as the active 'More' item", () => {
    // metrics is in the 'more' overflow set, so the More button is highlighted.
    render(<MobileNav activeTab="metrics" onTabChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /more/i }).className).toContain(
      "text-[var(--blue)]",
    );
  });
});

describe("MobileMenuSheet (PA-288)", () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    userName: "Jordan",
    userEmail: "jordan@example.com",
    isOwner: false,
    onTabChange: vi.fn(),
    onLogout: vi.fn(),
    onBillingPortal: vi.fn(),
    billingPortalLoading: false,
  };

  it("renders nothing when closed", () => {
    const { container } = render(
      <MobileMenuSheet {...baseProps} isOpen={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the user identity and the always-visible Team item when open", () => {
    render(<MobileMenuSheet {...baseProps} />);
    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(screen.getByText("jordan@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /team/i })).toBeInTheDocument();
  });

  it("shows permission-gated compute items only when the can-map allows them", () => {
    render(
      <MobileMenuSheet
        {...baseProps}
        can={{ "huggingface.use": true, "apps.use": false, "gpu.access": false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /hugging face/i }),
    ).toBeInTheDocument();
    // apps.use denied -> Apps hidden; gpu.access denied -> Storage/Metrics hidden
    expect(screen.queryByRole("button", { name: /^apps$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^storage$/i })).not.toBeInTheDocument();
  });

  it("falls back to isOwner gating when no can-map is supplied (legacy path)", () => {
    // isOwner=true and no `can` -> check() returns true for every permission.
    render(<MobileMenuSheet {...baseProps} isOwner={true} />);
    expect(
      screen.getByRole("button", { name: /hugging face/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^apps$/i })).toBeInTheDocument();
  });

  it("gates the Stripe Portal button on billing.view (PA-271)", () => {
    const { rerender } = render(
      <MobileMenuSheet {...baseProps} can={{ "billing.view": false }} />,
    );
    expect(
      screen.queryByRole("button", { name: /stripe portal/i }),
    ).not.toBeInTheDocument();

    rerender(<MobileMenuSheet {...baseProps} can={{ "billing.view": true }} />);
    expect(
      screen.getByRole("button", { name: /stripe portal/i }),
    ).toBeInTheDocument();
  });

  it("only shows Bare Metal when both bareMetalEnabled and billing.view are set", () => {
    const { rerender } = render(
      <MobileMenuSheet
        {...baseProps}
        bareMetalEnabled={false}
        can={{ "billing.view": true }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /bare metal/i }),
    ).not.toBeInTheDocument();

    rerender(
      <MobileMenuSheet
        {...baseProps}
        bareMetalEnabled={true}
        can={{ "billing.view": true }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /bare metal/i }),
    ).toBeInTheDocument();
  });

  it("switches tab AND closes the sheet when a menu item is clicked", () => {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileMenuSheet
        {...baseProps}
        onTabChange={onTabChange}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /team/i }));
    expect(onTabChange).toHaveBeenCalledWith("team");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onBillingPortal from the Stripe Portal button", () => {
    const onBillingPortal = vi.fn();
    render(
      <MobileMenuSheet
        {...baseProps}
        can={{ "billing.view": true }}
        onBillingPortal={onBillingPortal}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /stripe portal/i }));
    expect(onBillingPortal).toHaveBeenCalledTimes(1);
  });

  it("fires onLogout from the Sign out button", () => {
    const onLogout = vi.fn();
    render(<MobileMenuSheet {...baseProps} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe("MobileMoreSheet (PA-288)", () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onTabChange: vi.fn(),
  };

  it("renders nothing when closed", () => {
    const { container } = render(
      <MobileMoreSheet {...baseProps} isOpen={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the overflow grid items when open", () => {
    render(<MobileMoreSheet {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /hugging face/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^storage$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^metrics$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^team$/i })).toBeInTheDocument();
  });

  it("shows Bare Metal only when both bareMetalEnabled and canViewBilling are set", () => {
    const { rerender } = render(<MobileMoreSheet {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /bare metal/i }),
    ).not.toBeInTheDocument();
    // bareMetalEnabled alone is no longer enough — the item is billing-gated.
    rerender(<MobileMoreSheet {...baseProps} bareMetalEnabled />);
    expect(
      screen.queryByRole("button", { name: /bare metal/i }),
    ).not.toBeInTheDocument();
    rerender(<MobileMoreSheet {...baseProps} bareMetalEnabled canViewBilling />);
    expect(
      screen.getByRole("button", { name: /bare metal/i }),
    ).toBeInTheDocument();
  });

  it("switches tab and closes when an overflow item is clicked", () => {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    render(
      <MobileMoreSheet
        {...baseProps}
        onTabChange={onTabChange}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^metrics$/i }));
    expect(onTabChange).toHaveBeenCalledWith("metrics");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
