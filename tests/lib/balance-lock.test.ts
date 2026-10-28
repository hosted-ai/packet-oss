// The balance lock is what keeps a funded customer from reading as in arrears.
// Both invoice generators zero the Stripe balance while they finalize; if they
// overlap, each reads the same credit B and posts its own -B, so the live
// balance swings POSITIVE and the arrears hard-stop, STEP 3 enforcement and
// every wallet debit act on a customer who is actually in credit. These tests
// pin (a) that the two paths serialize against ONE lock rather than a private
// copy each, and (b) that a restore which fails pages ops instead of stranding
// the credit at zero behind a console line.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/customer-cache", () => ({
  cacheCustomer: vi.fn().mockResolvedValue(undefined),
}));

const mockOpsAlert = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ops-alert", () => ({
  opsAlert: (...a: unknown[]) => mockOpsAlert(...a),
}));

import { createInvoiceForPayment } from "@/lib/invoice";
import { createBareMetalWireInvoice } from "@/lib/baremetal/invoice";

const SERVER_COST = 2_999_400;
const FEE = 700;
const TOTAL = SERVER_COST + FEE;

const bareMetalParams = {
  customerId: "cus_1",
  orderId: "order_1",
  invoiceNumber: "INV-BM-2026-ABC123",
  teamId: "team_1",
  contractMonths: 6,
  serverDescription: "B200 bare metal — 6 month term",
  serverCostCents: SERVER_COST,
  processingFeeCents: FEE,
};

// One fake Stripe customer shared by both invoice paths: the balance really
// moves on a balance transaction and the metadata persists, so the lock is real.
function makeSharedStripe(startingBalance: number) {
  const state = {
    balance: startingBalance,
    metadata: {} as Record<string, string>,
    highestBalanceSeen: startingBalance,
    gate: null as null | (() => void),
  };
  let seq = 0;

  const stripe = {
    state,
    invoices: {
      create: vi.fn(async () => ({ id: `in_${++seq}` })),
      finalizeInvoice: vi.fn(async (id: string) => {
        if (state.gate) {
          await new Promise<void>((resolve) => {
            state.gate = resolve;
          });
        }
        return {
          id,
          amount_due: TOTAL,
          number: "STRIPE-0001",
          hosted_invoice_url: "https://invoice.stripe.com/i/test",
        };
      }),
      pay: vi.fn().mockResolvedValue({}),
      voidInvoice: vi.fn().mockResolvedValue({}),
      sendInvoice: vi.fn().mockResolvedValue({}),
    },
    invoiceItems: { create: vi.fn().mockResolvedValue({}) },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_1", balance: state.balance, metadata: { ...state.metadata } })),
      update: vi.fn(async (_id: string, params: { metadata: Record<string, string> }) => {
        state.metadata = { ...params.metadata };
        return { id: "cus_1", balance: state.balance, metadata: { ...state.metadata } };
      }),
      createBalanceTransaction: vi.fn(async (_id: string, params: { amount: number }) => {
        state.balance += params.amount;
        state.highestBalanceSeen = Math.max(state.highestBalanceSeen, state.balance);
        return {};
      }),
      listBalanceTransactions: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
  return stripe;
}

type SharedStripe = ReturnType<typeof makeSharedStripe>;
const asStripe = (s: SharedStripe) => s as unknown as Stripe;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the two invoice paths share one balance lock", () => {
  it("serializes a bare-metal invoice behind a wallet invoice instead of double-neutralizing", async () => {
    // $48 of credit. Unfenced, both paths read -4800 and post +4800, leaving
    // the live balance at +4800 — the customer appears to owe their own credit.
    const stripe = makeSharedStripe(-4800);
    // Hold the wallet invoice inside its neutralize→restore window.
    stripe.state.gate = () => {};

    const wallet = createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "Wallet auto-refill", "pi_1");
    await vi.waitFor(() => expect(stripe.state.balance).toBe(0));

    const bareMetal = createBareMetalWireInvoice(asStripe(stripe), bareMetalParams);
    // Long enough for the bare-metal path to retrieve, see the lock and poll.
    await new Promise((r) => setTimeout(r, 100));

    // The second path is blocked on the lock: no second hold has been posted.
    expect(stripe.state.balance).toBe(0);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(1);

    stripe.state.gate?.();
    stripe.state.gate = null;
    await wallet;
    await bareMetal;

    // Both invoices finalized, credit is back, and the balance never went
    // positive — nothing downstream ever saw this customer as in arrears.
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(2);
    expect(stripe.state.balance).toBe(-4800);
    expect(stripe.state.highestBalanceSeen).toBe(0);
  });

  it("leaves the lock clear once both invoices are done", async () => {
    const stripe = makeSharedStripe(-4800);
    await createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "Wallet auto-refill");
    await createBareMetalWireInvoice(asStripe(stripe), bareMetalParams);
    expect(stripe.state.metadata.invoice_balance_lock).toBe("");
  });
});

describe("a failed balance restore pages ops", () => {
  it("alerts when the bare-metal restore fails, naming the stranded amount", async () => {
    const stripe = makeSharedStripe(-4800);
    stripe.customers.createBalanceTransaction.mockImplementation(async (_id, params) => {
      if (params.amount < 0) throw new Error("stripe down");
      stripe.state.balance += params.amount;
      return {};
    });

    // The invoice itself still succeeds — a failed restore must not mask it.
    await expect(createBareMetalWireInvoice(asStripe(stripe), bareMetalParams)).resolves.toMatchObject({
      stripeInvoiceId: "in_1",
    });

    expect(mockOpsAlert).toHaveBeenCalledWith(
      "BareMetal",
      expect.stringContaining("Balance restore FAILED"),
      expect.arrayContaining([expect.stringContaining("-4800")]),
    );
    // The lock is still released, so the next invoice is not blocked behind it.
    expect(stripe.state.metadata.invoice_balance_lock).toBe("");
  });

  it("alerts when the wallet-invoice restore fails", async () => {
    const stripe = makeSharedStripe(-4800);
    stripe.customers.createBalanceTransaction.mockImplementation(async (_id, params) => {
      if (params.amount < 0) throw new Error("stripe down");
      stripe.state.balance += params.amount;
      return {};
    });

    await createInvoiceForPayment(asStripe(stripe), "cus_1", 5000, "Wallet auto-refill");

    expect(mockOpsAlert).toHaveBeenCalledWith(
      "Invoice",
      expect.stringContaining("Balance restore FAILED"),
      expect.arrayContaining([expect.stringContaining("-4800")]),
    );
  });
});
