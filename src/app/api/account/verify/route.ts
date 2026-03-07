import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { resolveAllTeamsForEmail } from "@/lib/customer-resolver";
import { getWalletTransactions, formatCents, formatCentsForUser } from "@/lib/wallet";
import { createOneTimeLogin, ROLES } from "@/lib/hostedai";
import { getTwoFactorStatus } from "@/lib/two-factor";
import { logCustomerLogin } from "@/lib/admin-activity";
import { logAccountLogin, logTeamMemberJoined } from "@/lib/activity";
import { recordFirstLogin } from "@/lib/lifecycle";
import { getTeamMemberByEmail, acceptTeamInvite, isTeamMember } from "@/lib/team-members";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

    // Verify the token
    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const stripe = getStripe();

    // Resolve all teams and customers for this email — handles customers
    // with separate hourly + monthly Stripe accounts
    const resolved = await resolveAllTeamsForEmail(payload.email, payload.customerId);
    if (!resolved) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const customer = resolved.primaryCustomer;
    const billingType = customer.metadata?.billing_type;
    const teamId = customer.metadata?.hostedai_team_id;
    const monthlyCustomerIds = resolved.monthlyCustomerIds;
    console.log(`[Verify] Resolved ${payload.email}: primary=${customer.id}, teams=[${resolved.allTeamIds.join(",")}], monthly=[${monthlyCustomerIds.join(",")}]`);

    // Get wallet balance for hourly customers
    let wallet = null;
    let transactions: Array<{
      id: string;
      amount: number;
      amountFormatted: string;
      description: string;
      created: number;
      type: "credit" | "debit";
    }> = [];

    // ── Parallel fetch: wallet, transactions, subscriptions, payments, invoices ──
    // Use the already-retrieved customer for wallet balance (avoid duplicate Stripe call)
    const availableBalance = -(customer.balance || 0); // Flip sign: positive = credit

    const [walletTxns, subsFromPrimary, payments, invoices, ...monthlySubResults] = await Promise.all([
      getWalletTransactions(customer.id, 100),
      stripe.subscriptions.list({ customer: customer.id, status: "active", limit: 10 }),
      stripe.paymentIntents.list({ customer: customer.id, limit: 50 }),
      stripe.invoices.list({ customer: customer.id, limit: 50, status: "paid" }),
      ...monthlyCustomerIds.map((monthlyId) =>
        stripe.subscriptions.list({ customer: monthlyId, status: "active", limit: 10 }).catch((err) => {
          console.error(`Failed to fetch subscriptions from linked monthly customer ${monthlyId}:`, err);
          return { data: [] as Stripe.Subscription[] };
        })
      ),
    ]);

    // Build wallet info from already-retrieved customer
    {
      const displayBalance = Math.max(0, availableBalance);
      wallet = {
        balance: displayBalance,
        balanceFormatted: formatCentsForUser(availableBalance),
        currency: "usd",
      };

      const userFacingTxns = walletTxns.filter((txn) => {
        const metaType = txn.metadata?.type;
        if (metaType === "invoice_balance_hold" || metaType === "invoice_balance_restore") return false;
        const desc = (txn.description || "").toLowerCase();
        if (desc.includes("temporary hold for invoice") || desc.includes("restore after invoice")) return false;
        return true;
      });

      transactions = userFacingTxns.map((txn) => ({
        id: txn.id,
        amount: Math.abs(txn.amount),
        amountFormatted: formatCentsForUser(Math.abs(txn.amount)),
        description: txn.description || "Transaction",
        created: txn.created,
        type: txn.amount < 0 ? "credit" : "debit",
      }));
    }

    // Build subscriptions from parallel results
    let subscription = null;
    let subscriptions: Array<{
      id: string;
      status: string;
      currentPeriodStart: number;
      currentPeriodEnd: number;
      cancelAtPeriodEnd: boolean;
      productId: string | null;
      productName: string | null;
      poolIds: string[];
      pricePerMonthCents: number | null;
      stripePriceId: string | null;
    }> = [];

    {
      let allSubsData = [...subsFromPrimary.data];
      for (const monthlyResult of monthlySubResults) {
        allSubsData = [...allSubsData, ...monthlyResult.data];
      }

      // Deduplicate by subscription ID (shouldn't happen but safety)
      const subs = { data: [...new Map(allSubsData.map(s => [s.id, s])).values()] };

      if (subs.data.length > 0) {
        // Backward compat: keep the singular `subscription` field for the first one
        const firstSub = subs.data[0];
        const firstItem = firstSub.items?.data?.[0];
        subscription = {
          id: firstSub.id,
          status: firstSub.status,
          currentPeriodStart: firstItem?.current_period_start || 0,
          currentPeriodEnd: firstItem?.current_period_end || 0,
          cancelAtPeriodEnd: firstSub.cancel_at_period_end,
        };

        // Collect all price IDs from subscriptions to batch-lookup GpuProducts
        const priceIds = subs.data
          .map((s) => s.items?.data?.[0]?.price?.id)
          .filter((id): id is string => !!id);

        // Look up matching GpuProducts by stripePriceId (only monthly products)
        const matchingProducts = priceIds.length > 0
          ? await prisma.gpuProduct.findMany({
              where: {
                stripePriceId: { in: priceIds },
                billingType: "monthly",
                active: true,
              },
            })
          : [];

        const productByPriceId = new Map(
          matchingProducts.map((p) => [p.stripePriceId, p])
        );

        // Build enriched subscriptions array
        subscriptions = subs.data.map((sub) => {
          const item = sub.items?.data?.[0];
          const priceId = item?.price?.id || null;
          const product = priceId ? productByPriceId.get(priceId) : undefined;

          let poolIds: string[] = [];
          if (product?.poolIds) {
            try {
              poolIds = (JSON.parse(product.poolIds) as unknown[]).map(String);
            } catch {
              poolIds = [];
            }
          }

          return {
            id: sub.id,
            status: sub.status,
            currentPeriodStart: item?.current_period_start || 0,
            currentPeriodEnd: item?.current_period_end || 0,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            productId: product?.id || null,
            productName: product?.name || null,
            poolIds,
            pricePerMonthCents: product?.pricePerMonthCents ?? null,
            stripePriceId: priceId,
          };
        });
      }
    }

    // Build payments + invoices from parallel results above
    const invoicePdfMap = new Map<string, string>();
    for (const inv of invoices.data) {
      if (inv.metadata?.type === "wallet_payment" && inv.metadata?.payment_intent_id && inv.invoice_pdf) {
        invoicePdfMap.set(inv.metadata.payment_intent_id, inv.invoice_pdf);
      }
    }

    const recentPayments = payments.data
      .filter((p) => p.status === "succeeded")
      .map((p) => ({
        id: p.id,
        amount: p.amount,
        amountFormatted: formatCents(p.amount),
        created: p.created,
        description: p.description || "Payment",
        invoicePdf: invoicePdfMap.get(p.id) || null,
      }));

    // ── Parallel fetch: OTL + billing portal + 2FA ──
    const [otlResult, portalSession, twoFactorStatus] = await Promise.all([
      teamId
        ? createOneTimeLogin({
            email: payload.email,
            send_email_invite: false,
            teamId: teamId,
            roleId: ROLES.teamAdmin,
          }).catch((error) => {
            console.error("Failed to generate OTL:", error);
            return null;
          })
        : Promise.resolve(null),
      stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`,
      }),
      getTwoFactorStatus(payload.email),
    ]);

    const gpuDashboardUrl = otlResult?.url || null;

    // Check if logged-in user is the owner (their email matches Stripe customer email)
    // Team members have a different email than the Stripe customer
    const isOwner = payload.email.toLowerCase() === customer.email?.toLowerCase();

    // If this is a team member, verify they still belong to the team
    // When a team member is removed, their JWT may still be valid (up to 1 hour),
    // so we must check the DB to enforce removal immediately.
    if (!isOwner) {
      const stillMember = await isTeamMember(payload.email, customer.id);
      if (!stillMember) {
        return NextResponse.json(
          { error: "Your access to this team has been revoked" },
          { status: 403 }
        );
      }

      // Mark their invite as accepted on first login
      try {
        const teamMember = await getTeamMemberByEmail(payload.email);
        if (teamMember && !teamMember.acceptedAt && teamMember.stripeCustomerId === customer.id) {
          await acceptTeamInvite(teamMember.id);
          console.log(`[Team] Marked invite as accepted for ${payload.email}`);
          logTeamMemberJoined(customer.id, payload.email).catch(() => {});
        }
      } catch (error) {
        console.error("Failed to accept team invite:", error);
      }
    }

    // Check if this is an admin bypass token (skipTwoFactor flag in JWT)
    const skipTwoFactor = payload.skipTwoFactor === true;

    // Log customer login to admin activity
    logCustomerLogin(payload.email, customer.id, !isOwner).catch(() => {});

    // Log to customer activity
    logAccountLogin(customer.id, payload.email, !isOwner).catch(() => {});

    // Track lifecycle milestone (first login)
    recordFirstLogin(customer.id).catch(() => {});

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        billingType,
        teamId,
        created: customer.created,
      },
      wallet,
      transactions,
      subscription,
      subscriptions,
      recentPayments,
      gpuDashboardUrl,
      billingPortalUrl: portalSession.url,
      isOwner,
      userEmail: payload.email, // The logged-in user's email (may differ from customer email for team members)
      twoFactor: twoFactorStatus, // 2FA status for the user
      skipTwoFactor, // Admin bypass flag
    });
  } catch (error) {
    console.error("Account verify error:", error);
    return NextResponse.json(
      { error: "Failed to verify account" },
      { status: 500 }
    );
  }
}
