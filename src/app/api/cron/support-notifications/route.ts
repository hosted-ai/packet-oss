import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAllTickets,
  getTicketArticles,
  getUser,
  isTicketClosed,
} from "@/lib/zammad";
import { sendSupportReplyNotification, delay } from "@/lib/email";
import { getStripe } from "@/lib/stripe";
import { generateCustomerToken } from "@/lib/customer-auth";
import { resolvePrimaryCustomer } from "@/lib/customer-resolver";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getAppUrl } from "@/lib/branding";

// Sanitize text for email (remove problematic characters)
function sanitizeForEmail(text: string): string {
  return text
    .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
    .replace(/[<>]/g, "") // Remove HTML-like chars
    .trim();
}

const APP_URL = getAppUrl();

export async function GET(request: NextRequest) {
  // Verify cron secret (fail-closed with timing-safe comparison)
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  try {
    const stripe = getStripe();
    const results: Array<{
      ticketId: string;
      customerEmail: string;
      sent: boolean;
      error?: string;
    }> = [];

    // Get all tickets from Zammad (filtered to platform groups only)
    const tickets = await getAllTickets({ state: "all", page: 1, perPage: 100 });

    // Filter to only open tickets
    const openTicketsPromises = tickets.map(async (ticket) => {
      const closed = await isTicketClosed(ticket);
      return closed ? null : ticket;
    });
    const openTicketsWithNull = await Promise.all(openTicketsPromises);
    const openTickets = openTicketsWithNull.filter((t) => t !== null);

    for (const ticket of openTickets) {
      let currentEmail = "unknown";
      try {
        // Get all articles for this ticket
        const articles = await getTicketArticles(ticket.id);

        if (articles.length === 0) continue;

        // Get the last article
        const lastArticle = articles[articles.length - 1];

        // Skip if last article is from Customer or is internal
        if (lastArticle.sender === "Customer" || lastArticle.internal) {
          continue;
        }

        // Get the customer (ticket owner)
        const customer = await getUser(ticket.customer_id);
        currentEmail = customer.email || "unknown";

        if (!customer.email) {
          console.log(
            `No email for customer ${ticket.customer_id}, skipping`
          );
          continue;
        }

        // Look up the Stripe customer by email
        const customers = await stripe.customers.search({
          query: `email:"${customer.email}"`,
          limit: 1,
        });

        const stripeCustomer = customers.data[0];
        if (!stripeCustomer) {
          console.log(
            `No Stripe customer for email ${customer.email}, skipping`
          );
          continue;
        }

        // CRITICAL: Record the notification FIRST to prevent duplicates
        // The unique constraint (ticketId + lastArticleId) ensures only one record can exist
        // If this fails due to unique constraint, another cron run already claimed this article
        let notificationId: string;
        try {
          const notification = await prisma.supportNotification.create({
            data: {
              ticketId: String(ticket.id),
              stripeCustomerId: stripeCustomer.id,
              customerEmail: customer.email,
              lastArticleId: lastArticle.id,
              lastArticleAt: new Date(lastArticle.created_at),
            },
          });
          notificationId = notification.id;
        } catch (dbError) {
          // Unique constraint violation means we already notified - skip silently
          if ((dbError as Error).message?.includes("Unique constraint")) {
            continue;
          }
          throw dbError; // Re-throw other errors
        }

        // Now send the email - we've already claimed this article in the database
        const customerName = sanitizeForEmail(
          `${customer.firstname} ${customer.lastname}`.trim() ||
            customer.email.split("@")[0]
        );
        const ticketTitle = sanitizeForEmail(
          ticket.title || "Support Ticket"
        );
        const rawPreview =
          lastArticle.body.length > 150
            ? lastArticle.body.substring(0, 150) + "..."
            : lastArticle.body;
        const messagePreview = sanitizeForEmail(rawPreview);

        // Resolve to primary customer for the token (stripeCustomer from simple search may be monthly)
        const primaryForNotif = await resolvePrimaryCustomer(customer.email);
        const notifCustomerId = primaryForNotif?.id || stripeCustomer.id;

        // Generate a one-time login token that deep links to this ticket
        const token = generateCustomerToken(customer.email, notifCustomerId);
        const ticketUrl = `${APP_URL}/dashboard?token=${token}&ticket=${ticket.id}`;

        console.log(
          `Attempting to send email to ${customer.email} for ticket ${ticket.id}`
        );

        try {
          await sendSupportReplyNotification({
            to: customer.email,
            customerName,
            ticketTitle,
            messagePreview,
            dashboardUrl: ticketUrl,
          });
        } catch (emailError) {
          // Email failed - delete the notification record so it can be retried
          await prisma.supportNotification.delete({
            where: { id: notificationId },
          });
          throw emailError; // Re-throw to be caught by outer catch
        }

        results.push({
          ticketId: String(ticket.id),
          customerEmail: customer.email,
          sent: true,
        });

        console.log(
          `Sent support notification to ${customer.email} for ticket ${ticket.id}`
        );

        // Wait 10 seconds between emails to avoid rate limiting
        await delay(10000);
      } catch (error) {
        console.error(
          `Failed to process ticket ${ticket.id} (${currentEmail}):`,
          error
        );
        results.push({
          ticketId: String(ticket.id),
          customerEmail: currentEmail,
          sent: false,
          error: (error as Error).message,
        });
      }
    }

    const sentCount = results.filter((r) => r.sent).length;

    console.log(
      `Support notifications cron: checked ${openTickets.length} tickets, sent ${sentCount} notifications`
    );

    return NextResponse.json({
      checked: openTickets.length,
      sent: sentCount,
      results,
    });
  } catch (error) {
    console.error("Support notifications cron error:", error);
    return NextResponse.json(
      { error: "Failed to process support notifications" },
      { status: 500 }
    );
  }
}
