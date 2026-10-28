import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: tests/lib/voucher.test.ts spies on the voucher module's OWN exports
// (vi.spyOn(module, "fn").mockResolvedValue(...)), so it exercises the mocks,
// not the real logic. This file drives the REAL functions in src/lib/voucher/
// index.ts against a mocked Prisma + Stripe boundary, pinning actual behavior:
// validation branches, the redemption transaction, cents math, and admin CRUD.

// ── Prisma + Stripe mocks ───────────────────────────────────────────────────
// vi.mock is hoisted above declarations, so the mock fns must live in a
// vi.hoisted() block to be initialized before the factory runs.
const {
  mockVoucher,
  mockVoucherRedemption,
  mockTx,
  mockTransaction,
  mockCreateBalanceTransaction,
  mockRetrieve,
  mockUpdate,
  mockGetStripe,
} = vi.hoisted(() => {
  const voucher = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  const voucherRedemption = {
    findMany: vi.fn(),
    create: vi.fn(),
  };
  const tx = { voucher, voucherRedemption };
  const transaction = vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
  const createBalanceTransaction = vi.fn();
  const retrieve = vi.fn();
  const update = vi.fn();
  const getStripe = vi.fn(async () => ({
    customers: { createBalanceTransaction, retrieve, update },
  }));
  return {
    mockVoucher: voucher,
    mockVoucherRedemption: voucherRedemption,
    mockTx: tx,
    mockTransaction: transaction,
    mockCreateBalanceTransaction: createBalanceTransaction,
    mockRetrieve: retrieve,
    mockUpdate: update,
    mockGetStripe: getStripe,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voucher: mockVoucher,
    voucherRedemption: mockVoucherRedemption,
    $transaction: (cb: (tx: typeof mockTx) => unknown) => mockTransaction(cb),
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

import {
  validateVoucherPublic,
  validateVoucher,
  processVoucherRedemption,
  createVoucher,
  updateVoucher,
  deleteVoucher,
  getAllVouchers,
  getVoucherWithRedemptions,
  getVoucherStats,
} from "@/lib/voucher";

// Minimal voucher row factory (Prisma shape).
function makeVoucher(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    code: "PROMO",
    name: "Promo",
    description: null,
    creditCents: 5000,
    minTopupCents: null,
    maxRedemptions: null,
    redemptionCount: 0,
    maxPerCustomer: 1,
    startsAt: null,
    expiresAt: null,
    active: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    createdBy: null,
    redemptions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Default-resolve the transaction by invoking the callback against mockTx.
  mockTransaction.mockImplementation(async (cb) => cb(mockTx));
});

describe("validateVoucherPublic", () => {
  it("normalizes the code to uppercase + trimmed before lookup", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher());
    await validateVoucherPublic("  promo  ");
    expect(mockVoucher.findUnique).toHaveBeenCalledWith({
      where: { code: "PROMO" },
    });
  });

  it("returns the voucher summary for a valid active voucher", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ creditCents: 10000, minTopupCents: 2000 })
    );
    const r = await validateVoucherPublic("PROMO");
    expect(r).toEqual({
      valid: true,
      voucher: {
        code: "PROMO",
        name: "Promo",
        creditCents: 10000,
        minTopupCents: 2000,
      },
    });
  });

  it("rejects an unknown code", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    expect(await validateVoucherPublic("NOPE")).toEqual({
      valid: false,
      error: "Invalid voucher code",
    });
  });

  it("rejects an inactive voucher", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher({ active: false }));
    const r = await validateVoucherPublic("PROMO");
    expect(r.valid).toBe(false);
    expect(r.error).toBe("This voucher is no longer active");
  });

  it("rejects a not-yet-started voucher", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ startsAt: new Date(Date.now() + 86_400_000) })
    );
    const r = await validateVoucherPublic("PROMO");
    expect(r.error).toBe("This voucher is not yet active");
  });

  it("rejects an expired voucher", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ expiresAt: new Date(Date.now() - 86_400_000) })
    );
    const r = await validateVoucherPublic("PROMO");
    expect(r.error).toBe("This voucher has expired");
  });

  it("rejects a voucher at its max redemptions", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ maxRedemptions: 5, redemptionCount: 5 })
    );
    const r = await validateVoucherPublic("PROMO");
    expect(r.error).toBe("This voucher has reached its maximum uses");
  });
});

describe("validateVoucher (customer-scoped)", () => {
  it("queries redemptions scoped to the stripe customer", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher());
    await validateVoucher("PROMO", "cus_123");
    expect(mockVoucher.findUnique).toHaveBeenCalledWith({
      where: { code: "PROMO" },
      include: { redemptions: { where: { stripeCustomerId: "cus_123" } } },
    });
  });

  it("rejects when the customer already redeemed up to maxPerCustomer", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ maxPerCustomer: 1, redemptions: [{ id: "r1" }] })
    );
    const r = await validateVoucher("PROMO", "cus_123");
    expect(r.error).toBe("You have already used this voucher");
  });

  it("rejects when topup is below the minimum and reports a whole-dollar amount", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ minTopupCents: 10000 })
    );
    const r = await validateVoucher("PROMO", "cus_123", 5000);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("Minimum top-up of $100 required for this voucher");
  });

  it("passes when topup meets the minimum", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ minTopupCents: 10000 })
    );
    const r = await validateVoucher("PROMO", "cus_123", 10000);
    expect(r.valid).toBe(true);
  });

  it("skips the minimum check when no topup amount is supplied", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ minTopupCents: 10000 })
    );
    const r = await validateVoucher("PROMO", "cus_123");
    expect(r.valid).toBe(true);
  });
});

describe("processVoucherRedemption", () => {
  it("records the redemption, increments count, and credits the stripe balance", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ id: "v9", creditCents: 7500 })
    );
    mockVoucherRedemption.create.mockResolvedValue({});
    mockVoucher.update.mockResolvedValue({});
    mockRetrieve.mockResolvedValue({ metadata: { billing_type: "hourly" } });

    const r = await processVoucherRedemption(
      "promo",
      "cus_123",
      "user@example.com",
      20000,
      "cs_test_1"
    );

    expect(r).toEqual({ success: true, creditCents: 7500 });
    expect(mockVoucherRedemption.create).toHaveBeenCalledWith({
      data: {
        voucherId: "v9",
        stripeCustomerId: "cus_123",
        customerEmail: "user@example.com",
        topupCents: 20000,
        creditCents: 7500,
        stripeSessionId: "cs_test_1",
      },
    });
    expect(mockVoucher.update).toHaveBeenCalledWith({
      where: { id: "v9" },
      data: { redemptionCount: { increment: 1 } },
    });
    // Credit is applied as a NEGATIVE balance transaction.
    expect(mockCreateBalanceTransaction).toHaveBeenCalledWith("cus_123", {
      amount: -7500,
      currency: "usd",
      description: "Voucher PROMO: credit applied",
    });
  });

  it("upgrades a free customer to hourly billing after crediting", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher());
    mockVoucherRedemption.create.mockResolvedValue({});
    mockVoucher.update.mockResolvedValue({});
    mockRetrieve.mockResolvedValue({
      metadata: { billing_type: "free", foo: "bar" },
    });

    await processVoucherRedemption("PROMO", "cus_123", "u@e.com", 20000);

    expect(mockUpdate).toHaveBeenCalledWith("cus_123", {
      metadata: { billing_type: "hourly", foo: "bar" },
    });
  });

  it("does NOT touch billing_type for a non-free customer", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher());
    mockVoucherRedemption.create.mockResolvedValue({});
    mockVoucher.update.mockResolvedValue({});
    mockRetrieve.mockResolvedValue({ metadata: { billing_type: "hourly" } });

    await processVoucherRedemption("PROMO", "cus_123", "u@e.com", 20000);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("fails (no throw) when the voucher is unknown — error surfaced from the transaction", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    const r = await processVoucherRedemption("NOPE", "cus_123", "u@e.com", 100);
    expect(r).toEqual({ success: false, error: "Invalid voucher code" });
    expect(mockCreateBalanceTransaction).not.toHaveBeenCalled();
  });

  it("fails when the per-customer limit is already hit", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ maxPerCustomer: 1, redemptions: [{ id: "r1" }] })
    );
    const r = await processVoucherRedemption("PROMO", "cus_123", "u@e.com", 100);
    expect(r.success).toBe(false);
    expect(r.error).toBe("You have already used this voucher");
  });

  it("fails when topup is below the minimum (whole-dollar message)", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ minTopupCents: 5000 })
    );
    const r = await processVoucherRedemption("PROMO", "cus_123", "u@e.com", 100);
    expect(r.success).toBe(false);
    expect(r.error).toBe("Minimum top-up of $50 required");
  });

  it("succeeds even when the post-credit billing_type upgrade throws (best-effort)", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher({ creditCents: 1000 }));
    mockVoucherRedemption.create.mockResolvedValue({});
    mockVoucher.update.mockResolvedValue({});
    mockRetrieve.mockRejectedValue(new Error("stripe down"));

    const r = await processVoucherRedemption("PROMO", "cus_123", "u@e.com", 5000);
    // Redemption + credit already happened; the upgrade failure is swallowed.
    expect(r).toEqual({ success: true, creditCents: 1000 });
    expect(mockCreateBalanceTransaction).toHaveBeenCalled();
  });
});

describe("createVoucher", () => {
  it("normalizes the code, defaults optional fields, and persists", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    mockVoucher.create.mockImplementation(async ({ data }: { data: unknown }) => data);

    const result = await createVoucher({
      code: "  newone  ",
      name: "New One",
      creditCents: 5000,
    });

    expect(mockVoucher.create).toHaveBeenCalledWith({
      data: {
        code: "NEWONE",
        name: "New One",
        description: null,
        creditCents: 5000,
        minTopupCents: null,
        maxRedemptions: null,
        maxPerCustomer: 1,
        startsAt: null,
        expiresAt: null,
        active: true,
        createdBy: null,
      },
    });
    expect((result as { code: string }).code).toBe("NEWONE");
  });

  it("converts startsAt/expiresAt strings to Date and honors active:false", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    mockVoucher.create.mockImplementation(async ({ data }: { data: unknown }) => data);

    await createVoucher({
      code: "DATED",
      name: "Dated",
      creditCents: 100,
      startsAt: "2026-01-01",
      expiresAt: "2026-12-31",
      active: false,
      maxPerCustomer: 3,
    });

    const arg = mockVoucher.create.mock.calls[0][0].data;
    expect(arg.startsAt).toBeInstanceOf(Date);
    expect(arg.expiresAt).toBeInstanceOf(Date);
    expect(arg.active).toBe(false);
    expect(arg.maxPerCustomer).toBe(3);
  });

  it("throws on a duplicate code (uppercased in the message)", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher({ code: "DUP" }));
    await expect(
      createVoucher({ code: "dup", name: "Dup", creditCents: 100 })
    ).rejects.toThrow('Voucher code "DUP" already exists');
    expect(mockVoucher.create).not.toHaveBeenCalled();
  });
});

describe("updateVoucher", () => {
  it("only includes provided fields in the update payload", async () => {
    mockVoucher.update.mockResolvedValue(makeVoucher({ active: false }));
    await updateVoucher("v1", { active: false });
    expect(mockVoucher.update).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: { active: false },
    });
  });

  it("converts date strings and allows clearing a date with null", async () => {
    mockVoucher.update.mockResolvedValue(makeVoucher());
    await updateVoucher("v1", { startsAt: "2026-06-01", expiresAt: null });
    const arg = mockVoucher.update.mock.calls[0][0].data;
    expect(arg.startsAt).toBeInstanceOf(Date);
    expect(arg.expiresAt).toBeNull();
  });
});

describe("deleteVoucher", () => {
  it("deletes a voucher with no redemptions", async () => {
    mockVoucher.findUnique.mockResolvedValue(makeVoucher({ redemptions: [] }));
    mockVoucher.delete.mockResolvedValue({});
    await deleteVoucher("v1");
    expect(mockVoucher.delete).toHaveBeenCalledWith({ where: { id: "v1" } });
  });

  it("throws 'Voucher not found' when missing", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    await expect(deleteVoucher("nope")).rejects.toThrow("Voucher not found");
  });

  it("refuses to delete a voucher that has redemptions", async () => {
    mockVoucher.findUnique.mockResolvedValue(
      makeVoucher({ redemptions: [{ id: "r1" }] })
    );
    await expect(deleteVoucher("v1")).rejects.toThrow(
      "Cannot delete voucher with redemptions. Deactivate it instead."
    );
    expect(mockVoucher.delete).not.toHaveBeenCalled();
  });
});

describe("getAllVouchers / getVoucherWithRedemptions", () => {
  it("lists vouchers newest-first", async () => {
    mockVoucher.findMany.mockResolvedValue([makeVoucher()]);
    await getAllVouchers();
    expect(mockVoucher.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when a voucher with redemptions is not found", async () => {
    mockVoucher.findUnique.mockResolvedValue(null);
    expect(await getVoucherWithRedemptions("nope")).toBeNull();
  });
});

describe("getVoucherStats", () => {
  it("aggregates totals, monthly figures, and per-voucher credited sums", async () => {
    mockVoucher.count
      .mockResolvedValueOnce(10) // totalVouchers
      .mockResolvedValueOnce(6); // activeVouchers
    mockVoucherRedemption.findMany
      .mockResolvedValueOnce([
        { creditCents: 1000 },
        { creditCents: 2000 },
        { creditCents: 500 },
      ]) // allRedemptions
      .mockResolvedValueOnce([{ creditCents: 2000 }]); // monthRedemptions
    mockVoucher.findMany.mockResolvedValueOnce([
      {
        code: "TOP",
        name: "Top",
        redemptionCount: 3,
        redemptions: [{ creditCents: 1000 }, { creditCents: 2000 }],
      },
    ]); // topVouchersRaw

    const stats = await getVoucherStats();

    expect(stats).toEqual({
      totalVouchers: 10,
      activeVouchers: 6,
      totalRedemptions: 3,
      totalCreditedCents: 3500,
      redemptionsThisMonth: 1,
      creditedThisMonthCents: 2000,
      topVouchers: [
        { code: "TOP", name: "Top", redemptionCount: 3, totalCredited: 3000 },
      ],
    });
  });

  it("handles an empty system (all zeroes, empty top list)", async () => {
    mockVoucher.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mockVoucherRedemption.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockVoucher.findMany.mockResolvedValueOnce([]);

    const stats = await getVoucherStats();
    expect(stats.totalCreditedCents).toBe(0);
    expect(stats.totalRedemptions).toBe(0);
    expect(stats.topVouchers).toEqual([]);
  });
});
