import { describe, it, expect, vi, beforeEach } from "vitest";

// billing.ts wraps the external hosted.ai billing HTTP API. We mock the client
// boundary (getApiUrl/getApiKey) and the pools module (for getTeamUsageSinceLast),
// then drive global fetch to assert request shape + response parsing/fallbacks.
const mockGetApiUrl = vi.fn(async () => "https://hai.test");
const mockGetApiKey = vi.fn(async () => "test-key");
vi.mock("@/lib/hostedai/client", () => ({
  getApiUrl: () => mockGetApiUrl(),
  getApiKey: () => mockGetApiKey(),
}));

const mockGetPoolSubscriptions = vi.fn();
vi.mock("@/lib/hostedai/pools", () => ({
  getPoolSubscriptions: (...args: unknown[]) => mockGetPoolSubscriptions(...args),
}));

import {
  formatBillingDatetime,
  getTeamBillingSummary,
  getTeamBillingLastHour,
  getTeamBillingSummaryV2,
  getTeamUsageSinceLast,
} from "@/lib/hostedai/billing";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okText(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetApiUrl.mockResolvedValue("https://hai.test");
  mockGetApiKey.mockResolvedValue("test-key");
});

describe("formatBillingDatetime", () => {
  it("formats a UTC date as YYYY-MM-DDTHH:mm", () => {
    const d = new Date(Date.UTC(2026, 0, 5, 9, 7)); // Jan 5 2026 09:07 UTC
    expect(formatBillingDatetime(d)).toBe("2026-01-05T09:07");
  });

  it("zero-pads month, day, hour, and minute", () => {
    const d = new Date(Date.UTC(2026, 11, 31, 23, 59));
    expect(formatBillingDatetime(d)).toBe("2026-12-31T23:59");
  });

  it("uses UTC, not local time", () => {
    const d = new Date(Date.UTC(2026, 5, 1, 0, 0));
    expect(formatBillingDatetime(d)).toBe("2026-06-01T00:00");
  });
});

describe("getTeamBillingSummary", () => {
  it("builds the team-billing URL with interval + timezone and X-API-Key header", async () => {
    mockFetch.mockResolvedValueOnce(
      okText(JSON.stringify({ total_cost: 12, total_hours: 3, instances: [] }))
    );

    const data = await getTeamBillingSummary(
      "team-1",
      "2026-01-01T00:00",
      "2026-01-02T00:00",
      "daily"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hai.test/api/team-billing/team-1/2026-01-01T00:00/2026-01-02T00:00/daily?timezone=UTC",
      {
        method: "GET",
        headers: {
          "X-API-Key": "test-key",
          "Content-Type": "application/json",
        },
      }
    );
    expect(data).toEqual({ total_cost: 12, total_hours: 3, instances: [] });
  });

  it("defaults the interval to daily", async () => {
    mockFetch.mockResolvedValueOnce(okText(JSON.stringify({ total_cost: 0 })));
    await getTeamBillingSummary("t", "2026-01-01T00:00", "2026-01-02T00:00");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/daily?timezone=UTC");
  });

  it("returns a zeroed summary on an empty body", async () => {
    mockFetch.mockResolvedValueOnce(okText(""));
    const data = await getTeamBillingSummary("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, instances: [] });
  });

  it("returns a zeroed summary on a FAILURE result envelope", async () => {
    mockFetch.mockResolvedValueOnce(
      okText(JSON.stringify({ result: "FAILURE", errors: ["bad"] }))
    );
    const data = await getTeamBillingSummary("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, instances: [] });
  });

  it("returns a zeroed summary when the response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ total_cost: 99 }),
    });
    const data = await getTeamBillingSummary("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, instances: [] });
  });

  it("returns a zeroed summary on non-JSON body", async () => {
    mockFetch.mockResolvedValueOnce(okText("not json"));
    const data = await getTeamBillingSummary("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, instances: [] });
  });

  it("returns a zeroed summary when fetch rejects (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const data = await getTeamBillingSummary("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, instances: [] });
  });
});

describe("getTeamBillingLastHour", () => {
  it("returns total_cost and total_hours from the daily summary", async () => {
    mockFetch.mockResolvedValueOnce(
      okText(JSON.stringify({ total_cost: 40, total_hours: 8, instances: [] }))
    );
    const r = await getTeamBillingLastHour("team-1");
    expect(r).toEqual({ totalCost: 40, hoursUsed: 8 });
  });

  it("falls back to cost/2 when total_hours is absent", async () => {
    mockFetch.mockResolvedValueOnce(
      okText(JSON.stringify({ total_cost: 10, instances: [] }))
    );
    const r = await getTeamBillingLastHour("team-1");
    expect(r).toEqual({ totalCost: 10, hoursUsed: 5 });
  });

  it("returns zeroes when the API yields an empty body", async () => {
    mockFetch.mockResolvedValueOnce(okText(""));
    const r = await getTeamBillingLastHour("team-1");
    expect(r).toEqual({ totalCost: 0, hoursUsed: 0 });
  });
});

describe("getTeamBillingSummaryV2", () => {
  it("builds the summary URL (no interval, no timezone)", async () => {
    mockFetch.mockResolvedValueOnce(
      okText(JSON.stringify({ total_cost: 5, total_hours: 1, pool_hours: 2 }))
    );
    const data = await getTeamBillingSummaryV2(
      "team-9",
      "2026-01-01T00:00",
      "2026-01-02T00:00"
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hai.test/api/team-billing/summary/team-9/2026-01-01T00:00/2026-01-02T00:00",
      {
        method: "GET",
        headers: {
          "X-API-Key": "test-key",
          "Content-Type": "application/json",
        },
      }
    );
    expect(data).toEqual({ total_cost: 5, total_hours: 1, pool_hours: 2 });
  });

  it("returns a zeroed summary on empty body", async () => {
    mockFetch.mockResolvedValueOnce(okText(""));
    const data = await getTeamBillingSummaryV2("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, pool_hours: 0 });
  });

  it("returns a zeroed summary when not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ total_cost: 7 }),
    });
    const data = await getTeamBillingSummaryV2("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, pool_hours: 0 });
  });

  it("returns a zeroed summary on non-JSON body", async () => {
    mockFetch.mockResolvedValueOnce(okText("<html>oops</html>"));
    const data = await getTeamBillingSummaryV2("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, pool_hours: 0 });
  });

  it("returns a zeroed summary when fetch rejects", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    const data = await getTeamBillingSummaryV2("t", "a", "b");
    expect(data).toEqual({ total_cost: 0, total_hours: 0, pool_hours: 0 });
  });
});

describe("getTeamUsageSinceLast", () => {
  it("counts GPU-hours only for RUNNING pods over the interval", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: "s1",
        status: "subscribed",
        per_pod_info: { vgpu_count: 2 },
        pods: [
          { pod_name: "p1", pod_status: "Running", gpu_count: 2 },
          { pod_name: "p2", pod_status: "stopped", gpu_count: 2 },
        ],
      },
    ]);
    // 2 running GPUs * (30/60) hr = 1.0 GPU-hour
    const r = await getTeamUsageSinceLast("team-1", 30);
    expect(r.hoursUsed).toBeCloseTo(1.0, 5);
    expect(r.totalCost).toBe(0); // cost computed by caller, not here
  });

  it("skips subscriptions that are not active/subscribed", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: "s1",
        status: "cancelled",
        per_pod_info: { vgpu_count: 4 },
        pods: [{ pod_name: "p1", pod_status: "Running", gpu_count: 4 }],
      },
    ]);
    const r = await getTeamUsageSinceLast("team-1", 60);
    expect(r.hoursUsed).toBe(0);
  });

  it("falls back to the subscription vgpu_count when a pod omits gpu_count", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: "s1",
        status: "active",
        per_pod_info: { vgpu_count: 3 },
        pods: [{ pod_name: "p1", pod_status: "running" }],
      },
    ]);
    // 3 GPUs * (60/60) hr = 3
    const r = await getTeamUsageSinceLast("team-1", 60);
    expect(r.hoursUsed).toBeCloseTo(3, 5);
  });

  it("rounds fractional vgpu counts up and treats missing counts as 1", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      {
        id: "s1",
        status: "subscribed",
        per_pod_info: {}, // no vgpu_count → defaults to 1
        pods: [{ pod_name: "p1", pod_status: "running", gpu_count: 1.2 }],
      },
    ]);
    // ceil(1.2) = 2 GPUs * (30/60) = 1.0
    const r = await getTeamUsageSinceLast("team-1", 30);
    expect(r.hoursUsed).toBeCloseTo(1.0, 5);
  });

  it("bills nothing for a subscription with no pods array", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([
      { id: "s1", status: "active", per_pod_info: { vgpu_count: 8 }, pods: [] },
    ]);
    const r = await getTeamUsageSinceLast("team-1", 30);
    expect(r.hoursUsed).toBe(0);
  });

  it("returns zero usage when there are no subscriptions", async () => {
    mockGetPoolSubscriptions.mockResolvedValue([]);
    const r = await getTeamUsageSinceLast("team-1");
    expect(r).toEqual({ hoursUsed: 0, totalCost: 0 });
  });
});
