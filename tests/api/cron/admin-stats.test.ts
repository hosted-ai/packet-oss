// Tests for src/app/api/cron/admin-stats/route.ts.
//
// Twice-daily cron that snapshots admin dashboard KPIs (customers, revenue,
// MRR, active pods) into AdminStatsSnapshot. Pinned contracts:
//   * Auth gating
//   * Weekly revenue = succeeded Stripe charges minus refunds, paginated
//   * MRR = monthly items at face value + yearly items / 12
//   * Pod-count guard: HAI returning 0 pods while the last snapshot had
//     some → keep the snapshot value and skip cache pod-count writes
//     (likely API failure, not mass termination)
//   * HAI being down entirely is non-fatal — stats still snapshot
//   * Snapshot upserts on today's date
//   * Hard failure (customer cache unreadable) → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockCustomerCacheFindMany,
  mockCustomerCacheUpdateMany,
  mockCustomerCacheUpdate,
  mockSnapshotFindFirst,
  mockSnapshotUpsert,
  mockGetStripe,
  mockChargesList,
  mockSubscriptionsList,
  mockGetGlobalInstanceSummary,
  mockHostedaiRequest,
  mockCustomerLifecycleCount,
} = vi.hoisted(() => ({
  mockCustomerCacheFindMany: vi.fn(),
  mockCustomerCacheUpdateMany: vi.fn(),
  mockCustomerCacheUpdate: vi.fn(),
  mockSnapshotFindFirst: vi.fn(),
  mockSnapshotUpsert: vi.fn(),
  mockGetStripe: vi.fn(),
  mockChargesList: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockGetGlobalInstanceSummary: vi.fn(),
  mockHostedaiRequest: vi.fn(),
  mockCustomerLifecycleCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: {
      findMany: mockCustomerCacheFindMany,
      updateMany: mockCustomerCacheUpdateMany,
      update: mockCustomerCacheUpdate,
    },
    adminStatsSnapshot: {
      findFirst: mockSnapshotFindFirst,
      upsert: mockSnapshotUpsert,
    },
    // Total Customers is now a live count from customer_lifecycle (Total
    // Signups), decoupled from the CustomerCache length the route used to count.
    customerLifecycle: { count: mockCustomerLifecycleCount },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai/instances", () => ({
  getGlobalInstanceSummary: mockGetGlobalInstanceSummary,
}));
vi.mock("@/lib/hostedai/client", () => ({
  hostedaiRequest: mockHostedaiRequest,
}));

import { POST } from "@/app/api/cron/admin-stats/route";

const SECRET = "cron-stats-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/admin-stats", {
    method: "POST",
    headers,
  });
}

function cachedCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cus_1",
    email: "a@x.com",
    teamId: "team-1",
    billingType: "hourly",
    stripeCreatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30d ago
    ...overrides,
  };
}

function subscription(interval: "month" | "year", unitAmount: number, quantity = 1) {
  return {
    items: {
      data: [{ price: { recurring: { interval }, unit_amount: unitAmount }, quantity }],
    },
  };
}

describe("POST /api/cron/admin-stats", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockGetStripe.mockResolvedValue({
      charges: { list: mockChargesList },
      subscriptions: { list: mockSubscriptionsList },
    });
    mockCustomerCacheFindMany.mockResolvedValue([]);
    mockCustomerCacheUpdateMany.mockResolvedValue({ count: 0 });
    mockCustomerCacheUpdate.mockResolvedValue({});
    mockSnapshotFindFirst.mockResolvedValue(null);
    mockSnapshotUpsert.mockResolvedValue({});
    mockChargesList.mockResolvedValue({ data: [], has_more: false });
    mockSubscriptionsList.mockResolvedValue({ data: [] });
    mockGetGlobalInstanceSummary.mockResolvedValue({
      statusCounts: [],
      totalItems: 0,
    });
    mockHostedaiRequest.mockResolvedValue({ items: [], total_items: 0 });
    // Default live customer count; the test that asserts on it overrides.
    mockCustomerLifecycleCount.mockResolvedValue(0);
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without reading anything", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockCustomerCacheFindMany).not.toHaveBeenCalled();
  });

  it("sums weekly revenue from succeeded charges minus refunds, across pages", async () => {
    mockChargesList
      .mockResolvedValueOnce({
        data: [
          { id: "ch_1", status: "succeeded", amount: 10000, amount_refunded: 2500 },
          { id: "ch_2", status: "failed", amount: 9999, amount_refunded: 0 },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: "ch_3", status: "succeeded", amount: 5000, amount_refunded: 0 }],
        has_more: false,
      });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    // (10000 - 2500) + 5000; failed charge excluded
    expect(body.revenueWeekCents).toBe(12500);
    expect(mockChargesList).toHaveBeenCalledTimes(2);
    expect(mockChargesList.mock.calls[1][0]).toMatchObject({
      starting_after: "ch_2",
    });
  });

  it("computes MRR from monthly items plus yearly items divided by 12", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [
        subscription("month", 5000, 2), // 10000
        subscription("year", 120000), // 10000/mo
      ],
    });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.mrr).toBe(20000);
  });

  it("counts new customers from the last 7 days only", async () => {
    mockCustomerCacheFindMany.mockResolvedValue([
      cachedCustomer({ id: "old" }),
      cachedCustomer({
        id: "new",
        email: "b@x.com",
        teamId: "team-2",
        stripeCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      }),
    ]);
    // Total Customers is the live customerLifecycle count (5), independent of
    // the cache; newThisWeek is still derived from the cache (1 of 2 within 7d).
    mockCustomerLifecycleCount.mockResolvedValue(5);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.totalCustomers).toBe(5);
    expect(body.newThisWeek).toBe(1);
  });

  it("attributes active pods to customers via team id and writes counts", async () => {
    mockCustomerCacheFindMany.mockResolvedValue([
      cachedCustomer({ id: "cus_1", teamId: "team-1" }),
      cachedCustomer({ id: "cus_2", email: "b@x.com", teamId: "team-2" }),
    ]);
    mockGetGlobalInstanceSummary.mockResolvedValue({
      statusCounts: [
        { status: "Running", count: 2 },
        { status: "stopped", count: 5 },
      ],
      totalItems: 3,
    });
    mockHostedaiRequest.mockResolvedValue({
      items: [
        { status: "running", team: { id: "team-1" } },
        { status: "running", team: { id: "team-1" } },
        { status: "stopped", team: { id: "team-2" } },
      ],
      total_items: 3,
    });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.activePods).toBe(2); // running only, stopped excluded
    // Reset all counts, then write the attributed customer
    expect(mockCustomerCacheUpdateMany).toHaveBeenCalledWith({
      where: { isDeleted: false },
      data: { activePods: 0 },
    });
    expect(mockCustomerCacheUpdate).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: { activePods: 2 },
    });
  });

  // PA-134: /instances/unified returns both pods and VMs. A live VM reports
  // status "active" (Confluence HP/600178689 §2 — the VM analog of a pod's
  // "running"), not "running". Before the fix ACTIVE_STATUSES omitted "active",
  // so a customer's live VM GPU was counted on their own dashboard but dropped
  // from this admin per-customer count — the reported divergence.
  it("counts a live VM instance (status 'active') toward its customer's pod count (PA-134)", async () => {
    mockCustomerCacheFindMany.mockResolvedValue([
      cachedCustomer({ id: "cus_1", teamId: "team-1" }),
    ]);
    mockGetGlobalInstanceSummary.mockResolvedValue({
      statusCounts: [{ status: "active", count: 1 }],
      totalItems: 1,
    });
    mockHostedaiRequest.mockResolvedValue({
      items: [{ status: "active", team: { id: "team-1" } }],
      total_items: 1,
    });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.activePods).toBe(1); // VM "active" now counts as live
    expect(mockCustomerCacheUpdate).toHaveBeenCalledWith({
      where: { id: "cus_1" },
      data: { activePods: 1 },
    });
  });

  it("keeps the last snapshot's pod count when HAI reports 0 but snapshot had pods", async () => {
    mockSnapshotFindFirst.mockResolvedValue({ activeGPUs: 14 });
    mockGetGlobalInstanceSummary.mockRejectedValue(new Error("HAI down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200); // HAI being down is non-fatal
    expect(body.activePods).toBe(14); // kept, not zeroed
    expect(mockCustomerCacheUpdateMany).not.toHaveBeenCalled();
  });

  it("accepts 0 pods when the last snapshot was also 0 (genuinely idle platform)", async () => {
    mockSnapshotFindFirst.mockResolvedValue({ activeGPUs: 0 });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(body.activePods).toBe(0);
    expect(mockCustomerCacheUpdateMany).toHaveBeenCalled();
  });

  it("upserts the snapshot keyed on today's date", async () => {
    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    const todayStr = new Date().toISOString().split("T")[0];
    expect(body.date).toBe(todayStr);
    expect(mockSnapshotUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: todayStr },
        create: expect.objectContaining({ date: todayStr }),
      }),
    );
  });

  it("returns 500 with details when the customer cache is unreadable", async () => {
    mockCustomerCacheFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to compute stats");
    expect(body.details).toBe("db down");
    expect(mockSnapshotUpsert).not.toHaveBeenCalled();
  });
});
