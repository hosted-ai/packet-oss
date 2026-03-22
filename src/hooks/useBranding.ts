"use client";

import { useState, useEffect } from "react";
import { type BrandConfig } from "@/lib/branding";

/** Strip query strings from local paths — next/image rejects them. */
function cleanLocalUrl(url: string): string {
  if (url.startsWith("/") && url.includes("?")) {
    return url.split("?")[0];
  }
  return url;
}

/**
 * Fetch DB-backed branding config from /api/branding.
 * Falls back to client-side defaults (env vars + edition) until loaded.
 */
export function useBranding(): BrandConfig | null {
  const [config, setConfig] = useState<BrandConfig | null>(null);

  useEffect(() => {
    fetch("/api/branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          data.logoUrl = cleanLocalUrl(data.logoUrl);
          data.faviconUrl = cleanLocalUrl(data.faviconUrl);
          setConfig(data);
        }
      })
      .catch(() => {});
  }, []);

  return config;
}
