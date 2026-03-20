import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  SERVICE_GROUPS,
  getSetting,
  getSettings,
  setSetting,
  isSensitiveKey,
  isServiceConfigured,
  isEmailConfigured,
  maskValue,
  clearSettingsCache,
  type ServiceName,
} from "@/lib/settings";
import { clearSmtpPool } from "@/lib/email/client";
import { DEFAULT_BLOCKED_DOMAINS } from "@/lib/email-blocklist";

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

  return NextResponse.json({ services, emailBlocklist });
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

    // Skip empty values — don't store blanks
    if (!value || value.trim() === "") {
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
