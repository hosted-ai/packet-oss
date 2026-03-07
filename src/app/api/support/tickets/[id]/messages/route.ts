import { NextRequest, NextResponse } from "next/server";
import { verifyCustomerToken } from "@/lib/customer-auth";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";
import {
  getOrCreatePacketOrganization,
  getOrCreatePacketUser,
  getTicket,
  addCustomerReply,
  isTicketClosed,
} from "@/lib/zammad";

// POST - Send a message to a ticket
export async function POST(
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

    const { message } = await request.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Message is required" },
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

    // Check if ticket is closed
    const isClosed = await isTicketClosed(ticket);
    if (isClosed) {
      return NextResponse.json(
        { error: "Cannot reply to a closed ticket" },
        { status: 400 }
      );
    }

    // Add the reply to the ticket
    const article = await addCustomerReply({
      ticketId: ticketIdNum,
      message: message.trim(),
    });

    return NextResponse.json({
      success: true,
      message: {
        id: article.id,
        content: article.body,
        isFromCustomer: true,
        isBot: false,
        createdAt: article.created_at,
        attachments: [],
      },
    });
  } catch (error) {
    console.error("Failed to send message:", error);
    return NextResponse.json(
      { error: "Failed to send message", details: (error as Error).message },
      { status: 500 }
    );
  }
}
