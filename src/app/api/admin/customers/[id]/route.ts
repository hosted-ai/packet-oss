import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";
import { createOneTimeLogin, createTeam, suspendTeam, unsuspendTeam, terminateTeam, syncTeamsToDefaultPolicy, ROLES, DEFAULT_POLICIES } from "@/lib/hostedai";
import { sendEmail } from "@/lib/email";
import {
  emailLayout, emailButton, emailGreeting, emailText, emailMuted,
  emailSignoff, escapeHtml, plainTextFooter,
} from "@/lib/email/utils";
import { generateAdminBypassToken, generateCustomerToken } from "@/lib/customer-auth";
import { logAdminActivity } from "@/lib/admin-activity";
import { cacheCustomer, markCustomerCacheDeleted } from "@/lib/customer-cache";
import { getBrandName, getDashboardUrl } from "@/lib/branding";
import { loadTemplate } from "@/lib/email/template-loader";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

async function sendCredentialsEmail(params: {
  to: string;
  customerName: string;
  dashboardUrl: string;
}) {
  const brandName = getBrandName();
  const dashboardBaseUrl = getDashboardUrl();

  const subject = `Your {{brandName}} login link`;
  const html = emailLayout({
    preheader: `Your login link for {{brandName}}`,
    body: `
      ${emailGreeting("{{customerName}}")}
      ${emailText(`Here is your login link for {{brandName}}:`)}
      ${emailButton("Open Dashboard", "{{dashboardUrl}}")}
      ${emailMuted(`This link expires in 1 hour. Request a new one at <a href="{{dashboardBaseUrl}}/account" style="color: #1a4fff;">{{dashboardBaseUrl}}/account</a>`)}
      ${emailMuted("Did not request this? You can safely ignore this email.")}
      ${emailSignoff()}
    `,
  });
  const text = `Hi {{customerName}},\n\nHere is your login link for {{brandName}}:\n\nOpen Dashboard: {{dashboardUrl}}\n\nThis link expires in 1 hour. Request a new one at {{dashboardBaseUrl}}/account\n\nDid not request this? You can ignore this email.\n${plainTextFooter()}`;

  const template = await loadTemplate(
    "customer-login",
    {
      customerName: escapeHtml(params.customerName),
      dashboardUrl: params.dashboardUrl,
      brandName,
      dashboardBaseUrl,
    },
    { subject, html, text }
  );

  await sendEmail({
    to: params.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

export async function POST(
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
  const { action, amount, description, reason, reasonNote } = await request.json();

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(customerId);

    if ("deleted" in customer && customer.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    cacheCustomer(customer as Stripe.Customer).catch(() => {});

    const teamId = customer.metadata?.hostedai_team_id;

    switch (action) {
      case "send-credentials": {
        if (!customer.email) {
          return NextResponse.json({ error: "Customer has no email" }, { status: 400 });
        }

        try {
          // Auto-provision team if missing (webhook may have been lost during deployment)
          let resolvedTeamId = teamId;
          if (!resolvedTeamId) {
            console.log(`[Admin] No team ID for ${customer.email}, auto-provisioning...`);
            const customerName = customer.name || customer.email.split("@")[0];
            const safeName = customerName.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30) || "user";
            const billingType = customer.metadata?.billing_type || "hourly";
            const team = await createTeam({
              name: `${safeName}-${billingType}-${Date.now()}`,
              description: `${getBrandName()} - Auto-provisioned by admin`,
              color: "#6366F1",
              members: [
                {
                  email: customer.email,
                  name: customerName,
                  role: ROLES.teamAdmin,
                  send_email_invite: false,
                  pre_onboard: true,
                },
              ],
              pricing_policy_id: DEFAULT_POLICIES.pricing,
              resource_policy_id: DEFAULT_POLICIES.resource,
              service_policy_id: DEFAULT_POLICIES.service,
              instance_type_policy_id: DEFAULT_POLICIES.instanceType,
              image_policy_id: DEFAULT_POLICIES.image,
            });
            resolvedTeamId = team.id;
            console.log(`[Admin] Created team ${team.id} for ${customer.email}`);

            // CRITICAL: Add team to resource policy's teams array
            // Without this, the team cannot access GPU pools
            try {
              await syncTeamsToDefaultPolicy([team.id]);
              console.log(`[Admin] Added team ${team.id} to default resource policy`);
            } catch (policyError) {
              console.error(`[Admin] WARNING: Failed to add team to resource policy:`, policyError);
            }

            // Store team ID in Stripe metadata so it doesn't need provisioning again
            const updatedWithTeam = await stripe.customers.update(customerId, {
              metadata: {
                ...customer.metadata,
                hostedai_team_id: team.id,
              },
            });
            cacheCustomer(updatedWithTeam as Stripe.Customer).catch(() => {});
            console.log(`[Admin] Updated Stripe metadata with team ID ${team.id}`);
          }

          const otl = await createOneTimeLogin({
            email: customer.email,
            send_email_invite: false,
            teamId: resolvedTeamId,
            roleId: ROLES.teamAdmin,
            userName: customer.name || customer.email.split("@")[0],
          });

          // Generate our JWT-based dashboard URL (NOT the hosted.ai OTL URL)
          const dashboardToken = generateCustomerToken(customer.email.toLowerCase(), customerId);
          const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${dashboardToken}`;

          await sendCredentialsEmail({
            to: customer.email,
            customerName: customer.name || customer.email.split("@")[0],
            dashboardUrl,
          });

          // Log credentials sent
          await logAdminActivity(
            session.email,
            "customer_viewed", // Reusing type since no specific "credentials_sent" type
            `Sent login credentials to ${customer.email}`,
            { customerId, customerEmail: customer.email }
          );

          return NextResponse.json({ success: true, message: "Credentials sent" });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to send credentials to ${customer.email}:`, errorMessage);

          if (errorMessage.includes("12330015") || errorMessage.includes("failed to process team")) {
            return NextResponse.json({
              error: `Team ${teamId} does not exist on hosted.ai. The customer may need a new team created.`,
            }, { status: 400 });
          }

          return NextResponse.json({
            error: `Failed to generate login link: ${errorMessage}`,
          }, { status: 500 });
        }
      }

      case "cancel": {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });

        if (subscriptions.data.length === 0) {
          return NextResponse.json({ error: "No active subscription" }, { status: 400 });
        }

        await stripe.subscriptions.cancel(subscriptions.data[0].id);

        if (teamId) {
          try {
            await suspendTeam(teamId);
          } catch (e) {
            console.error("Failed to suspend team:", e);
          }
        }

        // Log subscription cancellation
        await logAdminActivity(
          session.email,
          "customer_viewed", // Reusing type
          `Canceled subscription for ${customer.email || customerId}`,
          { customerId, customerEmail: customer.email, action: "cancel-subscription" }
        );

        return NextResponse.json({ success: true, message: "Subscription canceled" });
      }

      case "suspend": {
        if (!teamId) {
          return NextResponse.json({ error: "No team ID found" }, { status: 400 });
        }

        await suspendTeam(teamId);

        // Log team suspension
        await logAdminActivity(
          session.email,
          "customer_viewed", // Reusing type
          `Suspended team for ${customer.email || customerId}`,
          { customerId, customerEmail: customer.email, teamId, action: "suspend-team" }
        );

        return NextResponse.json({ success: true, message: "Team suspended" });
      }

      case "unsuspend": {
        if (!teamId) {
          return NextResponse.json({ error: "No team ID found" }, { status: 400 });
        }

        await unsuspendTeam(teamId);

        // Log team unsuspension
        await logAdminActivity(
          session.email,
          "customer_viewed", // Reusing type
          `Unsuspended team for ${customer.email || customerId}`,
          { customerId, customerEmail: customer.email, teamId, action: "unsuspend-team" }
        );

        return NextResponse.json({ success: true, message: "Team unsuspended" });
      }

      case "adjust-credits": {
        // Amount is in dollars (can be positive to add or negative to remove credits)
        const amountDollars = parseFloat(amount);
        if (isNaN(amountDollars)) {
          return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        if (!reason) {
          return NextResponse.json({ error: "Reason is required for wallet adjustments" }, { status: 400 });
        }

        const amountCents = Math.round(amountDollars * 100);
        const reasonLabel = reason === "other" ? (reasonNote || "Other") : reason.replace(/_/g, " ");
        const adjustDescription = `${amountDollars >= 0 ? "Credit" : "Debit"}: ${reasonLabel}${reasonNote && reason !== "other" ? ` - ${reasonNote}` : ""}`;

        // Create balance transaction
        // In Stripe: negative amount = credit to customer, positive = debit from customer
        // Since we want positive dollars to ADD credits: multiply by -1
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -amountCents, // Negative = credit to customer
          currency: "usd",
          description: adjustDescription,
          metadata: {
            adjusted_by: session.email,
            adjustment_type: "admin_manual",
            reason,
            reason_note: reasonNote || "",
          },
        });

        // Get updated balance
        const updatedCustomer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        cacheCustomer(updatedCustomer).catch(() => {});
        const newBalance = -(updatedCustomer.balance || 0); // Convert to credits view

        // Log wallet adjustment to admin activity
        const direction = amountDollars >= 0 ? "Added" : "Removed";
        await logAdminActivity(
          session.email,
          "wallet_adjustment",
          `${direction} $${Math.abs(amountDollars).toFixed(2)} ${amountDollars >= 0 ? "to" : "from"} ${customer.email || customerId} — ${reasonLabel}${reasonNote && reason !== "other" ? `: ${reasonNote}` : ""}`,
          {
            customerId,
            customerEmail: customer.email,
            amountCents,
            amountDollars,
            direction: amountDollars >= 0 ? "credit" : "debit",
            reason,
            reasonNote: reasonNote || null,
            previousBalance: newBalance - amountCents,
            newBalance,
          }
        );

        return NextResponse.json({
          success: true,
          message: `Credits adjusted by $${amountDollars.toFixed(2)}. New balance: $${(newBalance / 100).toFixed(2)}`,
          newBalance,
        });
      }

      case "set-balance": {
        // Set the wallet to an absolute amount (in dollars)
        const targetDollars = parseFloat(amount);
        if (isNaN(targetDollars) || targetDollars < 0) {
          return NextResponse.json({ error: "Invalid amount - must be a positive number" }, { status: 400 });
        }

        if (!reason) {
          return NextResponse.json({ error: "Reason is required for wallet adjustments" }, { status: 400 });
        }

        // Get current balance (Stripe: negative = credit to customer)
        const currentBalanceCents = -(customer.balance || 0); // Convert to positive credits
        const targetCents = Math.round(targetDollars * 100);
        const adjustmentCents = targetCents - currentBalanceCents;

        if (adjustmentCents === 0) {
          return NextResponse.json({
            success: true,
            message: `Balance already at $${targetDollars.toFixed(2)}`,
            newBalance: targetCents,
          });
        }

        const setReasonLabel = reason === "other" ? (reasonNote || "Other") : reason.replace(/_/g, " ");
        const setDescription = `Set balance to $${targetDollars.toFixed(2)} (was $${(currentBalanceCents / 100).toFixed(2)}): ${setReasonLabel}${reasonNote && reason !== "other" ? ` - ${reasonNote}` : ""}`;

        // Create balance transaction for the difference
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -adjustmentCents, // Negative = credit to customer
          currency: "usd",
          description: setDescription,
          metadata: {
            adjusted_by: session.email,
            adjustment_type: "admin_set_balance",
            previous_balance_cents: String(currentBalanceCents),
            target_balance_cents: String(targetCents),
            reason,
            reason_note: reasonNote || "",
          },
        });

        // Log the balance set action
        const setDirection = adjustmentCents >= 0 ? "Increased" : "Decreased";
        await logAdminActivity(
          session.email,
          "wallet_adjustment",
          `${setDirection} balance to $${targetDollars.toFixed(2)} for ${customer.email || customerId} (was $${(currentBalanceCents / 100).toFixed(2)}) — ${setReasonLabel}${reasonNote && reason !== "other" ? `: ${reasonNote}` : ""}`,
          {
            customerId,
            customerEmail: customer.email,
            previousBalance: currentBalanceCents,
            newBalance: targetCents,
            adjustmentCents,
            adjustmentDollars: adjustmentCents / 100,
            direction: adjustmentCents >= 0 ? "credit" : "debit",
            reason,
            reasonNote: reasonNote || null,
            method: "set_balance",
          }
        );

        return NextResponse.json({
          success: true,
          message: `Balance set to $${targetDollars.toFixed(2)} (was $${(currentBalanceCents / 100).toFixed(2)})`,
          newBalance: targetCents,
        });
      }

      case "login-as": {
        if (!customer.email) {
          return NextResponse.json({ error: "Customer has no email" }, { status: 400 });
        }

        // Generate a dashboard token for this customer that bypasses 2FA
        const token = generateAdminBypassToken(customer.email.toLowerCase(), customerId);
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?token=${token}`;

        console.log(`Admin ${session.email} generated login-as link for ${customer.email}`);

        // Log login-as action
        await logAdminActivity(
          session.email,
          "customer_viewed",
          `Generated "Login as" link for ${customer.email}`,
          { customerId, customerEmail: customer.email, action: "login-as" }
        );

        return NextResponse.json({
          success: true,
          url: dashboardUrl,
        });
      }

      case "toggle-bare-metal": {
        const existing = await prisma.customerSettings.findUnique({
          where: { stripeCustomerId: customerId },
        });
        const newValue = !(existing?.bareMetalEnabled ?? false);

        await prisma.customerSettings.upsert({
          where: { stripeCustomerId: customerId },
          update: { bareMetalEnabled: newValue },
          create: { stripeCustomerId: customerId, bareMetalEnabled: newValue },
        });

        await logAdminActivity(
          session.email,
          "customer_viewed",
          `${newValue ? "Enabled" : "Disabled"} bare metal access for ${customer.email || customerId}`,
          { customerId, customerEmail: customer.email, bareMetalEnabled: newValue }
        );

        return NextResponse.json({
          success: true,
          message: `Bare metal ${newValue ? "enabled" : "disabled"} for ${customer.email}`,
          bareMetalEnabled: newValue,
        });
      }

      case "hostedai-login": {
        if (!customer.email) {
          return NextResponse.json({ error: "Customer has no email" }, { status: 400 });
        }

        if (!teamId) {
          return NextResponse.json({ error: "Customer has no hosted.ai team" }, { status: 400 });
        }

        // Generate OTL for hosted.ai admin dashboard
        try {
          const otl = await createOneTimeLogin({
            email: customer.email,
            send_email_invite: false,
            teamId: teamId,
            roleId: ROLES.teamAdmin,
            userName: customer.name || customer.email.split("@")[0],
          });

          console.log(`Admin ${session.email} generated hosted.ai OTL for ${customer.email}`);

          // Log hosted.ai login
          await logAdminActivity(
            session.email,
            "customer_viewed",
            `Generated hosted.ai login link for ${customer.email}`,
            { customerId, customerEmail: customer.email, teamId, action: "hostedai-login" }
          );

          return NextResponse.json({
            success: true,
            url: otl.url,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to generate OTL for ${customer.email}:`, errorMessage);

          // Check for specific error codes from hosted.ai API
          if (errorMessage.includes("12330015") || errorMessage.includes("failed to process team")) {
            return NextResponse.json({
              error: `Team ${teamId} does not exist on hosted.ai. The customer may need a new team created.`,
            }, { status: 400 });
          }

          if (errorMessage.includes("12330009") || errorMessage.includes("user details are required")) {
            return NextResponse.json({
              error: "Failed to generate login link: user details required by hosted.ai API",
            }, { status: 400 });
          }

          return NextResponse.json({
            error: `Failed to generate hosted.ai login: ${errorMessage}`,
          }, { status: 500 });
        }
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Customer action error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}

// DELETE /api/admin/customers/[id] - Delete a customer
export async function DELETE(
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
    const customer = await stripe.customers.retrieve(customerId);

    if ("deleted" in customer && customer.deleted) {
      return NextResponse.json({ error: "Customer already deleted" }, { status: 404 });
    }

    cacheCustomer(customer as Stripe.Customer).catch(() => {});

    const customerEmail = customer.email || "unknown";
    const teamId = customer.metadata?.hostedai_team_id;

    // 1. Cancel any active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
    });

    for (const sub of subscriptions.data) {
      await stripe.subscriptions.cancel(sub.id);
      console.log(`Canceled subscription ${sub.id} for customer ${customerId}`);
    }

    // 2. Delete/terminate hosted.ai team if exists
    if (teamId) {
      try {
        await terminateTeam(teamId);
        console.log(`Terminated hosted.ai team ${teamId} for customer ${customerId}`);
      } catch (teamError) {
        console.error(`Failed to terminate team ${teamId}:`, teamError);
        // Continue with deletion even if team termination fails
      }
    }

    // 3. Delete the Stripe customer
    await stripe.customers.del(customerId);
    markCustomerCacheDeleted(customerId).catch(() => {});
    console.log(`Deleted Stripe customer ${customerId}`);

    // Log the deletion
    await logAdminActivity(
      session.email,
      "customer_viewed", // Reusing type
      `Deleted customer ${customerEmail} (${customerId})`,
      { customerId, customerEmail, teamId, action: "delete-customer" }
    );

    return NextResponse.json({
      success: true,
      message: `Customer ${customerEmail} deleted successfully`,
    });
  } catch (error) {
    console.error("Customer delete error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to delete customer: ${errorMessage}` },
      { status: 500 }
    );
  }
}
