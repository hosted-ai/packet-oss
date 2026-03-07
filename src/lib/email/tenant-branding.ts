export interface EmailBranding {
  brandName: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string;
  logoUrl: string;
  dashboardUrl: string;
  /** Base URL for the inference API, e.g. "https://api.example.com" */
  apiBaseUrl: string;
}

export function getEmailBranding(): EmailBranding {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    brandName: process.env.NEXT_PUBLIC_BRAND_NAME || "GPU Cloud",
    primaryColor: "#1a4fff",
    accentColor: "#18b6a8",
    supportEmail: process.env.SUPPORT_EMAIL || "support@example.com",
    logoUrl: "/packet-logo.png",
    dashboardUrl: appUrl,
    apiBaseUrl: process.env.API_BASE_URL || "https://api.example.com",
  };
}

// Keep backwards-compatible export name
export async function getTenantBranding() {
  return getEmailBranding();
}
