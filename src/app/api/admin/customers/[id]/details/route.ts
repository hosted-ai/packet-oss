import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getTeam } from "@/lib/hostedai";
import { getActivityEvents } from "@/lib/activity";
import Stripe from "stripe";

// GET /api/admin/customers/[id]/details - Get comprehensive customer details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify admin session
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: customerId } = await params;

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["subscriptions", "sources"],
    }) as Stripe.Customer;

    if ("deleted" in customer && customer.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Get customer's balance transactions (wallet history)
    const balanceTransactions = await stripe.customers.listBalanceTransactions(
      customerId,
      { limit: 50 }
    );

    // Get customer's payment history
    const charges = await stripe.charges.list({
      customer: customerId,
      limit: 50,
    });

    // Get customer's invoices
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
    });

    // Get hosted.ai team info if available
    const teamId = customer.metadata?.hostedai_team_id;
    let hostedaiTeam = null;
    if (teamId) {
      try {
        hostedaiTeam = await getTeam(teamId);
      } catch (error) {
        console.error("Failed to get hosted.ai team:", error);
      }
    }

    // Get voucher redemptions for this customer
    const voucherRedemptions = await prisma.voucherRedemption.findMany({
      where: { stripeCustomerId: customerId },
      include: { voucher: true },
      orderBy: { createdAt: "desc" },
    });

    // Get referral info - check if they have a referral code (referrer)
    const referralCode = await prisma.referralCode.findFirst({
      where: { stripeCustomerId: customerId },
      include: { claims: true },
    });

    // Check if they were referred (referee)
    const referralClaim = await prisma.referralClaim.findFirst({
      where: { refereeCustomerId: customerId },
      include: { referralCode: true },
    });

    // Get activity events for the customer
    const activityEvents = await getActivityEvents(customerId, 200);

    // Get customer settings (bare metal flag)
    const customerSettings = await prisma.customerSettings.findUnique({
      where: { stripeCustomerId: customerId },
      select: { bareMetalEnabled: true },
    });

    // Calculate stats
    const totalSpent = charges.data
      .filter(c => c.paid && !c.refunded)
      .reduce((sum, c) => sum + c.amount, 0);

    const walletBalance = -(customer.balance || 0); // Stripe uses negative for credit

    return NextResponse.json({
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        created: customer.created,
        metadata: customer.metadata,
        billingType: customer.metadata?.billing_type || "unknown",
        walletBalance,
        totalSpent,
      },
      hostedaiTeam,
      balanceTransactions: balanceTransactions.data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description,
        created: t.created,
        endingBalance: t.ending_balance,
      })),
      charges: charges.data.map((c) => ({
        id: c.id,
        amount: c.amount,
        status: c.status,
        description: c.description,
        created: c.created,
        paid: c.paid,
        refunded: c.refunded,
        paymentMethod: c.payment_method_details?.type,
      })),
      invoices: invoices.data.map((i) => ({
        id: i.id,
        number: i.number,
        amount: i.amount_due,
        status: i.status,
        created: i.created,
        pdfUrl: i.invoice_pdf,
        hostedUrl: i.hosted_invoice_url,
      })),
      voucherRedemptions: voucherRedemptions.map((r) => ({
        id: r.id,
        voucherCode: r.voucher.code,
        voucherName: r.voucher.name,
        creditCents: r.creditCents,
        topupCents: r.topupCents,
        createdAt: r.createdAt,
      })),
      referral: referralCode ? {
        code: referralCode.code,
        role: "referrer",
        totalClaims: referralCode.claims.length,
        creditedClaims: referralCode.claims.filter(c => c.referrerCredited).length,
        createdAt: referralCode.createdAt,
      } : referralClaim ? {
        code: referralClaim.referralCode.code,
        role: "referred",
        status: referralClaim.status,
        credited: referralClaim.refereeCredited,
        createdAt: referralClaim.createdAt,
      } : null,
      activityEvents,
      bareMetalEnabled: customerSettings?.bareMetalEnabled ?? false,
    });
  } catch (error) {
    console.error("Failed to get customer details:", error);
    return NextResponse.json(
      { error: "Failed to get customer details" },
      { status: 500 }
    );
  }
}
