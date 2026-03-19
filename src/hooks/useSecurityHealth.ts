"use client";

import { useState, useEffect } from "react";

interface SecurityHealth {
  passwordSet: boolean;
  twoFactorEnabled: boolean;
  emailConfigured: boolean;
  recentFailedLogins: number;
  score: number;
  maxScore: number;
}

export function useSecurityHealth() {
  const [data, setData] = useState<SecurityHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHealth() {
      try {
        const res = await fetch("/api/admin/security-health");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
