"use client";

import type { Investor } from "../types";
import { SectionHeader } from "./SectionHeader";

interface InvestorManagementProps {
  investors: Investor[];
  newInvestorEmail: string;
  addingInvestor: boolean;
  investorError: string;
  resendingInvite: string | null;
  onNewInvestorEmailChange: (email: string) => void;
  onAddInvestor: (e: React.FormEvent) => void;
  onRemoveInvestor: (email: string) => void;
  onResendInvite: (email: string) => void;
}

export function InvestorManagement({
  investors,
  newInvestorEmail,
  addingInvestor,
  investorError,
  resendingInvite,
  onNewInvestorEmailChange,
  onAddInvestor,
  onRemoveInvestor,
  onResendInvite,
}: InvestorManagementProps) {
  return (
    <section className="border-t border-[#e4e7ef] pt-8">
      <SectionHeader title="Manage Investors" />

      <div className="bg-white border border-[#e4e7ef] rounded-xl p-6 mb-6">
        <form onSubmit={onAddInvestor} className="flex gap-3">
          <input
            type="email"
            placeholder="investor@example.com"
            value={newInvestorEmail}
            onChange={(e) => onNewInvestorEmailChange(e.target.value)}
            className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
          />
          <button
            type="submit"
            disabled={addingInvestor || !newInvestorEmail.trim()}
            className="px-4 py-2 bg-[#1a4fff] hover:bg-[#1238c9] text-white rounded-lg text-sm font-medium transition-colors disabled:bg-gray-400"
          >
            {addingInvestor ? "Adding..." : "Add Investor"}
          </button>
        </form>
        {investorError && (
          <p className="text-red-600 text-sm mt-2">{investorError}</p>
        )}
      </div>

      <div className="bg-white border border-[#e4e7ef] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb]">
            <tr>
              <th className="text-left px-6 py-3 text-[#5b6476] text-sm font-medium">
                Email
              </th>
              <th className="text-left px-6 py-3 text-[#5b6476] text-sm font-medium">
                Status
              </th>
              <th className="text-left px-6 py-3 text-[#5b6476] text-sm font-medium">
                Last Login
              </th>
              <th className="text-right px-6 py-3 text-[#5b6476] text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {investors.map((investor) => (
              <tr key={investor.email}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[#0b0f1c]">{investor.email}</span>
                    {investor.isOwner && (
                      <span className="px-2 py-0.5 bg-[#1a4fff]/10 text-[#1a4fff] text-xs rounded">
                        Owner
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {investor.acceptedAt ? (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">
                      Accepted
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                      Pending
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-[#5b6476] text-sm">
                  {investor.lastLoginAt
                    ? new Date(investor.lastLoginAt).toLocaleDateString()
                    : "Never"}
                </td>
                <td className="px-6 py-4 text-right">
                  {!investor.isOwner && (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => onResendInvite(investor.email)}
                        disabled={resendingInvite === investor.email}
                        className="text-[#1a4fff] hover:text-[#1238c9] text-sm disabled:text-gray-400"
                      >
                        {resendingInvite === investor.email
                          ? "Sending..."
                          : "Resend Invite"}
                      </button>
                      <button
                        onClick={() => onRemoveInvestor(investor.email)}
                        className="text-red-600 hover:text-red-700 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
