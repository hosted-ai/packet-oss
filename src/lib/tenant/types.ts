/**
 * Stub TenantConfig for OSS builds.
 * The full tenant system is Pro-only. This stub exists so shared code
 * that uses `import type { TenantConfig }` compiles in the OSS build.
 */
export interface TenantConfig {
  id: string;
  slug: string;
  status: string;
  brandName: string;
  logoUrl: string;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  customCss: string | null;
  customStrings: Record<string, string> | null;
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeWebhookSecret: string;
  supportEmail: string;
  supportUrl: string | null;
  statusPageEnabled: boolean;
  alertWebhookUrl: string | null;
  leadWebhookUrl: string | null;
  analyticsId: string | null;
  dripEmailEnabled: boolean;
  adminDomains: string[];
  allowedGpuTypes: string[];
  maxConcurrentGpus: number | null;
  signupCreditCents: number;
  billingModels: string[];
  isDefault: boolean;
  domains: string[];
}
