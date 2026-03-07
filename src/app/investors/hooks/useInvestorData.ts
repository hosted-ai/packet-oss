"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { InvestorDashboardData, Investor } from "../types";

export function useInvestorData() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [dashboardData, setDashboardData] = useState<InvestorDashboardData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setDataLoading(true);
    setDataError("");
    try {
      const response = await fetch("/api/investor/stats");
      if (!response.ok) throw new Error("Failed to fetch data");
      const data = await response.json();
      setDashboardData(data);
    } catch {
      setDataError("Failed to load dashboard data");
    } finally {
      setDataLoading(false);
    }
  }, []);

  const fetchInvestors = useCallback(async () => {
    try {
      const response = await fetch("/api/investor/investors");
      if (!response.ok) return;
      const data = await response.json();
      setInvestors(data.investors);
      setIsOwner(data.currentUserIsOwner);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch("/api/investor/auth");
        const data = await response.json();
        if (!data.authenticated) { router.push("/investors/login"); return; }
        setEmail(data.email);
        setLoading(false);
      } catch { router.push("/investors/login"); }
    }
    checkAuth();
  }, [router]);

  useEffect(() => {
    if (!loading && email) {
      fetchDashboard();
      fetchInvestors();
    }
  }, [loading, email, fetchDashboard, fetchInvestors]);

  return {
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
  };
}
