"use client";

import { useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export function useInvestorActions(fetchInvestors: () => Promise<void>) {
  const [newInvestorEmail, setNewInvestorEmail] = useState("");
  const [addingInvestor, setAddingInvestor] = useState(false);
  const [investorError, setInvestorError] = useState("");
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  // Add investor
  async function handleAddInvestor(e: React.FormEvent) {
    e.preventDefault();
    if (!newInvestorEmail.trim()) return;

    setAddingInvestor(true);
    setInvestorError("");

    try {
      const response = await fetch("/api/investor/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newInvestorEmail.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setInvestorError(data.error || "Failed to add investor");
        return;
      }

      setNewInvestorEmail("");
      fetchInvestors();
    } catch {
      setInvestorError("Failed to add investor");
    } finally {
      setAddingInvestor(false);
    }
  }

  // Remove investor
  async function handleRemoveInvestor(investorEmail: string) {
    if (!confirm(`Remove ${investorEmail} from investors?`)) return;

    try {
      const response = await fetch("/api/investor/investors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: investorEmail }),
      });

      if (response.ok) {
        fetchInvestors();
      }
    } catch {
      // Silently fail
    }
  }

  // Resend invite
  async function handleResendInvite(investorEmail: string) {
    setResendingInvite(investorEmail);

    try {
      const response = await fetch("/api/investor/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: investorEmail }),
      });

      if (response.ok) {
        alert(`Invite email resent to ${investorEmail}`);
      } else {
        const data = await response.json();
        alert(data.error || "Failed to resend invite");
      }
    } catch {
      alert("Failed to resend invite");
    } finally {
      setResendingInvite(null);
    }
  }

  // Logout
  async function handleLogout(router: AppRouterInstance) {
    await fetch("/api/investor/auth", { method: "DELETE" });
    router.push("/investors/login");
  }

  return {
    newInvestorEmail,
    addingInvestor,
    investorError,
    resendingInvite,
    setNewInvestorEmail,
    handleAddInvestor,
    handleRemoveInvestor,
    handleResendInvite,
    handleLogout,
  };
}
