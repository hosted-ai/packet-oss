#!/usr/bin/env npx tsx
/**
 * Generate the "All Paying Customers" report.
 *
 * Cohort: anyone who has at least one succeeded charge in Stripe across all
 * their linked customer IDs (the dup case is handled — one email can have
 * multiple cus_xxx, we sum across them).
 *
 * Each customer row covers:
 *   - Stripe identity: name, emails, all customer IDs, signup date
 *   - Revenue split: monthly-subscription revenue vs wallet top-up revenue
 *     vs refunds vs net. The split comes from Stripe charges where
 *     `charge.invoice` set => subscription, unset => wallet top-up.
 *   - Current wallet balance (live from Stripe)
 *   - Charge metrics: count, first charge date, last charge date
 *   - Lifetime pod history from packet_db.pod_metadata:
 *       has-ever-used-monthly, has-ever-used-hourly,
 *       has-ever-used-dedicated, has-ever-used-dynamic, lifetime pod count
 *   - Current state: do they have a running/stopped pod in HAI right now
 *     (Active) or are they a churned former customer (Churned)
 *
 * Usage:
 *   pnpm tsx scripts/paying-customers-report.ts
 *   pnpm tsx scripts/paying-customers-report.ts --out /tmp/wherever
 *   pnpm tsx scripts/paying-customers-report.ts --min-revenue 100  # only $100+
 *   pnpm tsx scripts/paying-customers-report.ts --limit 50         # smoke test
 *
 * Connection defaults: local MariaDB via /tmp/mysql.sock as the current OS user.
 * Override with --packet-host / --packet-user / --packet-pass / --packet-db.
 *
 * Requires STRIPE_SECRET_KEY in .env.local (this is a Stripe-first report).
 *
 * Runtime: ~3-5 minutes for ~1500 customers (Stripe API limits the speed).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import mysql from "mysql2/promise";
import Stripe from "stripe";
import { getSheetsClient, parseSheetId, writeTab, writeReadmeTab, rowsToGrid } from "./lib/sheets-client";

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

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY missing in .env.local");
  process.exit(1);
}

// ── Args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return dflt;
}

const today = new Date().toISOString().slice(0, 10);
const outDir = arg("out", "/tmp/packet-subscribers")!;
const minRevenueDollars = Number(arg("min-revenue", "0"));
const limit = Number(arg("limit", "0"));
const sheetArg = arg("sheet-id") ?? arg("sheet-url");
const sheetId = sheetArg ? parseSheetId(sheetArg) : null;
const tabName = arg("sheet-tab", "Paying Customers")!;
mkdirSync(outDir, { recursive: true });

const packetCfg: mysql.ConnectionOptions = {
  host:     arg("packet-host", process.env.PACKETDB_HOST),
  user:     arg("packet-user", process.env.PACKETDB_USER || process.env.USER),
  password: arg("packet-pass", process.env.PACKETDB_PASS),
  database: arg("packet-db",   process.env.PACKETDB_NAME || "packetdb"),
  socketPath: (arg("packet-host", process.env.PACKETDB_HOST) ? undefined : "/tmp/mysql.sock"),
  multipleStatements: true,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── CSV writer ────────────────────────────────────────────────────────
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n") + "\n";
}

// ── Stripe aggregation per email ──────────────────────────────────────
type StripeAgg = {
  name: string;
  customerIds: string[];
  signupAt: Date | null;
  balanceCents: number;
  subscriptionRevenueCents: number;
  walletTopupRevenueCents: number;
  refundCents: number;
  chargeCount: number;
  firstChargeAt: Date | null;
  lastChargeAt: Date | null;
};

async function fetchStripeForEmail(customerIds: string[]): Promise<StripeAgg> {
  const agg: StripeAgg = {
    name: "",
    customerIds,
    signupAt: null,
    balanceCents: 0,
    subscriptionRevenueCents: 0,
    walletTopupRevenueCents: 0,
    refundCents: 0,
    chargeCount: 0,
    firstChargeAt: null,
    lastChargeAt: null,
  };

  for (const id of customerIds) {
    try {
      const customer = await stripe.customers.retrieve(id);
      if ("deleted" in customer && customer.deleted) continue;
      const c = customer as Stripe.Customer;
      if (!agg.name && c.name) agg.name = c.name;
      agg.balanceCents += c.balance ?? 0;
      const created = new Date((c.created ?? 0) * 1000);
      if (!agg.signupAt || created < agg.signupAt) agg.signupAt = created;

      for await (const charge of stripe.charges.list({ customer: id, limit: 100 })) {
        if (charge.status !== "succeeded") continue;
        agg.chargeCount += 1;
        const chargeDate = new Date(charge.created * 1000);
        if (!agg.firstChargeAt || chargeDate < agg.firstChargeAt) agg.firstChargeAt = chargeDate;
        if (!agg.lastChargeAt || chargeDate > agg.lastChargeAt) agg.lastChargeAt = chargeDate;
        agg.refundCents += charge.amount_refunded ?? 0;
        const net = charge.amount - (charge.amount_refunded ?? 0);
        if (charge.invoice) {
          agg.subscriptionRevenueCents += net;
        } else {
          agg.walletTopupRevenueCents += net;
        }
      }
    } catch (err) {
      console.warn(`  ! Stripe ${id}: ${(err as Error).message}`);
    }
  }

  return agg;
}

// ── README content for the Google Sheet ───────────────────────────────
function buildPayingCustomersReadme(
  generatedAt: string,
  stats: { totalCustomers: number; activeCount: number; churnedCount: number; neverLaunched: number; minRevenueDollars: number },
): string[] {
  return [
    "# Paying Customers Report",
    "",
    `Generated: ${generatedAt}`,
    `Customers this run: ${stats.totalCustomers}`,
    `  Currently Active: ${stats.activeCount}     Churned: ${stats.churnedCount}     Paid but never launched: ${stats.neverLaunched}`,
    stats.minRevenueDollars > 0 ? `Filter: only customers with net revenue >= $${stats.minRevenueDollars}` : "Filter: any customer with at least 1 succeeded charge",
    "",
    "## Cohort definition",
    "Everyone in packetdb.customer_cache whose Stripe account has ≥1 succeeded charge.",
    "If one email has multiple Stripe customer IDs (signup duplicates), we sum across all.",
    "Customers with $0 revenue or no charges are excluded by default.",
    "",
    "## Revenue split",
    "Lifetime_Revenue_USD = Subscription_Revenue_USD + Wallet_Topup_Revenue_USD, minus refunds.",
    "  - Subscription_Revenue = charges where Stripe charge.invoice is set (recurring sub invoices)",
    "  - Wallet_Topup_Revenue = charges where charge.invoice is NULL (one-off wallet credit purchases)",
    "Note: in the current data, subscription revenue is $0 across the board — Packet appears to",
    "       bill monthly subscriptions as plain charges with metadata, not Stripe invoices. So",
    "       'Wallet_Topup_Revenue' is effectively all customer revenue right now.",
    "",
    "## Data sources by dimension",
    "Name / Balance / Charges .... Stripe API (live, fetched each run)",
    "Signup date ................ Earliest Stripe customer.created across all dup IDs for the email",
    "Lifetime pod counts ........ Packet: pod_metadata grouped by stripe_customer_id (lifetime, not just active)",
    "Currently_Active flag ...... HAI: instance with status Running or STOPPED, attributed back to email",
    "",
    "## Column dictionary",
    "Email ........................ Customer's Stripe email (the join key)",
    "Stripe_Name .................. Display name from Stripe (often blank for self-signups)",
    "Signup_Date / Signup_Month ... When their Stripe customer was first created",
    "Stripe_Customer_IDs .......... All cus_xxx IDs tied to this email (pipe-separated, oldest first)",
    "Lifetime_Revenue_USD ......... Net revenue: succeeded charges - refunds, across all cus_xxx",
    "Subscription_Revenue_USD ..... Subset linked to a Stripe invoice (currently always $0, see note above)",
    "Wallet_Topup_Revenue_USD ..... Subset NOT linked to an invoice (i.e., wallet top-ups)",
    "Refund_Total_USD ............. Total refunded amount across all charges",
    "Current_Wallet_Balance_USD ... Live from Stripe customer.balance (flipped sign — Stripe stores credits as negative)",
    "Charge_Count ................. Total # of succeeded charges across all cus_xxx",
    "First_Charge_Date ............ Date of their first succeeded charge",
    "Last_Charge_Date ............. Date of their most recent succeeded charge",
    "Lifetime_Pods ................ All pods Packet has ever recorded for this customer (incl. terminated)",
    "Monthly_Pods_Ever ............ Lifetime count where pod_metadata.billing_type='monthly'",
    "Hourly_Pods_Ever ............. Lifetime count where pod_metadata.billing_type='hourly'",
    "Dedicated_Pods_Ever .......... Lifetime count on sharing_ratio=1 pools",
    "Shared_Pods_Ever ............. Lifetime count on sharing_ratio>1 pools",
    "Billing_History .............. Roll-up: 'Monthly' / 'Hourly' / 'Both' / 'No pods recorded'",
    "Provisioning_History ......... Roll-up: 'Dedicated only' / 'Dynamic only' / 'Both' / 'No pods recorded'",
    "Currently_Active ............. yes/no — has at least one Running or STOPPED pod in HAI right now",
    "Status ....................... 'Active' / 'Churned' / 'Paid but never launched'",
    "",
    "## Status meanings",
    "Active ..................... Has a Running or STOPPED pod in HAI right now",
    "Churned .................... Has launched pods historically (Lifetime_Pods > 0), but none active now",
    "Paid but never launched .... Topped up wallet (or paid for something) but never deployed a pod",
    "                              These are the most interesting cohort — they're warm leads who",
    "                              gave us money but didn't get to value. Worth a follow-up.",
    "",
    "## Caveats / known issues",
    "- This script makes one Stripe API call per email. ~3-5 minutes for ~1500 customers.",
    "  If Stripe rate-limits, the run continues with warnings printed per-failed ID.",
    "- Deleted Stripe customers are skipped silently.",
    "- 'Lifetime_Pods' counts everything in packet.pod_metadata including failed/refunded pods.",
    "- 'Currently_Active' uses the same definition as the Active Subscribers report (Running OR Stopped).",
    "- Each run OVERWRITES this tab.",
  ];
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[report] connecting to packetdb @ ${packetCfg.host ?? packetCfg.socketPath}`);
  const conn = await mysql.createConnection(packetCfg);

  // 1. Pull email -> [stripe customer IDs] from customer_cache. One row per email
  //    even if multiple Stripe customers exist for the same email.
  const [emailRows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT email,
           GROUP_CONCAT(id ORDER BY stripe_created_at ASC SEPARATOR '|') AS ids
    FROM packetdb.customer_cache
    WHERE email IS NOT NULL AND email != ''
    GROUP BY email
    ORDER BY MIN(stripe_created_at)
  `);
  let emails = (emailRows as Array<{ email: string; ids: string }>).map((r) => ({
    email: r.email,
    ids: r.ids.split("|"),
  }));
  if (limit > 0) emails = emails.slice(0, limit);
  console.log(`[report] ${emails.length} unique emails in customer_cache`);

  // 2. Pull lifetime pod history per Stripe customer ID, joined with pool
  //    sharing ratio so we can flag dedicated vs dynamic usage.
  const [podHistRows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT pm.stripe_customer_id AS cus_id,
           SUM(pm.billing_type = 'monthly') AS monthly_pods,
           SUM(pm.billing_type = 'hourly')  AS hourly_pods,
           SUM(p.sharing_ratio = 1)         AS dedicated_pods,
           SUM(p.sharing_ratio > 1)         AS shared_pods,
           COUNT(*)                         AS lifetime_pods
    FROM packetdb.pod_metadata pm
    LEFT JOIN hai_user_panel.gpuaas_pools p ON p.id = pm.pool_id
    GROUP BY pm.stripe_customer_id
  `);
  type PodHist = {
    monthly_pods: number; hourly_pods: number;
    dedicated_pods: number; shared_pods: number; lifetime_pods: number;
  };
  const podHistByCus = new Map<string, PodHist>();
  for (const r of podHistRows as Array<PodHist & { cus_id: string }>) {
    podHistByCus.set(r.cus_id, {
      monthly_pods: Number(r.monthly_pods),
      hourly_pods: Number(r.hourly_pods),
      dedicated_pods: Number(r.dedicated_pods),
      shared_pods: Number(r.shared_pods),
      lifetime_pods: Number(r.lifetime_pods),
    });
  }

  // 3. Currently active emails (has Running or STOPPED HAI pod), resolved
  //    through packet's pod_metadata so we attribute to the Stripe payer.
  const [activeRows] = await conn.query<mysql.RowDataPacket[]>(`
    WITH latest_status AS (
      SELECT worker_id COLLATE utf8mb4_unicode_ci AS instance_id, status,
             ROW_NUMBER() OVER (PARTITION BY worker_id ORDER BY created_at DESC) AS rn
      FROM hai_user_panel.instance_pod_status_histories
    )
    SELECT DISTINCT cc.email
    FROM hai_user_panel.instances i
    JOIN latest_status ls ON ls.instance_id = i.id COLLATE utf8mb4_unicode_ci
                          AND ls.rn = 1 AND ls.status IN ('Running','STOPPED')
    JOIN packetdb.pod_metadata pm ON pm.instance_id COLLATE utf8mb4_unicode_ci = i.id COLLATE utf8mb4_unicode_ci
    JOIN packetdb.customer_cache cc ON cc.id = pm.stripe_customer_id
    WHERE i.deleted_at IS NULL AND i.nature = 'pod'
  `);
  const activeEmails = new Set((activeRows as Array<{ email: string }>).map((r) => r.email));
  console.log(`[report] ${activeEmails.size} emails currently have active pods`);

  // 4. Fetch Stripe for every email (concurrency limited)
  console.log(`[stripe] fetching for ${emails.length} emails (concurrency 6)...`);
  const CONCURRENCY = 6;
  type Enriched = { email: string; agg: StripeAgg };
  const results: Enriched[] = [];
  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const batch = emails.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ email, ids }) => ({
        email,
        agg: await fetchStripeForEmail(ids),
      })),
    );
    results.push(...batchResults);
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, emails.length)}/${emails.length}\r`);
  }
  process.stdout.write("\n");

  // 5. Filter to "has ever paid" (≥ 1 succeeded charge, optional minimum) and build the CSV rows
  const minRevenueCents = Math.round(minRevenueDollars * 100);
  const rows: Array<Record<string, unknown>> = [];
  for (const { email, agg } of results) {
    if (agg.chargeCount === 0) continue;
    const totalNet = agg.subscriptionRevenueCents + agg.walletTopupRevenueCents;
    if (totalNet < minRevenueCents) continue;

    // Aggregate pod history across all the dup Stripe IDs for this email
    const podSum: PodHist = {
      monthly_pods: 0, hourly_pods: 0,
      dedicated_pods: 0, shared_pods: 0, lifetime_pods: 0,
    };
    for (const id of agg.customerIds) {
      const h = podHistByCus.get(id);
      if (!h) continue;
      podSum.monthly_pods += h.monthly_pods;
      podSum.hourly_pods += h.hourly_pods;
      podSum.dedicated_pods += h.dedicated_pods;
      podSum.shared_pods += h.shared_pods;
      podSum.lifetime_pods += h.lifetime_pods;
    }

    const isActive = activeEmails.has(email);
    const billingHistory =
      podSum.monthly_pods > 0 && podSum.hourly_pods > 0 ? "Both" :
      podSum.monthly_pods > 0 ? "Monthly" :
      podSum.hourly_pods > 0  ? "Hourly" :
      "No pods recorded";
    const provisioningHistory =
      podSum.dedicated_pods > 0 && podSum.shared_pods > 0 ? "Both" :
      podSum.dedicated_pods > 0 ? "Dedicated only" :
      podSum.shared_pods > 0    ? "Dynamic only" :
      "No pods recorded";

    rows.push({
      Email: email,
      Stripe_Name: agg.name,
      Signup_Date: agg.signupAt?.toISOString().slice(0, 10) ?? "",
      Signup_Month: agg.signupAt ? agg.signupAt.toISOString().slice(0, 7) : "",
      Stripe_Customer_IDs: agg.customerIds.join("|"),
      Lifetime_Revenue_USD: (totalNet / 100).toFixed(2),
      Subscription_Revenue_USD: (agg.subscriptionRevenueCents / 100).toFixed(2),
      Wallet_Topup_Revenue_USD: (agg.walletTopupRevenueCents / 100).toFixed(2),
      Refund_Total_USD: (agg.refundCents / 100).toFixed(2),
      Current_Wallet_Balance_USD: (Math.abs(Math.min(0, agg.balanceCents)) / 100).toFixed(2),
      Charge_Count: agg.chargeCount,
      First_Charge_Date: agg.firstChargeAt?.toISOString().slice(0, 10) ?? "",
      Last_Charge_Date: agg.lastChargeAt?.toISOString().slice(0, 10) ?? "",
      Lifetime_Pods: podSum.lifetime_pods,
      Monthly_Pods_Ever: podSum.monthly_pods,
      Hourly_Pods_Ever: podSum.hourly_pods,
      Dedicated_Pods_Ever: podSum.dedicated_pods,
      Shared_Pods_Ever: podSum.shared_pods,
      Billing_History: billingHistory,
      Provisioning_History: provisioningHistory,
      Currently_Active: isActive ? "yes" : "no",
      Status: isActive ? "Active" : (podSum.lifetime_pods > 0 ? "Churned" : "Paid but never launched"),
    });
  }

  // Sort by lifetime revenue descending (biggest spenders first)
  rows.sort((a, b) => Number(b.Lifetime_Revenue_USD) - Number(a.Lifetime_Revenue_USD));

  if (sheetId) {
    const sheets = await getSheetsClient();
    console.log(`[sheets] writing tab "${tabName}" to spreadsheet ${sheetId}`);

    const generatedAt = new Date().toISOString();
    const aboutTab = arg("about-tab", "About — Paying Customers")!;
    await writeReadmeTab(sheets, sheetId, aboutTab, buildPayingCustomersReadme(generatedAt, {
      totalCustomers: rows.length,
      activeCount: rows.filter((r) => r.Currently_Active === "yes").length,
      churnedCount: rows.filter((r) => r.Status === "Churned").length,
      neverLaunched: rows.filter((r) => r.Status === "Paid but never launched").length,
      minRevenueDollars,
    }));
    await writeTab(sheets, sheetId, tabName, rowsToGrid(rows),
      `Every customer who has ever paid Packet (≥1 succeeded Stripe charge)\nOne row per unique email, summed across duplicate Stripe customer IDs. Sorted by Lifetime_Revenue_USD descending. See the "${aboutTab}" tab for the column dictionary and methodology.`);
    console.log(`[sheets] done. https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  } else {
    const outPath = resolve(outDir, `paying-customers-${today}.csv`);
    writeFileSync(outPath, rowsToCsv(rows));
    console.log(`Wrote ${rows.length} paying customer rows -> ${outPath}`);
  }
  await conn.end();

  // ── Summary stats to stdout ────────────────────────────────────────
  const totalRevenue = rows.reduce((s, r) => s + Number(r.Lifetime_Revenue_USD), 0);
  const totalSubRev  = rows.reduce((s, r) => s + Number(r.Subscription_Revenue_USD), 0);
  const totalWalletRev = rows.reduce((s, r) => s + Number(r.Wallet_Topup_Revenue_USD), 0);
  const totalRefund  = rows.reduce((s, r) => s + Number(r.Refund_Total_USD), 0);
  const activeCount  = rows.filter((r) => r.Currently_Active === "yes").length;
  const churnedCount = rows.filter((r) => r.Status === "Churned").length;
  const neverLaunched = rows.filter((r) => r.Status === "Paid but never launched").length;

  console.log("");
  console.log("Headline numbers:");
  console.log(`  Lifetime revenue (net):       $${totalRevenue.toFixed(2)}`);
  console.log(`    of which subscription:      $${totalSubRev.toFixed(2)}`);
  console.log(`    of which wallet top-ups:    $${totalWalletRev.toFixed(2)}`);
  console.log(`  Lifetime refunds:             $${totalRefund.toFixed(2)}`);
  console.log("");
  console.log(`  Paying customers total:       ${rows.length}`);
  console.log(`    currently active:           ${activeCount}`);
  console.log(`    churned (had pods, now 0):  ${churnedCount}`);
  console.log(`    paid but never launched:    ${neverLaunched}`);
  console.log("");
  console.log("Top 10 by revenue:");
  console.table(
    rows.slice(0, 10).map((r) => ({
      Email: r.Email,
      Revenue: r.Lifetime_Revenue_USD,
      Sub: r.Subscription_Revenue_USD,
      Wallet: r.Wallet_Topup_Revenue_USD,
      Status: r.Status,
    })),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
