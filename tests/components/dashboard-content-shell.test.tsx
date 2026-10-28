// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 5 — shell/orchestrator tier): unit tests for the
// DashboardContent SHELL. This ~1900-line component wires the desktop
// sidebar, the mobile chrome, the dashboard home view, and ~10 tab children
// together, driven by the dashboard hooks (useDashboardData / useModals /
// useDashboardActions). These tests pin the shell's OWN logic:
//   - the loading / error / no-data gates
//   - the default dashboard view + stat cards
//   - sidebar tab routing (setActiveTab)
//   - PA-202 / PA-271 permission gating of nav items and financial surfaces
//   - the active-tab content switch (a representative permitted tab)
//   - the edition gate (Pro-only nav hidden in OSS)
// Children are stubbed; we are NOT exercising tab internals.
//
// Isolation strategy (OSS-clean import graph):
//   - @/lib/edition mocked to OSS (isPro=false, hasPremiumFeature=false) so
//     the Pro dynamic tabs (BareMetalTab, BareMetalOrdersTab, Pro SupportTab,
//     TruConversionIdentity) resolve to the null/OSS branch and never import
//     premium source.
//   - The dashboard hooks are mocked; a makeData() factory supplies a
//     controllable AccountData incl. the `can` permission map and activeTab.
//   - The ./ barrel is mocked via importActual with light stubs for heavy
//     components; NavItem + StatusDot + utils stay real so nav routing works.
//   - Remaining child imports are stubbed by path.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Permission } from "@/lib/auth/role-permissions";

// jsdom has no IntersectionObserver — the dashboard home view attaches one to
// a sticky-header sentinel. Provide a no-op so the home view renders.
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
// Assigned directly (not via vi.stubGlobal) so the per-test
// vi.unstubAllGlobals() below doesn't wipe it.
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
  MockIntersectionObserver;

// next/dynamic: eagerly resolve the loader so dynamically-imported children
// (e.g. the OSS SupportTab) render synchronously in the test. The loader
// returns a promise for { default: Component }; we resolve it once and render
// through a tiny suspense-free wrapper backed by state.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const Dyn = (props: Record<string, unknown>) => {
      const [Comp, setComp] = React.useState<React.ComponentType<unknown> | null>(null);
      React.useEffect(() => {
        let active = true;
        Promise.resolve(loader()).then((m) => {
          if (active) setComp(() => m.default);
        });
        return () => {
          active = false;
        };
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
    return Dyn;
  },
}));

// ── edition: OSS branch ──────────────────────────────────────────────────
vi.mock("@/lib/edition", () => ({
  isPro: () => false,
  isOSS: () => true,
  hasPremiumFeature: () => false,
}));

// ── next/navigation ──────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// ── controllable dashboard state ─────────────────────────────────────────
type CanMap = Partial<Record<Permission, boolean>>;

const dashState: {
  loading: boolean;
  error: string;
  data: ReturnType<typeof makeData> | null;
  activeTab: string;
} = {
  loading: false,
  error: "",
  data: null,
  activeTab: "dashboard",
};

const setActiveTabMock = vi.fn((tab: string) => {
  dashState.activeTab = tab;
});

function makeData(can: CanMap = {}) {
  return {
    next: null,
    skipTwoFactor: false,
    impersonator: null,
    customer: {
      id: "cust_1",
      email: "owner@example.com",
      name: "Jordan",
      billingType: "hourly",
      teamId: "team_1",
      created: 0,
      teamName: null,
    },
    wallet: { balance: 5000, balanceFormatted: "$50.00", currency: "usd" },
    transactions: [],
    subscription: null,
    subscriptions: [],
    recentPayments: [],
    gpuDashboardUrl: null,
    billingPortalUrl: "https://billing.example.com",
    bareMetalEnabled: false,
    isOwner: true,
    role: null,
    roleDisplayName: null,
    membershipIsOwner: true,
    can: can as Record<Permission, boolean>,
    userEmail: "owner@example.com",
    userDisplayName: "Jordan",
    twoFactor: { enabled: false, hasBackupCodes: false },
  };
}

vi.mock("@/app/dashboard/components/hooks", () => ({
  useDashboardData: () => ({
    token: "test-token",
    loading: dashState.loading,
    error: dashState.error,
    data: dashState.data,
    instances: [],
    poolSubscriptions: [],
    podMetadata: {},
    hfDeployments: {},
    instancesLoading: false,
    activityEvents: [],
    billingStats: null,
    snapshots: [],
    provisioningGpu: null,
    greeting: "Good morning",
    tagline: "tag",
    easterEgg: null,
    emptyState: { title: "No instances", subtitle: "Launch one" },
    twoFactorRequired: false,
    twoFactorVerified: false,
    pendingUserEmail: null,
    tosConsentRequired: false,
    tosConsentVersion: null,
    setTosConsentRequired: vi.fn(),
    fetchInstances: vi.fn(),
    fetchActivityEvents: vi.fn(),
    fetchBillingStats: vi.fn(),
    fetchSnapshots: vi.fn(),
    setData: vi.fn(),
    setProvisioningGpu: vi.fn(),
    setTwoFactorVerified: vi.fn(),
    setTwoFactorRequired: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    ticketId: null,
  }),
  useDashboardActions: () => ({
    topupLoading: false,
    hostedaiLoginLoading: false,
    billingPortalLoading: false,
    openHostedaiDashboard: vi.fn(),
    openBillingPortal: vi.fn(),
    downloadActivityCSV: vi.fn(),
    downloadTransactionsCSV: vi.fn(),
    formatDateTime: (n: number) => String(n),
    handleTopup: vi.fn(),
  }),
  useModals: () => ({
    showLaunchModal: false,
    showTopupModal: false,
    showActivityModal: false,
    showTransactionsModal: false,
    activeTab: dashState.activeTab,
    setShowLaunchModal: vi.fn(),
    setShowTopupModal: vi.fn(),
    setShowActivityModal: vi.fn(),
    setShowTransactionsModal: vi.fn(),
    setActiveTab: setActiveTabMock,
  }),
}));

// ── auxiliary hooks ──────────────────────────────────────────────────────
vi.mock("@/hooks/useBranding", () => ({ useBranding: () => null }));
vi.mock("@/hooks/useLiveCostTicker", () => ({
  useLiveCostTicker: () => ({
    currentBalance: 5000,
    formattedBalance: "$50.00",
    costPerSecond: 0,
    hoursRemaining: 0,
    timeRemainingFormatted: "0m",
    status: "healthy",
  }),
}));

// ── ./ barrel: keep NavItem/StatusDot/utils real, stub heavy children ─────
vi.mock("@/app/dashboard/components", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    UsageChart: () => <div data-testid="usage-chart" />,
    GPUUsageChart: () => <div data-testid="gpu-usage-chart" />,
    LaunchGPUModal: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="launch-modal" /> : null,
    PoolSubscriptionCard: () => <div data-testid="pool-sub-card" />,
    SnapshotCard: () => <div data-testid="snapshot-card" />,
    MetricsTab: () => <div data-testid="metrics-tab" />,
    BillingTab: () => <div data-testid="billing-tab" />,
    BareMetalTab: () => <div data-testid="baremetal-tab" />,
  };
});

// ── direct child imports stubbed by path ─────────────────────────────────
// NOTE: vi.mock is hoisted, so each factory must be self-contained (no shared
// helper closure — that would not be initialized at hoist time).
vi.mock("@/components/XTerminal", () => ({ __esModule: true, default: () => <div data-testid="xterminal" /> }));
vi.mock("@/components/TeamMembers", () => ({ __esModule: true, default: () => <div data-testid="team-members" /> }));
vi.mock("@/components/HuggingFaceTab", () => ({ __esModule: true, default: () => <div data-testid="huggingface-tab" /> }));
vi.mock("@/components/ReferralCard", () => ({ __esModule: true, default: () => <div data-testid="referral-card" /> }));
vi.mock("@/components/SSHKeys", () => ({ __esModule: true, default: () => <div data-testid="ssh-keys" /> }));
vi.mock("@/components/two-factor", () => ({ TwoFactorSettings: () => <div data-testid="2fa-settings" /> }));
vi.mock("@/components/TwoFactorVerify", () => ({ __esModule: true, default: () => <div data-testid="2fa-verify" /> }));
vi.mock("@/components/TosConsentModal", () => ({ __esModule: true, default: () => <div data-testid="tos-modal" /> }));
vi.mock("@/components/ApiKeysSettings", () => ({ ApiKeysSettings: () => <div data-testid="api-keys" /> }));
vi.mock("@/components/GPUHardwareMetrics", () => ({ GPUHardwareMetrics: () => <div data-testid="gpu-hw" /> }));
vi.mock("@/components/AccountSwitcher", () => ({ AccountSwitcher: () => <div data-testid="account-switcher" /> }));
vi.mock("@/components/InvitationAcceptModal", () => ({ InvitationAcceptModal: () => <div data-testid="invite-modal" /> }));
vi.mock("@/components/HelpTooltip", () => ({
  HelpTooltip: () => <span data-testid="help-tooltip" />,
  HELP_CONTENT: { tflops: {}, vram: {} },
}));
vi.mock("@/components/BrandLogo", () => ({ BrandLogo: ({ alt }: { alt?: string }) => <img alt={alt} /> }));
vi.mock("@/components/logout-confirm-modal", () => ({
  LogoutConfirmModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="logout-modal" /> : null),
}));
vi.mock("@/app/dashboard/components/AppsTab", () => ({ AppsTab: () => <div data-testid="apps-tab" /> }));
vi.mock("@/app/dashboard/components/StorageTab", () => ({ StorageTab: () => <div data-testid="storage-tab" /> }));
vi.mock("@/app/dashboard/components/BareMetalInstanceCard", () => ({ BareMetalInstanceCard: () => <div data-testid="bm-card" /> }));
vi.mock("@/app/dashboard/components/ImpersonationBanner", () => ({ ImpersonationBanner: () => <div data-testid="impersonation-banner" /> }));
vi.mock("@/app/dashboard/components/ProfileSettings", () => ({ ProfileSettings: () => <div data-testid="profile-settings" /> }));
vi.mock("@/app/dashboard/components/BudgetSettings", () => ({ BudgetSettings: () => <div data-testid="budget-settings" /> }));
vi.mock("@/app/dashboard/components/OnboardingChecklist", () => ({ OnboardingChecklist: () => <div data-testid="onboarding" /> }));
vi.mock("@/app/dashboard/components/DashboardAnnouncements", () => ({ DashboardAnnouncements: () => <div data-testid="announcements" /> }));
vi.mock("@/app/dashboard/components/OssSupportTab", () => ({ OssSupportTab: () => <div data-testid="oss-support-tab" /> }));
vi.mock("@/app/dashboard/components/modals", () => ({
  TopupModal: () => null,
  ActivityLogModal: () => null,
  TransactionsModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="transactions-modal" /> : null),
  BlackwellModal: () => null,
  MonthlyPlansModal: () => null,
}));

import { DashboardContent } from "@/app/dashboard/components/DashboardContent";

// A permission map granting the full set of relevant perms.
const ALL_CAN: CanMap = {
  "billing.view": true,
  "huggingface.use": true,
  "apps.use": true,
  "gpu.access": true,
  "gpu.provision": true,
  "referral.view": true,
  "storage.manage": true,
  "team.invite": true,
  "team.manage": true,
};

beforeEach(() => {
  dashState.loading = false;
  dashState.error = "";
  dashState.activeTab = "dashboard";
  dashState.data = makeData(ALL_CAN);
  setActiveTabMock.mockClear();
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("DashboardContent shell (PA-288)", () => {
  it("renders the loading spinner while loading", () => {
    dashState.loading = true;
    const { container } = render(<DashboardContent />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the access-denied gate when data fails to load", () => {
    dashState.data = null;
    dashState.error = "boom";
    render(<DashboardContent />);
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the dashboard home view by default", () => {
    render(<DashboardContent />);
    expect(
      screen.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Active GPUs")).toBeInTheDocument();
  });

  it("shows the financial stat cards for a billing.view user (PA-271)", () => {
    render(<DashboardContent />);
    expect(screen.getByText("GPU Hours")).toBeInTheDocument();
    expect(screen.getByText("Spent")).toBeInTheDocument();
    expect(screen.getByText("Projected")).toBeInTheDocument();
  });

  it("hides the financial stat cards when billing.view is denied (PA-271)", () => {
    dashState.data = makeData({ ...ALL_CAN, "billing.view": false });
    render(<DashboardContent />);
    expect(screen.getByText("Active GPUs")).toBeInTheDocument();
    expect(screen.queryByText("GPU Hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Spent")).not.toBeInTheDocument();
  });

  it("shows permission-gated nav items only when the can-map allows them (PA-202)", () => {
    dashState.data = makeData({
      "gpu.access": true,
      "billing.view": false,
      "huggingface.use": false,
      "apps.use": false,
      "referral.view": false,
    });
    const { container } = render(<DashboardContent />);
    // Scope to the DESKTOP sidebar <nav> — the mobile bottom bar (MobileNav)
    // shows a static, non-permission-gated "Billing"/"Settings" set that would
    // otherwise match these queries.
    const sidebarNav = container.querySelector("aside nav") as HTMLElement;
    const nav = within(sidebarNav);
    // huggingface.use / apps.use / billing.view / referral.view all denied.
    expect(nav.queryByRole("button", { name: /hugging face/i })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: /^apps$/i })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: /^billing$/i })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: /^referrals$/i })).not.toBeInTheDocument();
    // Team + Settings are always present in the sidebar.
    expect(nav.getByRole("button", { name: /^team$/i })).toBeInTheDocument();
    expect(nav.getByRole("button", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("routes to a permitted tab via the sidebar (Metrics)", () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole("button", { name: /^metrics$/i }));
    expect(setActiveTabMock).toHaveBeenCalledWith("metrics");
  });

  it("renders the active tab's child (billing) for a billing.view user", () => {
    dashState.activeTab = "billing";
    render(<DashboardContent />);
    expect(screen.getByTestId("billing-tab")).toBeInTheDocument();
  });

  it("does NOT render the billing tab content when billing.view is denied", () => {
    dashState.activeTab = "billing";
    dashState.data = makeData({ ...ALL_CAN, "billing.view": false });
    render(<DashboardContent />);
    // Guarded by `activeTab === 'billing' && canViewBilling`.
    expect(screen.queryByTestId("billing-tab")).not.toBeInTheDocument();
  });

  it("renders the OSS support tab (not the Pro one) when support is active", async () => {
    // SupportTab is loaded via next/dynamic; the OSS branch resolves to
    // OssSupportTab asynchronously, so await it.
    dashState.activeTab = "support";
    render(<DashboardContent />);
    expect(await screen.findByTestId("oss-support-tab")).toBeInTheDocument();
  });

  it("hides Pro-only nav items in the OSS edition", () => {
    // Bare Metal + Bare Metal Orders nav items are isPro()-gated; OSS hides them.
    render(<DashboardContent />);
    expect(screen.queryByRole("button", { name: /^bare metal$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bare metal orders/i })).not.toBeInTheDocument();
  });

  it("styles the On-demand CTA as a filled Packet-green button (PA-367)", () => {
    // The top-bar On-demand CTA must carry the emphasized --teal fill with
    // white text (same visual weight as the Monthly CTA), not the old plain
    // white/outlined treatment.
    render(<DashboardContent />);
    const onDemand = screen.getByRole("button", { name: /on-demand/i });
    expect(onDemand.className).toContain("bg-(--teal)");
    expect(onDemand.className).toContain("hover:bg-(--teal-dark)");
    expect(onDemand.className).toContain("text-white");
    expect(onDemand.className).not.toContain("bg-white");
  });

  it("renders the team tab child when team is active", () => {
    dashState.activeTab = "team";
    render(<DashboardContent />);
    expect(screen.getByTestId("team-members")).toBeInTheDocument();
  });

  it("renders the settings tab children when settings is active", () => {
    dashState.activeTab = "settings";
    render(<DashboardContent />);
    expect(screen.getByTestId("profile-settings")).toBeInTheDocument();
    expect(screen.getByTestId("api-keys")).toBeInTheDocument();
    expect(screen.getByTestId("ssh-keys")).toBeInTheDocument();
  });

  it("opens the logout confirm modal from the sidebar sign-out button", () => {
    render(<DashboardContent />);
    expect(screen.queryByTestId("logout-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(screen.getByTestId("logout-modal")).toBeInTheDocument();
  });
});
