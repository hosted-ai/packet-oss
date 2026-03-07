import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/admin/marketing/backfill
 *
 * Creates CustomerLifecycle records for all existing Stripe customers
 * who don't already have one. Safe to run multiple times (idempotent).
 */
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken || !verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stripe = getStripe();
    let created = 0;
    let skipped = 0;
    let errors = 0;
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const customers = await stripe.customers.list({
        limit: 100,
        ...(startingAfter && { starting_after: startingAfter }),
      });

      for (const customer of customers.data) {
        if (!customer.email) {
          skipped++;
          continue;
        }

        // Check if lifecycle already exists
        const existing = await prisma.customerLifecycle.findUnique({
          where: { stripeCustomerId: customer.id },
        });

        if (existing) {
          skipped++;
          continue;
        }

        try {
          // Determine billing type from metadata
          const billingType = customer.metadata?.billing_type || "free";

          // Read UTM from Stripe metadata (if present from signup)
          const utmSource = customer.metadata?.utm_source || null;
          const utmMedium = customer.metadata?.utm_medium || null;
          const utmCampaign = customer.metadata?.utm_campaign || null;
          const utmContent = customer.metadata?.utm_content || null;
          const utmTerm = customer.metadata?.utm_term || null;
          const landingPage = customer.metadata?.landing_page || null;
          const referrer = customer.metadata?.referrer || null;

          // Calculate total deposits from balance transactions
          let totalDepositsCents = 0;
          let depositCount = 0;
          let firstDepositAt: Date | null = null;

          try {
            const transactions = await stripe.customers.listBalanceTransactions(
              customer.id,
              { limit: 100 }
            );

            for (const txn of transactions.data) {
              // Credits (negative amounts) are deposits
              if (txn.amount < 0) {
                const metaType = txn.metadata?.type;
                // Skip internal bookkeeping
                if (metaType === "invoice_balance_hold" || metaType === "invoice_balance_restore") continue;
                if (metaType === "deployment_refund") continue;
                const desc = (txn.description || "").toLowerCase();
                if (desc.includes("temporary hold") || desc.includes("restore after")) continue;

                totalDepositsCents += Math.abs(txn.amount);
                depositCount++;

                const txnDate = new Date(txn.created * 1000);
                if (!firstDepositAt || txnDate < firstDepositAt) {
                  firstDepositAt = txnDate;
                }
              }
            }
          } catch {
            // Non-fatal — skip balance check
          }

          // Check for subscriptions (indicates monthly billing milestone)
          let subscribedAt: Date | null = null;
          try {
            const subs = await stripe.subscriptions.list({
              customer: customer.id,
              limit: 1,
              status: "active",
            });
            if (subs.data.length > 0) {
              subscribedAt = new Date(subs.data[0].created * 1000);
            }
          } catch {
            // Non-fatal
          }

          await prisma.customerLifecycle.create({
            data: {
              stripeCustomerId: customer.id,
              email: customer.email,
              utmSource,
              utmMedium,
              utmCampaign,
              utmContent,
              utmTerm,
              landingPage,
              referrer,
              signedUpAt: new Date(customer.created * 1000),
              firstLoginAt: new Date(customer.created * 1000), // Assume they logged in
              firstDepositAt,
              subscribedAt,
              totalDepositsCents,
              depositCount,
              currentBillingType: billingType,
              lastActiveAt: new Date(customer.created * 1000),
            },
          });

          created++;
        } catch (e) {
          console.error(`Failed to backfill customer ${customer.id}:`, e);
          errors++;
        }
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) {
        startingAfter = customers.data[customers.data.length - 1].id;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("Backfill error:", error);
    return NextResponse.json(
      { error: "Backfill failed" },
      { status: 500 }
    );
  }
}
