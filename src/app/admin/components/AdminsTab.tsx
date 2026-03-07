"use client";

import type { Admin } from "../types";

interface AdminsTabProps {
  admins: Admin[];
  adminEmail: string;
  newAdminEmail: string;
  actionLoading: string | null;
  canResetPin: boolean;
  onNewAdminEmailChange: (email: string) => void;
  onAddAdmin: (e: React.FormEvent) => void;
  onRemoveAdmin: (email: string) => void;
  onResendInvite: (email: string) => void;
  onResetPin: (email: string) => void;
}

export function AdminsTab({
  admins,
  adminEmail,
  newAdminEmail,
  actionLoading,
  canResetPin,
  onNewAdminEmailChange,
  onAddAdmin,
  onRemoveAdmin,
  onResendInvite,
  onResetPin,
}: AdminsTabProps) {
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
