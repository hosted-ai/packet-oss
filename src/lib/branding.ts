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
  supportEmail: "help@packet.ai",
  onboardingEmail: "onboarding@hosted.ai",
  statusEmailTo: "partners@hosted.ai",
  logoUrl: "/packet-logo.png",
  faviconUrl: "/favicon.ico",
  primaryColor: "#1a4fff",
  accentColor: "#18b6a8",
  backgroundColor: "#f7f8fb",
  textColor: "#0b0f1c",
  companyName: "Hosted AI Inc.",
  companyAddress: "622 North 9th Street, San Jose, CA 95112, USA",
  emailFromName: "",
  emailFromAddress: "",
  emailFooterText: "",
} as const;

// ── OSS defaults ────────────────────────────────────────────────────────────

const OSS_DEFAULTS = {
  brandName: "GPU Cloud Dashboard",
  appUrl: "http://localhost:3000",
  dashboardUrl: "http://localhost:3000",
  apiBaseUrl: "http://localhost:3000/api",
  supportEmail: "admin@localhost",
  // Internal-notification recipients: no @hosted.ai default in OSS — an
  // unconfigured self-host must not silently ship customer PII upstream.
  // Empty here → the getters fall back to the operator's own support email.
  onboardingEmail: "",
  statusEmailTo: "",
  logoUrl: "/logo.svg",
  faviconUrl: "/favicon.ico",
  primaryColor: "#1a4fff",
  accentColor: "#18b6a8",
  backgroundColor: "#f7f8fb",
  textColor: "#0b0f1c",
  companyName: "",
  companyAddress: "",
  emailFromName: "",
  emailFromAddress: "",
  emailFooterText: "",
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaults() {
  return isOSS() ? OSS_DEFAULTS : PRO_DEFAULTS;
}

function env(key: string): string | undefined {
  // On the server, check DB-backed platform settings first.
  // Dynamic require avoids bundling server-only deps (prisma, fs, crypto)
  // into client component bundles where branding.ts is also imported.
  if (typeof window === "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSettingSync } = require("./settings") as typeof import("./settings");
      const dbVal = getSettingSync(key);
      if (dbVal) return dbVal;
    } catch {
      // Settings module not available or DB not ready — fall through to env
    }
  }
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
  return (
    env("NEXT_PUBLIC_DASHBOARD_URL") ||
    env("NEXT_PUBLIC_APP_URL") ||
    defaults().dashboardUrl
  );
}

/** Inference API base URL. */
export function getApiBaseUrl(): string {
  return env("NEXT_PUBLIC_API_BASE_URL") || defaults().apiBaseUrl;
}

/** Support email address. */
export function getSupportEmail(): string {
  return env("SUPPORT_EMAIL") || defaults().supportEmail;
}

/**
 * Internal recipient for onboarding / customer-event notification emails
 * (signup, subscription, topup, GPU launch, the customer CSV export).
 *
 * These carry customer PII, so the recipient must be configurable: a
 * self-hoster sets `ONBOARDING_EMAIL` to route them internally. Pro defaults
 * to `onboarding@hosted.ai`; an unconfigured OSS build falls back to the
 * operator's own support email rather than leaking upstream to hosted.ai.
 */
export function getOnboardingEmail(): string {
  return env("ONBOARDING_EMAIL") || defaults().onboardingEmail || getSupportEmail();
}

/**
 * Internal recipient for the daily KPI / status snapshot email (MRR, revenue,
 * signups, active pods). Configurable via `STATUS_EMAIL_TO`; Pro defaults to
 * `partners@hosted.ai`, an unconfigured OSS build falls back to the operator's
 * own support email.
 */
export function getStatusEmailTo(): string {
  return env("STATUS_EMAIL_TO") || defaults().statusEmailTo || getSupportEmail();
}

/** Strip query strings from local paths — next/image rejects them. */
function cleanLocalUrl(url: string): string {
  if (url.startsWith("/") && url.includes("?")) {
    return url.split("?")[0];
  }
  return url;
}

/** Brand logo path or URL. */
export function getLogoUrl(): string {
  return cleanLocalUrl(env("NEXT_PUBLIC_LOGO_URL") || defaults().logoUrl);
}

/** Favicon path or URL. */
export function getFaviconUrl(): string {
  return cleanLocalUrl(env("NEXT_PUBLIC_FAVICON_URL") || defaults().faviconUrl);
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
 * Legal billing entity for invoices (FROM block + beneficiary reference). The
 * brand (e.g. "Packet.ai") is a product, not a company — invoices must bill from
 * the registered entity. Finance requires the exact wording "Hosted AI Inc.
 * (Packet.AI)" for the default Packet brand; tenant brands derive from their
 * configured company + brand, and an empty company name falls back to the brand.
 */
export function getInvoiceEntity(): string {
  const company = getCompanyName();
  if (!company) return getBrandName();
  const brand = getBrandName();
  if (brand === "Packet.ai") return `${company} (Packet.AI)`;
  return `${company} (${brand})`;
}

/** Background color (hex). */
export function getBackgroundColor(): string {
  return env("NEXT_PUBLIC_BACKGROUND_COLOR") || defaults().backgroundColor;
}

/** Primary text color (hex). */
export function getTextColor(): string {
  return env("NEXT_PUBLIC_TEXT_COLOR") || defaults().textColor;
}

/** Display name for the From header in outgoing emails. Falls back to brand name. */
export function getEmailFromName(): string {
  return env("EMAIL_FROM_NAME") || getBrandName();
}

/** Email address for the From header. Falls back to no-reply@{dashboard hostname}. */
export function getEmailFromAddress(): string {
  const configured = env("EMAIL_FROM_ADDRESS");
  if (configured) return configured;
  try {
    return `no-reply@${new URL(getDashboardUrl()).hostname}`;
  } catch {
    return defaults().supportEmail;
  }
}

/** Physical mailing address for CAN-SPAM compliance footer. */
export function getCompanyAddress(): string {
  return env("COMPANY_ADDRESS") || defaults().companyAddress;
}

/** Custom email footer text (e.g. tagline). Empty = uses company name default. */
export function getEmailFooterText(): string {
  return env("EMAIL_FOOTER_TEXT") || defaults().emailFooterText;
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
  backgroundColor: string;
  textColor: string;
  companyName: string;
  companyAddress: string;
  emailFromName: string;
  emailFromAddress: string;
  emailFooterText: string;
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
    backgroundColor: getBackgroundColor(),
    textColor: getTextColor(),
    companyName: getCompanyName(),
    companyAddress: getCompanyAddress(),
    emailFromName: getEmailFromName(),
    emailFromAddress: getEmailFromAddress(),
    emailFooterText: getEmailFooterText(),
  };
}
