import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  SERVICE_GROUPS,
  getSettings,
  setSetting,
  isSensitiveKey,
  isServiceConfigured,
  maskValue,
  type ServiceName,
} from "@/lib/settings";

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
    const configured = await isServiceConfigured(name as ServiceName);
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

  return NextResponse.json({ services });
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

  return NextResponse.json({ success: true });
}
