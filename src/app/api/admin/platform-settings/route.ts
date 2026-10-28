import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  SERVICE_GROUPS,
  getSetting,
  getSettings,
  setSetting,
  deleteSetting,
  isSensitiveKey,
  isServiceConfigured,
  isEmailConfigured,
  maskValue,
  clearSettingsCache,
  type ServiceName,
} from "@/lib/settings";
import { clearSmtpPool } from "@/lib/email/client";
import { DEFAULT_BLOCKED_DOMAINS } from "@/lib/email-blocklist";
import { DEFAULT_EMBARGOED_COUNTRIES } from "@/lib/embargo";
import {
  DEFAULT_INTERNAL_EMAIL_DOMAINS,
  DEFAULT_EXCLUDED_EMAILS,
  INTERNAL_EMAIL_DOMAINS_SETTING,
  INTERNAL_EXCLUDED_EMAILS_SETTING,
  getInternalExclusions,
} from "@/lib/internal-accounts";

function verifyAdmin(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken);
}

/**
 * GET /api/admin/platform-settings
 * Returns all service groups with their current values (sensitive values masked).
 */
export async function GET(request: NextRequest) {
  const session = verifyAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allKeys = Object.values(SERVICE_GROUPS).flatMap(
    (g) => g.keys as unknown as string[]
  );
  const values = await getSettings(allKeys);

  const services: Record<string, {
    label: string;
    configured: boolean;
    settings: Record<string, string | null>;
  }> = {};

  for (const [name, group] of Object.entries(SERVICE_GROUPS)) {
    // smtp group uses custom check (SMTP configured)
    const configured = name === "smtp"
      ? await isEmailConfigured()
      : await isServiceConfigured(name as ServiceName);
    const settings: Record<string, string | null> = {};

    for (const key of group.keys) {
      const raw = values[key];
      if (raw && isSensitiveKey(key)) {
        settings[key] = maskValue(raw);
      } else {
        settings[key] = raw;
      }
    }

    services[name] = {
      label: group.label,
      configured,
      settings,
    };
  }

  // ── Email blocklist settings ──
  const [blocklistEnabled, blocklistDomains] = await Promise.all([
    getSetting("email_blocklist_enabled"),
    getSetting("email_blocklist_domains"),
  ]);

  let domains: string[] = [];
  if (blocklistDomains) {
    try { domains = JSON.parse(blocklistDomains); } catch { /* malformed, return empty */ }
  }

  const emailBlocklist = {
    enabled: blocklistEnabled === "true",
    domains,
    defaultDomains: DEFAULT_BLOCKED_DOMAINS,
  };

  // ── Embargo settings ──
  const [embargoEnabled, embargoCountries] = await Promise.all([
    getSetting("embargo_enabled"),
    getSetting("embargo_countries"),
  ]);

  let embargoList: string[] = [];
  if (embargoCountries) {
    try { embargoList = JSON.parse(embargoCountries); } catch { /* malformed, return empty */ }
  }

  const embargo = {
    enabled: embargoEnabled === "true",
    countries: embargoList,
    defaultCountries: DEFAULT_EMBARGOED_COUNTRIES,
  };

  // ── Internal / test-account exclusion (PA-410) ──
  const { domains: internalDomains, emails: internalEmails } = await getInternalExclusions();
  const internalExclusions = {
    domains: internalDomains,
    emails: internalEmails,
    defaultDomains: DEFAULT_INTERNAL_EMAIL_DOMAINS,
    defaultEmails: DEFAULT_EXCLUDED_EMAILS,
  };

  return NextResponse.json({ services, emailBlocklist, embargo, internalExclusions });
}

/**
 * PUT /api/admin/platform-settings
 * Save settings. Sensitive keys are encrypted at rest.
 */
export async function PUT(request: NextRequest) {
  const session = verifyAdmin(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // ── Handle embargo settings updates ──
  if (body.embargo !== undefined) {
    const { enabled, countries } = body.embargo as { enabled?: boolean; countries?: string[] };

    if (enabled !== undefined) {
      await setSetting("embargo_enabled", enabled ? "true" : "false");
    }

    if (Array.isArray(countries)) {
      // Sanitize: uppercase, trim, deduplicate, 2-letter codes only
      const cleaned = [...new Set(
        countries
          .map(c => c.toUpperCase().trim())
          .filter(c => c.length === 2 && /^[A-Z]{2}$/.test(c))
      )];
      await setSetting("embargo_countries", JSON.stringify(cleaned));
    }

    clearSettingsCache();
    return NextResponse.json({ success: true });
  }

  // ── Handle email blocklist updates ──
  if (body.emailBlocklist !== undefined) {
    const { enabled, domains } = body.emailBlocklist as { enabled?: boolean; domains?: string[] };

    if (enabled !== undefined) {
      await setSetting("email_blocklist_enabled", enabled ? "true" : "false");
    }

    if (Array.isArray(domains)) {
      // Sanitize: lowercase, trim, deduplicate, remove empty
      const cleaned = [...new Set(
        domains.map(d => d.toLowerCase().trim()).filter(d => d.length > 0 && d.includes("."))
      )];
      await setSetting("email_blocklist_domains", JSON.stringify(cleaned));
    }

    // Clear cache so blocklist takes effect immediately
    clearSettingsCache();

    return NextResponse.json({ success: true });
  }

  // ── Handle internal / test-account exclusion updates (PA-410) ──
  if (body.internalExclusions !== undefined) {
    const { domains, emails } = body.internalExclusions as { domains?: string[]; emails?: string[] };

    if (Array.isArray(domains)) {
      // Charset-restrict: these are inlined into raw SQL by the marketing funnel.
      const cleaned = [...new Set(
        domains
          .map((d) => d.toLowerCase().trim())
          .filter((d) => /^[a-z0-9.-]+$/.test(d) && d.includes("."))
      )];
      await setSetting(INTERNAL_EMAIL_DOMAINS_SETTING, JSON.stringify(cleaned));
    }

    if (Array.isArray(emails)) {
      const cleaned = [...new Set(
        emails
          .map((e) => e.toLowerCase().trim())
          .filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z0-9]{2,}$/.test(e))
      )];
      await setSetting(INTERNAL_EXCLUDED_EMAILS_SETTING, JSON.stringify(cleaned));
    }

    clearSettingsCache();
    return NextResponse.json({ success: true });
  }

  // ── Handle service group settings ──
  const incoming: Record<string, string> = body.settings;

  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate that all keys belong to a known service group
  const allKnownKeys = new Set(
    Object.values(SERVICE_GROUPS).flatMap((g) => g.keys as unknown as string[])
  );

  for (const [key, value] of Object.entries(incoming)) {
    if (!allKnownKeys.has(key)) {
      return NextResponse.json({ error: `Unknown setting key: ${key}` }, { status: 400 });
    }

    // Skip masked values (user didn't change the sensitive field)
    if (typeof value === "string" && value.endsWith("****") && isSensitiveKey(key)) {
      continue;
    }

    // Empty value → delete the setting so it falls back to env or stays unset
    if (!value || value.trim() === "") {
      await deleteSetting(key);
      continue;
    }

    const encrypted = isSensitiveKey(key);
    await setSetting(key, value, encrypted);
  }

  // Invalidate caches so new settings take effect immediately
  clearSettingsCache();
  clearSmtpPool();

  return NextResponse.json({ success: true });
}
