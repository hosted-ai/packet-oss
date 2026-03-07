"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdminData, useAdminActions } from "../hooks";
import type { AdminTab, Investor } from "../types";
import {
  CustomersTab,
  AdminsTab,
  InvestorsTab,
  ReferralsTab,
  VouchersTab,
  ActivityTab,
  SettingsTab,
  QATab,
  ProvidersTab,
  LandingPageTab,
  GameStatsTab,
  ProductsTab,
  PodsTab,
  EmailTemplatesTab,
  DripTab,
  NodeMonitoringTab,
  PoolOverviewTab,
  BusinessTab,
  CreditModal,
  CustomerDetailPanel,
  SkyPilotTab,
  SupportTab,

  NodeRevenueTab,
  BannersTab,
  MarketingTab,
  UptimeTab,
  PayoutsTab,
  PlatformSettingsTab,
} from "./index";
import { AdminSidebar } from "./AdminSidebar";
import { LogoutConfirmModal } from "@/components/logout-confirm-modal";

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

  // Data hook
  const {
    loading,
    adminEmail,
    stats,
    customers,
    admins,
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
      providers: "Providers",
      referrals: "Referrals",
      vouchers: "Vouchers",
      activity: "Activity Log",
      settings: "Settings",
      qa: "QA Tools",
      landing: "Landing Page",
      game: "GPU Tetris Stats",
      products: "GPU Products",
      pods: "GPU Pods",
      emails: "Email Templates",
      drip: "Drip Campaigns",
      nodes: "Node Monitoring",
      pools: "Pool Overview",
      business: "Business Metrics",
      skypilot: "SkyPilot Integration",
      support: "Support Tickets",

      "node-revenue": "Node Revenue",
      banners: "Campaign Banners",
      marketing: "Marketing",
      uptime: "Pod Uptime",
      payouts: "Investor Payouts",
      "platform-settings": "Platform Settings",
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
            canResetPin={true}
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
            onViewRevenue={(investor) => {
              setRevenueInvestorEmail(investor.email);
              setActiveTab("node-revenue");
            }}
          />
        )}

        {activeTab === "referrals" && <ReferralsTab />}

        {activeTab === "providers" && <ProvidersTab />}

        {activeTab === "vouchers" && <VouchersTab />}

        {activeTab === "activity" && (
          <ActivityTab
            activities={activities}
            activitiesLoading={activitiesLoading}
            onRefresh={loadActivities}
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

        {activeTab === "qa" && <QATab adminEmail={adminEmail} />}

        {activeTab === "landing" && <LandingPageTab />}

        {activeTab === "game" && <GameStatsTab />}

        {activeTab === "products" && <ProductsTab />}

        {activeTab === "pods" && <PodsTab />}

        {activeTab === "emails" && <EmailTemplatesTab />}

        {activeTab === "drip" && <DripTab />}

        {activeTab === "nodes" && <NodeMonitoringTab />}

        {activeTab === "pools" && <PoolOverviewTab />}

        {activeTab === "business" && <BusinessTab />}

        {activeTab === "skypilot" && <SkyPilotTab />}

        {activeTab === "support" && <SupportTab onOpenCustomer={setSelectedCustomerId} />}


        {activeTab === "banners" && <BannersTab />}

        {activeTab === "marketing" && <MarketingTab />}

        {activeTab === "platform-settings" && <PlatformSettingsTab />}

        {activeTab === "uptime" && <UptimeTab />}

        {activeTab === "payouts" && <PayoutsTab />}

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
