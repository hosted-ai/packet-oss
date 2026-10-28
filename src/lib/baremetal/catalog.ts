/**
 * Bare-metal catalog — the single pricing authority for term-prepay orders.
 *
 * Products live in the BareMetalProduct table and are managed by admins via
 * /api/admin/bare-metal-products (mirroring how GpuProduct works). Each
 * product maps 1:1 to a HAI service of type "baremetal_gpu" — provisioning
 * passes haiServiceId as service_id to POST /baremetal/instances, the same
 * way the HAI user panel provisions baremetal through a service.
 *
 * Pricing is PER TERM: termPricing is [{months, priceCents}] where priceCents
 * is the TOTAL server price for that term — finance quotes term totals (e.g.
 * "$70k for 3 months") that integer monthly cents can't represent exactly,
 * and Stripe reconciliation needs exact amounts.
 *
 * The order route reads price/spec from here only — never from the request
 * body (the PO prototype took the price from the client; that hole is closed
 * by this layer).
 */

import { prisma } from "@/lib/prisma";
import type { BareMetalProduct } from "@prisma/client";

// Flat invoice processing fee, shown as its own line item on the invoice.
// Approximates Stripe Invoicing (0.4% capped) + wire/ACH-credit receipt costs.
export const STRIPE_INVOICE_FEE_CENTS = 700;

export type BareMetalPaymentMode = "stripe_invoice" | "manual_bank";

export interface TermPrice {
  months: number;
  priceCents: number; // TOTAL server price for the term (excl. setup + fees)
  // Optional per-term Stripe invoice processing fee (cents). When unset, the
  // term falls back to the flat STRIPE_INVOICE_FEE_CENTS at totals time. 0 = free.
  feeCents?: number;
}

export interface BareMetalCatalogItem {
  id: string;
  label: string;
  paymentMode: BareMetalPaymentMode;
  gpuType: string; // display, e.g. "NVIDIA B200 192GB"
  haiGpuType: string; // HAI short form, e.g. "B200"
  gpuCount: number;
  serverCount: number; // how many servers this product provisions (HAI quantity)
  cpuCores: number;
  ramGb: number;
  storageGb: number;
  storageType: string;
  operatingSystem: string;
  termPricing: TermPrice[];
  setupFeeCents: number;
  displayOrder: number;
  // HAI provisioning mapping. No region — products are abstract; the
  // customer picks a region at order time. Instance type + image SHOULD be
  // locked in the service, but HAI bugs currently prevent that for
  // baremetal_gpu services — when set, these overrides are sent to the
  // provisioning API.
  haiServiceId: string; // 1:1 baremetal_gpu service
  haiInstanceTypeId: number | null;
  haiImageId: number | null;
}

// Parse the JSON-encoded term pricing defensively — a malformed value must
// never take the order form down. There is no sane default PRICE, so a bad
// value yields [] (the product shows no orderable terms until fixed).
export function parseTermPricing(raw: string): TermPrice[] {
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (t) =>
          t &&
          typeof t === "object" &&
          Number.isInteger(t.months) &&
          t.months >= 1 &&
          t.months <= 36 &&
          Number.isInteger(t.priceCents) &&
          t.priceCents > 0
      )
    ) {
      return (parsed as TermPrice[])
        .map((t) => ({
          months: t.months,
          priceCents: t.priceCents,
          // Carry an optional per-term fee only when it's a valid non-negative
          // integer (0 allowed = fee-free term); else it falls back at totals time.
          ...(typeof t.feeCents === "number" && Number.isInteger(t.feeCents) && t.feeCents >= 0
            ? { feeCents: t.feeCents }
            : {}),
        }))
        .sort((a, b) => a.months - b.months);
    }
  } catch {
    // fall through
  }
  return [];
}

export function productToCatalogItem(row: BareMetalProduct): BareMetalCatalogItem {
  return {
    id: row.id,
    label: row.label,
    paymentMode: row.paymentMode === "manual_bank" ? "manual_bank" : "stripe_invoice",
    gpuType: row.gpuType,
    haiGpuType: row.haiGpuType,
    gpuCount: row.gpuCount,
    serverCount: row.serverCount,
    cpuCores: row.cpuCores,
    ramGb: row.ramGb,
    storageGb: row.storageGb,
    storageType: row.storageType,
    operatingSystem: row.operatingSystem,
    termPricing: parseTermPricing(row.termPricing),
    setupFeeCents: row.setupFeeCents,
    displayOrder: row.displayOrder,
    haiServiceId: row.haiServiceId,
    haiInstanceTypeId: row.haiInstanceTypeId,
    haiImageId: row.haiImageId,
  };
}

// Customer-facing catalog (order form). Products with no valid terms are
// filtered out — nothing would be orderable on them.
export async function getActiveCatalog(): Promise<BareMetalCatalogItem[]> {
  const rows = await prisma.bareMetalProduct.findMany({
    where: { active: true },
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  return rows.map(productToCatalogItem).filter((item) => item.termPricing.length > 0);
}

export async function getCatalogItem(id: string): Promise<BareMetalCatalogItem | null> {
  const row = await prisma.bareMetalProduct.findFirst({
    where: { id, active: true },
  });
  return row ? productToCatalogItem(row) : null;
}

export function getTermPrice(
  item: Pick<BareMetalCatalogItem, "termPricing">,
  contractMonths: number
): TermPrice | null {
  return item.termPricing.find((t) => t.months === contractMonths) ?? null;
}

export interface OrderTotals {
  termPriceCents: number; // the chosen term's total server price
  serverCostCents: number; // term price + setup fee
  processingFeeCents: number;
  totalInvoiceCents: number; // EXACT amount the customer must wire
}

export function computeOrderTotals(
  item: Pick<BareMetalCatalogItem, "id" | "termPricing" | "setupFeeCents">,
  contractMonths: number,
  // Explicit override: manual_bank passes 0 (wires go straight to our account —
  // no Stripe fee). When undefined, the fee is the selected term's feeCents,
  // falling back to the flat STRIPE_INVOICE_FEE_CENTS.
  processingFeeCents?: number
): OrderTotals {
  const term = getTermPrice(item, contractMonths);
  if (!term) {
    throw new Error(
      `Invalid contract term ${contractMonths} for ${item.id} — allowed: ${item.termPricing
        .map((t) => t.months)
        .join(", ")}`
    );
  }
  const fee = processingFeeCents ?? term.feeCents ?? STRIPE_INVOICE_FEE_CENTS;
  const serverCostCents = term.priceCents + item.setupFeeCents;
  return {
    termPriceCents: term.priceCents,
    serverCostCents,
    processingFeeCents: fee,
    totalInvoiceCents: serverCostCents + fee,
  };
}
