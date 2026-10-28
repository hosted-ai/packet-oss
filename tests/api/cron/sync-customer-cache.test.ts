// Tests for src/app/api/cron/sync-customer-cache/route.ts.
//
// Thin cron wrapper around fullSyncCustomerCache(). The contracts worth
// pinning: auth gating, the success payload mirrors the sync result, sync
// failures surface as 500 (so cron-job.org alerts fire), and GET delegates
// to POST for manual triggering.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { mockFullSync } = vi.hoisted(() => ({
  mockFullSync: vi.fn(),
}));

vi.mock("@/lib/customer-cache", () => ({
  fullSyncCustomerCache: mockFullSync,
}));

import { GET, POST } from "@/app/api/cron/sync-customer-cache/route";

const SECRET = "cron-cache-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(method: "GET" | "POST", secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/sync-customer-cache", {
    method,
    headers,
  });
}

describe("POST /api/cron/sync-customer-cache", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockFullSync.mockResolvedValue({ synced: 0, deleted: 0, refused: false });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without syncing", async () => {
    const res = await POST(makeRequest("POST"));

    expect(res.status).toBe(401);
    expect(mockFullSync).not.toHaveBeenCalled();
  });

  it("returns the sync result counts on success", async () => {
    mockFullSync.mockResolvedValue({ synced: 42, deleted: 3, refused: false });

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, synced: 42, deleted: 3, refused: false });
    expect(mockFullSync).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with details when the sync throws", async () => {
    mockFullSync.mockRejectedValue(new Error("stripe rate limited"));

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to sync customer cache");
    expect(body.details).toBe("stripe rate limited");
  });

  // A refused run is not a failed one, so it 200s — but the caller must be
  // able to tell it apart from a sweep that genuinely found nothing to delete.
  it("surfaces a refused sweep distinctly from a clean run", async () => {
    mockFullSync.mockResolvedValue({ synced: 12, deleted: 0, refused: true });

    const res = await POST(makeRequest("POST", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, synced: 12, deleted: 0, refused: true });
  });

  it("GET delegates to POST (manual-trigger parity)", async () => {
    mockFullSync.mockResolvedValue({ synced: 7, deleted: 1, refused: false });

    const res = await GET(makeRequest("GET", SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(7);
  });
});
