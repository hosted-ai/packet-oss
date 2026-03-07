import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { checkAndRefillWallet } from "@/lib/wallet";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed with timing-safe comparison)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    const stripe = getStripe();

    // Find all hourly billing customers with pagination
    const allCustomers: Array<{
      id: string;
      email: string | null;
      balance: number;
    }> = [];

    let page: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const searchResult = await stripe.customers.search({
        query: 'metadata["billing_type"]:"hourly"',
        limit: 100,
        page,
      });

      for (const customer of searchResult.data) {
        allCustomers.push({
          id: customer.id,
          email: customer.email,
          balance: -(customer.balance || 0),
        });
      }

      hasMore = searchResult.has_more;
      page = searchResult.next_page ?? undefined;
    }

    const results: Array<{
      customerId: string;
      email: string | null;
      balance: number;
      refilled: boolean;
      amount?: number;
      error?: string;
    }> = [];

    for (const customer of allCustomers) {
      const result = await checkAndRefillWallet(customer.id);

      results.push({
        customerId: customer.id,
        email: customer.email,
        balance: customer.balance,
        refilled: result.refilled,
        amount: result.amount,
        error: result.error,
      });
    }

    const refillCount = results.filter(r => r.refilled).length;

    console.log(`Wallet refill cron: checked ${results.length} customers, refilled ${refillCount}`);

    return NextResponse.json({
      checked: results.length,
      refilled: refillCount,
      results,
    });
  } catch (error) {
    console.error("Wallet refill cron error:", error);
    return NextResponse.json(
      { error: "Failed to process wallet refills" },
      { status: 500 }
    );
  }
}
