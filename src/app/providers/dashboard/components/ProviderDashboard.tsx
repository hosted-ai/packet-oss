"use client";

import { useState } from "react";
import { useProviderData, useProviderActions } from "../hooks";
import type { ProviderTab } from "../types";
import { InfrastructureTab } from "./InfrastructureTab";
import { RatesTab } from "./RatesTab";
import { RevenueTab } from "./RevenueTab";
import { PayoutsTab } from "./PayoutsTab";
import { SettingsTab } from "./SettingsTab";
import { DocsTab } from "./DocsTab";
import { AddServerModal } from "./AddServerModal";
import { ProviderSidebar } from "./ProviderSidebar";
import { LogoutConfirmModal } from "@/components/logout-confirm-modal";

export function ProviderDashboard() {
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const {
    loading,
    activeTab,
    setActiveTab,
    profile,
    setProfile,
    nodes,
    stats,
    revenue,
    revenueLoading,
    revenuePeriod,
    payoutData,
    payoutsLoading,
    isAdminSession,
    adminEmail,
    handlePeriodChange,
    refreshNodes,
    refreshRevenue,
    refreshPayouts,
  } = useProviderData();

  const {
    actionLoading,
    addNodeModalOpen,
    nodeForm,
    setNodeForm,
    nodeSaving,
    nodeError,
    handleAddNode,
    handleRemoveNode,
    handleCancelRemoval,
    handleUpdateProfile,
    handleLogout,
    openAddNodeModal,
    closeAddNodeModal,
  } = useProviderActions(refreshNodes, setProfile);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <p className="text-xl text-[#0b0f1c]">Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <p className="text-xl text-[#0b0f1c]">Unable to load profile</p>
      </div>
    );
  }

  // Get tab label for header
  const getTabLabel = (tab: ProviderTab) => {
    const labels: Record<ProviderTab, string> = {
      infrastructure: "Infrastructure",
      rates: "Rates",
      revenue: "Revenue",
      payouts: "Payouts",
      settings: "Settings",
      docs: "Documentation",
    };
    return labels[tab];
  };

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      {/* Sidebar */}
      <ProviderSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={() => setShowLogoutModal(true)}
        companyName={profile.companyName}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isAdminSession={isAdminSession}
      />

      {/* Main Content */}
      <div className={`min-h-screen transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-72"}`}>
        {/* Top Header with Stats */}
        <header className="bg-white border-b border-[#e4e7ef] px-8 py-6">
          {/* Admin Session Banner */}
          {isAdminSession && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-amber-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span className="text-amber-800 font-medium">
                    Admin Session: Viewing as {profile.companyName}
                  </span>
                </div>
                <span className="text-amber-600 text-sm">
                  Logged in as {adminEmail}
                </span>
              </div>
            </div>
          )}

          <h1 className="text-2xl font-bold text-[#0b0f1c] mb-4">{getTabLabel(activeTab)}</h1>

          {/* Stats Row */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Active Servers</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.activeNodes}</p>
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Total GPUs</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.totalGpus}</p>
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Utilization</p>
              <p className="text-xl font-bold text-[#0b0f1c]">{stats.utilizationPercent.toFixed(0)}%</p>
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">This Month</p>
              <p className="text-xl font-bold text-[#0b0f1c]">${stats.thisMonthEarnings.toFixed(2)}</p>
            </div>
            <div className="bg-[#f7f8fb] rounded-lg p-3">
              <p className="text-[#5b6476] text-xs">Last Month</p>
              <p className="text-xl font-bold text-[#0b0f1c]">${stats.lastMonthEarnings.toFixed(2)}</p>
            </div>
          </div>
        </header>

        {/* Status Badge */}
        {profile.status !== "active" && (
          <div className="px-8 pt-6">
            <div
              className={`p-4 rounded-lg ${
                profile.status === "pending"
                  ? "bg-yellow-50 border border-yellow-200"
                  : "bg-red-50 border border-red-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    profile.status === "pending" ? "bg-yellow-500" : "bg-red-500"
                  }`}
                />
                <span
                  className={
                    profile.status === "pending"
                      ? "text-yellow-800"
                      : "text-red-800"
                  }
                >
                  {profile.status === "pending"
                    ? "Your account is pending approval. You can add servers but they won't go live until approved."
                    : "Your account has been suspended. Please contact support."}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <main className="p-8">
          {activeTab === "infrastructure" && (
            <InfrastructureTab
              nodes={nodes}
              stats={stats}
              actionLoading={actionLoading}
              onAddServer={openAddNodeModal}
              onRemoveServer={handleRemoveNode}
              onCancelRemoval={handleCancelRemoval}
              onRefresh={refreshNodes}
            />
          )}

          {activeTab === "rates" && <RatesTab />}

          {activeTab === "revenue" && (
            <RevenueTab
              revenue={revenue}
              loading={revenueLoading}
              period={revenuePeriod}
              onPeriodChange={handlePeriodChange}
              onRefresh={refreshRevenue}
            />
          )}

          {activeTab === "payouts" && (
            <PayoutsTab
              data={payoutData}
              loading={payoutsLoading}
              onRefresh={refreshPayouts}
            />
          )}

          {activeTab === "settings" && (
            <SettingsTab
              profile={profile}
              actionLoading={actionLoading === "profile"}
              onUpdateProfile={handleUpdateProfile}
            />
          )}

          {activeTab === "docs" && <DocsTab />}
        </main>
      </div>

      {/* Modals */}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
        variant="light"
      />

      {addNodeModalOpen && (
        <AddServerModal
          form={nodeForm}
          saving={nodeSaving}
          error={nodeError}
          onFormChange={setNodeForm}
          onSubmit={handleAddNode}
          onClose={closeAddNodeModal}
        />
      )}
    </div>
  );
}
