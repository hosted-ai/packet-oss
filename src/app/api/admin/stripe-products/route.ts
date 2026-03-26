import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { verifySessionToken } from "@/lib/admin";

export async function GET(request: NextRequest) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stripe = await getStripe();

    // Fetch all active Stripe products
    const products = await stripe.products.list({
      active: true,
      limit: 100,
    });

    // For each product, fetch its recurring prices
    const productsWithPrices = await Promise.all(
      products.data.map(async (product) => {
        const prices = await stripe.prices.list({
          product: product.id,
          active: true,
          type: "recurring",
          limit: 10,
        });

        if (prices.data.length === 0) return null;

        return {
          id: product.id,
          name: product.name,
          description: product.description,
          prices: prices.data.map((price) => ({
            id: price.id,
            unitAmount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval || "month",
            intervalCount: price.recurring?.interval_count || 1,
          })),
        };
      })
    );

    const filtered = productsWithPrices.filter(Boolean);
    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    console.error("Failed to fetch Stripe products:", error);
    return NextResponse.json(
      { error: "Failed to fetch Stripe products" },
      { status: 500 }
    );
  }
}
