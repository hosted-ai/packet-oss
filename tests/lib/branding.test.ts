import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// branding.ts resolves through three layers (DB settings → env → edition
// defaults). We mock the edition flag to exercise BOTH Pro and OSS branches,
// and mock the server-only settings module so getSettingSync() is a no-op
// unless a test opts in (keeping env-override tests deterministic).
const mockIsOSS = vi.fn(() => false);
vi.mock("@/lib/edition", () => ({
  isOSS: () => mockIsOSS(),
  isPro: () => !mockIsOSS(),
}));

const mockGetSettingSync = vi.fn<(key: string) => string | undefined>(
  () => undefined
);
vi.mock("@/lib/settings", () => ({
  getSettingSync: (key: string) => mockGetSettingSync(key),
}));

import * as branding from "@/lib/branding";

// NEXT_PUBLIC_* and friends that branding.ts reads, so we can scrub them.
const BRANDING_ENV_KEYS = [
  "NEXT_PUBLIC_BRAND_NAME",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_DASHBOARD_URL",
  "NEXT_PUBLIC_API_BASE_URL",
  "SUPPORT_EMAIL",
  "ONBOARDING_EMAIL",
  "STATUS_EMAIL_TO",
  "NEXT_PUBLIC_LOGO_URL",
  "NEXT_PUBLIC_FAVICON_URL",
  "NEXT_PUBLIC_PRIMARY_COLOR",
  "NEXT_PUBLIC_ACCENT_COLOR",
  "NEXT_PUBLIC_BACKGROUND_COLOR",
  "NEXT_PUBLIC_TEXT_COLOR",
  "COMPANY_NAME",
  "COMPANY_ADDRESS",
  "EMAIL_FROM_NAME",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_FOOTER_TEXT",
];

describe("branding (server)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot + clear branding env so defaults/overrides are deterministic.
    for (const k of BRANDING_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    mockIsOSS.mockReturnValue(false); // default: Pro
    mockGetSettingSync.mockReturnValue(undefined);
    vi.clearAllMocks();
    mockGetSettingSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    for (const k of BRANDING_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("Pro edition defaults", () => {
    it("returns Packet.ai brand name", () => {
      expect(branding.getBrandName()).toBe("Packet.ai");
    });

    it("uses the marketing app URL, not the dashboard URL", () => {
      // Regression guard: getAppUrl() must resolve the marketing site and
      // getDashboardUrl() the app — a prior bug conflated the two.
      expect(branding.getAppUrl()).toBe("https://packet.ai");
      expect(branding.getDashboardUrl()).toBe("https://dash.packet.ai");
      expect(branding.getAppUrl()).not.toBe(branding.getDashboardUrl());
    });

    it("returns the inference API base URL", () => {
      expect(branding.getApiBaseUrl()).toBe("https://api.packet.ai");
    });

    it("returns support email and company defaults", () => {
      expect(branding.getSupportEmail()).toBe("help@packet.ai");
      expect(branding.getCompanyName()).toBe("Hosted AI Inc.");
      expect(branding.getCompanyAddress()).toBe(
        "622 North 9th Street, San Jose, CA 95112, USA"
      );
    });

    it("returns the hosted.ai internal-notification recipients", () => {
      expect(branding.getOnboardingEmail()).toBe("onboarding@hosted.ai");
      expect(branding.getStatusEmailTo()).toBe("partners@hosted.ai");
    });

    it("returns default brand colors", () => {
      expect(branding.getPrimaryColor()).toBe("#1a4fff");
      expect(branding.getAccentColor()).toBe("#18b6a8");
      expect(branding.getBackgroundColor()).toBe("#f7f8fb");
      expect(branding.getTextColor()).toBe("#0b0f1c");
    });
  });

  describe("OSS edition defaults", () => {
    beforeEach(() => mockIsOSS.mockReturnValue(true));

    it("returns the generic brand name", () => {
      expect(branding.getBrandName()).toBe("GPU Cloud Dashboard");
    });

    it("returns localhost URLs and admin@localhost support email", () => {
      expect(branding.getAppUrl()).toBe("http://localhost:3000");
      expect(branding.getDashboardUrl()).toBe("http://localhost:3000");
      expect(branding.getApiBaseUrl()).toBe("http://localhost:3000/api");
      expect(branding.getSupportEmail()).toBe("admin@localhost");
    });

    it("returns empty company name/address (not configured in OSS)", () => {
      expect(branding.getCompanyName()).toBe("");
      expect(branding.getCompanyAddress()).toBe("");
    });

    it("never defaults notification recipients to hosted.ai — falls back to support email", () => {
      // The whole point of PA-379: an unconfigured self-host must not ship
      // customer PII / KPIs to @hosted.ai. With no override, both getters
      // resolve to the operator's own support address.
      expect(branding.getOnboardingEmail()).toBe("admin@localhost");
      expect(branding.getStatusEmailTo()).toBe("admin@localhost");
      expect(branding.getOnboardingEmail()).not.toContain("@hosted.ai");
      expect(branding.getStatusEmailTo()).not.toContain("@hosted.ai");
    });

    it("uses /logo.svg instead of the Packet logo", () => {
      expect(branding.getLogoUrl()).toBe("/logo.svg");
    });
  });

  describe("environment variable overrides", () => {
    it("env brand name beats the edition default", () => {
      process.env.NEXT_PUBLIC_BRAND_NAME = "Acme Cloud";
      expect(branding.getBrandName()).toBe("Acme Cloud");
    });

    it("getDashboardUrl falls back to NEXT_PUBLIC_APP_URL when dashboard unset", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      expect(branding.getDashboardUrl()).toBe("https://app.example.com");
    });

    it("getDashboardUrl prefers its own env var over NEXT_PUBLIC_APP_URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
      process.env.NEXT_PUBLIC_DASHBOARD_URL = "https://dash.example.com";
      expect(branding.getDashboardUrl()).toBe("https://dash.example.com");
    });

    it("treats empty-string env as unset (falls through to default)", () => {
      process.env.NEXT_PUBLIC_BRAND_NAME = "";
      expect(branding.getBrandName()).toBe("Packet.ai");
    });

    it("ONBOARDING_EMAIL / STATUS_EMAIL_TO env vars override the defaults", () => {
      process.env.ONBOARDING_EMAIL = "ops@acme.internal";
      process.env.STATUS_EMAIL_TO = "leadership@acme.internal";
      expect(branding.getOnboardingEmail()).toBe("ops@acme.internal");
      expect(branding.getStatusEmailTo()).toBe("leadership@acme.internal");
    });

    it("falls back to the env var when no DB setting is present", () => {
      // env() consults getSettingSync first (mocked to return undefined here),
      // then process.env. With no DB override, the env var is used.
      process.env.NEXT_PUBLIC_BRAND_NAME = "FromEnv";
      mockGetSettingSync.mockReturnValue(undefined);
      expect(branding.getBrandName()).toBe("FromEnv");
    });
  });

  describe("local URL cleaning", () => {
    it("strips query strings from local logo paths (next/image rejects them)", () => {
      process.env.NEXT_PUBLIC_LOGO_URL = "/brand/logo.svg?v=2";
      expect(branding.getLogoUrl()).toBe("/brand/logo.svg");
    });

    it("leaves absolute (http) URLs with query strings intact", () => {
      process.env.NEXT_PUBLIC_LOGO_URL = "https://cdn.example.com/logo.png?v=2";
      expect(branding.getLogoUrl()).toBe(
        "https://cdn.example.com/logo.png?v=2"
      );
    });

    it("cleans favicon paths the same way", () => {
      process.env.NEXT_PUBLIC_FAVICON_URL = "/favicon.ico?cachebust=1";
      expect(branding.getFaviconUrl()).toBe("/favicon.ico");
    });
  });

  describe("email helpers", () => {
    it("getEmailFromName falls back to the brand name", () => {
      expect(branding.getEmailFromName()).toBe("Packet.ai");
    });

    it("getEmailFromName honors an explicit override", () => {
      process.env.EMAIL_FROM_NAME = "Billing Team";
      expect(branding.getEmailFromName()).toBe("Billing Team");
    });

    it("getEmailFromAddress derives no-reply@{dashboard hostname} when unset", () => {
      // Default Pro dashboard is https://dash.packet.ai → dash.packet.ai
      expect(branding.getEmailFromAddress()).toBe("no-reply@dash.packet.ai");
    });

    it("getEmailFromAddress honors an explicit override", () => {
      process.env.EMAIL_FROM_ADDRESS = "noreply@custom.com";
      expect(branding.getEmailFromAddress()).toBe("noreply@custom.com");
    });

    it("getEmailFooterText defaults to empty string", () => {
      expect(branding.getEmailFooterText()).toBe("");
    });
  });

  describe("getBrandConfig", () => {
    it("assembles every branding field into one object", () => {
      const cfg = branding.getBrandConfig();
      expect(cfg).toMatchObject({
        brandName: "Packet.ai",
        appUrl: "https://packet.ai",
        dashboardUrl: "https://dash.packet.ai",
        apiBaseUrl: "https://api.packet.ai",
        supportEmail: "help@packet.ai",
        logoUrl: "/packet-logo.png",
        faviconUrl: "/favicon.ico",
        primaryColor: "#1a4fff",
        accentColor: "#18b6a8",
        companyName: "Hosted AI Inc.",
        emailFromName: "Packet.ai",
        emailFromAddress: "no-reply@dash.packet.ai",
      });
    });

    it("reflects the OSS edition when isOSS() is true", () => {
      mockIsOSS.mockReturnValue(true);
      const cfg = branding.getBrandConfig();
      expect(cfg.brandName).toBe("GPU Cloud Dashboard");
      expect(cfg.companyName).toBe("");
    });
  });
});
