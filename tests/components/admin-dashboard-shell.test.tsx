// @vitest-environment jsdom
//
// PA-288 (Phase 3, batch 5 — shell/orchestrator tier): unit tests for the
// AdminDashboard SHELL. AdminDashboard wires ~40 child tabs, the sidebar, a
// stats header, and a pile of modals together, driven by the admin hooks
// (useAdminData / useAdminActions / ...). These tests pin the shell's OWN
// logic — the loading gate, the stats header, tab routing via the sidebar,
// the per-tab content switch, and the premium-tab OSS placeholder — NOT the
// children, which are stubbed.
//
// Isolation strategy (keeps the import graph OSS-clean):
//   - @/lib/edition mocked to the OSS branch (isPro=false). Every premium tab
//     in AdminDashboard resolves to `NullTab` and its dynamic import never
//     fires, so no premium source enters the graph.
//   - The admin hooks (../hooks) are mocked so the test drives loading /
//     activeTab / stats deterministically and captures setActiveTab.
//   - The ./index barrel is mocked via importActual + light stubs for the
//     heavy OSS tab components (already covered in earlier batches).
//   - The remaining directly-imported children are stubbed by path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── edition: OSS branch ──────────────────────────────────────────────────
vi.mock("@/lib/edition", () => ({
  isPro: () => false,
  isOSS: () => true,
  hasPremiumFeature: () => false,
}));

// ── next/navigation ──────────────────────────────────────────────────────
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

// ── admin hooks: fully controlled ────────────────────────────────────────
// A single mutable state object backs useAdminData so individual tests can
// flip `loading` / `activeTab` before rendering. setActiveTab is a spy that
// also mutates the backing state so a re-render would reflect it.
const adminState: { loading: boolean; activeTab: string } = {
  loading: false,
  activeTab: "customers",
};
const setActiveTabMock = vi.fn((tab: string) => {
  adminState.activeTab = tab;
});
const loadActivitiesMock = vi.fn();

vi.mock("@/app/admin/hooks", () => ({
  useAdminData: () => ({
    loading: adminState.loading,
    adminEmail: "admin@example.com",
    stats: {
      totalCustomers: 7,
      activePods: 3,
      mrr: 12300,
      newCustomersThisWeek: 2,
      revenueThisWeek: 4500,
      growth: null,
    },
    customers: [],
    admins: [],
    canResetPin: false,
    clusterOffers: [],
    quotes: [],
    pricing: null,
    activities: [],
    activitiesLoading: false,
    search: "",
    activeTab: adminState.activeTab,
    customersPage: 1,
    customersTotalPages: 1,
    customersTotal: 0,
    customersSortBy: "created",
    customersSortDir: "desc",
    customersLoading: false,
    setSearch: vi.fn(),
    setActiveTab: setActiveTabMock,
    setPricing: vi.fn(),
    loadData: vi.fn(),
    loadActivities: loadActivitiesMock,
    handleSearch: vi.fn(),
    clearSearch: vi.fn(),
    handleCustomersSort: vi.fn(),
    handleCustomersPageChange: vi.fn(),
  }),
  useAdminActions: () => ({
    actionLoading: null,
    creditModalCustomer: null,
    creditAmount: "",
    newAdminEmail: "",
    pricingForm: {},
    pricingSaving: false,
    setCreditModalCustomer: vi.fn(),
    setCreditAmount: vi.fn(),
    setNewAdminEmail: vi.fn(),
    setPricingForm: vi.fn(),
    initPricingForm: vi.fn(),
    handleCustomerAction: vi.fn(),
    handleLoginAs: vi.fn(),
    handleHostedAiLogin: vi.fn(),
    handleDeleteCustomer: vi.fn(),
    handleAddAdmin: vi.fn(),
    handleRemoveAdmin: vi.fn(),
    handleResendInvite: vi.fn(),
    handleResetPin: vi.fn(),
    handleAdjustCredits: vi.fn(),
    handleSavePricing: vi.fn(),
    handleLogout: vi.fn(),
  }),
  useClusterManagement: () => ({
    clusterModalOpen: false,
    editingCluster: null,
    clusterForm: {},
    clusterSaving: false,
    highlightInput: "",
    imageUploading: false,
    setClusterForm: vi.fn(),
    setHighlightInput: vi.fn(),
    openClusterModal: vi.fn(),
    closeClusterModal: vi.fn(),
    handleImageUpload: vi.fn(),
    handleSaveCluster: vi.fn(),
    handleDeleteCluster: vi.fn(),
    addHighlight: vi.fn(),
    removeHighlight: vi.fn(),
    removeImage: vi.fn(),
  }),
  useQuoteManagement: () => ({
    quoteModalOpen: false,
    editingQuote: null,
    quoteForm: {},
    quoteSaving: false,
    quoteViewModalOpen: false,
    viewingQuote: null,
    emailPreviewModalOpen: false,
    emailPreview: null,
    emailPreviewLoading: false,
    emailSending: false,
    previewQuoteId: null,
    setQuoteForm: vi.fn(),
    openQuoteModal: vi.fn(),
    closeQuoteModal: vi.fn(),
    handleSaveQuote: vi.fn(),
    handleDeleteQuote: vi.fn(),
    viewQuoteDetails: vi.fn(),
    closeQuoteViewModal: vi.fn(),
    handlePreviewEmail: vi.fn(),
    handleSendEmail: vi.fn(),
    closeEmailPreviewModal: vi.fn(),
    prefillQuoteFromCluster: vi.fn(),
    copyQuoteUrl: vi.fn(),
  }),
  useInfrastructureRequestManagement: () => ({
    requestModalOpen: false,
    editingRequest: null,
    requestForm: {},
    requestSaving: false,
    locationInput: "",
    setRequestForm: vi.fn(),
    setLocationInput: vi.fn(),
    openRequestModal: vi.fn(),
    closeRequestModal: vi.fn(),
    handleSaveRequest: vi.fn(),
    handleDeleteRequest: vi.fn(),
    addLocation: vi.fn(),
    removeLocation: vi.fn(),
  }),
}));

// ── auxiliary hooks ──────────────────────────────────────────────────────
vi.mock("@/hooks/useServiceStatus", () => ({
  useServiceStatus: () => ({ services: null, loading: false, isConfigured: () => true }),
}));
vi.mock("@/hooks/useSecurityHealth", () => ({
  useSecurityHealth: () => ({ data: null, loading: false }),
}));

// ── heavy OSS tab components (covered in earlier batches) ────────────────
// Spread the real barrel so utilities/types stay intact, then override the
// tab/modal components with light stubs.
vi.mock("@/app/admin/components/index", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  const stub = (id: string) => {
    const C = () => <div data-testid={id} />;
    C.displayName = `Stub-${id}`;
    return C;
  };
  return {
    ...actual,
    CustomersTab: stub("customers-tab"),
    AdminsTab: stub("admins-tab"),
    ReferralsTab: stub("referrals-tab"),
    VouchersTab: stub("vouchers-tab"),
    ActivityTab: stub("activity-tab"),
    SettingsTab: stub("settings-tab"),
    ProvidersTab: stub("providers-tab"),
    ProductsTab: stub("products-tab"),
    PodsTab: stub("pods-tab"),
    EmailTemplatesTab: stub("emails-tab"),
    EmailLogTab: stub("email-log-tab"),
    DripTab: stub("drip-tab"),
    NodeMonitoringTab: stub("nodes-tab"),
    PoolOverviewTab: stub("pools-tab"),
    BusinessTab: stub("business-tab"),
    BannersTab: stub("banners-tab"),
    UptimeTab: stub("uptime-tab"),
    PlatformSettingsTab: stub("platform-settings-tab"),
    AnnouncementsTab: stub("announcements-tab"),
    BroadcastTab: stub("broadcast-tab"),
    CreditModal: () => null,
    CustomerDetailPanel: () => null,
  };
});

vi.mock("@/app/admin/components/GpuAppsTab", () => ({
  GpuAppsTab: () => <div data-testid="gpu-apps-tab" />,
}));
vi.mock("@/app/admin/components/OssAdminSupportTab", () => ({
  OssAdminSupportTab: () => <div data-testid="oss-support-tab" />,
}));
vi.mock("@/components/logout-confirm-modal", () => ({
  LogoutConfirmModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="logout-modal" /> : null,
}));
vi.mock("@/components/ServiceRequiredBanner", () => ({
  ServiceRequiredBanner: () => null,
}));

import { AdminDashboard } from "@/app/admin/components/AdminDashboard";

beforeEach(() => {
  adminState.loading = false;
  adminState.activeTab = "customers";
  setActiveTabMock.mockClear();
  loadActivitiesMock.mockClear();
  pushMock.mockClear();
});

describe("AdminDashboard shell (PA-288)", () => {
  it("renders the loading gate while data is loading", () => {
    adminState.loading = true;
    render(<AdminDashboard />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // No tab content while loading.
    expect(screen.queryByTestId("customers-tab")).not.toBeInTheDocument();
  });

  it("mounts and renders the default (customers) tab once loaded", () => {
    render(<AdminDashboard />);
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    // Header label for the active tab.
    expect(
      screen.getByRole("heading", { name: "Customers" }),
    ).toBeInTheDocument();
  });

  it("renders the stats header populated from the data hook", () => {
    render(<AdminDashboard />);
    expect(screen.getByText("Total Customers")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Active Pods")).toBeInTheDocument();
    // MRR is cents -> $123.00
    expect(screen.getByText("$123.00")).toBeInTheDocument();
  });

  it("routes to the matching child when the sidebar fires a tab change", () => {
    render(<AdminDashboard />);
    // The sidebar 'GPU Pods' button maps to the 'pods' tab.
    fireEvent.click(screen.getByRole("button", { name: "GPU Pods" }));
    expect(setActiveTabMock).toHaveBeenCalledWith("pods");
  });

  it("calls loadActivities when switching to the activity tab", () => {
    render(<AdminDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(setActiveTabMock).toHaveBeenCalledWith("activity");
    expect(loadActivitiesMock).toHaveBeenCalledTimes(1);
  });

  it("renders a representative OSS tab (vouchers) when it is active", () => {
    adminState.activeTab = "vouchers";
    render(<AdminDashboard />);
    expect(screen.getByTestId("vouchers-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("customers-tab")).not.toBeInTheDocument();
  });

  it("renders the OSS placeholder (not the component) for a premium tab", () => {
    // 'clusters' is a PREMIUM_ADMIN_TAB; in OSS the guard shows the upgrade
    // message and the premium component resolves to NullTab (renders nothing).
    adminState.activeTab = "clusters";
    render(<AdminDashboard />);
    expect(
      screen.getByText(/available in the Pro edition/i),
    ).toBeInTheDocument();
  });

  it("renders the OSS support tab (not the Pro Zammad tab) when support is active", () => {
    adminState.activeTab = "support";
    render(<AdminDashboard />);
    expect(screen.getByTestId("oss-support-tab")).toBeInTheDocument();
  });

  it("opens the logout confirm modal from the sidebar logout button", () => {
    render(<AdminDashboard />);
    expect(screen.queryByTestId("logout-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(screen.getByTestId("logout-modal")).toBeInTheDocument();
  });

  it("renders the sidebar with the admin email", () => {
    render(<AdminDashboard />);
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
  });

  it("renders the gpu-apps OSS tab when active", () => {
    adminState.activeTab = "gpu-apps";
    render(<AdminDashboard />);
    expect(screen.getByTestId("gpu-apps-tab")).toBeInTheDocument();
  });
});
