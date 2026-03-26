/**
 * POST /api/cron/process-drip — Drip Campaign Processor
 *
 * Runs periodically (every hour via cron) to:
 * 1. Find active enrollments where the next step is due
 * 2. Determine product vertical (GPU vs API) from enrollment metadata
 * 3. Send the right email for that step
 * 4. On the final step, apply $25 wallet credit (no card required)
 * 5. Advance the enrollment to the next step (or mark completed)
 *
 * Skips users who have already converted (billing_type != "free")
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { cacheCustomer } from "@/lib/customer-cache";
import { generateCustomerToken, generateUnsubscribeToken } from "@/lib/customer-auth";
import { resolvePrimaryCustomer } from "@/lib/customer-resolver";
import {
  sendDripGpu1,
  sendDripGpu2,
  sendDripGpu3,
  sendDripApi1,
  sendDripApi2,
  sendDripApi3,
  // Legacy exports for backwards compat
  sendDripDay1,
  sendDripDay3,
  sendDripDay7,
  sendDripDay14,
} from "@/lib/email/templates/drip";

const DRIP_CREDIT_CENTS = 2500; // $25.00

// Legacy template slug -> send function mapping (for existing DripStep records)
const LEGACY_SENDERS: Record<string, (params: { to: string; customerName: string; dashboardUrl: string }) => Promise<void>> = {
  "drip-day1-api": sendDripDay1,
  "drip-day3-explore": sendDripDay3,
  "drip-day7-deploy": sendDripDay7,
  "drip-day14-value": sendDripDay14,
};

/**
 * Apply $25 credit to a Stripe customer's wallet balance.
 * Works even without a payment method on file.
 */
async function applyDripCredit(stripeCustomerId: string, email: string): Promise<boolean> {
  try {
    const stripe = await getStripe();

    // Check if we've already given this customer drip credit (idempotency)
    const recentTxns = await stripe.customers.listBalanceTransactions(stripeCustomerId, { limit: 20 });
    const alreadyCredited = recentTxns.data.some(
      (txn) => txn.metadata?.type === "drip_credit"
    );
    if (alreadyCredited) {
      console.log(`[Drip] Skipping credit for ${email} — already received drip credit`);
      return true; // Already credited, still counts as success
    }

    // Add credit (negative amount = credit to customer)
    await stripe.customers.createBalanceTransaction(stripeCustomerId, {
      amount: -DRIP_CREDIT_CENTS,
      currency: "usd",
      description: "Drip campaign — $25 welcome credit",
      metadata: {
        type: "drip_credit",
        applied_at: new Date().toISOString(),
      },
    });

    console.log(`[Drip] Applied $25 credit to ${email} (${stripeCustomerId})`);
    return true;
  } catch (err) {
    console.error(`[Drip] Failed to apply credit to ${email}:`, err);
    return false;
  }
}

/**
 * Send the right email based on step index and product vertical.
 * Returns true if email was sent successfully.
 */
async function sendProductAwareEmail(
  stepIndex: number,
  totalSteps: number,
  templateSlug: string,
  email: string,
  customerName: string,
  dashboardUrl: string,
  gpu: string | null,
  stripeCustomerId: string,
  unsubscribeUrl: string,
): Promise<boolean> {
  const isLastStep = stepIndex + 1 >= totalSteps;
  const isFirstStep = stepIndex === 0;

  // Apply $25 credit on the first email (immediate value / reciprocity)
  let creditApplied = false;
  if (isFirstStep) {
    creditApplied = await applyDripCredit(stripeCustomerId, email);
  }

  try {
    if (gpu) {
      // GPU vertical
      switch (stepIndex) {
        case 0:
          await sendDripGpu1({ to: email, customerName, dashboardUrl, gpu, creditApplied, unsubscribeUrl });
          break;
        case 1:
          await sendDripGpu2({ to: email, customerName, dashboardUrl, gpu, unsubscribeUrl });
          break;
        case 2:
          await sendDripGpu3({ to: email, customerName, dashboardUrl, gpu, creditApplied: false, unsubscribeUrl });
          break;
        default: {
          // Fall back to legacy sender if template slug matches
          const legacy = LEGACY_SENDERS[templateSlug];
          if (legacy) {
            await legacy({ to: email, customerName, dashboardUrl });
          } else {
            console.error(`[Drip] No sender for GPU step ${stepIndex}, template: ${templateSlug}`);
            return false;
          }
        }
      }
    } else {
      // API vertical
      switch (stepIndex) {
        case 0:
          await sendDripApi1({ to: email, customerName, dashboardUrl, creditApplied, unsubscribeUrl });
          break;
        case 1:
          await sendDripApi2({ to: email, customerName, dashboardUrl, unsubscribeUrl });
          break;
        case 2:
          await sendDripApi3({ to: email, customerName, dashboardUrl, creditApplied: false, unsubscribeUrl });
          break;
        default: {
          const legacy = LEGACY_SENDERS[templateSlug];
          if (legacy) {
            await legacy({ to: email, customerName, dashboardUrl });
          } else {
            console.error(`[Drip] No sender for API step ${stepIndex}, template: ${templateSlug}`);
            return false;
          }
        }
      }
    }
    return true;
  } catch (err) {
    console.error(`[Drip] Error sending email to ${email} (step ${stepIndex}):`, err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  let completed = 0;
  let credited = 0;

  try {
    // Find all active enrollments
    const enrollments = await prisma.dripEnrollment.findMany({
      where: { status: "active" },
      include: {
        sequence: {
          include: {
            steps: {
              where: { active: true },
              orderBy: { stepOrder: "asc" },
            },
          },
        },
      },
    });

    console.log(`[Drip] Processing ${enrollments.length} active enrollments`);

    for (const enrollment of enrollments) {
      try {
        const { sequence } = enrollment;
        if (!sequence.active || sequence.steps.length === 0) {
          skipped++;
          continue;
        }

        // Find the next step to send
        const nextStepIndex = enrollment.currentStep; // 0-based: currentStep=0 means step[0] is next
        if (nextStepIndex >= sequence.steps.length) {
          // All steps completed
          await prisma.dripEnrollment.update({
            where: { id: enrollment.id },
            data: { status: "completed", completedAt: now },
          });
          completed++;
          continue;
        }

        const nextStep = sequence.steps[nextStepIndex];

        // Check if enough time has passed since enrollment/last send
        const referenceTime = enrollment.lastSentAt || enrollment.enrolledAt;
        const hoursSinceReference = (now.getTime() - referenceTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceReference < nextStep.delayHours) {
          // Not time yet
          skipped++;
          continue;
        }

        // Check if user has converted (upgraded from free) — skip if so
        try {
          const stripe = await getStripe();
          const customer = await stripe.customers.retrieve(enrollment.stripeCustomerId);
          if (!("deleted" in customer)) {
            cacheCustomer(customer).catch(() => {});
          }
          if (!("deleted" in customer) && customer.metadata?.billing_type && customer.metadata.billing_type !== "free" && customer.metadata.billing_type !== "free_trial") {
            // User has upgraded — cancel drip
            await prisma.dripEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "cancelled", cancelledAt: now },
            });
            console.log(`[Drip] Cancelled drip for ${enrollment.email} — user converted to ${customer.metadata.billing_type}`);
            skipped++;
            continue;
          }
        } catch {
          // Can't check Stripe — skip this round
          skipped++;
          continue;
        }

        // Parse enrollment metadata for product context
        let gpu: string | null = null;
        try {
          const meta = enrollment.metadata ? JSON.parse(enrollment.metadata) : {};
          gpu = meta.gpu || null;
        } catch {
          // Invalid metadata, default to API vertical
        }

        // Resolve to primary customer (enrollment may reference a monthly customer)
        const primaryForDrip = await resolvePrimaryCustomer(enrollment.email);
        const dripCustomerId = primaryForDrip?.id || enrollment.stripeCustomerId;

        // Generate a fresh dashboard URL
        const token = generateCustomerToken(enrollment.email, dripCustomerId);
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

        // Generate unsubscribe URL (90-day token)
        const unsubToken = generateUnsubscribeToken(enrollment.email);
        const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/drip/unsubscribe?token=${unsubToken}`;

        const emailSent = await sendProductAwareEmail(
          nextStepIndex,
          sequence.steps.length,
          nextStep.templateSlug,
          enrollment.email,
          enrollment.customerName || enrollment.email.split("@")[0],
          dashboardUrl,
          gpu,
          enrollment.stripeCustomerId,
          unsubscribeUrl,
        );

        if (!emailSent) {
          errors++;
          continue;
        }

        // Track credits
        const isLastStep = nextStepIndex + 1 >= sequence.steps.length;
        if (isLastStep) credited++;

        // Advance enrollment
        await prisma.dripEnrollment.update({
          where: { id: enrollment.id },
          data: {
            currentStep: nextStepIndex + 1,
            lastSentAt: now,
            ...(isLastStep ? { status: "completed", completedAt: now } : {}),
          },
        });

        console.log(`[Drip] Sent ${gpu ? `gpu-${nextStepIndex + 1}` : `api-${nextStepIndex + 1}`} to ${enrollment.email} (step ${nextStepIndex + 1}/${sequence.steps.length})`);
        sent++;

        if (isLastStep) {
          completed++;
        }
      } catch (err) {
        console.error(`[Drip] Error processing enrollment ${enrollment.id}:`, err);
        errors++;
      }
    }

    console.log(`[Drip] Done: sent=${sent}, skipped=${skipped}, completed=${completed}, credited=${credited}, errors=${errors}`);

    return NextResponse.json({
      success: true,
      processed: enrollments.length,
      sent,
      skipped,
      completed,
      credited,
      errors,
    });
  } catch (err) {
    console.error("[Drip] Fatal error:", err);
    return NextResponse.json(
      { error: "Failed to process drip campaigns" },
      { status: 500 }
    );
  }
}
