/**
 * Tenant branding helpers for email templates.
 *
 * Every email function that renders brand-specific text (company name, colors,
 * URLs) accepts an optional `EmailBranding` object. When omitted the default
 * default branding is used, so all existing call-sites keep working unchanged.
 */

import type { TenantConfig } from '@/lib/tenant/types';
import { isPro } from '@/lib/edition';
import { getAppUrl, getApiBaseUrl, getBrandName } from "@/lib/branding";

export interface EmailBranding {
  brandName: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  logoUrl: string;
  dashboardUrl: string;
  /** Base URL for the inference API */
  apiBaseUrl: string;
}

/** OSS fallback — derives branding from env vars when tenant system is unavailable. */
function getOssBranding(): EmailBranding {
  const appUrl = getAppUrl();
  const domain = new URL(appUrl).hostname;
  return {
    brandName: getBrandName(),
    primaryColor: "#1a4fff",
    accentColor: "#00c389",
    supportEmail: `support@${domain}`,
    logoUrl: `${appUrl}/packet-logo.png`,
    dashboardUrl: appUrl,
    apiBaseUrl: getApiBaseUrl(),
  };
}

export function getEmailBranding(tenant?: TenantConfig): EmailBranding {
  if (!isPro()) return getOssBranding();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDefaultTenantConfig } = require('@/lib/tenant/resolve');
  const t = tenant || getDefaultTenantConfig();
  const domain = t.isDefault
    ? new URL(getAppUrl()).hostname
    : (t.domains[0] || new URL(getAppUrl()).hostname);

  return {
    brandName: t.brandName,
    primaryColor: t.primaryColor,
    accentColor: t.accentColor,
    supportEmail: t.supportEmail,
    logoUrl: t.logoUrl,
    dashboardUrl: `https://${domain}`,
    apiBaseUrl: t.isDefault
      ? getApiBaseUrl()
      : `https://${domain.replace(/^dash\./, 'api.')}`,
  };
}
