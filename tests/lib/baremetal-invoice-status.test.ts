// PA-306: an unpaid order that was terminated wrongly showed PAID on the invoice
// page because the status allowlist included "terminated". deriveInvoiceStatus
// keys off paymentReceivedDate (the truthful signal) instead.

import { describe, it, expect } from "vitest";
import { deriveInvoiceStatus } from "@/lib/baremetal/invoice-status";

describe("deriveInvoiceStatus", () => {
  it("does NOT show PAID for a terminated order that was never paid (the bug)", () => {
    const s = deriveInvoiceStatus({ status: "terminated", paymentReceivedDate: null });
    expect(s.label).toBe("VOIDED");
    expect(s.isPaid).toBe(false);
  });

  it("voids a cancelled-without-payment order", () => {
    expect(deriveInvoiceStatus({ status: "cancelled", paymentReceivedDate: null }).label).toBe("VOIDED");
  });

  it("shows PAID when payment actually landed", () => {
    const now = new Date();
    for (const status of ["payment_received", "provisioning", "active"]) {
      const s = deriveInvoiceStatus({ status, paymentReceivedDate: now });
      expect(s.label).toBe("PAID");
      expect(s.isPaid).toBe(true);
    }
  });

  it("keeps PAID for an order paid first and terminated later (historical truth)", () => {
    const s = deriveInvoiceStatus({ status: "terminated", paymentReceivedDate: new Date() });
    expect(s.label).toBe("PAID");
    expect(s.isPaid).toBe(true);
  });

  it("shows REFUNDED for refund states (overrides PAID)", () => {
    expect(deriveInvoiceStatus({ status: "refunded", paymentReceivedDate: new Date() }).label).toBe("REFUNDED");
    expect(deriveInvoiceStatus({ status: "refund_pending", paymentReceivedDate: new Date() }).label).toBe("REFUNDED");
    expect(deriveInvoiceStatus({ status: "refunded", paymentReceivedDate: new Date() }).isPaid).toBe(false);
  });

  it("shows PAYMENT PENDING while a wire is awaited", () => {
    expect(deriveInvoiceStatus({ status: "wire_transfer_pending", paymentReceivedDate: null }).label).toBe(
      "PAYMENT PENDING",
    );
  });

  it("shows UNPAID for a fresh unpaid invoice", () => {
    expect(deriveInvoiceStatus({ status: "invoice_generated", paymentReceivedDate: null }).label).toBe("UNPAID");
  });
});
