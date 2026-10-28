#!/usr/bin/env npx tsx
/**
 * Generate the "Revenue by Month" report.
 *
 * Three views of the same time series:
 *   1. By Transaction Type  - exact split from packetdb.wallet_transaction.type
 *                             (gpu_usage, gpu_deploy, stopped_reservation, storage, bare_metal).
 *                             This is what Packet actually billed, in cents.
 *   2. By Billing Class     - same revenue, grouped by each customer's current
 *                             pod portfolio: Monthly / Hourly / Both / Unknown.
 *                             Useful for "how much of our revenue is monthly subscribers?"
 *   3. Stripe Top-ups       - cash collected via Stripe, by month. This is
 *                             separate from recognized revenue (top-ups become
 *                             wallet credit; recognized revenue is wallet debits).
 *                             Needs Stripe API access.
 *
 * Each tab gets a chart at the bottom for visual at-a-glance.
 *
 * Usage:
 *   npx tsx scripts/revenue-by-month-report.ts                      # CSVs to /tmp
 *   npx tsx scripts/revenue-by-month-report.ts --sheet-id 1abc...   # Google Sheet
 *   npx tsx scripts/revenue-by-month-report.ts --skip-stripe        # skip the slow Stripe tab
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import mysql from "mysql2/promise";
import Stripe from "stripe";
import {
  getSheetsClient, parseSheetId, writeTab, writeReadmeTab, addChart, rowsToGrid,
} from "./lib/sheets-client";

// ── Load .env.local ───────────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const args = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return dflt;
}

const today = new Date().toISOString().slice(0, 10);
const outDir = arg("out", "/tmp/packet-subscribers")!;
const sheetArg = arg("sheet-id") ?? arg("sheet-url");
const sheetId = sheetArg ? parseSheetId(sheetArg) : null;
const skipStripe = args.includes("--skip-stripe");
mkdirSync(outDir, { recursive: true });

const packetCfg: mysql.ConnectionOptions = {
  host:     arg("packet-host", process.env.PACKETDB_HOST),
  user:     arg("packet-user", process.env.PACKETDB_USER || process.env.USER),
  password: arg("packet-pass", process.env.PACKETDB_PASS),
  database: arg("packet-db",   process.env.PACKETDB_NAME || "packetdb"),
  socketPath: (arg("packet-host", process.env.PACKETDB_HOST) ? undefined : "/tmp/mysql.sock"),
  multipleStatements: true,
};

const stripe = !skipStripe && process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// ── CSV helpers ───────────────────────────────────────────────────────
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n") + "\n";
}

// ── Number helper: cents → dollars string with 2 decimals ────────────
function c2d(cents: number): number {
  return Math.round(cents) / 100;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[report] connecting to packetdb @ ${packetCfg.host ?? packetCfg.socketPath}`);
  const conn = await mysql.createConnection(packetCfg);

  // ── 1. Revenue by month + transaction type ─────────────────────────
  const [byTypeRows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m') AS month,
      type,
      SUM(amount_cents) AS cents
    FROM packetdb.wallet_transaction
    WHERE amount_cents > 0
    GROUP BY month, type
    ORDER BY month, type
  `);

  // Pivot into one row per month with one column per type
  type ByTypeRow = { month: string; type: string; cents: number };
  const byTypeMap = new Map<string, Record<string, number>>();
  for (const r of byTypeRows as ByTypeRow[]) {
    if (!byTypeMap.has(r.month)) byTypeMap.set(r.month, {});
    byTypeMap.get(r.month)![r.type] = Number(r.cents);
  }
  const typeColumns = ["gpu_usage", "gpu_deploy", "stopped_reservation", "storage", "bare_metal"];
  const typeLabels: Record<string, string> = {
    gpu_usage: "GPU Hourly Usage",
    gpu_deploy: "GPU Deploy Fee",
    stopped_reservation: "Stopped Reservation",
    storage: "Storage",
    bare_metal: "Baremetal",
  };
  const byTypeMonthRows: Array<Record<string, unknown>> = [];
  const monthsSortedT = [...byTypeMap.keys()].sort();
  for (const month of monthsSortedT) {
    const data = byTypeMap.get(month)!;
    const row: Record<string, unknown> = { Month: month };
    let total = 0;
    for (const k of typeColumns) {
      const cents = data[k] ?? 0;
      total += cents;
      row[`${typeLabels[k]}_USD`] = c2d(cents);
    }
    row.Total_Revenue_USD = c2d(total);
    byTypeMonthRows.push(row);
  }

  // ── 2. Revenue by month + customer billing class ───────────────────
  // Customer class = derived from their pod_metadata billing_type history
  // (current portfolio; not historically accurate for back-months).
  const [byClassRows] = await conn.query<mysql.RowDataPacket[]>(`
    WITH customer_class AS (
      SELECT
        pm.stripe_customer_id,
        CASE
          WHEN MAX(pm.billing_type='monthly') > 0 AND MAX(pm.billing_type='hourly') > 0 THEN 'Both'
          WHEN MAX(pm.billing_type='monthly') > 0 THEN 'Monthly'
          WHEN MAX(pm.billing_type='hourly') > 0  THEN 'Hourly'
          ELSE 'Unknown'
        END AS billing_class
      FROM packetdb.pod_metadata pm
      GROUP BY pm.stripe_customer_id
    )
    SELECT
      DATE_FORMAT(wt.created_at, '%Y-%m') AS month,
      COALESCE(cc.billing_class, 'No pods') AS billing_class,
      SUM(wt.amount_cents) AS cents
    FROM packetdb.wallet_transaction wt
    LEFT JOIN customer_class cc ON cc.stripe_customer_id = wt.stripe_customer_id
    WHERE wt.amount_cents > 0
      AND wt.type IN ('gpu_usage','gpu_deploy','stopped_reservation','storage','bare_metal')
    GROUP BY month, billing_class
    ORDER BY month, billing_class
  `);

  type ByClassRow = { month: string; billing_class: string; cents: number };
  const byClassMap = new Map<string, Record<string, number>>();
  for (const r of byClassRows as ByClassRow[]) {
    if (!byClassMap.has(r.month)) byClassMap.set(r.month, {});
    byClassMap.get(r.month)![r.billing_class] = Number(r.cents);
  }
  const classColumns = ["Monthly", "Hourly", "Both", "Unknown", "No pods"];
  const byClassMonthRows: Array<Record<string, unknown>> = [];
  const monthsSortedC = [...byClassMap.keys()].sort();
  for (const month of monthsSortedC) {
    const data = byClassMap.get(month)!;
    const row: Record<string, unknown> = { Month: month };
    let total = 0;
    for (const k of classColumns) {
      const cents = data[k] ?? 0;
      total += cents;
      row[`${k}_Customers_Revenue_USD`] = c2d(cents);
    }
    row.Total_Revenue_USD = c2d(total);
    byClassMonthRows.push(row);
  }

  // ── 3. Stripe top-ups by month (optional, slow) ────────────────────
  // We iterate the full Stripe charges feed (oldest first) and aggregate.
  // This is the only way to see cash inflow regardless of pod/wallet attribution.
  let topupRows: Array<Record<string, unknown>> = [];
  if (stripe) {
    console.log("[stripe] fetching full charge history (this can take 1-2 min for ~10k charges)...");
    const byMonth = new Map<string, { count: number; succeeded_cents: number; refunded_cents: number; customers: Set<string> }>();
    let pageCount = 0;
    for await (const charge of stripe.charges.list({ limit: 100 })) {
      const month = new Date(charge.created * 1000).toISOString().slice(0, 7);
      if (!byMonth.has(month)) {
        byMonth.set(month, { count: 0, succeeded_cents: 0, refunded_cents: 0, customers: new Set() });
      }
      const m = byMonth.get(month)!;
      m.count += 1;
      if (charge.status === "succeeded") {
        m.succeeded_cents += charge.amount - (charge.amount_refunded ?? 0);
        m.refunded_cents += charge.amount_refunded ?? 0;
        if (typeof charge.customer === "string") m.customers.add(charge.customer);
      }
      pageCount += 1;
      if (pageCount % 500 === 0) process.stdout.write(`  ${pageCount} charges...\r`);
    }
    process.stdout.write("\n");

    topupRows = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
      Month: month,
      Total_Charges: v.count,
      Unique_Customers: v.customers.size,
      Succeeded_USD: c2d(v.succeeded_cents),
      Refunded_USD:  c2d(v.refunded_cents),
      Net_Cash_USD:  c2d(v.succeeded_cents),  // succeeded is already net of refunds
    }));
  }

  await conn.end();

  // ── Output ────────────────────────────────────────────────────────
  const headlineByType  = byTypeMonthRows.reduce((s, r) => s + Number(r.Total_Revenue_USD || 0), 0);
  const headlineByClass = byClassMonthRows.reduce((s, r) => s + Number(r.Total_Revenue_USD || 0), 0);
  const headlineTopups  = topupRows.reduce((s, r) => s + Number(r.Net_Cash_USD || 0), 0);

  if (sheetId) {
    const sheets = await getSheetsClient();
    console.log(`[sheets] writing to spreadsheet ${sheetId}`);
    const generatedAt = new Date().toISOString();

    await writeReadmeTab(sheets, sheetId, "About — Revenue", buildReadme(generatedAt, {
      months: byTypeMonthRows.length,
      totalRevenue: headlineByType,
      stripeIncluded: !!stripe,
      topupTotal: headlineTopups,
    }));

    // Tab 1: by transaction type, with stacked-column chart below
    const byType = await writeTab(
      sheets, sheetId, "Revenue by Type",
      rowsToGrid(byTypeMonthRows),
      `Monthly recognized revenue, split by what was billed\nPulled from packetdb.wallet_transaction. Categories: GPU Hourly Usage (running pods), GPU Deploy Fee (upfront launch charge), Stopped Reservation (paused pods), Storage, Baremetal. See the "About — Revenue" tab.`,
    );
    if (byType.dataEndRow >= byType.dataStartRow) {
      const seriesCols = typeColumns.map((_, i) => 1 + i);  // skip Month
      await addChart(sheets, sheetId, byType.tabSheetId, {
        title: "Monthly Revenue by Type (stacked)",
        chartType: "STACKED_COLUMN",
        headerRow: byType.headerRowIndex,
        dataStartRow: byType.dataStartRow,
        dataEndRow: byType.dataEndRow,
        domainColumnIndex: 0,
        seriesColumnIndices: seriesCols,
        anchorRow: byType.dataEndRow + 3,
        anchorCol: 0,
      });
    }

    // Tab 2: by customer billing class
    const byClass = await writeTab(
      sheets, sheetId, "Revenue by Billing Class",
      rowsToGrid(byClassMonthRows),
      `Monthly revenue grouped by each customer's current billing class\nMonthly / Hourly / Both / Unknown is derived from each customer's pod_metadata.billing_type. NOTE: classification is from the current portfolio, so back-months may misattribute customers who switched plans. Use "Revenue by Type" for the most accurate split.`,
    );
    if (byClass.dataEndRow >= byClass.dataStartRow) {
      await addChart(sheets, sheetId, byClass.tabSheetId, {
        title: "Monthly Revenue by Customer Billing Class (stacked)",
        chartType: "STACKED_COLUMN",
        headerRow: byClass.headerRowIndex,
        dataStartRow: byClass.dataStartRow,
        dataEndRow: byClass.dataEndRow,
        domainColumnIndex: 0,
        seriesColumnIndices: classColumns.map((_, i) => 1 + i),
        anchorRow: byClass.dataEndRow + 3,
        anchorCol: 0,
      });
    }

    // Tab 3: Stripe top-ups (cash collected)
    if (stripe && topupRows.length > 0) {
      const topup = await writeTab(
        sheets, sheetId, "Stripe Top-ups",
        rowsToGrid(topupRows),
        `Cash collected via Stripe by month — top-ups, NOT recognized revenue\nThis is gross inflow. Customers top up their wallet here; recognized revenue happens later as wallet debits (see "Revenue by Type"). Net_Cash = succeeded charges minus refunds.`,
      );
      if (topup.dataEndRow >= topup.dataStartRow) {
        await addChart(sheets, sheetId, topup.tabSheetId, {
          title: "Stripe Cash Collected by Month",
          chartType: "COLUMN",
          headerRow: topup.headerRowIndex,
          dataStartRow: topup.dataStartRow,
          dataEndRow: topup.dataEndRow,
          domainColumnIndex: 0,
          seriesColumnIndices: [3, 5],  // Succeeded_USD, Net_Cash_USD
          anchorRow: topup.dataEndRow + 3,
          anchorCol: 0,
        });
      }
    }

    console.log(`[sheets] done. https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  } else {
    // CSV fallback
    const byTypePath  = resolve(outDir, `revenue-by-type-${today}.csv`);
    const byClassPath = resolve(outDir, `revenue-by-class-${today}.csv`);
    const topupPath   = resolve(outDir, `stripe-topups-${today}.csv`);
    writeFileSync(byTypePath,  rowsToCsv(byTypeMonthRows));
    writeFileSync(byClassPath, rowsToCsv(byClassMonthRows));
    if (topupRows.length) writeFileSync(topupPath, rowsToCsv(topupRows));
    console.log(`Wrote -> ${byTypePath}`);
    console.log(`Wrote -> ${byClassPath}`);
    if (topupRows.length) console.log(`Wrote -> ${topupPath}`);
  }

  console.log("");
  console.log("Headlines:");
  console.log(`  Lifetime billed revenue (wallet debits, gross): $${headlineByType.toFixed(2)}`);
  console.log(`  Lifetime Stripe cash collected:                 $${headlineTopups.toFixed(2)}${stripe ? "" : "  (skipped — pass STRIPE_SECRET_KEY to include)"}`);
  console.log("");
  console.log("Revenue by Type (last 6 months):");
  console.table(byTypeMonthRows.slice(-6));
}

function buildReadme(generatedAt: string, stats: { months: number; totalRevenue: number; stripeIncluded: boolean; topupTotal: number }): string[] {
  return [
    "# Revenue by Month Report",
    "",
    `Generated: ${generatedAt}`,
    `Months covered: ${stats.months}     Lifetime billed: $${stats.totalRevenue.toFixed(2)}`,
    stats.stripeIncluded
      ? `Stripe cash collected (top-ups): $${stats.topupTotal.toFixed(2)}`
      : "Stripe top-ups: SKIPPED (rerun without --skip-stripe to include)",
    "",
    "## Two definitions of 'revenue'",
    "RECOGNIZED revenue = wallet debits (what Packet actually billed customers for compute).",
    "                     This is what \"Revenue by Type\" and \"Revenue by Billing Class\" show.",
    "CASH revenue       = Stripe charges (what customers paid us). This is what \"Stripe Top-ups\"",
    "                     shows. The two diverge because customers top up their wallet in advance",
    "                     and recognized revenue happens gradually as they use it.",
    "",
    "## Revenue by Type tab",
    "One row per calendar month, columns for each wallet_transaction.type:",
    "  GPU Hourly Usage ......... Per-cycle compute billing (every running pod, every 30 min)",
    "  GPU Deploy Fee ........... Upfront charge when a pod is first launched (one-time per deploy)",
    "  Stopped Reservation ...... Paused-pod reservation rate (typically 25% of normal)",
    "  Storage .................. Persistent disk storage",
    "  Baremetal ................ Baremetal compute billing",
    "  Total_Revenue_USD ........ Sum across all columns",
    "Stacked chart at the bottom shows the same data visually.",
    "",
    "## Revenue by Billing Class tab",
    "Same monthly revenue, but grouped by each customer's CURRENT billing class:",
    "  Monthly  ......... Customer's pods are all monthly-billed",
    "  Hourly   ......... Customer's pods are all hourly-billed",
    "  Both     ......... Customer has both monthly and hourly pods",
    "  Unknown  ......... Customer has pods but billing_type is NULL (older data)",
    "  No pods  ......... Customer has wallet activity but no pod_metadata row.",
    "                     Mostly early customers (pre-Mar 2026) whose pod_metadata is missing.",
    "                     This is NOT 'customers who paid but never launched' — it's a data",
    "                     coverage gap. Real customers with real usage, billing class unknown.",
    "",
    "Caveat: classification reflects the customer's CURRENT pod portfolio, not their state",
    "at the time of the charge. If a customer was hourly in Feb and switched to monthly in May,",
    "their Feb charges will be attributed to 'Monthly'. For per-transaction accuracy, use the",
    "\"Revenue by Type\" tab instead.",
    "",
    "## Stripe Top-ups tab",
    "Live from Stripe, every succeeded charge across every customer. Aggregated by month.",
    "  Total_Charges .......... # of charge objects (incl. failed/refunded)",
    "  Unique_Customers ....... # distinct Stripe customers who paid us this month",
    "  Succeeded_USD .......... Sum of charge.amount minus amount_refunded, for succeeded charges",
    "  Refunded_USD ........... Total refunded amount",
    "  Net_Cash_USD ........... = Succeeded_USD (already net of refunds)",
    "",
    "Caveat: in Packet's setup, all charges show up in Stripe as plain charges (no recurring",
    "invoice). So this tab can't distinguish wallet top-ups from monthly-subscription payments",
    "based on Stripe data alone.",
    "",
    "## Data sources",
    "Revenue by Type ............. packetdb.wallet_transaction (Packet's own books)",
    "Revenue by Billing Class .... packetdb.wallet_transaction + packetdb.pod_metadata",
    "Stripe Top-ups .............. Stripe API (live, paginated)",
    "",
    "## Caveats / known issues",
    "- 'Recognized revenue' here doesn't subtract refunds because wallet_transaction doesn't",
    "  track refunds. If a Stripe charge was refunded, the corresponding wallet credit was",
    "  presumably clawed back, but it's not visible in this table.",
    "- Old wallet_transaction rows (early 2026) often have NULL pool_id and integer-style",
    "  subscription_id values, which is why some attribution may degrade for back-months.",
    "- Each run OVERWRITES the tabs. No historical archive in this sheet.",
  ];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
