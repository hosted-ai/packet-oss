import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken, generateCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import { validateVoucher } from "@/lib/voucher";

const TOP_UP_AMOUNTS = [
  { value: 2500, label: "$25" },
  { value: 5000, label: "$50" },
  { value: 10000, label: "$100" },
  { value: 25000, label: "$250" },
  { value: 50000, label: "$500" },
];

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.substring(7);
  const payload = verifyCustomerToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const { amount, voucherCode, launchProductId } = await request.json();

    // Validate amount
    const amountCents = parseInt(amount);
    if (!TOP_UP_AMOUNTS.some((a) => a.value === amountCents)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const stripe = await getStripe();

    // Verify customer exists and is hourly billing
    const customer = await stripe.customers.retrieve(payload.customerId);
    if ("deleted" in customer && customer.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // NOTE: billing_type upgrade from free/free_trial to hourly now happens in the
    // Stripe webhook (handleWalletTopup) AFTER payment succeeds. This prevents
    // users from getting hourly billing status without actually paying.
    const bt = customer.metadata?.billing_type;
    if (bt !== "free" && bt !== "free_trial" && bt !== "hourly") {
      return NextResponse.json(
        { error: "Wallet top-up is only available for hourly billing customers" },
        { status: 400 }
      );
    }

    // Validate voucher code if provided
    let validatedVoucher: { code: string; creditCents: number } | null = null;
    if (voucherCode && voucherCode.trim()) {
      const voucherResult = await validateVoucher(
        voucherCode.trim(),
        payload.customerId,
        amountCents
      );

      if (!voucherResult.valid) {
        return NextResponse.json(
          { error: voucherResult.error },
          { status: 400 }
        );
      }

      validatedVoucher = {
        code: voucherResult.voucher!.code,
        creditCents: voucherResult.voucher!.creditCents,
      };
    }

    // Build description with voucher bonus if applicable
    let description = `Add $${(amountCents / 100).toFixed(0)} to your wallet balance`;
    if (validatedVoucher) {
      description += ` + $${(validatedVoucher.creditCents / 100).toFixed(0)} bonus`;
    }

    // Generate a fresh token for the return URL so the user stays authenticated
    // after Stripe redirects back (the dashboard requires ?token= in the URL).
    // Use 2-hour expiry to allow time for checkout completion.
    const returnToken = generateCustomerToken(payload.email, payload.customerId, 2);

    // Create checkout session for one-time payment
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer: payload.customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "GPU Wallet Top-Up",
              description,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          type: "wallet_topup",
          customer_id: payload.customerId,
          voucher_code: validatedVoucher?.code || "",
        },
      },
      metadata: {
        type: "wallet_topup",
        customer_id: payload.customerId,
        voucher_code: validatedVoucher?.code || "",
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${returnToken}&topup=success&amount=${amountCents}${validatedVoucher ? `&bonus=${validatedVoucher.creditCents}` : ""}${launchProductId ? `&launchProduct=${encodeURIComponent(launchProductId)}` : ""}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${returnToken}&topup=canceled`,
    });

    return NextResponse.json({
      url: session.url,
      voucherApplied: validatedVoucher
        ? {
            code: validatedVoucher.code,
            creditCents: validatedVoucher.creditCents,
          }
        : null,
    });
  } catch (error) {
    console.error("Wallet top-up error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ amounts: TOP_UP_AMOUNTS });
}
