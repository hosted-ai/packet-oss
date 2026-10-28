// PA-325 — createInvoiceForPayment mutates the shared source-of-truth Stripe
// balance (it zeroes it around invoice finalization, then restores it). These
// tests pin that neutralize→restore sequence, the per-customer lock that
// serializes concurrent invoice generations, and the hasInFlightBalanceHold
// helper the negative-balance enforcement uses to avoid acting on a balance
// that is still mutating. Prior to PA-325 this function had no direct coverage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/customer-cache", () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
}));

import {
  createInvoiceForPayment,
  hasInFlightBalanceHold,
  heldByInvoiceGeneration,
} from "@/lib/invoice";

type StripeMock = ReturnType<typeof makeStripe>;

/**
 * Build a fake Stripe client. `retrieve` returns a customer with the given
 * balance and metadata; `update` echoes the balance back with the merged
 * metadata (so acquireBalanceLock reads the right balance off the lock update).
 */
function makeStripe(opts: { balance: number; metadata?: Record<string, string> }) {
  let metadata = { ...(opts.metadata ?? {}) };
  return {
    balance: opts.balance,
    invoices: {
      create: vi.fn().mockResolvedValue({ id: "in_1" }),
      finalizeInvoice: vi.fn().mockResolvedValue({}),
      pay: vi.fn().mockResolvedValue({}),
    },
    invoiceItems: {
      create: vi.fn().mockResolvedValue({}),
    },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_1", balance: opts.balance, metadata })),
      update: vi.fn(async (_id: string, params: { metadata: Record<string, string> }) => {
        metadata = { ...params.metadata };
        return { id: "cus_1", balance: opts.balance, metadata };
      }),
      createBalanceTransaction: vi.fn().mockResolvedValue({}),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

 
const asStripe = (s: StripeMock) => s as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createInvoiceForPayment (PA-325)", () => {
  it("neutralizes and restores the balance around finalize, under the lock", async () => {
    // -4800 = $48 credit
    const stripe = makeStripe({ balance: -4800 });
    await createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "Wallet auto-refill", "pi_1");

    // Lock acquired (set) then released (cleared).
    const lockSet = stripe.customers.update.mock.calls.find(
      (c) => c[1].metadata.invoice_balance_lock && c[1].metadata.invoice_balance_lock !== "",
    );
    const lockCleared = stripe.customers.update.mock.calls.find(
      (c) => c[1].metadata.invoice_balance_lock === "",
    );
    expect(lockSet).toBeTruthy();
    expect(lockCleared).toBeTruthy();

    // Hold negates the -4800 credit (→ +4800) then restore re-applies -4800.
    const txns = stripe.customers.createBalanceTransaction.mock.calls;
    const hold = txns.find((c) => c[1].metadata.type === "invoice_balance_hold");
    const restore = txns.find((c) => c[1].metadata.type === "invoice_balance_restore");
    expect(hold?.[1].amount).toBe(4800);
    expect(restore?.[1].amount).toBe(-4800);

    // Invoice actually finalized + paid out of band.
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    expect(stripe.invoices.pay).toHaveBeenCalledWith("in_1", { paid_out_of_band: true });
  });

  it("does not touch the balance when it is already zero, but still locks/finalizes", async () => {
    const stripe = makeStripe({ balance: 0 });
    await createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "desc");

    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    // Lock still acquired + released.
    expect(stripe.customers.update.mock.calls.some((c) => c[1].metadata.invoice_balance_lock !== "")).toBe(true);
    expect(stripe.customers.update.mock.calls.some((c) => c[1].metadata.invoice_balance_lock === "")).toBe(true);
  });

  it("restores the balance and releases the lock even if finalize throws", async () => {
    const stripe = makeStripe({ balance: -4800 });
    stripe.invoices.finalizeInvoice.mockRejectedValueOnce(new Error("stripe boom"));

    // Must not throw — invoice creation is best-effort.
    await expect(
      createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "desc"),
    ).resolves.toBeUndefined();

    // The restore ran in the finally...
    const restore = stripe.customers.createBalanceTransaction.mock.calls.find(
      (c) => c[1].metadata.type === "invoice_balance_restore",
    );
    expect(restore?.[1].amount).toBe(-4800);
    // ...and the lock was released.
    expect(stripe.customers.update.mock.calls.some((c) => c[1].metadata.invoice_balance_lock === "")).toBe(true);
  });

  it("steals a stale lock (older than the stale window) without waiting", async () => {
    const staleTs = (Math.floor(Date.now() / 1000) - 120).toString(); // 2 min old
    const stripe = makeStripe({ balance: -4800, metadata: { invoice_balance_lock: staleTs } });

    await createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "desc");

    // Proceeded: neutralized + finalized despite the (stale) lock being present.
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    expect(
      stripe.customers.createBalanceTransaction.mock.calls.some((c) => c[1].metadata.type === "invoice_balance_hold"),
    ).toBe(true);
  });

  it("waits for a fresh lock then proceeds once it is stolen at the deadline", async () => {
    vi.useFakeTimers();
    // Lock is always fresh (never released by the 'other' process) → we wait the
    // full window, warn, and proceed anyway (best-effort, never block forever).
    const freshTs = Math.floor(Date.now() / 1000).toString();
    const stripe = makeStripe({ balance: -4800, metadata: { invoice_balance_lock: freshTs } });

    const promise = createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "desc");
    await vi.advanceTimersByTimeAsync(7000); // past the 6s max wait
    await promise;

    expect(console.warn).toHaveBeenCalled();
    // Still ultimately did the work.
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith("in_1");
    // Polled the lock more than once while waiting.
    expect(stripe.customers.retrieve.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("hasInFlightBalanceHold (PA-325)", () => {
  const nowSec = () => Math.floor(Date.now() / 1000);

  it("returns true when a recent hold has no matching restore", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [{ created: nowSec(), metadata: { type: "invoice_balance_hold" } }],
    });
    expect(await hasInFlightBalanceHold(asStripe(stripe), "cus_1")).toBe(true);
  });

  it("returns false when holds and restores are balanced", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [
        { created: nowSec(), metadata: { type: "invoice_balance_hold" } },
        { created: nowSec(), metadata: { type: "invoice_balance_restore" } },
      ],
    });
    expect(await hasInFlightBalanceHold(asStripe(stripe), "cus_1")).toBe(false);
  });

  it("ignores holds older than the window", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [{ created: nowSec() - 5000, metadata: { type: "invoice_balance_hold" } }],
    });
    expect(await hasInFlightBalanceHold(asStripe(stripe), "cus_1", 600)).toBe(false);
  });

  it("is conservative (returns true) if the transaction listing fails", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockRejectedValueOnce(new Error("stripe down"));
    expect(await hasInFlightBalanceHold(asStripe(stripe), "cus_1")).toBe(true);
  });
});

// The figure every wallet reader adds back, so a held credit is still spendable
// on a GPU rather than reported to the customer as an empty wallet.
describe("heldByInvoiceGeneration", () => {
  const hold = (invoiceId: string, amount: number) => ({
    id: `cbtxn_hold_${invoiceId}`,
    amount,
    metadata: { type: "invoice_balance_hold", invoice_id: invoiceId },
  });
  const restore = (invoiceId: string, amount: number) => ({
    id: `cbtxn_restore_${invoiceId}`,
    amount,
    metadata: { type: "invoice_balance_restore", invoice_id: invoiceId },
  });

  it("reports a $100 credit whose restore never ran", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [hold("in_leaked", 10000), { id: "cbtxn_topup", amount: -10000, metadata: {} }],
    });
    expect(await heldByInvoiceGeneration(asStripe(stripe), "cus_1")).toBe(10000);
  });

  it("reports nothing once the restore lands, whatever its age", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [restore("in_1", -10000), hold("in_1", 10000)],
    });
    expect(await heldByInvoiceGeneration(asStripe(stripe), "cus_1")).toBe(0);
  });

  it("pairs per invoice, so one settled invoice does not cancel another's hold", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockResolvedValueOnce({
      data: [hold("in_1", 10000), restore("in_1", -10000), hold("in_2", 2500)],
    });
    expect(await heldByInvoiceGeneration(asStripe(stripe), "cus_1")).toBe(2500);
  });

  it("returns 0 if the transaction listing fails", async () => {
    const stripe = makeStripe({ balance: 0 });
    stripe.customers.listBalanceTransactions.mockRejectedValueOnce(new Error("stripe down"));
    expect(await heldByInvoiceGeneration(asStripe(stripe), "cus_1")).toBe(0);
  });
});
