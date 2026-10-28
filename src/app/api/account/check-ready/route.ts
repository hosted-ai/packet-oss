import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createLoginLink } from "@/lib/customer-auth";
import { resolveCustomerTeamId } from "@/lib/auth/account-resolver";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "session_id is required" },
      { status: 400 }
    );
  }

  try {
    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || !session.customer_email) {
      return NextResponse.json({ ready: false });
    }

    const customerId = session.customer as string | null;
    if (!customerId) {
      return NextResponse.json({ ready: false });
    }

    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) {
      return NextResponse.json({ ready: false });
    }

    const { teamId, primaryCustomer } = await resolveCustomerTeamId(stripe, customer);
    if (!teamId) {
      return NextResponse.json({ ready: false });
    }

    // The token is minted for the account that owns the team, so the dashboard
    // shows the combined hourly + monthly view.
    const account = primaryCustomer ?? customer;
    const token = await createLoginLink({
      email: session.customer_email.toLowerCase(),
      customerId: account.id,
    });
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

    return NextResponse.json({
      ready: true,
      dashboardUrl,
      email: session.customer_email,
      name: account.name || null,
      amountCents: session.amount_total || 0,
      customerId: account.id,
    });
  } catch (error) {
    console.error("Check-ready error:", error);
    return NextResponse.json({ ready: false });
  }
}
