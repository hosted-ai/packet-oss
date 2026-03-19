"use client";

import { useState, useEffect } from "react";

export interface ServiceStatus {
  [serviceName: string]: {
    label: string;
    configured: boolean;
  };
}

/**
 * Fetch service configuration status from platform settings.
 * Used for capability-based feature gating in admin tabs.
 */
export function useServiceStatus() {
  const [services, setServices] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/platform-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.services) return;
        const status: ServiceStatus = {};
        for (const [name, svc] of Object.entries(data.services)) {
          const s = svc as { label: string; configured: boolean };
          status[name] = { label: s.label, configured: s.configured };
        }
        setServices(status);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function isConfigured(service: string): boolean {
    if (!services) return true; // assume configured while loading
    return services[service]?.configured ?? true;
  }

  return { services, loading, isConfigured };
}
