import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getAllTickets,
  getUser,
  ZAMMAD_STATES,
} from "@/lib/zammad";
import type { ZammadTicket } from "@/lib/zammad";

// In-memory cache (5 minutes)
let statsCache: { data: unknown; timestamp: number; period: string } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// State ID to name mapping
const STATE_NAMES: Record<number, string> = {
  [ZAMMAD_STATES.new]: "new",
  [ZAMMAD_STATES.open]: "open",
  [ZAMMAD_STATES.pending_reminder]: "pending reminder",
  [ZAMMAD_STATES.closed]: "closed",
  [ZAMMAD_STATES.merged]: "merged",
  [ZAMMAD_STATES.pending_close]: "pending close",
};

const PRIORITY_NAMES: Record<number, string> = {
  1: "low",
  2: "normal",
  3: "high",
};

const OPEN_STATES: number[] = [ZAMMAD_STATES.new, ZAMMAD_STATES.open, ZAMMAD_STATES.pending_reminder, ZAMMAD_STATES.pending_close];
const CLOSED_STATES: number[] = [ZAMMAD_STATES.closed, ZAMMAD_STATES.merged];

function isOpenState(stateId: number): boolean {
  return OPEN_STATES.includes(stateId);
}

function isClosedState(stateId: number): boolean {
  return CLOSED_STATES.includes(stateId);
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
  const days = Math.floor(mins / 1440);
  const hours = Math.round((mins % 1440) / 60);
  return `${days}d ${hours}h`;
}

function getResponseTimeBucket(mins: number): string {
  if (mins < 60) return "<1h";
  if (mins < 240) return "1-4h";
  if (mins < 720) return "4-12h";
  if (mins < 1440) return "12-24h";
  return ">24h";
}

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get("admin_session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30";

    // Check cache
    if (statsCache && Date.now() - statsCache.timestamp < CACHE_TTL && statsCache.period === period) {
      return NextResponse.json(statsCache.data);
    }

    // Fetch all tickets (already filtered to platform groups)
    const tickets = await getAllTickets({ state: "all", perPage: 10000 });

    // Period filter for volume metrics
    const periodDays = period === "all" ? Infinity : parseInt(period, 10);
    const cutoffDate = periodDays === Infinity
      ? new Date(0)
      : new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const periodTickets = tickets.filter(
      (t) => new Date(t.created_at) >= cutoffDate
    );

    // ─── KPI computation ───

    const openTickets = tickets.filter((t) => isOpenState(t.state_id));
    const closedTickets = tickets.filter((t) => isClosedState(t.state_id));

    // Avg first response time (on tickets that have it, within period)
    const firstResponseTimes = periodTickets
      .filter((t) => t.first_response_in_min != null && t.first_response_in_min > 0)
      .map((t) => t.first_response_in_min!);
    const avgFirstResponseMin = firstResponseTimes.length > 0
      ? firstResponseTimes.reduce((a, b) => a + b, 0) / firstResponseTimes.length
      : 0;

    // Avg resolution time (closed tickets within period that have close_in_min)
    const closedInPeriod = periodTickets.filter((t) => isClosedState(t.state_id));
    const resolutionTimes = closedInPeriod
      .filter((t) => t.close_in_min != null && t.close_in_min > 0)
      .map((t) => t.close_in_min!);
    const avgResolutionMin = resolutionTimes.length > 0
      ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      : 0;

    // Needs reply: open tickets where last_contact_customer_at > last_contact_agent_at
    const needsReply = openTickets.filter((t) => {
      if (!t.last_contact_customer_at) return false;
      if (!t.last_contact_agent_at) return true;
      return new Date(t.last_contact_customer_at) > new Date(t.last_contact_agent_at);
    });

    // First contact resolution: closed tickets where article_count <= 2
    // (1 customer message + 1 agent reply = resolved on first contact)
    const fcrEligible = closedInPeriod.filter((t) => t.article_count > 0);
    const fcrCount = fcrEligible.filter((t) => t.article_count <= 3).length;
    const firstContactResolutionPct = fcrEligible.length > 0
      ? Math.round((fcrCount / fcrEligible.length) * 100)
      : 0;

    // ─── Volume by day ───

    const volumeByDay: Record<string, { created: number; closed: number }> = {};
    for (const t of periodTickets) {
      const day = new Date(t.created_at).toISOString().slice(0, 10);
      if (!volumeByDay[day]) volumeByDay[day] = { created: 0, closed: 0 };
      volumeByDay[day].created++;
    }
    for (const t of closedInPeriod) {
      if (t.close_at) {
        const day = new Date(t.close_at).toISOString().slice(0, 10);
        if (!volumeByDay[day]) volumeByDay[day] = { created: 0, closed: 0 };
        volumeByDay[day].closed++;
      }
    }

    // Fill in missing days
    const volumeDays = Object.keys(volumeByDay).sort();
    if (volumeDays.length > 0 && periodDays !== Infinity) {
      const startDay = cutoffDate.toISOString().slice(0, 10);
      const endDay = new Date().toISOString().slice(0, 10);
      const d = new Date(startDay);
      while (d.toISOString().slice(0, 10) <= endDay) {
        const dayStr = d.toISOString().slice(0, 10);
        if (!volumeByDay[dayStr]) volumeByDay[dayStr] = { created: 0, closed: 0 };
        d.setDate(d.getDate() + 1);
      }
    }

    const sortedVolumeByDay = Object.entries(volumeByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, counts]) => ({ day, ...counts }));

    // ─── Response time distribution ───

    const firstResponseBuckets: Record<string, number> = { "<1h": 0, "1-4h": 0, "4-12h": 0, "12-24h": 0, ">24h": 0 };
    const resolutionBuckets: Record<string, number> = { "<1h": 0, "1-4h": 0, "4-12h": 0, "12-24h": 0, ">24h": 0 };

    for (const mins of firstResponseTimes) {
      firstResponseBuckets[getResponseTimeBucket(mins)]++;
    }
    for (const mins of resolutionTimes) {
      resolutionBuckets[getResponseTimeBucket(mins)]++;
    }

    // ─── Status breakdown ───

    const statusCounts: Record<string, number> = {};
    for (const t of tickets) {
      const name = STATE_NAMES[t.state_id] || "unknown";
      statusCounts[name] = (statusCounts[name] || 0) + 1;
    }
    const statusBreakdown = Object.entries(statusCounts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Priority breakdown ───

    const priorityCounts: Record<string, number> = {};
    for (const t of periodTickets) {
      const name = PRIORITY_NAMES[t.priority_id] || "unknown";
      priorityCounts[name] = (priorityCounts[name] || 0) + 1;
    }
    const priorityBreakdown = Object.entries(priorityCounts)
      .map(([priority, count]) => ({ priority, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Top customers (by ticket count) ───

    const customerTicketCounts: Record<number, { count: number; ticket: ZammadTicket }> = {};
    for (const t of tickets) {
      if (!customerTicketCounts[t.customer_id]) {
        customerTicketCounts[t.customer_id] = { count: 0, ticket: t };
      }
      customerTicketCounts[t.customer_id].count++;
    }

    const topCustomerIds = Object.entries(customerTicketCounts)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10);

    const topCustomers = await Promise.all(
      topCustomerIds.map(async ([customerId, { count }]) => {
        try {
          const user = await getUser(parseInt(customerId, 10));
          return {
            email: user.email,
            name: `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.email,
            ticketCount: count,
          };
        } catch {
          return { email: `User #${customerId}`, name: `User #${customerId}`, ticketCount: count };
        }
      })
    );

    // ─── Recent tickets ───

    const enrichedRecentTickets = await Promise.all(
      tickets
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 10)
        .map(async (t) => {
          let customerEmail = "";
          let customerName = "";
          try {
            const user = await getUser(t.customer_id);
            customerEmail = user.email;
            customerName = `${user.firstname || ""} ${user.lastname || ""}`.trim();
          } catch {
            // skip
          }
          return {
            number: `PKT-${t.number}`,
            title: t.title,
            customer: customerName || customerEmail || `User #${t.customer_id}`,
            status: STATE_NAMES[t.state_id] || "unknown",
            priority: PRIORITY_NAMES[t.priority_id] || "normal",
            createdAt: t.created_at,
            updatedAt: t.updated_at,
          };
        })
    );

    const responseData = {
      overview: {
        total: tickets.length,
        periodTotal: periodTickets.length,
        open: openTickets.length,
        closed: closedTickets.length,
        needsReply: needsReply.length,
        avgFirstResponseMin: Math.round(avgFirstResponseMin),
        avgFirstResponseFormatted: formatMinutes(avgFirstResponseMin),
        avgResolutionMin: Math.round(avgResolutionMin),
        avgResolutionFormatted: formatMinutes(avgResolutionMin),
        firstContactResolutionPct,
      },
      volumeByDay: sortedVolumeByDay,
      responseTimeBuckets: {
        firstResponse: firstResponseBuckets,
        resolution: resolutionBuckets,
      },
      statusBreakdown,
      priorityBreakdown,
      topCustomers,
      recentTickets: enrichedRecentTickets,
    };

    // Cache
    statsCache = { data: responseData, timestamp: Date.now(), period };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Failed to compute support stats:", error);
    return NextResponse.json(
      { error: "Failed to compute support stats", details: (error as Error).message },
      { status: 500 }
    );
  }
}
