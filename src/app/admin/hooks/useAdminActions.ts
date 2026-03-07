"use client";

import { useState, useCallback } from "react";
import type { Customer, PricingConfig } from "../types";

export function useAdminActions(loadData: () => Promise<void>) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [creditModalCustomer, setCreditModalCustomer] = useState<Customer | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [pricingForm, setPricingForm] = useState({
    hourlyRate: "",
    refillThreshold: "",
    refillAmount: "",
    stoppedInstanceRate: "",
  });
  const [pricingSaving, setPricingSaving] = useState(false);

  const initPricingForm = useCallback((pricing: PricingConfig | null) => {
    if (pricing) {
      setPricingForm({
        hourlyRate: (pricing.hourlyRateCents / 100).toFixed(2),
        refillThreshold: (pricing.autoRefillThresholdCents / 100).toFixed(2),
        refillAmount: (pricing.autoRefillAmountCents / 100).toFixed(2),
        stoppedInstanceRate: (pricing.stoppedInstanceRatePercent || 25).toString(),
      });
    }
  }, []);

  const handleCustomerAction = useCallback(async (customerId: string, action: string) => {
    if (!confirm(`Are you sure you want to ${action} this customer?`)) return;

    setActionLoading(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        loadData();
      } else {
        alert(data.error || "Action failed");
      }
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  const handleLoginAs = useCallback(async (customerId: string) => {
    setActionLoading(customerId);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-as" }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.open(data.url, "_blank");
      } else {
        alert(data.error || "Failed to generate login link");
      }
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleHostedAiLogin = useCallback(async (customerId: string) => {
    setActionLoading(`hostedai-${customerId}`);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hostedai-login" }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.open(data.url, "_blank");
      } else {
        alert(data.error || "Failed to generate hosted.ai login link");
      }
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleDeleteCustomer = useCallback(async (customer: Customer) => {
    const confirmMessage = `Are you sure you want to DELETE customer "${customer.email}"?\n\nThis will:\n- Cancel all subscriptions\n- Delete their hosted.ai team\n- Delete their Stripe customer\n\nThis action cannot be undone!`;

    if (!confirm(confirmMessage)) return;

    // Double confirmation for safety
    const doubleConfirm = prompt(`Type "${customer.email}" to confirm deletion:`);
    if (doubleConfirm !== customer.email) {
      alert("Email did not match. Deletion cancelled.");
      return;
    }

    setActionLoading(`delete-${customer.id}`);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Customer deleted successfully");
        loadData();
      } else {
        alert(data.error || "Failed to delete customer");
      }
    } finally {
      setActionLoading(null);
    }
  }, [loadData]);

  const handleAddAdmin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail) return;

    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newAdminEmail }),
      });

      if (res.ok) {
        setNewAdminEmail("");
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add admin");
      }
    } catch {
      alert("Failed to add admin");
    }
  }, [newAdminEmail, loadData]);

  const handleRemoveAdmin = useCallback(async (email: string) => {
    if (!confirm(`Remove ${email} as admin?`)) return;

    try {
      const res = await fetch("/api/admin/admins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to remove admin");
      }
    } catch {
      alert("Failed to remove admin");
    }
  }, [loadData]);

  const handleResendInvite = useCallback(async (email: string) => {
    setActionLoading(email);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Invite sent!");
      } else {
        alert(data.error || "Failed to send invite");
      }
    } catch {
      alert("Failed to send invite");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleResetPin = useCallback(async (email: string) => {
    if (!confirm(`Reset PIN for ${email}? They'll need to set a new one on next login.`)) return;

    setActionLoading(email);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || "PIN reset!");
      } else {
        alert(data.error || "Failed to reset PIN");
      }
    } catch {
      alert("Failed to reset PIN");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleAdjustCredits = useCallback(async (e: React.FormEvent, reason?: string, reasonNote?: string) => {
    e.preventDefault();
    if (!creditModalCustomer || !creditAmount) return;

    const amount = parseFloat(creditAmount);
    if (isNaN(amount)) {
      alert("Invalid amount");
      return;
    }

    if (!reason) {
      alert("Please select a reason for this adjustment");
      return;
    }

    setActionLoading(creditModalCustomer.id);
    try {
      const res = await fetch(`/api/admin/customers/${creditModalCustomer.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust-credits", amount, reason, reasonNote }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setCreditModalCustomer(null);
        setCreditAmount("");
        loadData();
      } else {
        alert(data.error || "Failed to adjust credits");
      }
    } finally {
      setActionLoading(null);
    }
  }, [creditModalCustomer, creditAmount, loadData]);

  const handleSavePricing = useCallback(async (
    e: React.FormEvent,
    setPricing: (pricing: PricingConfig) => void
  ) => {
    e.preventDefault();
    setPricingSaving(true);

    try {
      const hourlyRate = parseFloat(pricingForm.hourlyRate);
      const refillThreshold = parseFloat(pricingForm.refillThreshold);
      const refillAmount = parseFloat(pricingForm.refillAmount);
      const stoppedInstanceRate = parseFloat(pricingForm.stoppedInstanceRate);

      if (isNaN(hourlyRate) || hourlyRate < 0) {
        alert("Invalid hourly rate");
        return;
      }
      if (isNaN(refillThreshold) || refillThreshold < 0) {
        alert("Invalid refill threshold");
        return;
      }
      if (isNaN(refillAmount) || refillAmount < 0) {
        alert("Invalid refill amount");
        return;
      }
      if (isNaN(stoppedInstanceRate) || stoppedInstanceRate < 0 || stoppedInstanceRate > 100) {
        alert("Invalid stopped instance rate (must be 0-100%)");
        return;
      }

      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hourlyRateCents: Math.round(hourlyRate * 100),
          autoRefillThresholdCents: Math.round(refillThreshold * 100),
          autoRefillAmountCents: Math.round(refillAmount * 100),
          stoppedInstanceRatePercent: Math.round(stoppedInstanceRate),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setPricing(data.pricing);
        alert("Pricing updated successfully");
      } else {
        alert(data.error || "Failed to update pricing");
      }
    } finally {
      setPricingSaving(false);
    }
  }, [pricingForm]);

  const handleLogout = useCallback(async (router: { push: (url: string) => void }) => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }, []);

  return {
    actionLoading,
    creditModalCustomer,
    creditAmount,
    newAdminEmail,
    pricingForm,
    pricingSaving,
    setActionLoading,
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
  };
}
