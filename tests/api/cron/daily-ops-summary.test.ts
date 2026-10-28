// Tests for src/app/api/cron/daily-ops-summary/route.ts.
//
// The compute itself is covered in tests/lib/ops-summary.test.ts — what's
// load-bearing HERE are the route guards, which decide whether the ops channel
// gets a post at all (and whether it gets a duplicate):
//   * Auth gating (CRON_SECRET)
//   * ?dryRun=1 computes but never posts, never stamps state
//   * config.enabled=false skips the scheduled post; ?force=1 overrides
//   * No webhook configured short-circuits BEFORE any Stripe/HAI sweep
//   * OPS_SUMMARY_LAST_POSTED dedup (catch-up/restart safe); ?force=1 overrides
//   * Success stamps LAST_POSTED + the Rev/GPU GPU-count snapshot
//   * Mattermost failure → 502 + ops alert, and does NOT stamp (so a retry posts)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getOpsWebhookUrl: vi.fn(),
  postToMattermost: vi.fn(),
  opsAlert: vi.fn(),
  computeOpsSummary: vi.fn(),
  getOpsSummaryConfig: vi.fn(),
  stampOpsGpuSnapshot: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getSetting: h.getSetting, setSetting: h.setSetting }));
vi.mock("@/lib/mattermost", () => ({
  getOpsWebhookUrl: h.getOpsWebhookUrl,
  postToMattermost: h.postToMattermost,
  MATTERMOST_OPS_WEBHOOK_KEY: "MATTERMOST_OPS_WEBHOOK_URL",
}));
vi.mock("@/lib/ops-alert", () => ({ opsAlert: h.opsAlert }));
vi.mock("@/lib/ops-summary", () => ({
  computeOpsSummary: h.computeOpsSummary,
  getOpsSummaryConfig: h.getOpsSummaryConfig,
  stampOpsGpuSnapshot: h.stampOpsGpuSnapshot,
  OPS_SUMMARY_LAST_POSTED_KEY: "OPS_SUMMARY_LAST_POSTED",
}));

import { POST } from "@/app/api/cron/daily-ops-summary/route";

const SECRET = "cron-ops-secret";
const ORIGINAL = process.env.CRON_SECRET;
const TODAY_UTC = new Date().toISOString().split("T")[0];
const SCOPE = { mode: "everything", productIds: [] };

function makeRequest(query = "", secret: string | null = SECRET) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest(`http://localhost/api/cron/daily-ops-summary${query}`, {
    method: "POST",
    headers,
  });
}

function summary() {
  return {
    date: "2026-07-29",
    scopeLabel: "Platform",
    rows: [],
    missing: [],
    bmContractCents: 0,
    text: "### 📊 Packet Daily Operating Summary — 2026-07-29",
    raw: { gpusInUse: 5 },
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  h.getOpsSummaryConfig.mockResolvedValue({ enabled: true, scope: SCOPE, gpuRows: [], goals: {} });
  h.getOpsWebhookUrl.mockResolvedValue("https://mattermost.example/hook");
  h.getSetting.mockResolvedValue(null); // not posted today
  h.computeOpsSummary.mockResolvedValue(summary());
  h.postToMattermost.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL;
  vi.clearAllMocks();
});

describe("POST /api/cron/daily-ops-summary", () => {
  it("401 without the cron secret; nothing computed", async () => {
    const res = await POST(makeRequest("", null));
    expect(res.status).toBe(401);
    expect(h.computeOpsSummary).not.toHaveBeenCalled();
    expect(h.postToMattermost).not.toHaveBeenCalled();
  });

  it("?dryRun=1 computes and returns the summary without posting or stamping", async () => {
    const res = await POST(makeRequest("?dryRun=1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.posted).toBe(false);
    expect(body.dryRun).toBe(true);
    expect(body.text).toContain("Daily Operating Summary");
    expect(h.postToMattermost).not.toHaveBeenCalled();
    expect(h.setSetting).not.toHaveBeenCalled();
    expect(h.stampOpsGpuSnapshot).not.toHaveBeenCalled();
  });

  it("skips when auto-post is disabled, before any sweep", async () => {
    h.getOpsSummaryConfig.mockResolvedValue({ enabled: false, scope: SCOPE, gpuRows: [], goals: {} });
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ posted: false, skipped: "auto-post disabled" });
    expect(h.computeOpsSummary).not.toHaveBeenCalled();
  });

  it("skips when no webhook is configured, BEFORE any Stripe/HAI sweep", async () => {
    h.getOpsWebhookUrl.mockResolvedValue(null);
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.posted).toBe(false);
    expect(body.skipped).toContain("MATTERMOST_OPS_WEBHOOK_URL");
    expect(h.computeOpsSummary).not.toHaveBeenCalled();
  });

  it("skips when already posted today (catch-up/restart dedup)", async () => {
    h.getSetting.mockResolvedValue(TODAY_UTC);
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ posted: false, skipped: "already posted today" });
    expect(h.postToMattermost).not.toHaveBeenCalled();
  });

  it("?force=1 posts despite disabled config AND the already-posted guard", async () => {
    h.getOpsSummaryConfig.mockResolvedValue({ enabled: false, scope: SCOPE, gpuRows: [], goals: {} });
    h.getSetting.mockResolvedValue(TODAY_UTC);
    const res = await POST(makeRequest("?force=1"));
    const body = await res.json();
    expect(body.posted).toBe(true);
    expect(h.postToMattermost).toHaveBeenCalled();
  });

  it("posts, stamps LAST_POSTED with today's UTC date, and stamps the GPU snapshot", async () => {
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.posted).toBe(true);
    expect(body.date).toBe("2026-07-29");
    expect(h.postToMattermost).toHaveBeenCalledWith(
      "https://mattermost.example/hook",
      expect.objectContaining({
        text: expect.stringContaining("Daily Operating Summary"),
        username: "Packet Ops",
      }),
    );
    expect(h.setSetting).toHaveBeenCalledWith("OPS_SUMMARY_LAST_POSTED", TODAY_UTC);
    // Tomorrow's Rev/GPU divides by a count measured during the revenue day.
    expect(h.stampOpsGpuSnapshot).toHaveBeenCalledWith(SCOPE, 5);
  });

  it("Mattermost failure → 502 + ops alert, and does NOT stamp (retry can post)", async () => {
    h.postToMattermost.mockRejectedValue(new Error("webhook 404"));
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.posted).toBe(false);
    expect(h.opsAlert).toHaveBeenCalled();
    expect(h.setSetting).not.toHaveBeenCalled();
    expect(h.stampOpsGpuSnapshot).not.toHaveBeenCalled();
  });

  it("compute failure → 500", async () => {
    h.computeOpsSummary.mockRejectedValue(new Error("HAI sweep died"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(h.postToMattermost).not.toHaveBeenCalled();
  });
});
