import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/admin";
import { getSetting, setSetting, getSettings, isServiceConfigured, SERVICE_GROUPS, isSensitiveKey, maskValue, type ServiceName } from "@/lib/settings";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = verifySessionToken(sessionToken);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Gather all settings with their status
  const services: Record<string, { label: string; configured: boolean; settings: Record<string, string | null> }> = {};

  for (const [name, group] of Object.entries(SERVICE_GROUPS)) {
    const configured = await isServiceConfigured(name as ServiceName);
    const values = await getSettings(group.keys as unknown as string[]);

    // Mask sensitive values
    const masked: Record<string, string | null> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val && isSensitiveKey(key)) {
        masked[key] = maskValue(val);
      } else {
        masked[key] = val;
      }
    }

    services[name] = { label: group.label, configured, settings: masked };
  }

  return NextResponse.json({ services });
}

export async function PUT(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = verifySessionToken(sessionToken);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { settings } = body as { settings: Record<string, string> };

  if (!settings || typeof settings !== "object") {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }

  // Save each setting
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null) continue;
    // Skip masked values (user didn't change them)
    if (value.endsWith("****") && value.length <= 12) continue;
    const encrypted = isSensitiveKey(key);
    await setSetting(key, value, encrypted);
  }

  return NextResponse.json({ success: true });
}
