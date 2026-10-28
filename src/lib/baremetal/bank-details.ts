/**
 * Packet's receiving bank account for MANUAL bare-metal wire payments
 * ("manual_bank" payment mode). Stored as a JSON blob in the SystemSetting
 * table (key BAREMETAL_BANK_DETAILS), editable by admins via
 * /api/admin/bare-metal-products/settings — never hardcoded (the PO prototype
 * hardcoded SVB details in the UI; this closes that).
 *
 * Shown to the customer on the order/invoice page when their order's
 * paymentMode is "manual_bank". The Stripe mode never uses this — Stripe
 * issues its own virtual account per customer.
 */

import { getSetting, setSetting } from "@/lib/settings";

export const BANK_DETAILS_SETTING_KEY = "BAREMETAL_BANK_DETAILS";

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string;
  swiftCode?: string;
  bankAddress?: string;
  /** Free-text instructions shown to the customer (e.g. "include the invoice number in the wire memo") */
  instructions?: string;
}

export async function getBankDetails(): Promise<BankDetails | null> {
  const raw = await getSetting(BANK_DETAILS_SETTING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BankDetails;
    if (!parsed.bankName || !parsed.accountName || !parsed.accountNumber || !parsed.routingNumber) {
      return null; // incomplete config = not configured
    }
    return parsed;
  } catch {
    console.error("[BareMetal] BAREMETAL_BANK_DETAILS is not valid JSON — treating as unconfigured");
    return null;
  }
}

export async function setBankDetails(details: BankDetails): Promise<void> {
  // encrypted=true: account numbers are sensitive at rest
  await setSetting(BANK_DETAILS_SETTING_KEY, JSON.stringify(details), true);
}

export async function isManualBankConfigured(): Promise<boolean> {
  return (await getBankDetails()) !== null;
}
