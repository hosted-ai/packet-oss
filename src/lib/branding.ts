/**
 * Branding abstraction layer.
 *
 * Provides a single source of truth for brand name, URLs, colors, and support
 * contact across both Pro (Packet.ai) and OSS editions.
 *
 * Resolution order (highest priority wins):
 *   1. Tenant config  (multi-tenant white-label overrides)
 *   2. Environment variables  (NEXT_PUBLIC_BRAND_NAME, etc.)
 *   3. Edition defaults  (Pro → "Packet.ai", OSS → "GPU Cloud Dashboard")
 *
 * Usage:
 *   import { getBrandName, getAppUrl } from "@/lib/branding";
 *   const name = getBrandName();            // "Packet.ai" in Pro
 *   const url  = getAppUrl();               // "https://packet.ai" in Pro
 */

import { isOSS } from "./edition";

// ── Pro defaults ────────────────────────────────────────────────────────────

const PRO_DEFAULTS = {
  brandName: "Packet.ai",
  appUrl: "https://packet.ai",
  dashboardUrl: "https://dash.packet.ai",
  apiBaseUrl: "https://api.packet.ai",
  supportEmail: "support@packet.ai",
  logoUrl: "/packet-logo.png",
  faviconUrl: "/favicon.ico",
  primaryColor: "#1a4fff",
  accentColor: "#18b6a8",
  companyName: "Hosted AI Inc.",
} as const;

// ── OSS defaults ────────────────────────────────────────────────────────────

const OSS_DEFAULTS = {
  brandName: "GPU Cloud Dashboard",
  appUrl: "http://localhost:3000",
  dashboardUrl: "http://localhost:3000",
  apiBaseUrl: "http://localhost:3000/api",
  supportEmail: "admin@localhost",
  logoUrl: "/logo.png",
  faviconUrl: "/favicon.ico",
  primaryColor: "#1a4fff",
  accentColor: "#18b6a8",
  companyName: "",
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaults() {
  return isOSS() ? OSS_DEFAULTS : PRO_DEFAULTS;
}

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Display name shown in UI, emails, and metadata. */
export function getBrandName(): string {
  return env("NEXT_PUBLIC_BRAND_NAME") || defaults().brandName;
}

/** Public-facing app URL (e.g. "https://packet.ai"). */
export function getAppUrl(): string {
  return env("NEXT_PUBLIC_APP_URL") || defaults().appUrl;
}

/** Dashboard base URL (may differ from marketing site). */
export function getDashboardUrl(): string {
  return env("NEXT_PUBLIC_DASHBOARD_URL") || env("NEXT_PUBLIC_APP_URL") || defaults().dashboardUrl;
}

/** Inference API base URL. */
export function getApiBaseUrl(): string {
  return env("NEXT_PUBLIC_API_BASE_URL") || defaults().apiBaseUrl;
}

/** Support email address. */
export function getSupportEmail(): string {
  return env("SUPPORT_EMAIL") || defaults().supportEmail;
}

/** Brand logo path or URL. */
export function getLogoUrl(): string {
  return env("NEXT_PUBLIC_LOGO_URL") || defaults().logoUrl;
}

/** Favicon path or URL. */
export function getFaviconUrl(): string {
  return env("NEXT_PUBLIC_FAVICON_URL") || defaults().faviconUrl;
}

/** Primary brand color (hex). */
export function getPrimaryColor(): string {
  return env("NEXT_PUBLIC_PRIMARY_COLOR") || defaults().primaryColor;
}

/** Accent/secondary brand color (hex). */
export function getAccentColor(): string {
  return env("NEXT_PUBLIC_ACCENT_COLOR") || defaults().accentColor;
}

/** Parent company name (empty in OSS if not configured). */
export function getCompanyName(): string {
  return env("COMPANY_NAME") || defaults().companyName;
}

/**
 * Full branding object — convenient for passing to email templates,
 * metadata generators, or components that need multiple values at once.
 */
export interface BrandConfig {
  brandName: string;
  appUrl: string;
  dashboardUrl: string;
  apiBaseUrl: string;
  supportEmail: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  companyName: string;
}

export function getBrandConfig(): BrandConfig {
  return {
    brandName: getBrandName(),
    appUrl: getAppUrl(),
    dashboardUrl: getDashboardUrl(),
    apiBaseUrl: getApiBaseUrl(),
    supportEmail: getSupportEmail(),
    logoUrl: getLogoUrl(),
    faviconUrl: getFaviconUrl(),
    primaryColor: getPrimaryColor(),
    accentColor: getAccentColor(),
    companyName: getCompanyName(),
  };
}
