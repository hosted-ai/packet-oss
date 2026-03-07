import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/auth/helpers";
import {
  getOrCreatePacketOrganization,
  getOrCreatePacketUser,
  createPacketSupportTicket,
  getTicketsByCustomer,
  getTicketArticles,
  isTicketClosed,
} from "@/lib/zammad";
import type { ZammadTicket, ZammadArticle } from "@/lib/zammad";
import { sendOnboardingEvent } from "@/lib/email/onboarding-events";

/**
 * Format a Zammad ticket for the API response
 */
async function formatTicket(
  ticket: ZammadTicket,
  articles?: ZammadArticle[]
): Promise<{
  id: string;
  ticketNumber: string | null;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessage: string | null;
  isArchived: boolean;
  hasUnreadReply: boolean;
}> {
  const isClosed = await isTicketClosed(ticket);

  // Get last article if not provided
  let lastArticle: ZammadArticle | undefined;
  if (articles && articles.length > 0) {
    lastArticle = articles[articles.length - 1];
  }

  // Check if last message is from agent (has unread reply)
  const hasUnreadReply =
    lastArticle && lastArticle.sender !== "Customer" && !isClosed;

  return {
    id: String(ticket.id),
    ticketNumber: ticket.number ? `PKT-${ticket.number}` : null,
    title: ticket.title || "Support Ticket",
    status: isClosed ? "closed" : "open", // Normalize to "open" or "closed" for frontend
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    lastMessageAt: lastArticle?.created_at || null,
    lastMessage: lastArticle?.body?.substring(0, 200) || null,
    isArchived: isClosed,
    hasUnreadReply: Boolean(hasUnreadReply),
  };
}

// GET - List support tickets for the customer
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer } = auth;

    // Get or create organization and user in Zammad
    const org = await getOrCreatePacketOrganization(
      payload.customerId,
      customer.name || undefined
    );
    const zammadUser = await getOrCreatePacketUser(
      payload.email,
      org.id,
      customer.name || undefined
    );

    // Get all tickets for this customer
    const tickets = await getTicketsByCustomer(zammadUser.id);

    // Format tickets with last message info
    const ticketsWithMessages = await Promise.all(
      tickets.map(async (ticket) => {
        try {
          const articles = await getTicketArticles(ticket.id);
          return formatTicket(ticket, articles);
        } catch {
          return formatTicket(ticket);
        }
      })
    );

    // Sort by last message date, most recent first
    ticketsWithMessages.sort((a, b) => {
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return dateB - dateA;
    });

    // Check if any ticket has unread replies
    const hasUnreadReplies = ticketsWithMessages.some((t) => t.hasUnreadReply);

    return NextResponse.json({
      success: true,
      tickets: ticketsWithMessages,
      contactId: String(zammadUser.id),
      hasUnreadReplies,
    });
  } catch (error) {
    console.error("Failed to fetch support tickets:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch support tickets",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}

// POST - Create a new support ticket
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedCustomer(request);
    if (auth instanceof NextResponse) return auth;
    const { payload, customer } = auth;

    const { subject, message, priority } = await request.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Validate priority if provided
    const validPriorities = ["low", "normal", "high"];
    const ticketPriority = validPriorities.includes(priority) ? priority : "normal";

    // Get or create organization and user in Zammad
    const org = await getOrCreatePacketOrganization(
      payload.customerId,
      customer.name || undefined
    );
    const zammadUser = await getOrCreatePacketUser(
      payload.email,
      org.id,
      customer.name || undefined
    );

    // Create the ticket in Zammad
    const ticketSubject = subject || "Support Ticket";
    const ticket = await createPacketSupportTicket({
      customerId: zammadUser.id,
      subject: ticketSubject,
      message: message.trim(),
      priority: ticketPriority as "low" | "normal" | "high",
    });

    const ticketNumber = `PKT-${ticket.number}`;

    // Notify onboarding system
    sendOnboardingEvent({
      type: "support.ticket_opened",
      email: payload.email,
      name: customer.name || payload.email.split("@")[0],
      metadata: {
        "Stripe Customer ID": payload.customerId,
        "Ticket Number": ticketNumber,
        "Ticket ID": String(ticket.id),
        "Subject": ticketSubject,
        "Priority": ticketPriority,
        "Message Preview": message.trim().substring(0, 500),
      },
    });

    return NextResponse.json({
      success: true,
      ticket: {
        id: String(ticket.id),
        ticketNumber,
        title: ticket.title,
        status: "open",
        createdAt: ticket.created_at,
      },
    });
  } catch (error) {
    console.error("Failed to create support ticket:", error);
    return NextResponse.json(
      {
        error: "Failed to create support ticket",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
