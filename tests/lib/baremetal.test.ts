// Tests for the bare-metal term-prepay billing core (pick #1 — real Stripe
// invoice flow). Pinned contracts:
//
//   catalog.computeOrderTotals
//     * total = term price (TOTAL for the term) + setup + flat processing fee
//     * invalid term throws
//
//   invoice.createBareMetalWireInvoice (money-critical)
//     * invoice create params: send_invoice + customer_balance/us_bank_transfer,
//       lowercase usd, metadata kind=baremetal_term + order_id (webhook key)
//     * two line items (server cost + processing fee)
//     * credit-balance dance: non-zero balance is held then ALWAYS restored,
//       even when finalize throws (same metadata types as invoice.ts so the
//       billing-history filter hides the pair)
//     * amount_due mismatch → invoice voided + throws (never send a wrong
//       receivable — exact-amount wire reconciliation depends on it)
//     * sendInvoice failure is non-fatal
//
//   payment.handleBareMetalInvoicePaid (webhook)
//     * resolves order via metadata.order_id, falls back to stripeInvoiceId
//     * no order → no write; non-payable status → no write (replay-safe)
//     * underpaid → no write (manual review)
//     * happy path → compare-and-set transition to payment_received

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const { mockFindUnique, mockUpdateMany, mockProductFindFirst, mockProductFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockProductFindFirst: vi.fn(),
  mockProductFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bareMetalOrder: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
    bareMetalProduct: {
      findFirst: mockProductFindFirst,
      findMany: mockProductFindMany,
    },
  },
}));

import {
  computeOrderTotals,
  getCatalogItem,
  getTermPrice,
  parseTermPricing,
  STRIPE_INVOICE_FEE_CENTS,
} from "@/lib/baremetal/catalog";
import { createBareMetalWireInvoice } from "@/lib/baremetal/invoice";
import { handleBareMetalInvoicePaid } from "@/lib/baremetal/payment";

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

// A DB row as prisma would return it (termPricing is a JSON string of
// {months, priceCents} entries — priceCents is the TOTAL for the term)
const productRow = {
  id: "prod_b200",
  label: "NVIDIA B200 — dedicated server",
  active: true,
  haiServiceId: "svc_bm_1",
  gpuType: "NVIDIA B200 192GB",
  haiGpuType: "B200",
  gpuCount: 1,
  cpuCores: 64,
  ramGb: 256,
  storageGb: 1000,
  storageType: "NVMe SSD",
  operatingSystem: "Ubuntu 22.04",
  termPricing: '[{"months":1,"priceCents":499900},{"months":6,"priceCents":2799900}]',
  setupFeeCents: 0,
  haiInstanceTypeId: null,
  haiImageId: null,
  displayOrder: 0,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("catalog", () => {
  beforeEach(() => {
    mockProductFindFirst.mockReset();
  });

  it("getCatalogItem maps a DB row (terms parsed from JSON, only active rows)", async () => {
    mockProductFindFirst.mockResolvedValue(productRow);
    const item = await getCatalogItem("prod_b200");
    expect(mockProductFindFirst).toHaveBeenCalledWith({
      where: { id: "prod_b200", active: true },
    });
    expect(item).toMatchObject({
      id: "prod_b200",
      haiServiceId: "svc_bm_1",
      termPricing: [
        { months: 1, priceCents: 499_900 },
        { months: 6, priceCents: 2_799_900 },
      ],
    });
  });

  it("getCatalogItem returns null for unknown/inactive ids", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    expect(await getCatalogItem("nope")).toBeNull();
  });

  it("parseTermPricing yields [] on malformed input — there is no default PRICE", () => {
    expect(parseTermPricing("not json")).toEqual([]);
    expect(parseTermPricing('["a"]')).toEqual([]);
    expect(parseTermPricing('[{"months":1}]')).toEqual([]); // missing price
    expect(parseTermPricing('[{"months":0,"priceCents":100}]')).toEqual([]); // months < 1
    expect(parseTermPricing('[{"months":1,"priceCents":0}]')).toEqual([]); // free server? no.
    // valid entries come back sorted by months
    expect(
      parseTermPricing('[{"months":6,"priceCents":600},{"months":1,"priceCents":100}]')
    ).toEqual([
      { months: 1, priceCents: 100 },
      { months: 6, priceCents: 600 },
    ]);
  });

  it("computeOrderTotals: term TOTAL + setup + flat processing fee", () => {
    const item = {
      id: "prod_b200",
      setupFeeCents: 10_000,
      termPricing: [
        { months: 1, priceCents: 499_900 },
        // a discounted term total that integer monthly cents could NOT express
        { months: 3, priceCents: 1_000_000 },
      ],
    };
    const totals = computeOrderTotals(item, 3);
    expect(totals.termPriceCents).toBe(1_000_000);
    expect(totals.serverCostCents).toBe(1_000_000 + 10_000);
    expect(totals.processingFeeCents).toBe(STRIPE_INVOICE_FEE_CENTS);
    expect(totals.totalInvoiceCents).toBe(1_000_000 + 10_000 + STRIPE_INVOICE_FEE_CENTS);
  });

  it("computeOrderTotals rejects a term with no configured price", () => {
    const item = {
      id: "x",
      setupFeeCents: 0,
      termPricing: [{ months: 1, priceCents: 100 }],
    };
    expect(() => computeOrderTotals(item, 5)).toThrow(/Invalid contract term/);
    expect(getTermPrice(item, 5)).toBeNull();
    expect(getTermPrice(item, 1)).toEqual({ months: 1, priceCents: 100 });
  });
});

// ---------------------------------------------------------------------------
// invoice
// ---------------------------------------------------------------------------

interface MockStripe {
  invoices: {
    create: ReturnType<typeof vi.fn>;
    finalizeInvoice: ReturnType<typeof vi.fn>;
    voidInvoice: ReturnType<typeof vi.fn>;
    sendInvoice: ReturnType<typeof vi.fn>;
  };
  invoiceItems: { create: ReturnType<typeof vi.fn> };
  customers: {
    retrieve: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    createBalanceTransaction: ReturnType<typeof vi.fn>;
  };
}

// `update` is the balance lock's own storage — the invoice path takes the lock
// before it reads the balance, so the mock has to carry the metadata.
function makeMockStripe(opts: { balance?: number; amountDue: number }): MockStripe {
  let metadata: Record<string, string> = {};
  return {
    invoices: {
      create: vi.fn().mockResolvedValue({ id: "in_test_1" }),
      finalizeInvoice: vi.fn().mockResolvedValue({
        id: "in_test_1",
        amount_due: opts.amountDue,
        number: "STRIPE-0001",
        hosted_invoice_url: "https://invoice.stripe.com/i/test",
      }),
      voidInvoice: vi.fn().mockResolvedValue({}),
      sendInvoice: vi.fn().mockResolvedValue({}),
    },
    invoiceItems: { create: vi.fn().mockResolvedValue({}) },
    customers: {
      retrieve: vi.fn(async () => ({ id: "cus_1", balance: opts.balance ?? 0, metadata })),
      update: vi.fn(async (_id: string, params: { metadata: Record<string, string> }) => {
        metadata = { ...params.metadata };
        return { id: "cus_1", balance: opts.balance ?? 0, metadata };
      }),
      createBalanceTransaction: vi.fn().mockResolvedValue({}),
    },
  };
}

const invoiceParams = {
  customerId: "cus_1",
  orderId: "order_1",
  invoiceNumber: "INV-BM-2026-ABC123",
  teamId: "team_1",
  contractMonths: 6,
  serverDescription: "B200 bare metal — 6 month term",
  serverCostCents: 2_999_400,
  processingFeeCents: 700,
};
const EXPECTED_TOTAL = 2_999_400 + 700;

describe("createBareMetalWireInvoice", () => {
  it("creates a send_invoice payable by customer_balance/us_bank_transfer with order metadata", async () => {
    const stripe = makeMockStripe({ amountDue: EXPECTED_TOTAL });
    const result = await createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams);

    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        collection_method: "send_invoice",
        currency: "usd",
        pending_invoice_items_behavior: "exclude",
        payment_settings: expect.objectContaining({
          payment_method_types: ["customer_balance"],
          payment_method_options: {
            customer_balance: {
              funding_type: "bank_transfer",
              bank_transfer: { type: "us_bank_transfer" },
            },
          },
        }),
        metadata: expect.objectContaining({
          kind: "baremetal_term",
          order_id: "order_1",
        }),
      })
    );

    // two line items: server cost + processing fee
    expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(2);
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ amount: 2_999_400, invoice: "in_test_1" })
    );
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: 700, description: "Invoice processing fee" })
    );

    expect(result).toEqual({
      stripeInvoiceId: "in_test_1",
      stripeInvoiceNumber: "STRIPE-0001",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
      amountDueCents: EXPECTED_TOTAL,
    });
  });

  it("zero balance → no balance transactions at all", async () => {
    const stripe = makeMockStripe({ balance: 0, amountDue: EXPECTED_TOTAL });
    await createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams);
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
  });

  it("non-zero credit balance is held before finalize and restored after", async () => {
    const stripe = makeMockStripe({ balance: -50_000, amountDue: EXPECTED_TOTAL });
    await createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams);

    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(2);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenNthCalledWith(
      1,
      "cus_1",
      expect.objectContaining({
        amount: 50_000, // negate the -50k credit to reach zero
        metadata: expect.objectContaining({ type: "invoice_balance_hold" }),
      })
    );
    expect(stripe.customers.createBalanceTransaction).toHaveBeenNthCalledWith(
      2,
      "cus_1",
      expect.objectContaining({
        amount: -50_000, // restore the original credit
        metadata: expect.objectContaining({ type: "invoice_balance_restore" }),
      })
    );
  });

  it("restores the balance even when finalize throws", async () => {
    const stripe = makeMockStripe({ balance: -50_000, amountDue: EXPECTED_TOTAL });
    stripe.invoices.finalizeInvoice.mockRejectedValue(new Error("stripe down"));

    await expect(
      createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams)
    ).rejects.toThrow("stripe down");

    // hold + restore both happened despite the failure
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledTimes(2);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenNthCalledWith(
      2,
      "cus_1",
      expect.objectContaining({ amount: -50_000 })
    );
  });

  it("voids and throws when finalized amount_due != expected total", async () => {
    const stripe = makeMockStripe({ amountDue: EXPECTED_TOTAL - 1 });
    await expect(
      createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams)
    ).rejects.toThrow(/amount_due/);
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_test_1");
  });

  it("sendInvoice failure is non-fatal", async () => {
    const stripe = makeMockStripe({ amountDue: EXPECTED_TOTAL });
    stripe.invoices.sendInvoice.mockRejectedValue(new Error("email down"));
    const result = await createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams);
    expect(result.stripeInvoiceId).toBe("in_test_1");
  });

  it("line-item creation failure voids the draft and rethrows", async () => {
    const stripe = makeMockStripe({ amountDue: EXPECTED_TOTAL });
    stripe.invoiceItems.create
      .mockResolvedValueOnce({}) // server cost line succeeds
      .mockRejectedValueOnce(new Error("stripe item error")); // fee line fails

    await expect(
      createBareMetalWireInvoice(stripe as unknown as Stripe, invoiceParams)
    ).rejects.toThrow("stripe item error");
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_test_1");
    expect(stripe.invoices.finalizeInvoice).not.toHaveBeenCalled();
  });

  it("rejects non-positive server cost before touching Stripe", async () => {
    const stripe = makeMockStripe({ amountDue: 0 });
    await expect(
      createBareMetalWireInvoice(stripe as unknown as Stripe, {
        ...invoiceParams,
        serverCostCents: 0,
      })
    ).rejects.toThrow(/must be positive integers/);
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// payment (webhook)
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_test_1",
    status: "paid",
    amount_paid: 3_000_100,
    metadata: { kind: "baremetal_term", order_id: "order_1" },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

const payableOrder = {
  id: "order_1",
  status: "wire_transfer_pending",
  totalInvoiceCents: 3_000_100,
  stripeInvoiceId: "in_test_1",
};

describe("handleBareMetalInvoicePaid", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdateMany.mockReset();
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("records stripeReportedPaidAt (no auto-advance) via compare-and-set", async () => {
    mockFindUnique.mockResolvedValue(payableOrder);

    await handleBareMetalInvoicePaid(makeInvoice());

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "order_1" } });
    // Option B gate: the webhook records the verified payment but does NOT flip
    // to payment_received or kick off provisioning — an admin confirms first.
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "order_1",
        status: { in: ["invoice_generated", "wire_transfer_pending"] },
        stripeReportedPaidAt: null,
      },
      data: expect.objectContaining({
        stripeReportedPaidAt: expect.any(Date),
        updatedBy: "stripe-webhook",
      }),
    });
    // It must NOT advance status or stamp paymentReceivedDate (that's the admin's job).
    const writtenData = mockUpdateMany.mock.calls[0][0].data;
    expect(writtenData.status).toBeUndefined();
    expect(writtenData.paymentReceivedDate).toBeUndefined();
  });

  it("falls back to stripeInvoiceId lookup when metadata.order_id is missing", async () => {
    mockFindUnique.mockResolvedValue(payableOrder);

    await handleBareMetalInvoicePaid(
      makeInvoice({ metadata: { kind: "baremetal_term" } as Stripe.Metadata })
    );

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { stripeInvoiceId: "in_test_1" } });
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it("no matching order → no write", async () => {
    mockFindUnique.mockResolvedValue(null);
    await handleBareMetalInvoicePaid(makeInvoice());
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("already payment_received → no write (webhook replay safe)", async () => {
    mockFindUnique.mockResolvedValue({ ...payableOrder, status: "payment_received" });
    await handleBareMetalInvoicePaid(makeInvoice());
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("underpaid invoice → no write (manual review)", async () => {
    mockFindUnique.mockResolvedValue(payableOrder);
    await handleBareMetalInvoicePaid(makeInvoice({ amount_paid: 100 } as Partial<Stripe.Invoice>));
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("OVERPAID invoice → no write (exact-match required, manual review)", async () => {
    mockFindUnique.mockResolvedValue(payableOrder);
    await handleBareMetalInvoicePaid(
      makeInvoice({ amount_paid: 9_999_999 } as Partial<Stripe.Invoice>)
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("invoice not yet status=paid → no write (amount_paid may be partial/undefined)", async () => {
    mockFindUnique.mockResolvedValue(payableOrder);
    await handleBareMetalInvoicePaid(makeInvoice({ status: "open" } as Partial<Stripe.Invoice>));
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("order linked to a DIFFERENT invoice id → no write (consistency guard)", async () => {
    mockFindUnique.mockResolvedValue({ ...payableOrder, stripeInvoiceId: "in_other" });
    await handleBareMetalInvoicePaid(makeInvoice());
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
