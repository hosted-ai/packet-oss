import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/ratelimit";
import { validateVoucherPublic } from "@/lib/voucher";
import { sendWelcomeEmail } from "@/lib/email";
import {
  createTeam,
  createOneTimeLogin,
  syncTeamsToDefaultPolicy,
  ensureDefaultPolicies,
  ensureRoles,
} from "@/lib/hostedai";
import { generateCustomerToken } from "@/lib/customer-auth";
import { isPro } from "@/lib/edition";
import { checkAndProcessReferralQualification } from "@/lib/referral";
import { cacheCustomer } from "@/lib/customer-cache";
import { getBrandName } from "@/lib/branding";
import crypto from "crypto";

// Generate a secure password for hosted.ai account
function generateSecurePassword(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function POST(request: NextRequest) {
  // Rate limit: 10 requests per minute per IP
  const ip = getClientIp(request);
  const rateLimitResult = rateLimit(`checkout:${ip}`, {
    maxRequests: 10,
    windowMs: 60000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { productId, email, checkOnly, voucherCode } = await request.json();

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Fetch product from database
    const product = await prisma.gpuProduct.findUnique({
      where: { id: productId },
    });

    if (!product || !product.active) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const stripe = await getStripe();

    // Check if customer already exists (search ALL customers with this email)
    const existingCustomers = await stripe.customers.list({
      email: email,
      limit: 10,
    });

    if (existingCustomers.data.length > 0) {
      // Find the primary (hourly/wallet) customer if one exists
      const primaryCustomer = existingCustomers.data.find(
        (c) => c.metadata?.billing_type === "hourly"
      ) || existingCustomers.data[0];

      // For monthly products: check ALL Stripe customers for this email to prevent duplicate subscriptions.
      // Monthly subs live on SEPARATE Stripe customers (to protect wallet), so we must check all of them.
      if (product.billingType === "monthly" && product.stripePriceId) {
        let alreadySubscribed = false;

        for (const cust of existingCustomers.data) {
          const subscriptions = await stripe.subscriptions.list({
            customer: cust.id,
            status: "active",
            limit: 10,
          });

          alreadySubscribed = subscriptions.data.some((sub) => {
            const priceId = sub.items?.data?.[0]?.price?.id;
            return priceId === product.stripePriceId;
          });

          if (alreadySubscribed) break;
        }

        if (alreadySubscribed) {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: primaryCustomer.id,
            return_url: `${process.env.NEXT_PUBLIC_APP_URL}`,
          });

          return NextResponse.json({
            url: portalSession.url,
            isPortal: true,
            message: "You already have an active subscription for this product. Redirecting to manage your plan."
          });
        }

        // Customer exists but doesn't have THIS product — allow checkout below
      } else {
        // Hourly product: check if customer already has wallet set up
        if (primaryCustomer.metadata?.billing_type === "hourly") {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: primaryCustomer.id,
            return_url: `${process.env.NEXT_PUBLIC_APP_URL}/wallet`,
          });

          return NextResponse.json({
            url: portalSession.url,
            isPortal: true,
            message: "You already have an account. Redirecting to manage your wallet."
          });
        }
      }
    }

    // If only checking for existing customer, return here
    if (checkOnly) {
      return NextResponse.json({ isNewCustomer: true });
    }

    // Initial deposit: flat $50
    const baseDeposit = 5000; // $50 in cents
    let depositAmount = baseDeposit;

    // Validate voucher and reduce deposit if applicable
    let validatedVoucher: { code: string; creditCents: number } | null = null;
    if (voucherCode) {
      const voucherResult = await validateVoucherPublic(voucherCode);

      if (voucherResult.valid && voucherResult.voucher) {
        validatedVoucher = {
          code: voucherResult.voucher.code,
          creditCents: voucherResult.voucher.creditCents
        };
        // Reduce deposit by voucher amount (but not below $1 minimum for Stripe)
        depositAmount = Math.max(100, depositAmount - voucherResult.voucher.creditCents);
      }
    }

    // If voucher covers entire deposit, skip Stripe and create account directly
    if (validatedVoucher && validatedVoucher.creditCents >= baseDeposit) {
      const customerEmail = email.toLowerCase();
      // Sanitize name: remove special chars (like + and .) that hosted.ai doesn't allow
      const rawName = email.split("@")[0];
      const customerName = rawName.replace(/[^a-zA-Z0-9- ]/g, "").trim() || "User";

      console.log(`=== VOUCHER SIGNUP: Full deposit covered for ${customerEmail} ===`);

      // Create Stripe customer first (needed for later payments)
      const stripeCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          billing_type: "hourly",
          gpu_product_id: product.id,
          source: getBrandName(),
          signup_type: "voucher",
        },
      });
      cacheCustomer(stripeCustomer).catch(() => {});
      console.log(`✅ Created Stripe customer: ${stripeCustomer.id}`);

      // Credit the customer's Stripe balance with the voucher amount
      await stripe.customers.createBalanceTransaction(stripeCustomer.id, {
        amount: -validatedVoucher.creditCents, // Negative = credit
        currency: "usd",
        description: `Voucher ${validatedVoucher.code} - Initial signup credit`,
      });

      // Record voucher redemption
      const voucher = await prisma.voucher.findUnique({
        where: { code: validatedVoucher.code },
      });
      if (voucher) {
        await prisma.$transaction([
          prisma.voucherRedemption.create({
            data: {
              voucherId: voucher.id,
              stripeCustomerId: stripeCustomer.id,
              customerEmail: customerEmail,
              topupCents: 0,
              creditCents: voucher.creditCents,
            },
          }),
          prisma.voucher.update({
            where: { id: voucher.id },
            data: { redemptionCount: { increment: 1 } },
          }),
        ]);
      }

      // Create hosted.ai team (same as Stripe webhook does for paid signups)
      const generatedPassword = generateSecurePassword();
      const teamName = `${customerName}-hourly-${Date.now()}`;

      console.log(`=== VOUCHER SIGNUP: Creating hosted.ai team for ${customerEmail} ===`);

      let team: { id: string; name: string };
      try {
        const [policies, roles] = await Promise.all([
          ensureDefaultPolicies(),
          ensureRoles(),
        ]);

        team = await createTeam({
          name: teamName,
          description: `${getBrandName()} - ${product.name} (hourly) - Voucher signup`,
          color: "#6366F1",
          members: [
            {
              email: customerEmail,
              name: customerName,
              role: roles.teamAdmin,
              send_email_invite: false,
              password: generatedPassword,
              pre_onboard: true,
            },
          ],
          pricing_policy_id: policies.pricing,
          resource_policy_id: policies.resource,
          service_policy_id: policies.service,
          instance_type_policy_id: policies.instanceType,
          image_policy_id: policies.image,
        });
        console.log(`✅ Created hosted.ai team ${team.id} for voucher signup`);

        // CRITICAL: Add team to resource policy's teams array
        // Without this, the team cannot access GPU pools
        try {
          await syncTeamsToDefaultPolicy([team.id]);
          console.log(`✅ Added team ${team.id} to default resource policy`);
        } catch (policyError) {
          console.error(`⚠️ WARNING: Failed to add team to resource policy:`, policyError);
        }
      } catch (teamError) {
        console.error("❌ FATAL: Failed to create hosted.ai team for voucher signup:", teamError);
        throw new Error(`Failed to create hosted.ai team: ${teamError instanceof Error ? teamError.message : String(teamError)}`);
      }

      // Create one-time login token
      try {
        const otlRoles = await ensureRoles();
        await createOneTimeLogin({
          email: customerEmail,
          send_email_invite: false,
          teamId: team.id,
          roleId: otlRoles.teamAdmin,
        });
        console.log(`✅ Created OTL for ${customerEmail}`);
      } catch (otlError) {
        console.error("❌ WARNING: Failed to create OTL (non-fatal):", otlError);
      }

      // Update Stripe customer with hosted.ai team ID
      const updatedVoucherCustomer = await stripe.customers.update(stripeCustomer.id, {
        metadata: {
          hostedai_team_id: team.id,
          gpu_product_id: product.id,
          billing_type: "hourly",
        },
      });
      cacheCustomer(updatedVoucherCustomer as import("stripe").default.Customer).catch(() => {});

      // Generate dashboard URL with token
      const token = generateCustomerToken(customerEmail, stripeCustomer.id);
      const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

      // Send welcome email
      try {
        await sendWelcomeEmail({
          to: customerEmail,
          customerName: customerName,
          productName: product.name,
          dashboardUrl,
          walletBalance: validatedVoucher ? `$${(validatedVoucher.creditCents / 100).toFixed(0)}` : undefined,
        });
        console.log(`✅ Sent welcome email to ${customerEmail} (voucher signup)`);
      } catch (emailError) {
        console.error("❌ WARNING: Failed to send welcome email (non-fatal):", emailError);
      }

      // Process referral qualification (voucher amount counts as deposit)
      try {
        const referralResult = await checkAndProcessReferralQualification(
          stripeCustomer.id,
          validatedVoucher.creditCents
        );
        if (referralResult.processed) {
          console.log(`✅ Referral reward processed for voucher signup ${stripeCustomer.id}`);
        }
      } catch (referralError) {
        console.error("❌ WARNING: Failed to process referral (non-fatal):", referralError);
      }

      // Sync to Pipedrive (async, don't block response — Pro only)
      if (isPro()) {
        import("@/lib/pipedrive").then(({ syncCustomerToPipedrive }) =>
          syncCustomerToPipedrive({
            name: customerName,
            email: customerEmail,
            productName: product.name,
            billingType: "hourly",
            stripeCustomerId: stripeCustomer.id,
          })
        ).catch((err) => console.error("[Pipedrive] Customer sync failed:", err));
      }

      console.log(`=== VOUCHER SIGNUP COMPLETE: ${customerEmail} -> Team ${team.id} ===`);

      // Redirect to success page — include token so user can auto-login
      return NextResponse.json({
        url: `${process.env.NEXT_PUBLIC_APP_URL}/success?type=voucher&email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
        voucherApplied: true,
      });
    }

    // Monthly subscription checkout
    if (product.billingType === "monthly" && product.stripePriceId) {
      // IMPORTANT: Always use customer_email (never attach to existing customer).
      // Existing customers may have wallet credit (negative Stripe balance) from hourly billing.
      // If we attach the subscription to that customer, Stripe automatically applies the credit
      // balance to the subscription invoice — effectively draining the wallet to pay the monthly fee.
      // Monthly subscriptions must be completely isolated from the hourly wallet system.
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [
          {
            price: product.stripePriceId,
            quantity: 1,
          },
        ],
        subscription_data: {
          metadata: {
            gpu_product_id: product.id,
            gpu_product_name: product.name,
            billing_type: "monthly",
          },
        },
        metadata: {
          gpu_product_id: product.id,
          gpu_product_name: product.name,
          billing_type: "monthly",
        },
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success?session_id={CHECKOUT_SESSION_ID}&type=monthly`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}?canceled=true`,
      });

      return NextResponse.json({ url: session.url });
    }

    // Create one-time payment checkout session (hourly products)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: depositAmount,
            product_data: {
              name: "GPU Wallet Deposit",
              description: validatedVoucher
                ? `Initial wallet funding for ${product.name} (includes $${(validatedVoucher.creditCents / 100).toFixed(0)} voucher discount)`
                : `Initial wallet funding for ${product.name} ($${(product.pricePerHourCents / 100).toFixed(2)}/hour)`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        setup_future_usage: "off_session", // Save card for auto-refill
        metadata: {
          type: "wallet_funding",
          gpu_product_id: product.id,
        },
      },
      metadata: {
        gpu_product_id: product.id,
        gpu_product_name: product.name,
        billing_type: "hourly",
        voucher_code: validatedVoucher?.code || "",
        voucher_credit_cents: validatedVoucher?.creditCents?.toString() || "0",
        original_deposit_cents: baseDeposit.toString(),
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/success?session_id={CHECKOUT_SESSION_ID}&type=hourly`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
