import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import { requirePermission } from "@/lib/auth/audit";
import { getWalletTransactions, formatCentsForUser } from "@/lib/wallet";

/**
 * GET /api/billing/history
 *
 * Returns the complete Stripe balance transaction history for the operating
 * account, auto-paginating all pages regardless of count.
 *
 * Also returns pre-computed all-time aggregate totals so the dashboard can display
 * accurate "All-Time Spend" stats without the 100-transaction cap imposed by the
 * fast-path in /api/account/verify.
 *
 * Used by:
 *   - BillingTab.tsx  — lazy-loads all-time stats on mount
 *   - downloadTransactionsCSV — exports the complete transaction history
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;

    // billing.view, the same gate as /api/account/billing-stats: the sidebar
    // hide is cosmetic, so a member can otherwise call this route directly.
    const denial = requirePermission(auth, "billing.view", request);
    if (denial) return denial;

    // The wallet on screen belongs to the operating account, which is what
    // /api/account/verify reads for the same rows.
    const allRaw = await getWalletTransactions(auth.accountId);

    // Apply the same bookkeeping filter as /api/account/verify
    const userFacing = allRaw.filter((txn) => {
      const metaType = txn.metadata?.type;
      if (metaType === "invoice_balance_hold" || metaType === "invoice_balance_restore") return false;
      const desc = (txn.description || "").toLowerCase();
      if (desc.includes("temporary hold for invoice") || desc.includes("restore after invoice")) return false;
      return true;
    });

    // Compute all-time aggregates from the raw Stripe amounts:
    // positive amount = debit (customer spent), negative = credit (customer received)
    let totalSpentCents = 0;
    let totalCreditsCents = 0;
    for (const txn of userFacing) {
      if (txn.amount > 0) {
        totalSpentCents += txn.amount;
      } else {
        totalCreditsCents += Math.abs(txn.amount);
      }
    }

    const transactions = userFacing.map((txn) => ({
      id: txn.id,
      amount: Math.abs(txn.amount),
      amountFormatted: formatCentsForUser(Math.abs(txn.amount)),
      description: txn.description || "Transaction",
      created: txn.created,
      type: txn.amount < 0 ? ("credit" as const) : ("debit" as const),
    }));

    return NextResponse.json({
      transactions,
      allTimeStats: {
        totalSpent: totalSpentCents / 100,
        totalCredits: totalCreditsCents / 100,
        netSpend: (totalSpentCents - totalCreditsCents) / 100,
        transactionCount: transactions.length,
      },
    });
  } catch (error) {
    console.error("[BillingHistory] Error fetching full transaction history:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing history" },
      { status: 500 }
    );
  }
}
