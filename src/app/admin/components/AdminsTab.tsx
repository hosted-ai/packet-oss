"use client";

import { useState } from "react";
import type { Admin } from "../types";

interface AdminsTabProps {
  admins: Admin[];
  adminEmail: string;
  newAdminEmail: string;
  actionLoading: string | null;
  canResetPin: boolean;
  setupUrl?: string | null;
  onNewAdminEmailChange: (email: string) => void;
  onAddAdmin: (e: React.FormEvent) => void;
  onRemoveAdmin: (email: string) => void;
  onResendInvite: (email: string) => void;
  onResetPin: (email: string) => void;
  onReset2FA?: (email: string) => void;
}

export function AdminsTab({
  admins,
  adminEmail,
  newAdminEmail,
  actionLoading,
  canResetPin,
  setupUrl,
  onNewAdminEmailChange,
  onAddAdmin,
  onRemoveAdmin,
  onResendInvite,
  onResetPin,
  onReset2FA,
}: AdminsTabProps) {
  const [copied, setCopied] = useState(false);

  const handleCopySetupUrl = () => {
    if (!setupUrl) return;
    const fullUrl = `${window.location.origin}${setupUrl}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <form onSubmit={onAddAdmin} className="flex gap-2 mb-4">
        <input
          type="email"
          placeholder="Add admin email..."
          value={newAdminEmail}
          onChange={(e) => onNewAdminEmailChange(e.target.value)}
          className="flex-1 px-4 py-2 bg-white border border-[#e4e7ef] rounded-lg text-[#0b0f1c] placeholder-[#5b6476] focus:outline-none focus:ring-2 focus:ring-[#1a4fff]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[#1a4fff] text-white hover:bg-[#1238c9] rounded-lg font-medium"
        >
          Add Admin
        </button>
      </form>

      {setupUrl && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 font-medium mb-2">
            Email is not configured. Share this setup URL with the new admin:
          </p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded text-sm text-[#0b0f1c] truncate">
              {window.location.origin}{setupUrl}
            </code>
            <button
              type="button"
              onClick={handleCopySetupUrl}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-1">This link expires in 24 hours.</p>
        </div>
      )}

      <div className="bg-white border border-[#e4e7ef] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#f7f8fb] border-b border-[#e4e7ef]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Email</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Added</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[#5b6476]">Added By</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[#5b6476]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e7ef]">
            {admins.map((admin) => (
              <tr key={admin.email} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-[#0b0f1c]">{admin.email}</td>
                <td className="px-4 py-3 text-sm text-[#5b6476]">
                  {new Date(admin.addedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm text-[#5b6476]">{admin.addedBy}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => onResendInvite(admin.email)}
                    disabled={actionLoading === admin.email}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#0b0f1c] rounded disabled:opacity-50"
                  >
                    {actionLoading === admin.email ? "Sending..." : "Resend Invite"}
                  </button>
                  {canResetPin && (
                    <button
                      onClick={() => onResetPin(admin.email)}
                      disabled={actionLoading === admin.email}
                      className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded disabled:opacity-50"
                    >
                      Reset PIN
                    </button>
                  )}
                  {canResetPin && onReset2FA && (
                    <button
                      onClick={() => onReset2FA(admin.email)}
                      disabled={actionLoading === admin.email}
                      className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded disabled:opacity-50"
                    >
                      Reset 2FA
                    </button>
                  )}
                  {admin.email !== adminEmail && (
                    <button
                      onClick={() => onRemoveAdmin(admin.email)}
                      className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
