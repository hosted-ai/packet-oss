/**
 * Admin per-pod SSH credentials, fetched on demand from HAI.
 *
 *   GET /api/admin/pods/ssh?id=<instanceId>&nature=<pod|baremetal>
 *
 * GPU pods:   HAI  GET /instance/{id}/credentials
 * Baremetal:  HAI  GET /baremetal/instances/{id}/credentials
 * (For baremetal, id is the numeric HAI subscription id, e.g. "121".)
 *
 * Both return { ip, username, password, port }. We never persist the password —
 * it's fetched live and handed straight to the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getInstanceCredentials, getBaremetalCredentials } from "@/lib/hostedai";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken || !verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const nature = searchParams.get("nature");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const creds =
      nature === "baremetal"
        ? await getBaremetalCredentials(id)
        : await getInstanceCredentials(id);

    if (!creds?.ip) {
      return NextResponse.json({ error: "No SSH info for this pod" }, { status: 404 });
    }

    const port = creds.port ?? 22;
    const username = creds.username || "root";
    const command = `ssh -p ${port} ${username}@${creds.ip}`;
    return NextResponse.json({
      command,
      host: creds.ip,
      port,
      username,
      password: creds.password ?? undefined,
    });
  } catch (err) {
    console.error("Admin pod SSH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch SSH info" },
      { status: 500 }
    );
  }
}
