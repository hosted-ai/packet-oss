import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getActivePodCountsByTeam } from "@/lib/admin-cache";
import { fetchCustomerGroups, type CustomerGroup } from "@/lib/admin-customer-groups";

type SortField = "email" | "name" | "teamId" | "productId" | "walletBalance" | "activeGPUs" | "created";
type SortDir = "asc" | "desc";

const VALID_SORT_FIELDS: SortField[] = ["email", "name", "teamId", "productId", "walletBalance", "activeGPUs", "created"];

// The table shows only email and name, and short numeric queries matched hex pairs
// inside UUIDs, so widen to id/teamId only when the query looks like one.
function buildSearchOr(search: string) {
  const looksLikeStripeId = /^cus_/i.test(search);
  const looksLikeUuidFragment = search.length >= 8 && /^[0-9a-f-]+$/i.test(search);

  return [
    { email: { contains: search } },
    { name: { contains: search } },
    ...(looksLikeStripeId ? [{ id: { contains: search } }] : []),
    ...(looksLikeUuidFragment ? [{ teamId: { contains: search } }] : []),
  ];
}

interface CustomerRow {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
  teamId?: string;
  productId?: string;
  billingType?: string;
  walletBalance: number;
  activeGPUs: number;
  customerIds: string[];
}

const text = (value: string | null | undefined) => (value ?? "").toLowerCase();

// Every comparator falls through to created DESC then the Stripe id, so ties —
// a page full of zero balances — always slice into the same pages.
function compareRows(a: CustomerRow, b: CustomerRow, sortBy: SortField, sortDir: SortDir) {
  let cmp = 0;
  switch (sortBy) {
    case "walletBalance":
      cmp = a.walletBalance - b.walletBalance;
      break;
    case "activeGPUs":
      cmp = a.activeGPUs - b.activeGPUs;
      break;
    case "created":
      cmp = a.created - b.created;
      break;
    default:
      cmp = text(a[sortBy]).localeCompare(text(b[sortBy]));
  }

  if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
  return b.created - a.created || a.id.localeCompare(b.id);
}

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const sortBy = VALID_SORT_FIELDS.includes(searchParams.get("sortBy") as SortField)
      ? (searchParams.get("sortBy") as SortField)
      : "created";
    const sortDir: SortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";

    // The live per-team count beats the 12h snapshot: a team absent from a
    // SUCCESSFUL fetch has 0 active, so fall back only when the fetch fails.
    const liveByTeam = await getActivePodCountsByTeam().catch(() => null);

    // Each of the account's teams is counted once, however many Stripe records
    // carry it; the snapshot is per record, so take the account's largest.
    const resolveActiveGPUs = (group: CustomerGroup) =>
      liveByTeam
        ? group.teamIds.reduce((sum, teamId) => sum + (liveByTeam.get(teamId) ?? 0), 0)
        : Math.max(...group.rows.map((r) => r.activePods));

    const groups = await fetchCustomerGroups(search ? buildSearchOr(search) : null);

    const rows: CustomerRow[] = groups.map((group) => ({
      id: group.primary.id,
      email: group.primary.email,
      name: group.primary.name ?? null,
      created: Math.floor(group.primary.stripeCreatedAt.getTime() / 1000),
      teamId: group.primary.teamId || group.teamIds[0] || undefined,
      productId: group.productId || undefined,
      billingType: group.billingType || undefined,
      walletBalance: -(group.primary.balanceCents || 0),
      activeGPUs: resolveActiveGPUs(group),
      customerIds: group.customerIds,
    }));

    rows.sort((a, b) => compareRows(a, b, sortBy, sortDir));

    const total = rows.length;
    const startIndex = (page - 1) * limit;

    return NextResponse.json({
      customers: rows.slice(startIndex, startIndex + limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Customers error:", error);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}
