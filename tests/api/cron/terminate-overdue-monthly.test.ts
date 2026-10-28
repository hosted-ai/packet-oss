// Tests for src/app/api/cron/terminate-overdue-monthly/route.ts (PA-361).
//
// This sweep is the second half of the monthly-payment grace window: the Stripe
// webhook stamps PodMetadata.paymentFailedAt on the first failed invoice
// instead of terminating; this cron terminates pods still stamped past 24h.
// Getting it wrong destroys a paying customer's running pods. Pinned contracts:
//   * Auth gating (no query when unauthorized)
//   * Query scoping: monthly + paymentFailedAt older than the 24h cutoff
//   * Re-checks the LIVE Stripe subscription first — an active/trialing sub
//     (missed payment_succeeded webhook) clears the clock, never terminates
//   * A still-unpaid / canceled subscription IS terminated (deleteInstance on
//     the HAI instance + delete metadata — PA-347: these are instance-model
//     pods, so the legacy unsubscribeFromPool is a no-op)
//   * A subscription lookup that THROWS is ignorance, not a verdict — skipped
//   * Pods with no instanceId still get their metadata deleted (no orphans)
//   * Idempotent tallies; DB failure → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockFindMany,
  mockUpdateMany,
  mockDelete,
  mockGetStripe,
  mockDeleteInstance,
  mockSubRetrieve,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDelete: vi.fn(),
  mockGetStripe: vi.fn(),
  mockDeleteInstance: vi.fn(),
  mockSubRetrieve: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    podMetadata: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
      delete: mockDelete,
    },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: mockGetStripe }));
vi.mock("@/lib/hostedai", () => ({ deleteInstance: mockDeleteInstance }));

import { GET, POST } from "@/app/api/cron/terminate-overdue-monthly/route";

const SECRET = "cron-terminate-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/terminate-overdue-monthly", {
    method: "POST",
    headers,
  });
}

function overduePod(overrides: Record<string, unknown> = {}) {
  return {
    id: "pod-1",
    subscriptionId: "instance-i-1",
    instanceId: "i-1",
    poolId: "pool-1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  mockFindMany.mockResolvedValue([]);
  mockUpdateMany.mockResolvedValue({ count: 0 });
  mockDelete.mockResolvedValue({});
  mockDeleteInstance.mockResolvedValue(undefined);
  // Default: subscription is still unpaid (past_due) → terminate.
  mockSubRetrieve.mockResolvedValue({ id: "sub_1", status: "past_due" });
  mockGetStripe.mockResolvedValue({
    subscriptions: { retrieve: mockSubRetrieve },
  });
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL;
  vi.clearAllMocks();
});

describe("POST /api/cron/terminate-overdue-monthly", () => {
  it("returns 401 on an unauthorized request without querying", async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("queries only monthly pods stamped past the 24h cutoff", async () => {
    await POST(makeRequest(SECRET));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billingType: "monthly",
          paymentFailedAt: expect.objectContaining({
            not: null,
            lt: expect.any(Date),
          }),
        }),
      })
    );
  });

  it("handles zero overdue pods cleanly", async () => {
    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, checked: 0, terminated: 0, recovered: 0, skipped: 0 });
  });

  it("terminates a pod whose subscription is still unpaid after the window", async () => {
    mockFindMany.mockResolvedValue([overduePod()]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSubRetrieve).toHaveBeenCalledWith("sub_1");
    // PA-347: monthly pods are instance-model — deleteInstance is the real
    // teardown, not the legacy (no-op) unsubscribeFromPool.
    expect(mockDeleteInstance).toHaveBeenCalledWith("i-1");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "pod-1" } });
    expect(body.terminated).toBe(1);
    expect(body.recovered).toBe(0);
  });

  it("spares a pod whose subscription recovered (missed payment_succeeded webhook)", async () => {
    mockFindMany.mockResolvedValue([overduePod()]);
    mockSubRetrieve.mockResolvedValue({ id: "sub_1", status: "active" });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    // Clock cleared, pod NOT terminated.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_1",
        billingType: "monthly",
        paymentFailedAt: { not: null },
      },
      data: { paymentFailedAt: null },
    });
    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(body.recovered).toBe(1);
    expect(body.terminated).toBe(0);
  });

  it("never terminates when the live subscription lookup throws", async () => {
    mockFindMany.mockResolvedValue([overduePod()]);
    mockSubRetrieve.mockRejectedValue(new Error("Stripe is unreachable"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(body.terminated).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it("still deletes metadata (no orphaned tracking row) when a pod has no instanceId", async () => {
    mockFindMany.mockResolvedValue([overduePod({ instanceId: null })]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "pod-1" } });
    expect(body.terminated).toBe(1);
  });

  it("re-checks each subscription once when several pods share it", async () => {
    mockFindMany.mockResolvedValue([
      overduePod({ id: "pod-1", subscriptionId: "instance-i-1", instanceId: "i-1" }),
      overduePod({ id: "pod-2", subscriptionId: "instance-i-2", instanceId: "i-2" }),
    ]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSubRetrieve).toHaveBeenCalledTimes(1); // grouped by subscription
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(body.terminated).toBe(2);
  });

  it("skips pods with no linked subscription (can't re-verify)", async () => {
    mockFindMany.mockResolvedValue([overduePod({ stripeSubscriptionId: null })]);

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(mockSubRetrieve).not.toHaveBeenCalled();
    expect(mockDeleteInstance).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(body.checked).toBe(1);
    expect(body.terminated).toBe(0);
  });

  it("returns 500 when the DB query fails", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));

    const res = await POST(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("db down");
  });

  it("is reachable via GET for manual runs", async () => {
    const res = await GET(makeRequest(SECRET));

    expect(res.status).toBe(200);
  });
});
