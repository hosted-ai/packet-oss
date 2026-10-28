import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// branding-client.ts is the client-safe mirror: it resolves ONLY against
// NEXT_PUBLIC_* env vars + edition defaults — it never touches settings.ts /
// prisma. We mock the edition flag to drive both Pro and OSS branches.
const mockIsOSS = vi.fn(() => false);
vi.mock("@/lib/edition", () => ({
  isOSS: () => mockIsOSS(),
  isPro: () => !mockIsOSS(),
}));

import * as branding from "@/lib/branding-client";

const BRANDING_ENV_KEYS = [
  "NEXT_PUBLIC_BRAND_NAME",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_DASHBOARD_URL",
  "NEXT_PUBLIC_API_BASE_URL",
  "SUPPORT_EMAIL",
  "NEXT_PUBLIC_LOGO_URL",
  "NEXT_PUBLIC_FAVICON_URL",
  "NEXT_PUBLIC_PRIMARY_COLOR",
  "NEXT_PUBLIC_ACCENT_COLOR",
  "NEXT_PUBLIC_BACKGROUND_COLOR",
  "NEXT_PUBLIC_TEXT_COLOR",
  "COMPANY_NAME",
  "COMPANY_ADDRESS",
];

describe("branding-client", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of BRANDING_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    mockIsOSS.mockReturnValue(false);
  });

  afterEach(() => {
    for (const k of BRANDING_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("Pro defaults", () => {
    it("returns Packet.ai brand name", () => {
      expect(branding.getBrandName()).toBe("Packet.ai");
    });

    it("distinguishes marketing app URL from dashboard URL", () => {
      expect(branding.getAppUrl()).toBe("https://packet.ai");
      expect(branding.getDashboardUrl()).toBe("https://dash.packet.ai");
    });

    it("returns API base URL and support email", () => {
      expect(branding.getApiBaseUrl()).toBe("https://api.packet.ai");
      expect(branding.getSupportEmail()).toBe("help@packet.ai");
    });

    it("returns default colors", () => {
      expect(branding.getPrimaryColor()).toBe("#1a4fff");
      expect(branding.getAccentColor()).toBe("#18b6a8");
      expect(branding.getBackgroundColor()).toBe("#f7f8fb");
      expect(branding.getTextColor()).toBe("#0b0f1c");
    });

    it("returns the Packet logo and company name", () => {
      expect(branding.getLogoUrl()).toBe("/packet-logo.png");
      expect(branding.getCompanyName()).toBe("Hosted AI Inc.");
    });
  });

  describe("OSS defaults", () => {
    beforeEach(() => mockIsOSS.mockReturnValue(true));

    it("returns the generic brand name and localhost URLs", () => {
      expect(branding.getBrandName()).toBe("GPU Cloud Dashboard");
      expect(branding.getAppUrl()).toBe("http://localhost:3000");
      expect(branding.getApiBaseUrl()).toBe("http://localhost:3000/api");
    });

    it("uses /logo.svg and empty company fields", () => {
      expect(branding.getLogoUrl()).toBe("/logo.svg");
      expect(branding.getCompanyName()).toBe("");
      expect(branding.getCompanyAddress()).toBe("");
    });
  });

  describe("env overrides", () => {
    it("env brand name beats the default", () => {
      process.env.NEXT_PUBLIC_BRAND_NAME = "Acme";
      expect(branding.getBrandName()).toBe("Acme");
    });

    it("getDashboardUrl falls back to NEXT_PUBLIC_APP_URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      expect(branding.getDashboardUrl()).toBe("https://app.example.com");
    });

    it("getDashboardUrl prefers its own var", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      process.env.NEXT_PUBLIC_DASHBOARD_URL = "https://dash.example.com";
      expect(branding.getDashboardUrl()).toBe("https://dash.example.com");
    });

    it("treats empty string as unset", () => {
      process.env.NEXT_PUBLIC_PRIMARY_COLOR = "";
      expect(branding.getPrimaryColor()).toBe("#1a4fff");
    });
  });

  describe("local URL cleaning", () => {
    it("strips query strings from local paths", () => {
      process.env.NEXT_PUBLIC_LOGO_URL = "/logo.svg?v=3";
      expect(branding.getLogoUrl()).toBe("/logo.svg");
    });

    it("leaves http URLs intact", () => {
      process.env.NEXT_PUBLIC_FAVICON_URL =
        "https://cdn.example.com/fav.ico?v=3";
      expect(branding.getFaviconUrl()).toBe(
        "https://cdn.example.com/fav.ico?v=3"
      );
    });
  });
});
