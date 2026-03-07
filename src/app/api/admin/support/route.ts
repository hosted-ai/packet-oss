import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getAllTickets,
  getTicketArticles,
  getUser,
  isTicketClosed,
  getStateName,
} from "@/lib/zammad";
import type { ZammadTicket, ZammadArticle } from "@/lib/zammad";

interface FormattedTicket {
  id: number;
  number: string;
  title: string;
  status: string;
  priority: string;
  customerId: number;
  customerEmail?: string;
  customerName?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
  hasUnreadCustomerReply: boolean;
}

async function formatTicketForAdmin(
  ticket: ZammadTicket,
  articles?: ZammadArticle[]
): Promise<FormattedTicket> {
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
    // Customer lookup failed, continue without
  }

  // Check if last message is from customer (needs reply)
  let lastArticle: ZammadArticle | undefined;
  let hasUnreadCustomerReply = false;
  if (articles && articles.length > 0) {
    lastArticle = articles[articles.length - 1];
    hasUnreadCustomerReply = lastArticle.sender === "Customer" && !isClosed;
  }

  // Get priority name from ID
  const priorityNames: Record<number, string> = {
    1: "low",
    2: "normal",
    3: "high",
  };

  return {
    id: ticket.id,
    number: `PKT-${ticket.number}`,
    title: ticket.title || "Support Ticket",
    status: isClosed ? "closed" : stateName.toLowerCase(),
    priority: priorityNames[ticket.priority_id] || "normal",
    customerId: ticket.customer_id,
    customerEmail,
    customerName,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    lastMessageAt: lastArticle?.created_at || null,
    lastMessagePreview: lastArticle?.body?.substring(0, 150) || null,
    messageCount: articles?.length || 0,
    hasUnreadCustomerReply,
  };
}

// GET - List all support tickets for admin
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const state = (searchParams.get("state") as "open" | "closed" | "all") || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const perPage = parseInt(searchParams.get("perPage") || "50", 10);

    // Get all tickets
    const tickets = await getAllTickets({ state, page, perPage });

    // Format tickets with additional info
    const formattedTickets = await Promise.all(
      tickets.map(async (ticket) => {
        try {
          const articles = await getTicketArticles(ticket.id);
          return formatTicketForAdmin(ticket, articles);
        } catch {
          return formatTicketForAdmin(ticket);
        }
      })
    );

    // Sort by last message date (most recent first), prioritizing unread
    formattedTickets.sort((a, b) => {
      // Unread customer replies first
      if (a.hasUnreadCustomerReply && !b.hasUnreadCustomerReply) return -1;
      if (!a.hasUnreadCustomerReply && b.hasUnreadCustomerReply) return 1;

      // Then by date
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return dateB - dateA;
    });

    // Count tickets needing reply
    const needsReplyCount = formattedTickets.filter(
      (t) => t.hasUnreadCustomerReply
    ).length;

    return NextResponse.json({
      success: true,
      tickets: formattedTickets,
      total: formattedTickets.length,
      needsReplyCount,
      page,
      perPage,
    });
  } catch (error) {
    console.error("Failed to fetch admin support tickets:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch support tickets",
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
