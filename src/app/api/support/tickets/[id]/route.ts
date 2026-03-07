import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";
import {
  getOrCreatePacketOrganization,
  getOrCreatePacketUser,
  getTicket,
  getTicketArticles,
  isTicketClosed,
  closeTicket,
} from "@/lib/zammad";

// GET - Get a single ticket with messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { id: ticketId } = await params;
    const ticketIdNum = parseInt(ticketId, 10);

    if (isNaN(ticketIdNum)) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    // Get Stripe customer to verify ownership
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(payload.customerId);
    if ("deleted" in customerResult && customerResult.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customerResult as Stripe.Customer;

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

    // Get the ticket
    const ticket = await getTicket(ticketIdNum);

    // Verify this ticket belongs to the customer
    if (ticket.customer_id !== zammadUser.id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Get all articles (messages) for this ticket
    const articles = await getTicketArticles(ticketIdNum);

    // Format messages
    // Filter out internal articles and format for frontend
    const messages = articles
      .filter((article) => !article.internal)
      .map((article) => ({
        id: article.id,
        content: article.body,
        isFromCustomer: article.sender === "Customer",
        isBot: false,
        createdAt: article.created_at,
        attachments:
          article.attachments?.map((att) => ({
            filename: att.filename,
            url: `/api/support/attachments/${att.id}`, // We'd need an attachment proxy
            mime: att.preferences["Content-Type"] || att.preferences.Mime,
            size: parseInt(att.size, 10) || 0,
          })) || [],
      }));

    const isClosed = await isTicketClosed(ticket);

    return NextResponse.json({
      success: true,
      ticket: {
        id: String(ticket.id),
        ticketNumber: ticket.number ? `PKT-${ticket.number}` : null,
        title: ticket.title || "Support Ticket",
        status: isClosed ? "closed" : "open", // Normalize to "open" or "closed" for frontend
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        isArchived: isClosed,
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

// PATCH - Update ticket (close/resolve)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = verifyCustomerToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const { id: ticketId } = await params;
    const ticketIdNum = parseInt(ticketId, 10);

    if (isNaN(ticketIdNum)) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    const { action } = await request.json();

    if (action !== "close") {
      return NextResponse.json(
        { error: "Invalid action. Supported actions: close" },
        { status: 400 }
      );
    }

    // Get Stripe customer to verify ownership
    const stripe = getStripe();
    const customerResult = await stripe.customers.retrieve(payload.customerId);
    if ("deleted" in customerResult && customerResult.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customerResult as Stripe.Customer;

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

    // Get the ticket
    const ticket = await getTicket(ticketIdNum);

    // Verify this ticket belongs to the customer
    if (ticket.customer_id !== zammadUser.id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check if already closed
    const alreadyClosed = await isTicketClosed(ticket);
    if (alreadyClosed) {
      return NextResponse.json(
        { error: "Ticket is already closed" },
        { status: 400 }
      );
    }

    // Close the ticket
    await closeTicket(ticketIdNum);

    return NextResponse.json({
      success: true,
      message: "Ticket closed successfully",
    });
  } catch (error) {
    console.error("Failed to update ticket:", error);
    return NextResponse.json(
      { error: "Failed to update ticket", details: (error as Error).message },
      { status: 500 }
    );
  }
}
