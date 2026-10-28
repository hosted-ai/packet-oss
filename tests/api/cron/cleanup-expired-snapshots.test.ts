// Tests for src/app/api/cron/cleanup-expired-snapshots/route.ts.
//
// This cron is intentionally a no-op: PA-88 removed snapshot auto-preservation,
// so snapshots are manual-only and never expire. The contract worth pinning is
// exactly that — it stays a no-op and never touches the database — so a future
// re-activation has to consciously rewrite these expectations. It still sits
// behind CRON_SECRET like every other cron endpoint (PA-259).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/cron/cleanup-expired-snapshots/route";

const SECRET = "cleanup-snapshots-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/cleanup-expired-snapshots", {
    method: "POST",
    headers,
  });
}

describe("POST /api/cron/cleanup-expired-snapshots", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
  });

  it("returns 401 without the cron secret", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns a disabled-cleanup success message", async () => {
    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
  });

  it("GET delegates to POST (manual-trigger parity)", async () => {
    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
