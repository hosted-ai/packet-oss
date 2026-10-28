// Tests for src/app/api/cron/cleanup-expired-volumes/route.ts (PA-206).
//
// Daily cron that deletes shared volumes past their non-payment grace period.
// Getting this wrong deletes a paying customer's data (recovered but still
// cleaned up) or leaks storage forever (never cleaned up). Pinned contracts:
//   * Auth gating (fail-closed)
//   * Query scoping: only rows whose scheduledFor is due (<= now)
//   * Recovery guard: customer no longer owes → keep storage, drop the row
//   * Deleted Stripe customer → proceed to delete (nothing to recover)
//   * Balance-check failure → defer (don't delete this run), status "error"
//   * HAI 404 on delete → treat as gone, drop the row
//   * Other HAI delete error → keep the row for retry, status "error"
//   * DB failure → 500

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockFindMany,
  mockDelete,
  mockCustomersRetrieve,
  mockDeleteSharedVolume,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockDelete: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockDeleteSharedVolume: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingVolumeDeletion: {
      findMany: mockFindMany,
      delete: mockDelete,
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn().mockResolvedValue({
    customers: { retrieve: mockCustomersRetrieve },
  }),
}));
vi.mock("@/lib/hostedai", () => ({
  deleteSharedVolume: mockDeleteSharedVolume,
}));

import { GET } from "@/app/api/cron/cleanup-expired-volumes/route";

const SECRET = "cron-volumes-secret";
const ORIGINAL = process.env.CRON_SECRET;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) headers.set("x-cron-secret", secret);
  return new NextRequest("http://localhost/api/cron/cleanup-expired-volumes", {
    method: "GET",
    headers,
  });
}

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pvd-1",
    volumeId: 42,
    volumeName: "vol-42",
    teamId: "team-1",
    stripeCustomerId: "cus_1",
    reason: "negative_balance",
    scheduledFor: new Date(Date.now() - 60 * 1000), // due 1 min ago
    ...overrides,
  };
}

describe("GET /api/cron/cleanup-expired-volumes", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockFindMany.mockResolvedValue([]);
    mockDelete.mockResolvedValue({});
    mockDeleteSharedVolume.mockResolvedValue(undefined);
    // Default: customer still owes money (positive balance).
    mockCustomersRetrieve.mockResolvedValue({ id: "cus_1", balance: 5000 });
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL;
    vi.clearAllMocks();
  });

  it("returns 401 on unauthorized request without querying", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("queries only rows whose grace window has lapsed", async () => {
    await GET(makeRequest(SECRET));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduledFor: { lte: expect.any(Date) } },
      }),
    );
  });

  it("handles zero due volumes cleanly", async () => {
    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      checked: 0,
      deleted: 0,
      kept: 0,
      errors: 0,
      results: [],
    });
    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
  });

  it("deletes the volume and drops the row when the customer still owes", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(42);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "pvd-1" } });
    expect(body.deleted).toBe(1);
    expect(body.results[0].status).toBe("deleted");
  });

  it("KEEPS the storage and drops the row when the customer has recovered", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockCustomersRetrieve.mockResolvedValue({ id: "cus_1", balance: 0 }); // no longer owes

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "pvd-1" } });
    expect(body.kept).toBe(1);
    expect(body.results[0].status).toBe("kept_recovered");
  });

  it("treats a credit balance (negative) as recovered", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockCustomersRetrieve.mockResolvedValue({ id: "cus_1", balance: -1500 }); // has credit

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(body.kept).toBe(1);
  });

  it("proceeds to delete when the Stripe customer no longer exists", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockCustomersRetrieve.mockResolvedValue({ id: "cus_1", deleted: true });

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(42);
    expect(body.deleted).toBe(1);
  });

  it("defers (does NOT delete) and reports an error when the balance check fails", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockCustomersRetrieve.mockRejectedValue(new Error("stripe down"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDeleteSharedVolume).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled(); // row kept for retry
    expect(body.errors).toBe(1);
    expect(body.results[0].status).toBe("error");
  });

  it("drops the row when HAI reports the volume already gone (404)", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockDeleteSharedVolume.mockRejectedValue(new Error("404 not found"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "pvd-1" } });
    expect(body.deleted).toBe(1);
  });

  it("keeps the row for retry on a non-404 HAI delete error", async () => {
    mockFindMany.mockResolvedValue([dueRow()]);
    mockDeleteSharedVolume.mockRejectedValue(new Error("503 service unavailable"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(mockDelete).not.toHaveBeenCalled();
    expect(body.errors).toBe(1);
    expect(body.results[0].status).toBe("error");
  });

  it("tallies a mixed batch: delete + keep + error", async () => {
    mockFindMany.mockResolvedValue([
      dueRow({ id: "pvd-del", volumeId: 1, stripeCustomerId: "cus_owes" }),
      dueRow({ id: "pvd-keep", volumeId: 2, stripeCustomerId: "cus_ok" }),
      dueRow({ id: "pvd-err", volumeId: 3, stripeCustomerId: "cus_err" }),
    ]);
    mockCustomersRetrieve.mockImplementation((id: string) => {
      if (id === "cus_ok") return Promise.resolve({ id, balance: 0 });
      if (id === "cus_err") return Promise.reject(new Error("stripe down"));
      return Promise.resolve({ id, balance: 5000 });
    });

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(body.checked).toBe(3);
    expect(body.deleted).toBe(1);
    expect(body.kept).toBe(1);
    expect(body.errors).toBe(1);
    expect(mockDeleteSharedVolume).toHaveBeenCalledWith(1);
    expect(mockDeleteSharedVolume).not.toHaveBeenCalledWith(2);
  });

  it("returns 500 when the DB query fails", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest(SECRET));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("db down");
  });
});
