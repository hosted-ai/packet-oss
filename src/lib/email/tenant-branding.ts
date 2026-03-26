/**
 * Tenant branding helpers for email templates.
 *
 * Every email function that renders brand-specific text (company name, colors,
 * URLs) accepts an optional `EmailBranding` object. When omitted the default
 * default branding is used, so all existing call-sites keep working unchanged.
 */

import type { TenantConfig } from '@/lib/tenant/types';
import { isPro } from '@/lib/edition';
import {
  getAppUrl, getApiBaseUrl, getBrandName, getPrimaryColor, getAccentColor,
  getSupportEmail, getLogoUrl, getCompanyName, getCompanyAddress,
  getEmailFromName, getEmailFromAddress, getEmailFooterText,
} from "@/lib/branding";

export interface EmailBranding {
  brandName: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  logoUrl: string;
  dashboardUrl: string;
  /** Base URL for the inference API */
  apiBaseUrl: string;
  /** Company name for email footer */
  companyName: string;
  /** Physical mailing address (CAN-SPAM) */
  companyAddress: string;
  /** Custom footer text / tagline */
  footerText: string;
  /** Display name in email From header */
  fromName: string;
  /** Email address in email From header */
  fromAddress: string;
}

/** OSS / platform-level fallback — derives branding from DB-backed settings + env vars. */
function getOssBranding(): EmailBranding {
  const appUrl = getAppUrl();
  return {
    brandName: getBrandName(),
    primaryColor: getPrimaryColor(),
    accentColor: getAccentColor(),
    supportEmail: getSupportEmail(),
    logoUrl: getLogoUrl(),
    dashboardUrl: appUrl,
    apiBaseUrl: getApiBaseUrl(),
    companyName: getCompanyName(),
    companyAddress: getCompanyAddress(),
    footerText: getEmailFooterText(),
    fromName: getEmailFromName(),
    fromAddress: getEmailFromAddress(),
  };
}

export async function getEmailBranding(tenant?: TenantConfig): Promise<EmailBranding> {
  if (!isPro()) return getOssBranding();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDefaultTenantConfig } = require('@/lib/tenant/resolve');
  const t = tenant || await getDefaultTenantConfig();
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
    companyName: getCompanyName(),
    companyAddress: getCompanyAddress(),
    footerText: getEmailFooterText(),
    fromName: getEmailFromName(),
    fromAddress: getEmailFromAddress(),
  };
}
