"use client";

import { useState } from "react";
import type { Customer } from "../types";

type SortField = "teamId" | "productId" | "walletBalance" | "activeGPUs" | "created";

interface CustomersTabProps {
  customers: Customer[];
  search: string;
  actionLoading: string | null;
  page: number;
  totalPages: number;
  total: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  customersLoading: boolean;
  onSearchChange: (search: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  onLoginAs: (customerId: string) => void;
  onHostedAiLogin: (customerId: string) => void;
  onCustomerAction: (customerId: string, action: string) => void;
  onOpenCreditModal: (customer: Customer) => void;
  onDeleteCustomer: (customer: Customer) => void;
  onSelectCustomer: (customerId: string) => void;
  onSort: (field: string) => void;
  onPageChange: (page: number) => void;
}

function formatRelativeTime(unix: number): string {
  const now = Date.now() / 1000;
  const diff = now - unix;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

export function CustomersTab({
  customers,
  search,
  actionLoading,
  page,
  totalPages,
  total,
  sortBy,
  sortDir,
  customersLoading,
  onSearchChange,
  onSearch,
  onClearSearch,
  onLoginAs,
  onHostedAiLogin,
  onCustomerAction,
  onOpenCreditModal,
  onDeleteCustomer,
  onSelectCustomer,
  onSort,
  onPageChange,
}: CustomersTabProps) {
  const [exporting, setExporting] = useState(false);

  const sortIcon = (field: SortField) => {
    if (sortBy !== field) return <span className="ml-1 text-[#c4c9d4]">&uarr;&darr;</span>;
    return <span className="ml-1 text-[#1a4fff]">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>;
  };

  const getPageNumbers = (): (number | "...")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "...")[] = [1];
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
    return pages;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/customers/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "customers.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <button
          onClick={onSearch}
          className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg"
        >
          Search
        </button>
        <button
          onClick={onClearSearch}
          className="px-4 py-2 bg-white border border-[#e4e7ef] hover:bg-gray-50 text-[#0b0f1c] rounded-lg"
        >
          Clear
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 bg-white border border-[#e4e7ef] hover:bg-gray-50 text-[#0b0f1c] rounded-lg disabled:opacity-50 flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
        <span className="text-sm text-[#5b6476] ml-2 whitespace-nowrap">
          {total} customer{total !== 1 ? "s" : ""}
        </span>
      </div>

      <div className={`bg-white border border-[#e4e7ef] rounded-lg overflow-hidden ${customersLoading ? "opacity-60" : ""}`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476] cursor-pointer select-none hover:text-[#0b0f1c]" onClick={() => onSort("teamId")}>Team ID{sortIcon("teamId")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476] cursor-pointer select-none hover:text-[#0b0f1c]" onClick={() => onSort("productId")}>Plan{sortIcon("productId")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476] cursor-pointer select-none hover:text-[#0b0f1c]" onClick={() => onSort("walletBalance")}>Credits{sortIcon("walletBalance")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476] cursor-pointer select-none hover:text-[#0b0f1c]" onClick={() => onSort("activeGPUs")}>Active GPUs{sortIcon("activeGPUs")}</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476] cursor-pointer select-none hover:text-[#0b0f1c]" onClick={() => onSort("created")}>Signed Up{sortIcon("created")}</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e7ef]">
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectCustomer(customer.id)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#0b0f1c]">{customer.name || "\u2014"}</p>
                    <p className="text-sm text-[#5b6476]">{customer.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {customer.teamId ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(customer.teamId);
                        }}
                        className="text-[#5b6476] hover:text-[#1a4fff] transition-colors"
                        title={customer.teamId}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    ) : (
                      <span className="text-sm text-[#5b6476]">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[#0b0f1c]">{customer.productId || "\u2014"}</span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {customer.walletBalance === 0 ? (
                      <span className="text-sm text-[#c4c9d4]">$0.00</span>
                    ) : (
                      <button
                        onClick={() => onOpenCreditModal(customer)}
                        className={`text-sm font-medium ${
                          customer.billingType === "hourly"
                            ? "text-emerald-600 hover:text-emerald-700"
                            : "text-blue-600 hover:text-blue-700"
                        }`}
                      >
                        ${(customer.walletBalance / 100).toFixed(2)}
                        {customer.billingType && customer.billingType !== "hourly" && (
                          <span className="ml-1 text-xs font-normal text-[#5b6476]">
                            {customer.billingType}
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {customer.activeGPUs > 0 ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                        {customer.activeGPUs} GPU{customer.activeGPUs !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-[#5b6476]">
                        0
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#5b6476]">
                    {new Date(customer.created * 1000).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {customer.teamId && (
                        <button
                          onClick={() => onHostedAiLogin(customer.id)}
                          disabled={actionLoading === `hostedai-${customer.id}`}
                          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                        >
                          {actionLoading === `hostedai-${customer.id}` ? "..." : "Hosted.ai"}
                        </button>
                      )}
                      <button
                        onClick={() => onLoginAs(customer.id)}
                        disabled={actionLoading === customer.id}
                        className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded disabled:opacity-50"
                      >
                        Login As
                      </button>
                      <button
                        onClick={() => onCustomerAction(customer.id, "send-credentials")}
                        disabled={actionLoading === customer.id}
                        className="text-xs px-2 py-1 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded disabled:opacity-50"
                      >
                        Send Credentials
                      </button>
                      <button
                        onClick={() => onDeleteCustomer(customer)}
                        disabled={actionLoading === `delete-${customer.id}`}
                        className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                        title="Delete customer"
                      >
                        {actionLoading === `delete-${customer.id}` ? "..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#5b6476]">
                    {customersLoading ? "Loading customers..." : "No customers found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-[#5b6476]">
            Showing {(page - 1) * 25 + 1}{"\u2013"}{Math.min(page * 25, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1 || customersLoading}
              className="px-3 py-1.5 text-sm border border-[#e4e7ef] rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            {getPageNumbers().map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-2 text-[#5b6476]">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => onPageChange(p as number)}
                  disabled={customersLoading}
                  className={`px-3 py-1.5 text-sm rounded-lg ${
                    p === page
                      ? "bg-[#1a4fff] text-white"
                      : "border border-[#e4e7ef] hover:bg-gray-50"
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages || customersLoading}
              className="px-3 py-1.5 text-sm border border-[#e4e7ef] rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
