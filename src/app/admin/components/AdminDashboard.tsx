"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminData, useAdminActions, useClusterManagement, useQuoteManagement, useInfrastructureRequestManagement } from "../hooks";
import type { AdminTab, Quote, Investor, InfrastructureRequest } from "../types";
import { PREMIUM_ADMIN_TABS, OSS_ONLY_ADMIN_TABS } from "../types";
import { isPro, isOSS } from "@/lib/edition";
import dynamic from "next/dynamic";
import {
  CustomersTab,
  AdminsTab,
  ReferralsTab,
  VouchersTab,
  ActivityTab,
  SettingsTab,
  ProvidersTab,
  ProductsTab,
  PodsTab,
  EmailTemplatesTab,
  EmailLogTab,
  DripTab,
  NodeMonitoringTab,
  PoolOverviewTab,
  BusinessTab,
  CreditModal,
  CustomerDetailPanel,
  BannersTab,
  UptimeTab,
  PlatformSettingsTab,
} from "./index";
import { GpuAppsTab } from "./GpuAppsTab";
import { OssAdminSupportTab } from "./OssAdminSupportTab";
import { AdminSidebar } from "./AdminSidebar";

// Support tab — edition-gated: Pro uses Zammad, OSS uses contact submissions
const SupportTab = isPro()
  ? dynamic(() => import("./SupportTab").then(m => ({ default: m.SupportTab })))
  : null;
import { LogoutConfirmModal } from "@/components/logout-confirm-modal";
import { useServiceStatus } from "@/hooks/useServiceStatus";
import { ServiceRequiredBanner } from "@/components/ServiceRequiredBanner";

// Premium tab components — dynamically imported, files excluded in OSS build
const NullTab = () => null;
const ClustersTab = isPro() ? dynamic(() => import("./ClustersTab").then(m => ({ default: m.ClustersTab }))) : NullTab;
const QuotesTab = isPro() ? dynamic(() => import("./QuotesTab").then(m => ({ default: m.QuotesTab }))) : NullTab;
const QATab = isPro() ? dynamic(() => import("./QATab").then(m => ({ default: m.QATab }))) : NullTab;
const BatchesTab = isPro() ? dynamic(() => import("./BatchesTab").then(m => ({ default: m.BatchesTab }))) : NullTab;
const TokenFactoryProvidersTab = isPro() ? dynamic(() => import("./TokenFactoryProvidersTab").then(m => ({ default: m.TokenFactoryProvidersTab }))) : NullTab;
const SkyPilotTab = isPro() ? dynamic(() => import("./SkyPilotTab").then(m => ({ default: m.SkyPilotTab }))) : NullTab;
const SpheronInventoryTab = isPro() ? dynamic(() => import("./SpheronInventoryTab").then(m => ({ default: m.SpheronInventoryTab }))) : NullTab;
const MarketingTab = isPro() ? dynamic(() => import("./MarketingTab").then(m => ({ default: m.MarketingTab }))) : NullTab;
const TenantsTab = isPro() ? dynamic(() => import("./TenantsTab").then(m => ({ default: m.TenantsTab }))) : NullTab;
const PixelFactoryTab = isPro() ? dynamic(() => import("./PixelFactoryTab").then(m => ({ default: m.PixelFactoryTab }))) : NullTab;
const InfrastructureRequestsTab = isPro() ? dynamic(() => import("./InfrastructureRequestsTab").then(m => ({ default: m.InfrastructureRequestsTab }))) : NullTab;
const DealCalculators = isPro() ? dynamic(() => import("./DealCalculator").then(m => ({ default: m.DealCalculators }))) : NullTab;
const InvestorsTab = isPro() ? dynamic(() => import("./InvestorsTab").then(m => ({ default: m.InvestorsTab }))) : NullTab;
const GameStatsTab = isPro() ? dynamic(() => import("./GameStatsTab").then(m => ({ default: m.GameStatsTab }))) : NullTab;
const LandingPageTab = isPro() ? dynamic(() => import("./LandingPageTab").then(m => ({ default: m.LandingPageTab }))) : NullTab;
const NodeRevenueTab = isPro() ? dynamic(() => import("./NodeRevenueTab").then(m => ({ default: m.NodeRevenueTab }))) : NullTab;
const PayoutsTab = isPro() ? dynamic(() => import("./PayoutsTab").then(m => ({ default: m.PayoutsTab }))) : NullTab;

// Premium modals — dynamically imported
const ClusterModal = isPro() ? dynamic(() => import("./ClusterModal").then(m => ({ default: m.ClusterModal }))) : NullTab;
const QuoteModal = isPro() ? dynamic(() => import("./QuoteModal").then(m => ({ default: m.QuoteModal }))) : NullTab;
const QuoteViewModal = isPro() ? dynamic(() => import("./QuoteViewModal").then(m => ({ default: m.QuoteViewModal }))) : NullTab;
const EmailPreviewModal = isPro() ? dynamic(() => import("./EmailPreviewModal").then(m => ({ default: m.EmailPreviewModal }))) : NullTab;
const InfrastructureRequestModal = isPro() ? dynamic(() => import("./InfrastructureRequestModal").then(m => ({ default: m.InfrastructureRequestModal }))) : NullTab;

export function AdminDashboard() {
  const router = useRouter();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Investor state
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [newInvestorEmail, setNewInvestorEmail] = useState("");
  const [investorActionLoading, setInvestorActionLoading] = useState<string | null>(null);
  const [revenueInvestorEmail, setRevenueInvestorEmail] = useState<string | null>(null);

  // Infrastructure requests state
  const [infrastructureRequests, setInfrastructureRequests] = useState<InfrastructureRequest[]>([]);

  // Service capability gating
  const { isConfigured } = useServiceStatus();

  // Data hook
  const {
    loading,
    adminEmail,
    stats,
    customers,
    admins,
    canResetPin,
    clusterOffers,
    quotes,
    pricing,
    activities,
    activitiesLoading,
    search,
    activeTab,
    customersPage,
    customersTotalPages,
    customersTotal,
    customersSortBy,
    customersSortDir,
    customersLoading,
    setSearch,
    setActiveTab,
    setPricing,
    loadData,
    loadActivities,
    handleSearch,
    clearSearch,
    handleCustomersSort,
    handleCustomersPageChange,
  } = useAdminData();

  // Actions hook
  const {
    actionLoading,
    creditModalCustomer,
    creditAmount,
    newAdminEmail,
    pricingForm,
    pricingSaving,
    setCreditModalCustomer,
    setCreditAmount,
    setNewAdminEmail,
    setPricingForm,
    initPricingForm,
    handleCustomerAction,
    handleLoginAs,
    handleHostedAiLogin,
    handleDeleteCustomer,
    handleAddAdmin,
    handleRemoveAdmin,
    handleResendInvite,
    handleResetPin,
    handleAdjustCredits,
    handleSavePricing,
    handleLogout,
  } = useAdminActions(loadData);

  // Initialize pricing form when pricing data loads
  useEffect(() => {
    if (pricing) {
      initPricingForm(pricing);
    }
  }, [pricing, initPricingForm]);

  // Cluster management hook
  const {
    clusterModalOpen,
    editingCluster,
    clusterForm,
    clusterSaving,
    highlightInput,
    imageUploading,
    setClusterForm,
    setHighlightInput,
    openClusterModal,
    closeClusterModal,
    handleImageUpload,
    handleSaveCluster,
    handleDeleteCluster,
    addHighlight,
    removeHighlight,
    removeImage,
  } = useClusterManagement(loadData);

  // Quote management hook
  const {
    quoteModalOpen,
    editingQuote,
    quoteForm,
    quoteSaving,
    quoteViewModalOpen,
    viewingQuote,
    emailPreviewModalOpen,
    emailPreview,
    emailPreviewLoading,
    emailSending,
    previewQuoteId,
    setQuoteForm,
    openQuoteModal,
    closeQuoteModal,
    handleSaveQuote,
    handleDeleteQuote,
    viewQuoteDetails,
    closeQuoteViewModal,
    handlePreviewEmail,
    handleSendEmail,
    closeEmailPreviewModal,
    prefillQuoteFromCluster,
    copyQuoteUrl,
  } = useQuoteManagement(loadData);

  // Infrastructure request management hook
  const {
    requestModalOpen,
    editingRequest,
    requestForm,
    requestSaving,
    locationInput,
    setRequestForm,
    setLocationInput,
    openRequestModal,
    closeRequestModal,
    handleSaveRequest,
    handleDeleteRequest,
    addLocation,
    removeLocation,
  } = useInfrastructureRequestManagement(async () => {
    await loadInfrastructureRequests();
  });

  // Load infrastructure requests
  const loadInfrastructureRequests = async () => {
    try {
      const res = await fetch("/api/admin/infrastructure-requests");
      const data = await res.json();
      if (data.requests) {
        setInfrastructureRequests(data.requests);
      }
    } catch (error) {
      console.error("Failed to load infrastructure requests:", error);
    }
  };

  // Load investors
  const loadInvestors = async () => {
    try {
      const res = await fetch("/api/admin/investors");
      const data = await res.json();
      if (data.success) {
        setInvestors(data.data);
      }
    } catch (error) {
      console.error("Failed to load investors:", error);
    }
  };

  // Load investors when tab changes to investors
  useEffect(() => {
    if (activeTab === "investors") {
      loadInvestors();
    }
  }, [activeTab]);

  // Load infrastructure requests when tab changes to demand
  useEffect(() => {
    if (activeTab === "demand") {
      loadInfrastructureRequests();
    }
  }, [activeTab]);

  // Investor handlers
  const handleAddInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvestorEmail) return;

    setInvestorActionLoading(`add-${newInvestorEmail}`);
    try {
      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", email: newInvestorEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setNewInvestorEmail("");
        loadInvestors();
      } else {
        alert(data.error || "Failed to add investor");
      }
    } catch (error) {
      console.error("Failed to add investor:", error);
      alert("Failed to add investor");
    } finally {
      setInvestorActionLoading(null);
    }
  };

  const handleRemoveInvestor = async (email: string) => {
    if (!confirm(`Are you sure you want to remove ${email}?`)) return;

    setInvestorActionLoading(`remove-${email}`);
    try {
      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", email }),
      });
      const data = await res.json();
      if (data.success) {
        loadInvestors();
      } else {
        alert(data.error || "Failed to remove investor");
      }
    } catch (error) {
      console.error("Failed to remove investor:", error);
      alert("Failed to remove investor");
    } finally {
      setInvestorActionLoading(null);
    }
  };

  const handleResendInvestorInvite = async (email: string) => {
    setInvestorActionLoading(`resend-${email}`);
    try {
      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend-invite", email }),
      });
      const data = await res.json();
      if (data.success) {
        alert("Invite sent successfully");
      } else {
        alert(data.error || "Failed to send invite");
      }
    } catch (error) {
      console.error("Failed to resend invite:", error);
      alert("Failed to send invite");
    } finally {
      setInvestorActionLoading(null);
    }
  };

  const handleLoginAsInvestor = async (email: string) => {
    setInvestorActionLoading(`login-${email}`);
    try {
      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-as", email }),
      });
      const data = await res.json();
      if (data.success && data.data?.loginUrl) {
        window.open(data.data.loginUrl, "_blank");
      } else {
        alert(data.error || "Failed to login as investor");
      }
    } catch (error) {
      console.error("Failed to login as investor:", error);
      alert("Failed to login as investor");
    } finally {
      setInvestorActionLoading(null);
    }
  };

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    if (tab === "activity") {
      loadActivities();
    }
  };

  const handleViewQuoteFromActivity = (quote: Quote) => {
    viewQuoteDetails(quote);
  };

  const handleSwitchToQuotes = () => {
    setActiveTab("quotes");
  };

  const doLogout = async () => {
    await handleLogout(router);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <p className="text-xl text-[#0b0f1c]">Loading...</p>
      </div>
    );
  }

  // Get tab label for header
  const getTabLabel = (tab: AdminTab) => {
    const labels: Record<AdminTab, string> = {
      customers: "Customers",
      admins: "Administrators",
      investors: "Investors",
      clusters: "Cluster Offers",
      quotes: "Quotes",
      providers: "Providers",
      referrals: "Referrals",
      vouchers: "Vouchers",
      activity: "Activity Log",
      settings: "Settings",
      calculator: "Deal Calculator",
      qa: "QA Tools",
      landing: "Landing Page",
      game: "GPU Tetris Stats",
      products: "GPU Products",
      pods: "GPU Pods",
      emails: "Email Templates",
      "email-log": "Email Delivery Log",
      drip: "Drip Campaigns",
      nodes: "Node Monitoring",
      pools: "Pool Overview",
      business: "Business Metrics",
      demand: "Infrastructure Demand",
      batches: "Batch Jobs",
      "token-providers": "Token Provider Revenue",
      skypilot: "SkyPilot Integration",
      support: "Support Tickets",
      spheron: "Spheron Inventory",
      "node-revenue": "Node Revenue",
      banners: "Campaign Banners",
      marketing: "Marketing",
      tenants: "White-Label Tenants",
      "pixel-factory": "Pixel Factory",
      uptime: "Pod Uptime",
      payouts: "Investor Payouts",
      "platform-settings": "Platform Settings",
      "gpu-apps": "GPU Apps",
    };
    return labels[tab];
  };

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      {/* Sidebar */}
      <AdminSidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onLogout={() => setShowLogoutModal(true)}
        adminEmail={adminEmail}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Content */}
      <div className={`min-h-screen transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"}`}>
        {/* Top Header with Stats */}
        <header className="bg-white border-b border-[#e4e7ef] px-8 py-6">
          <h1 className="text-2xl font-bold text-[#0b0f1c] mb-4">{getTabLabel(activeTab)}</h1>

          {/* Stats Row */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Total Customers</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.totalCustomers}</p>
              {stats.growth && (
                <p className={`text-xs mt-1 ${stats.growth.totalCustomers >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {stats.growth.totalCustomers >= 0 ? "+" : ""}{stats.growth.totalCustomers} from yesterday
                </p>
              )}
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Active Pods</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.activePods}</p>
              {stats.growth && (
                <p className={`text-xs mt-1 ${stats.growth.activePods >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {stats.growth.activePods >= 0 ? "+" : ""}{stats.growth.activePods} from yesterday
                </p>
              )}
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">MRR</p>
              <p className="text-xl font-bold text-[#0b0f1c]">${(stats.mrr / 100).toFixed(2)}</p>
              {stats.growth && (
                <p className={`text-xs mt-1 ${stats.growth.mrr >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {stats.growth.mrr >= 0 ? "+" : ""}{stats.growth.mrr >= 0 ? "$" : "-$"}{(Math.abs(stats.growth.mrr) / 100).toFixed(0)} from yesterday
                </p>
              )}
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">New This Week</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.newCustomersThisWeek}</p>
              {stats.growth && (
                <p className={`text-xs mt-1 ${stats.growth.newCustomersThisWeek >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {stats.growth.newCustomersThisWeek >= 0 ? "+" : ""}{stats.growth.newCustomersThisWeek} from yesterday
                </p>
              )}
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Revenue This Week</p>
              <p className="text-xl font-bold text-[#0b0f1c]">${(stats.revenueThisWeek / 100).toFixed(2)}</p>
              {stats.growth && (
                <p className={`text-xs mt-1 ${stats.growth.revenueThisWeek >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {stats.growth.revenueThisWeek >= 0 ? "+" : ""}{stats.growth.revenueThisWeek >= 0 ? "$" : "-$"}{(Math.abs(stats.growth.revenueThisWeek) / 100).toFixed(0)} from yesterday
                </p>
              )}
            </div>
          </div>
        </header>

        {/* Tab Content */}
        <main className="p-8">
        {/* Premium tabs are hidden from sidebar in OSS, but guard rendering too */}
        {!isPro() && PREMIUM_ADMIN_TABS.has(activeTab) && (
          <div className="text-center py-20 text-gray-500">
            <p>This feature is available in the Pro edition.</p>
          </div>
        )}

        {/* OSS-only tabs are hidden from sidebar in Pro, but guard rendering too */}
        {!isOSS() && OSS_ONLY_ADMIN_TABS.has(activeTab) && (
          <div className="text-center py-20 text-gray-500">
            <p>This feature is available in the self-hosted edition.</p>
          </div>
        )}

        {activeTab === "customers" && (
          <CustomersTab
            customers={customers}
            search={search}
            actionLoading={actionLoading}
            page={customersPage}
            totalPages={customersTotalPages}
            total={customersTotal}
            sortBy={customersSortBy}
            sortDir={customersSortDir}
            customersLoading={customersLoading}
            onSearchChange={setSearch}
            onSearch={handleSearch}
            onClearSearch={clearSearch}
            onLoginAs={handleLoginAs}
            onHostedAiLogin={handleHostedAiLogin}
            onCustomerAction={handleCustomerAction}
            onOpenCreditModal={setCreditModalCustomer}
            onDeleteCustomer={handleDeleteCustomer}
            onSelectCustomer={setSelectedCustomerId}
            onSort={handleCustomersSort}
            onPageChange={handleCustomersPageChange}
          />
        )}

        {activeTab === "admins" && (
          <AdminsTab
            admins={admins}
            adminEmail={adminEmail}
            newAdminEmail={newAdminEmail}
            actionLoading={actionLoading}
            canResetPin={canResetPin}
            onNewAdminEmailChange={setNewAdminEmail}
            onAddAdmin={handleAddAdmin}
            onRemoveAdmin={handleRemoveAdmin}
            onResendInvite={handleResendInvite}
            onResetPin={handleResetPin}
          />
        )}

        {activeTab === "investors" && (
          <InvestorsTab
            investors={investors}
            newInvestorEmail={newInvestorEmail}
            actionLoading={investorActionLoading}
            onNewInvestorEmailChange={setNewInvestorEmail}
            onAddInvestor={handleAddInvestor}
            onRemoveInvestor={handleRemoveInvestor}
            onResendInvite={handleResendInvestorInvite}
            onLoginAs={handleLoginAsInvestor}
            onViewRevenue={(investor: Investor) => {
              setRevenueInvestorEmail(investor.email);
              setActiveTab("node-revenue");
            }}
          />
        )}

        {activeTab === "clusters" && (
          <ClustersTab
            clusterOffers={clusterOffers}
            onOpenModal={openClusterModal}
            onDelete={handleDeleteCluster}
          />
        )}

        {activeTab === "quotes" && (
          <QuotesTab
            quotes={quotes}
            emailPreviewLoading={emailPreviewLoading}
            previewQuoteId={previewQuoteId}
            onOpenModal={openQuoteModal}
            onViewDetails={viewQuoteDetails}
            onCopyUrl={copyQuoteUrl}
            onPreviewEmail={handlePreviewEmail}
            onDelete={handleDeleteQuote}
          />
        )}

        {activeTab === "referrals" && <ReferralsTab />}

        {activeTab === "providers" && <ProvidersTab />}

        {activeTab === "vouchers" && <VouchersTab />}

        {activeTab === "activity" && (
          <ActivityTab
            activities={activities}
            activitiesLoading={activitiesLoading}
            quotes={quotes}
            onRefresh={loadActivities}
            onViewQuote={handleViewQuoteFromActivity}
            onSwitchToQuotes={handleSwitchToQuotes}
          />
        )}

        {activeTab === "settings" && (
          <SettingsTab
            pricing={pricing}
            pricingForm={pricingForm}
            pricingSaving={pricingSaving}
            onPricingFormChange={setPricingForm}
            onSavePricing={(e) => handleSavePricing(e, setPricing)}
          />
        )}

        {activeTab === "calculator" && <DealCalculators />}

        {activeTab === "qa" && <QATab adminEmail={adminEmail} />}

        {activeTab === "landing" && <LandingPageTab />}

        {activeTab === "game" && <GameStatsTab />}

        {activeTab === "products" && <ProductsTab />}

        {activeTab === "gpu-apps" && <GpuAppsTab />}

        {activeTab === "pods" && (
          <>
            <ServiceRequiredBanner serviceName="hostedai" serviceLabel="GPU Backend (hosted.ai)" configured={isConfigured("hostedai")} />
            <PodsTab />
          </>
        )}

        {activeTab === "emails" && (
          <>
            <ServiceRequiredBanner serviceName="smtp" serviceLabel="Email Delivery" configured={isConfigured("smtp")} />
            <EmailTemplatesTab />
          </>
        )}

        {activeTab === "email-log" && <EmailLogTab />}

        {activeTab === "drip" && (
          <>
            <ServiceRequiredBanner serviceName="smtp" serviceLabel="Email Delivery" configured={isConfigured("smtp")} />
            <DripTab />
          </>
        )}

        {activeTab === "nodes" && <NodeMonitoringTab />}

        {activeTab === "pools" && <PoolOverviewTab />}

        {activeTab === "business" && <BusinessTab />}

        {activeTab === "demand" && (
          <InfrastructureRequestsTab
            requests={infrastructureRequests}
            onOpenModal={openRequestModal}
            onDelete={handleDeleteRequest}
          />
        )}

        {activeTab === "batches" && <BatchesTab />}

        {activeTab === "token-providers" && <TokenFactoryProvidersTab />}

        {activeTab === "skypilot" && <SkyPilotTab />}

        {activeTab === "support" && (
          isPro() && SupportTab ? (
            <>
              <ServiceRequiredBanner serviceName="zammad" serviceLabel="Support (Zammad)" configured={isConfigured("zammad")} />
              <SupportTab onOpenCustomer={setSelectedCustomerId} />
            </>
          ) : (
            <OssAdminSupportTab />
          )
        )}

        {activeTab === "spheron" && <SpheronInventoryTab />}

        {activeTab === "banners" && <BannersTab />}

        {activeTab === "marketing" && <MarketingTab />}

        {activeTab === "tenants" && <TenantsTab />}

        {activeTab === "pixel-factory" && <PixelFactoryTab />}

        {activeTab === "uptime" && <UptimeTab />}

        {activeTab === "payouts" && <PayoutsTab />}

        {activeTab === "platform-settings" && <PlatformSettingsTab />}

        {activeTab === "node-revenue" && (
          <NodeRevenueTab
            investorEmail={revenueInvestorEmail || undefined}
            investorLabel={revenueInvestorEmail || undefined}
            onBack={() => {
              setRevenueInvestorEmail(null);
              setActiveTab("investors");
            }}
          />
        )}
        </main>
      </div>

      {/* Modals */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={doLogout}
        variant="light"
      />

      {clusterModalOpen && (
        <ClusterModal
          editingCluster={editingCluster}
          clusterForm={clusterForm}
          clusterSaving={clusterSaving}
          highlightInput={highlightInput}
          imageUploading={imageUploading}
          onFormChange={setClusterForm}
          onHighlightInputChange={setHighlightInput}
          onAddHighlight={addHighlight}
          onRemoveHighlight={removeHighlight}
          onImageUpload={handleImageUpload}
          onRemoveImage={removeImage}
          onSubmit={handleSaveCluster}
          onClose={closeClusterModal}
        />
      )}

      {requestModalOpen && (
        <InfrastructureRequestModal
          editingRequest={editingRequest}
          form={requestForm}
          saving={requestSaving}
          locationInput={locationInput}
          onFormChange={setRequestForm}
          onLocationInputChange={setLocationInput}
          onAddLocation={addLocation}
          onRemoveLocation={removeLocation}
          onSubmit={handleSaveRequest}
          onClose={closeRequestModal}
        />
      )}

      {quoteModalOpen && (
        <QuoteModal
          editingQuote={editingQuote}
          quoteForm={quoteForm}
          quoteSaving={quoteSaving}
          clusterOffers={clusterOffers}
          onFormChange={setQuoteForm}
          onPrefillFromCluster={(id: string) => prefillQuoteFromCluster(id, clusterOffers)}
          onSubmit={handleSaveQuote}
          onClose={closeQuoteModal}
        />
      )}

      {creditModalCustomer && (
        <CreditModal
          customer={creditModalCustomer}
          creditAmount={creditAmount}
          actionLoading={actionLoading}
          onCreditAmountChange={setCreditAmount}
          onSubmit={handleAdjustCredits}
          onClose={() => { setCreditModalCustomer(null); setCreditAmount(""); }}
        />
      )}

      {emailPreviewModalOpen && emailPreview && (
        <EmailPreviewModal
          emailPreview={emailPreview}
          emailSending={emailSending}
          onSend={handleSendEmail}
          onClose={closeEmailPreviewModal}
        />
      )}

      {quoteViewModalOpen && viewingQuote && (
        <QuoteViewModal
          quote={viewingQuote}
          onClose={closeQuoteViewModal}
          onEdit={(quote: Quote) => { closeQuoteViewModal(); openQuoteModal(quote); }}
        />
      )}

      {selectedCustomerId && (
        <CustomerDetailPanel
          customerId={selectedCustomerId}
          onClose={() => setSelectedCustomerId(null)}
          onCustomerUpdated={loadData}
        />
      )}
    </div>
  );
}
