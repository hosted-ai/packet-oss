import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getTicket,
  getTicketArticles,
  getUser,
  addAgentReply,
  closeTicket,
  reopenTicket,
  isTicketClosed,
  getStateName,
} from "@/lib/zammad";
import type { ZammadArticle } from "@/lib/zammad";
import { getStripe } from "@/lib/stripe";

interface FormattedMessage {
  id: number;
  content: string;
  sender: string;
  senderName?: string;
  isFromCustomer: boolean;
  isInternal: boolean;
  createdAt: string;
}

function formatArticle(article: ZammadArticle): FormattedMessage {
  return {
    id: article.id,
    content: article.body || "",
    sender: article.sender || "unknown",
    isFromCustomer: article.sender === "Customer",
    isInternal: article.internal || false,
    createdAt: article.created_at,
  };
}

// GET - Get ticket details with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify admin session
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    // Get ticket
    const ticket = await getTicket(ticketId);
    const articles = await getTicketArticles(ticketId);
    const isClosed = await isTicketClosed(ticket);
    const stateName = await getStateName(ticket.state_id);

    // Get customer info
    let customerEmail: string | undefined;
    let customerName: string | undefined;
    try {
      const customer = await getUser(ticket.customer_id);
      customerEmail = customer.email;
      customerName = `${customer.firstname || ""} ${customer.lastname || ""}`.trim();
    } catch {
      // Customer lookup failed
    }

    // Look up Stripe customer by email for login-as functionality
    let stripeCustomerId: string | undefined;
    if (customerEmail) {
      try {
        const stripe = getStripe();
        const stripeCustomers = await stripe.customers.list({
          email: customerEmail.toLowerCase(),
          limit: 1,
        });
        if (stripeCustomers.data.length > 0) {
          stripeCustomerId = stripeCustomers.data[0].id;
        }
      } catch {
        // Stripe lookup failed, continue without
      }
    }

    // Format messages
    const messages = articles.map(formatArticle);

    const priorityNames: Record<number, string> = {
      1: "low",
      2: "normal",
      3: "high",
    };

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        number: `PKT-${ticket.number}`,
        title: ticket.title || "Support Ticket",
        status: isClosed ? "closed" : stateName.toLowerCase(),
        priority: priorityNames[ticket.priority_id] || "normal",
        customerId: ticket.customer_id,
        customerEmail,
        customerName,
        stripeCustomerId,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        isClosed,
      },
      messages,
    });
  } catch (error) {
    console.error("Failed to fetch ticket:", error);
    return NextResponse.json(
      { error: "Failed to fetch ticket", details: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST - Send a reply to the ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify admin session
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    const body = await request.json();
    const { message, internal = false } = body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    // Check if ticket exists
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Add the agent reply
    const article = await addAgentReply({
      ticketId,
      message: message.trim(),
      internal,
    });

    return NextResponse.json({
      success: true,
      message: formatArticle(article),
    });
  } catch (error) {
    console.error("Failed to send reply:", error);
    return NextResponse.json(
      { error: "Failed to send reply", details: (error as Error).message },
      { status: 500 }
    );
  }
}

// PATCH - Update ticket status (close/reopen)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify admin session
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    if (!action || !["close", "reopen"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'close' or 'reopen'" },
        { status: 400 }
      );
    }

    let updatedTicket;
    if (action === "close") {
      updatedTicket = await closeTicket(ticketId);
    } else {
      updatedTicket = await reopenTicket(ticketId);
    }

    return NextResponse.json({
      success: true,
      ticket: {
        id: updatedTicket.id,
        status: action === "close" ? "closed" : "open",
      },
    });
  } catch (error) {
    console.error("Failed to update ticket:", error);
    return NextResponse.json(
      { error: "Failed to update ticket", details: (error as Error).message },
      { status: 500 }
    );
  }
}
