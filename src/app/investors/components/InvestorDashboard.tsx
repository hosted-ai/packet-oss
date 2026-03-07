"use client";

import Image from "next/image";
import Link from "next/link";
import { useInvestorData, useInvestorActions } from "../hooks";
import { StatsDisplay } from "./StatsDisplay";
import { AccountSettings } from "./AccountSettings";
import { InvestorManagement } from "./InvestorManagement";

export function InvestorDashboard() {
  const {
    loading,
    email,
    dashboardData,
    dataLoading,
    dataError,
    investors,
    isOwner,
    fetchDashboard,
    fetchInvestors,
    router,
  } = useInvestorData();

  const {
    newInvestorEmail,
    addingInvestor,
    investorError,
    resendingInvite,
    setNewInvestorEmail,
    handleAddInvestor,
    handleRemoveInvestor,
    handleResendInvite,
    handleLogout,
  } = useInvestorActions(fetchInvestors);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f8fb] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#1a4fff] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#5b6476]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      {/* Header */}
      <header className="border-b border-[#e4e7ef] bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/packet-logo.png"
              alt="GPU Cloud"
              width={120}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-[#1a4fff] text-sm font-medium">Investors</span>
          </Link>

          <div className="flex items-center gap-4">
            <span className="text-[#5b6476] text-sm">{email}</span>
            <button
              onClick={() => handleLogout(router)}
              className="text-sm text-[#5b6476] hover:text-[#0b0f1c] transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#0b0f1c]">Investor Dashboard</h1>
            {dashboardData?._cachedAt ? (
              <p className="text-[#5b6476] mt-1 text-sm">
                Data from{" "}
                <span className="font-medium text-[#0b0f1c]">
                  {new Date(dashboardData._cachedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {dashboardData._nextUpdateAt && (
                  <>
                    {" "}&middot; Next update{" "}
                    {new Date(dashboardData._nextUpdateAt).toLocaleString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
            ) : (
              <p className="text-[#5b6476] mt-1">
                Revenue and GPU fleet performance
              </p>
            )}
          </div>
          <button
            onClick={fetchDashboard}
            disabled={dataLoading}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg text-sm font-medium transition-colors disabled:bg-gray-400"
          >
            {dataLoading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>

        {dataError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {dataError}
          </div>
        )}

        {dashboardData && <StatsDisplay data={dashboardData} />}

        {!dashboardData && !dataLoading && !dataError && (
          <div className="bg-white border border-[#e4e7ef] rounded-xl p-8 text-center text-[#5b6476]">
            Loading dashboard data...
          </div>
        )}

        <AccountSettings />

        {isOwner && (
          <InvestorManagement
            investors={investors}
            newInvestorEmail={newInvestorEmail}
            addingInvestor={addingInvestor}
            investorError={investorError}
            resendingInvite={resendingInvite}
            onNewInvestorEmailChange={setNewInvestorEmail}
            onAddInvestor={handleAddInvestor}
            onRemoveInvestor={handleRemoveInvestor}
            onResendInvite={handleResendInvite}
          />
        )}
      </div>
    </div>
  );
}
