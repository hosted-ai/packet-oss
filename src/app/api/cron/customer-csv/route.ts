import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { sendEmailDirect } from "@/lib/email/client";

const ONBOARDING_EMAIL = process.env.ONBOARDING_EMAIL || process.env.ADMIN_BCC_EMAIL || "";

/**
 * Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines.
 */
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format a Unix timestamp or Date to ISO string, or return empty string.
 */
function formatDate(value: number | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return new Date(value * 1000).toISOString();
}

/**
 * POST /api/cron/customer-csv
 *
 * Generates a comprehensive customer CSV and emails it to ONBOARDING_EMAIL.
 * Includes wallet balance, active GPUs, billing type, and recent activity timestamps.
 *
 * Schedule: Every 12 hours via external cron.
 */
export async function POST(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request);
    if (authError) return authError;

    if (!ONBOARDING_EMAIL) {
      return NextResponse.json({ skipped: true, reason: "ONBOARDING_EMAIL not configured" });
    }

    console.log("[Customer CSV] Starting customer CSV generation...");

    // Read from local cache instead of Stripe
    const allCustomers = await prisma.customerCache.findMany({
      where: { isDeleted: false },
    });

    console.log(`[Customer CSV] Loaded ${allCustomers.length} customers from cache`);

    // Get active pod counts per customer from PodMetadata
    const allPodMetadata = await prisma.podMetadata.findMany({
      select: {
        stripeCustomerId: true,
        subscriptionId: true,
        billingType: true,
        hourlyRateCents: true,
      },
    });

    const podCountByCustomer = new Map<string, number>();
    for (const pod of allPodMetadata) {
      if (pod.stripeCustomerId) {
        podCountByCustomer.set(
          pod.stripeCustomerId,
          (podCountByCustomer.get(pod.stripeCustomerId) || 0) + 1
        );
      }
    }

    // Get recent activity events per customer (last 5 events each)
    const allActivityEvents = await prisma.activityEvent.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        customerId: true,
        type: true,
        description: true,
        createdAt: true,
      },
    });

    // Group events by customer, keep only the latest 5
    const eventsByCustomer = new Map<string, typeof allActivityEvents>();
    for (const event of allActivityEvents) {
      const existing = eventsByCustomer.get(event.customerId) || [];
      if (existing.length < 5) {
        existing.push(event);
        eventsByCustomer.set(event.customerId, existing);
      }
    }

    // Get lifecycle data per customer
    const allLifecycles = await prisma.customerLifecycle.findMany({
      select: {
        stripeCustomerId: true,
        firstDepositAt: true,
        subscribedAt: true,
        churnedAt: true,
        reactivatedAt: true,
        totalSpendCents: true,
        totalDepositsCents: true,
        depositCount: true,
        currentBillingType: true,
      },
    });

    const lifecycleByCustomer = new Map<string, (typeof allLifecycles)[0]>();
    for (const lc of allLifecycles) {
      lifecycleByCustomer.set(lc.stripeCustomerId, lc);
    }

    // CSV headers
    const headers = [
      "Email",
      "Name",
      "Stripe Customer ID",
      "Billing Type",
      "Wallet Balance ($)",
      "Active Pods",
      "Team ID",
      "Account Created",
      "Total Spend ($)",
      "First Deposit",
      "Subscription Date",
      "Last Activity",
      "Last Activity Type",
      "Recent Action 1",
      "Recent Action 1 Time",
      "Recent Action 2",
      "Recent Action 2 Time",
      "Recent Action 3",
      "Recent Action 3 Time",
      "Recent Action 4",
      "Recent Action 4 Time",
      "Recent Action 5",
      "Recent Action 5 Time",
    ];

    // Build CSV rows
    const rows: string[][] = [];

    for (const customer of allCustomers) {
      const billingType = customer.billingType || "unknown";
      const walletBalance = Math.abs(Math.min(0, customer.balanceCents || 0)) / 100;
      const teamId = customer.teamId || "";
      const activePods = podCountByCustomer.get(customer.id) || 0;
      const lifecycle = lifecycleByCustomer.get(customer.id);
      const events = eventsByCustomer.get(customer.id) || [];

      const row = [
        csvEscape(customer.email),
        csvEscape(customer.name),
        csvEscape(customer.id),
        csvEscape(billingType),
        csvEscape(walletBalance.toFixed(2)),
        csvEscape(activePods),
        csvEscape(teamId),
        csvEscape(formatDate(customer.stripeCreatedAt)),
        csvEscape(lifecycle?.totalSpendCents ? (lifecycle.totalSpendCents / 100).toFixed(2) : "0.00"),
        csvEscape(lifecycle?.firstDepositAt ? formatDate(lifecycle.firstDepositAt) : ""),
        csvEscape(lifecycle?.subscribedAt ? formatDate(lifecycle.subscribedAt) : ""),
        csvEscape(events[0] ? formatDate(events[0].createdAt) : ""),
        csvEscape(events[0]?.type || ""),
        // Recent actions 1-5
        csvEscape(events[0]?.description || ""),
        csvEscape(events[0] ? formatDate(events[0].createdAt) : ""),
        csvEscape(events[1]?.description || ""),
        csvEscape(events[1] ? formatDate(events[1].createdAt) : ""),
        csvEscape(events[2]?.description || ""),
        csvEscape(events[2] ? formatDate(events[2].createdAt) : ""),
        csvEscape(events[3]?.description || ""),
        csvEscape(events[3] ? formatDate(events[3].createdAt) : ""),
        csvEscape(events[4]?.description || ""),
        csvEscape(events[4] ? formatDate(events[4].createdAt) : ""),
      ];

      rows.push(row);
    }

    // Sort by most recently created first
    rows.sort((a, b) => {
      const dateA = a[7] || "";
      const dateB = b[7] || "";
      return dateB.localeCompare(dateA);
    });

    // Assemble CSV
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "");
    const filename = `packet-customers-${dateStr}-${timeStr}.csv`;

    // Build summary stats for the email body
    const totalCustomers = allCustomers.length;
    const totalWalletBalance = allCustomers.reduce(
      (sum, c) => sum + Math.abs(Math.min(0, c.balanceCents || 0)),
      0
    );
    const totalActivePods = Array.from(podCountByCustomer.values()).reduce((sum, v) => sum + v, 0);
    const billingTypeCounts: Record<string, number> = {};
    for (const c of allCustomers) {
      const bt = c.billingType || "unknown";
      billingTypeCounts[bt] = (billingTypeCounts[bt] || 0) + 1;
    }

    // Build HTML customer table (key columns only for readability)
    const customerTableRows = rows
      .map((row) => {
        // row indices: 0=email, 1=name, 2=stripeId, 3=billingType, 4=walletBalance,
        // 5=activePods, 6=teamId, 7=accountCreated, 8=totalSpend, 9=firstDeposit,
        // 10=subscribedAt, 11=lastActivity, 12=lastActivityType, 13-22=recent actions
        const email = row[0] || "";
        const name = row[1] || "";
        const stripeId = row[2] || "";
        const billing = row[3] || "";
        const wallet = row[4] || "0.00";
        const pods = row[5] || "0";
        const created = row[7] ? row[7].split("T")[0] : "";
        const spend = row[8] || "0.00";
        const lastActivity = row[11] ? row[11].split("T")[0] : "";
        const lastType = row[12] || "";
        return `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;white-space:nowrap;">${email}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;">${name}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;font-family:monospace;">${stripeId}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;">${billing}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;text-align:right;">$${wallet}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;text-align:center;">${pods}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;text-align:right;">$${spend}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;">${created}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;">${lastActivity}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e4e7ef;font-size:11px;">${lastType}</td>
        </tr>`;
      })
      .join("\n");

    const emailHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0 auto;">
        <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:16px;font-weight:600;">Customer Report — ${dateStr}</h2>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">${now.toISOString()}</p>
        </div>
        <div style="border:1px solid #e4e7ef;border-top:none;padding:16px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
            <tr>
              <td style="padding:4px 12px;font-size:13px;color:#6b7280;">Total Customers</td>
              <td style="padding:4px 12px;font-size:13px;color:#111827;font-weight:600;">${totalCustomers}</td>
              <td style="padding:4px 12px;font-size:13px;color:#6b7280;">Active Pods</td>
              <td style="padding:4px 12px;font-size:13px;color:#111827;font-weight:600;">${totalActivePods}</td>
              <td style="padding:4px 12px;font-size:13px;color:#6b7280;">Total Wallet</td>
              <td style="padding:4px 12px;font-size:13px;color:#111827;font-weight:600;">$${(totalWalletBalance / 100).toFixed(2)}</td>
            </tr>
            <tr>
              ${Object.entries(billingTypeCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([bt, count]) => `<td style="padding:4px 12px;font-size:13px;color:#6b7280;">${bt}</td><td style="padding:4px 12px;font-size:13px;color:#111827;font-weight:600;">${count}</td>`)
                .join("")}
            </tr>
          </table>
        </div>
        <div style="border:1px solid #e4e7ef;border-top:none;border-radius:0 0 8px 8px;padding:0;overflow-x:auto;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Email</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Name</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Stripe ID</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Type</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:right;border-bottom:2px solid #e4e7ef;">Wallet</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:center;border-bottom:2px solid #e4e7ef;">Pods</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:right;border-bottom:2px solid #e4e7ef;">Spend</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Created</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Last Active</th>
                <th style="padding:6px 8px;font-size:11px;color:#6b7280;text-align:left;border-bottom:2px solid #e4e7ef;">Last Action</th>
              </tr>
            </thead>
            <tbody>
              ${customerTableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Plain text includes the full raw CSV for easy import
    const emailText = [
      `Customer Report — ${dateStr} (${now.toISOString()})`,
      "",
      `Total Customers: ${totalCustomers}`,
      `Total Wallet Balance: $${(totalWalletBalance / 100).toFixed(2)}`,
      `Active Pods: ${totalActivePods}`,
      ...Object.entries(billingTypeCounts).map(([bt, count]) => `${bt}: ${count}`),
      "",
      `=== CSV DATA (${rows.length} rows) — copy below this line ===`,
      "",
      csvContent,
    ].join("\n");

    // Send email with inline data (no attachments — Emailit doesn't support them)
    await sendEmailDirect({
      to: ONBOARDING_EMAIL,
      subject: `[Customer CSV] ${dateStr} — ${totalCustomers} customers`,
      html: emailHtml,
      text: emailText,
    });

    console.log(`[Customer CSV] Sent to ${ONBOARDING_EMAIL}: ${rows.length} customers`);

    return NextResponse.json({
      success: true,
      sentTo: ONBOARDING_EMAIL,
      customers: rows.length,
      filename,
    });
  } catch (error) {
    console.error("[Customer CSV] Failed:", error);
    return NextResponse.json(
      { error: "Failed to generate customer CSV", details: (error as Error).message },
      { status: 500 }
    );
  }
}

// GET support for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
