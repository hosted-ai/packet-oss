// A wallet top-up whose webhook credited the balance but lost the invoice leaves the
// customer with no billing record and nothing to retry it — this sweep issues it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(),
  invoicesList: vi.fn(),
  paymentIntentsList: vi.fn(),
  createInvoiceForPayment: vi.fn(),
  opsAlert: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ verifyCronAuth: m.verifyCronAuth }));
vi.mock("@/lib/invoice", () => ({ createInvoiceForPayment: m.createInvoiceForPayment }));
vi.mock("@/lib/ops-alert", () => ({ opsAlert: m.opsAlert }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    invoices: { list: m.invoicesList },
    paymentIntents: { list: m.paymentIntentsList },
  }),
}));

import { POST } from "@/app/api/cron/reconcile-wallet-invoices/route";

/** The SDK auto-paginates via async iteration; the route consumes it that way. */
const iterable = <T>(rows: T[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const r of rows) yield r;
  },
});

const topup = (id: string, created: number, amount = 10000, customer = "cus_1") => ({
  id,
  created,
  amount,
  customer,
  status: "succeeded",
  metadata: { type: "wallet_topup" },
});

const walletInvoice = (paymentIntentId: string) => ({
  id: `in_${paymentIntentId}`,
  metadata: { type: "wallet_payment", payment_intent_id: paymentIntentId },
});

const req = (qs = "") =>
  new NextRequest(`http://localhost/api/cron/reconcile-wallet-invoices${qs}`, {
    method: "POST",
  });

const DAY = 86400;
const recentEnough = Math.floor(Date.now() / 1000) - 3 * DAY;

beforeEach(() => {
  vi.clearAllMocks();
  m.verifyCronAuth.mockReturnValue(null);
  m.invoicesList.mockReturnValue(iterable([]));
  m.paymentIntentsList.mockReturnValue(iterable([]));
  m.createInvoiceForPayment.mockResolvedValue({ id: "in_new" });
});

describe("reconcile-wallet-invoices", () => {
  it("issues the invoice for a top-up that has none", async () => {
    m.paymentIntentsList.mockReturnValue(iterable([topup("pi_a", recentEnough)]));

    const body = await (await POST(req())).json();

    expect(body.issued).toBe(1);
    expect(m.createInvoiceForPayment).toHaveBeenCalledTimes(1);
    const [, customer, amount, description, intentId] =
      m.createInvoiceForPayment.mock.calls[0];
    expect(customer).toBe("cus_1");
    expect(amount).toBe(10000);
    expect(description).toContain("$100");
    expect(intentId).toBe("pi_a");
  });

  // The sweep runs every 30 minutes over an overlapping window, so a top-up already
  // invoiced must cost nothing — otherwise every run issues a duplicate record.
  it("skips a top-up that already carries a wallet_payment invoice", async () => {
    m.paymentIntentsList.mockReturnValue(iterable([topup("pi_a", recentEnough)]));
    m.invoicesList.mockReturnValue(iterable([walletInvoice("pi_a")]));

    const body = await (await POST(req())).json();

    expect(body.missing).toBe(0);
    expect(body.issued).toBe(0);
    expect(m.createInvoiceForPayment).not.toHaveBeenCalled();
  });

  it("ignores payments that are not wallet top-ups", async () => {
    m.paymentIntentsList.mockReturnValue(
      iterable([
        { ...topup("pi_sub", recentEnough), metadata: { type: "subscription" } },
        { ...topup("pi_none", recentEnough), metadata: {} },
      ]),
    );

    const body = await (await POST(req())).json();

    expect(body.missing).toBe(0);
    expect(m.createInvoiceForPayment).not.toHaveBeenCalled();
  });

  it("ignores a payment that did not succeed", async () => {
    m.paymentIntentsList.mockReturnValue(
      iterable([{ ...topup("pi_fail", recentEnough), status: "requires_payment_method" }]),
    );

    expect((await (await POST(req())).json()).missing).toBe(0);
  });

  // createInvoiceForPayment is written not to throw, so an undefined return is the
  // only signal it failed — reading it as success would re-hide the original bug.
  it("counts an undefined return as an error and alerts", async () => {
    m.paymentIntentsList.mockReturnValue(iterable([topup("pi_a", recentEnough)]));
    m.createInvoiceForPayment.mockResolvedValue(undefined);

    const body = await (await POST(req())).json();

    expect(body.issued).toBe(0);
    expect(body.errors).toBe(1);
    expect(m.opsAlert).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when there is nothing to issue", async () => {
    const body = await (await POST(req())).json();

    expect(body).toMatchObject({ success: true, missing: 0, issued: 0, errors: 0 });
    expect(m.opsAlert).not.toHaveBeenCalled();
  });

  it("writes nothing under dryRun, but still reports what it would issue", async () => {
    m.paymentIntentsList.mockReturnValue(iterable([topup("pi_a", recentEnough)]));

    const body = await (await POST(req("?dryRun=1"))).json();

    expect(body.dryRun).toBe(true);
    expect(body.results[0].outcome).toBe("would_issue");
    expect(m.createInvoiceForPayment).not.toHaveBeenCalled();
  });

  it("clamps an absurd backfill window instead of scanning all of Stripe", async () => {
    const body = await (await POST(req("?days=99999"))).json();
    expect(body.lookbackDays).toBe(400);
  });

  it("issues oldest first, so the longest-waiting customer is served", async () => {
    m.paymentIntentsList.mockReturnValue(
      iterable([
        topup("pi_new", recentEnough, 10000, "cus_new"),
        topup("pi_old", recentEnough - 2 * DAY, 25000, "cus_old"),
      ]),
    );

    const body = await (await POST(req())).json();

    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["pi_old", "pi_new"]);
  });

  it("refuses without cron auth", async () => {
    m.verifyCronAuth.mockReturnValue(
      new Response(null, { status: 401 }) as unknown as ReturnType<typeof m.verifyCronAuth>,
    );

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(m.paymentIntentsList).not.toHaveBeenCalled();
  });
});
