// Tests for fullSyncCustomerCache in src/lib/customer-cache.ts.
//
// The cache is load-bearing for billing (the sweep serves identity and
// balance_cents from it), so the contracts worth pinning are the ones that
// guard the destructive half: a short-but-successful Stripe listing must not
// flag the unseen customers deleted, and a listing that cannot terminate must
// fail before it reaches the delete rather than loop on an unmoved cursor.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCustomersList,
  mockUpsert,
  mockFindMany,
  mockUpdateMany,
  mockUpdate,
  mockOpsAlert,
} = vi.hoisted(() => ({
  mockCustomersList: vi.fn(),
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockOpsAlert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerCache: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({ customers: { list: mockCustomersList } }),
}));

vi.mock("@/lib/ops-alert", () => ({ opsAlert: mockOpsAlert }));

import { fullSyncCustomerCache, markCustomerCacheDeleted } from "@/lib/customer-cache";

function customer(id: string) {
  return { id, email: `${id}@example.test`, name: id, created: 1_700_000_000, balance: 0, metadata: {} };
}

function cached(ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("fullSyncCustomerCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue(undefined);
    mockUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("marks genuinely absent customers deleted when the listing is complete", async () => {
    const live = Array.from({ length: 19 }, (_, i) => `cus_${i}`);
    mockCustomersList.mockResolvedValueOnce({ data: live.map(customer), has_more: false });
    mockFindMany.mockResolvedValue(cached([...live, "cus_gone"]));
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await fullSyncCustomerCache();

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cus_gone"] } },
      data: { isDeleted: true, lastSyncedAt: expect.any(Date) },
    });
    expect(result).toEqual({ synced: 19, deleted: 1, refused: false });
    expect(mockOpsAlert).not.toHaveBeenCalled();
  });

  // A truncated-but-successful Stripe answer is the dangerous case: it reaches
  // the updateMany, where a thrown error would not have.
  it("refuses the delete sweep and alerts when the run saw too few customers", async () => {
    mockCustomersList.mockResolvedValueOnce({ data: [customer("cus_a")], has_more: false });
    mockFindMany.mockResolvedValue(cached(Array.from({ length: 100 }, (_, i) => `cus_${i}`)));

    const result = await fullSyncCustomerCache();

    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, deleted: 0, refused: true });
    expect(mockOpsAlert).toHaveBeenCalledTimes(1);
    expect(mockOpsAlert.mock.calls[0][0]).toBe("CustomerCacheSync");
    expect(mockOpsAlert.mock.calls[0][1]).toContain("1");
  });

  it("still sweeps when the shortfall is within the floor", async () => {
    mockCustomersList.mockResolvedValueOnce({
      data: Array.from({ length: 95 }, (_, i) => customer(`cus_${i}`)),
      has_more: false,
    });
    mockFindMany.mockResolvedValue(cached(Array.from({ length: 100 }, (_, i) => `cus_${i}`)));
    mockUpdateMany.mockResolvedValue({ count: 5 });

    const result = await fullSyncCustomerCache();

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(result.refused).toBe(false);
    expect(result.deleted).toBe(5);
  });

  // A cold cache has nothing to protect, so the floor must not block the run
  // that populates it.
  it("runs normally on an empty cache", async () => {
    mockCustomersList.mockResolvedValueOnce({ data: [customer("cus_a")], has_more: false });
    mockFindMany.mockResolvedValue([]);

    const result = await fullSyncCustomerCache();

    expect(result).toEqual({ synced: 1, deleted: 0, refused: false });
    expect(mockOpsAlert).not.toHaveBeenCalled();
  });

  it("throws rather than looping when has_more is true on an empty page", async () => {
    mockCustomersList
      .mockResolvedValueOnce({ data: [customer("cus_a")], has_more: true })
      .mockResolvedValueOnce({ data: [], has_more: true });
    mockFindMany.mockResolvedValue(cached(["cus_a", "cus_b"]));

    await expect(fullSyncCustomerCache()).rejects.toThrow(/empty customer page/);
    expect(mockCustomersList).toHaveBeenCalledTimes(2);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("paginates on the last id of each page", async () => {
    mockCustomersList
      .mockResolvedValueOnce({ data: [customer("cus_a"), customer("cus_b")], has_more: true })
      .mockResolvedValueOnce({ data: [customer("cus_c")], has_more: false });
    mockFindMany.mockResolvedValue(cached(["cus_a", "cus_b", "cus_c"]));

    const result = await fullSyncCustomerCache();

    expect(mockCustomersList.mock.calls[1][0]).toEqual({ limit: 100, starting_after: "cus_b" });
    expect(result.synced).toBe(3);
  });
});

// The cache serves identity and balance to the billing sweep, so a write that
// failed for a real reason must not read the same as an uncached customer.
describe("markCustomerCacheDeleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the cached row deleted", async () => {
    mockUpdate.mockResolvedValue({});

    await markCustomerCacheDeleted("cus_a");

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "cus_a" },
      data: { isDeleted: true, lastSyncedAt: expect.any(Date) },
    });
  });

  it("ignores a customer that was never cached", async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("record not found"), { code: "P2025" }));

    await expect(markCustomerCacheDeleted("cus_missing")).resolves.toBeUndefined();
  });

  it("rethrows a real write failure rather than swallowing it", async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("connection pool timeout"), { code: "P2024" }));

    await expect(markCustomerCacheDeleted("cus_a")).rejects.toThrow("connection pool timeout");
  });
});
