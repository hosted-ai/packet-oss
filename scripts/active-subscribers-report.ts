#!/usr/bin/env npx tsx
/**
 * Generate the "Active Subscribers" report.
 *
 * Active = HAI pod with latest status in (Running, STOPPED).
 * Failed / DEPROVISIONING_FAILED / Deprovisioned pods are excluded.
 *
 * Source of truth per dimension:
 *   - Pod existence + status: HAI instances + instance_pod_status_histories
 *   - Pool sharing ratio:     HAI gpuaas_pools
 *   - Pod owner (Stripe):     Packet pod_metadata.stripe_customer_id (fallback: HAI team_admin)
 *   - Billing type:           Packet pod_metadata.billing_type
 *   - Signup month:           Packet customer_cache.stripe_created_at (MIN per email)
 *
 * Usage:
 *   pnpm tsx scripts/active-subscribers-report.ts
 *   pnpm tsx scripts/active-subscribers-report.ts --out /tmp/somewhere
 *
 * Connection defaults: local MariaDB via /tmp/mysql.sock as the current OS user.
 * Override with:
 *   --packet-host / --packet-user / --packet-pass / --packet-db
 *   --hai-host    / --hai-user    / --hai-pass    / --hai-db
 *
 * Or set env vars: PACKETDB_HOST, PACKETDB_USER, PACKETDB_PASS, PACKETDB_NAME,
 *                  HAIDB_HOST,    HAIDB_USER,    HAIDB_PASS,    HAIDB_NAME
 *
 * Optional --with-stripe enriches the per-customer CSV with live Stripe data
 * (name, current wallet balance, lifetime revenue). Needs STRIPE_SECRET_KEY in
 * .env.local. Adds ~5-30s depending on customer count.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import mysql from "mysql2/promise";
import Stripe from "stripe";
import { getSheetsClient, parseSheetId, writeTab, writeReadmeTab, rowsToGrid } from "./lib/sheets-client";

// ── Load .env.local (best-effort) ─────────────────────────────────────
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

// ── Args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return dflt;
}

const today = new Date().toISOString().slice(0, 10);
const outDir = arg("out", "/tmp/packet-subscribers")!;
const withStripe = args.includes("--with-stripe");
const sheetArg = arg("sheet-id") ?? arg("sheet-url");
const sheetId = sheetArg ? parseSheetId(sheetArg) : null;
mkdirSync(outDir, { recursive: true });

if (withStripe && !process.env.STRIPE_SECRET_KEY) {
  console.error("--with-stripe requires STRIPE_SECRET_KEY in .env.local");
  process.exit(1);
}
const stripe = withStripe ? new Stripe(process.env.STRIPE_SECRET_KEY!) : null;

// ── DB connection configs ─────────────────────────────────────────────
const packetCfg: mysql.ConnectionOptions = {
  host:     arg("packet-host", process.env.PACKETDB_HOST),
  user:     arg("packet-user", process.env.PACKETDB_USER || process.env.USER),
  password: arg("packet-pass", process.env.PACKETDB_PASS),
  database: arg("packet-db",   process.env.PACKETDB_NAME || "packetdb"),
  socketPath: (arg("packet-host", process.env.PACKETDB_HOST) ? undefined : "/tmp/mysql.sock"),
  multipleStatements: true,
};
const haiCfg: mysql.ConnectionOptions = {
  host:     arg("hai-host", process.env.HAIDB_HOST),
  user:     arg("hai-user", process.env.HAIDB_USER || process.env.USER),
  password: arg("hai-pass", process.env.HAIDB_PASS),
  database: arg("hai-db",   process.env.HAIDB_NAME || "hai_user_panel"),
  socketPath: (arg("hai-host", process.env.HAIDB_HOST) ? undefined : "/tmp/mysql.sock"),
};

// ── Shared CTE block (the query body that every output uses) ──────────
// MariaDB cross-database joins need explicit COLLATE on string compares.
const COMMON_CTES = /* sql */ `
WITH latest_status AS (
  SELECT worker_id COLLATE utf8mb4_unicode_ci AS instance_id, status,
         ROW_NUMBER() OVER (PARTITION BY worker_id ORDER BY created_at DESC) AS rn
  FROM hai_user_panel.instance_pod_status_histories
),
active_pods AS (
  SELECT i.id COLLATE utf8mb4_unicode_ci AS instance_id, i.name AS pod_name,
         i.team_id COLLATE utf8mb4_unicode_ci AS team_id, i.created_at AS pod_created,
         ls.status AS pod_status,
         ipm.pool_id, p.pool_name COLLATE utf8mb4_unicode_ci AS pool_name,
         p.sharing_ratio,
         p.security_level COLLATE utf8mb4_unicode_ci AS pool_security,
         p.gpu_model_type COLLATE utf8mb4_unicode_ci AS gpu_model_type
  FROM hai_user_panel.instances i
  JOIN latest_status ls
    ON ls.instance_id = i.id COLLATE utf8mb4_unicode_ci
   AND ls.rn = 1
   AND ls.status IN ('Running','STOPPED')
  LEFT JOIN hai_user_panel.instance_pod_metadata ipm ON ipm.instance_id = i.id
  LEFT JOIN hai_user_panel.gpuaas_pools p ON p.id = ipm.pool_id
  WHERE i.deleted_at IS NULL AND i.nature = 'pod'
),
team_admin AS (
  SELECT ut.team_id COLLATE utf8mb4_unicode_ci AS team_id,
         u.email COLLATE utf8mb4_unicode_ci AS email,
         ROW_NUMBER() OVER (PARTITION BY ut.team_id ORDER BY ut.joined_at, ut.created_at) AS rn
  FROM hai_user_panel.user_teams ut
  JOIN hai_user_panel.users u ON u.id = ut.user_id
  WHERE ut.role_id = '1cd64174-ff8c-4054-97ad-a799fe1740ab'  /* team_admin */
    AND ut.status = 'active'
),
team_anyone AS (
  SELECT ut.team_id COLLATE utf8mb4_unicode_ci AS team_id,
         u.email COLLATE utf8mb4_unicode_ci AS email,
         ROW_NUMBER() OVER (PARTITION BY ut.team_id ORDER BY ut.joined_at, ut.created_at) AS rn
  FROM hai_user_panel.user_teams ut
  JOIN hai_user_panel.users u ON u.id = ut.user_id
  WHERE ut.status = 'active'
),
packet_owner AS (
  SELECT pm.instance_id COLLATE utf8mb4_unicode_ci AS instance_id,
         pm.billing_type,
         pm.stripe_customer_id,
         cc.email COLLATE utf8mb4_unicode_ci AS email,
         gp.name AS product_name
  FROM packetdb.pod_metadata pm
  LEFT JOIN packetdb.customer_cache cc ON cc.id = pm.stripe_customer_id
  LEFT JOIN packetdb.gpu_product gp ON gp.id = pm.product_id
),
resolved AS (
  SELECT ap.*,
    COALESCE(po.email, ta.email, tx.email) AS owner_email,
    CASE
      WHEN po.email IS NOT NULL THEN 'packet'
      WHEN ta.email IS NOT NULL THEN 'hai_admin'
      WHEN tx.email IS NOT NULL THEN 'hai_member'
      ELSE 'unknown'
    END AS owner_source,
    po.billing_type, po.product_name
  FROM active_pods ap
  LEFT JOIN packet_owner po ON po.instance_id = ap.instance_id
  LEFT JOIN team_admin   ta ON ta.team_id = ap.team_id AND ta.rn = 1
  LEFT JOIN team_anyone  tx ON tx.team_id = ap.team_id AND tx.rn = 1
),
signup AS (
  SELECT email COLLATE utf8mb4_unicode_ci AS email, MIN(stripe_created_at) AS signup
  FROM packetdb.customer_cache
  GROUP BY email
),
final AS (
  SELECT r.*, s.signup,
    CASE
      WHEN r.owner_email IS NULL THEN 'orphan/internal'
      WHEN r.owner_email LIKE '%@hosted.ai' THEN 'internal'
      ELSE 'customer'
    END AS owner_class
  FROM resolved r
  LEFT JOIN signup s ON s.email = r.owner_email
)
`;

const PER_POD_SQL = /* sql */ `
${COMMON_CTES}
SELECT
  COALESCE(owner_email, '')           AS Owner_Email,
  DATE_FORMAT(signup, '%Y-%m')        AS Signup_Month,
  DATE_FORMAT(signup, '%M %Y')        AS Signup_Month_Label,
  owner_class                         AS Owner_Class,
  owner_source                        AS Owner_Source,
  instance_id                         AS Instance_ID,
  pod_name                            AS Pod_Name,
  pod_status                          AS Pod_Status,
  pod_created                         AS Pod_Created,
  COALESCE(billing_type, '')          AS Billing_Type,
  COALESCE(product_name, '')          AS Packet_Product,
  COALESCE(CAST(pool_id AS CHAR), '') AS Pool_ID,
  COALESCE(pool_name, '')             AS Pool_Name,
  COALESCE(CAST(sharing_ratio AS CHAR), '') AS Sharing_Ratio,
  COALESCE(pool_security, '')         AS Security_Level,
  COALESCE(gpu_model_type, '')        AS GPU_Model,
  CASE
    WHEN sharing_ratio = 1 THEN 'Dedicated'
    WHEN sharing_ratio > 1 THEN CONCAT('Dynamic (', sharing_ratio, ':1)')
    ELSE 'Unknown'
  END AS Provisioning
FROM final
ORDER BY signup, owner_email, pod_created;
`;

const PER_CUSTOMER_SQL = /* sql */ `
${COMMON_CTES}
SELECT
  owner_email                              AS Email,
  DATE_FORMAT(signup, '%Y-%m')             AS Signup_Month,
  DATE_FORMAT(signup, '%M %Y')             AS Signup_Month_Label,
  owner_class                              AS Owner_Class,
  COUNT(*)                                 AS Active_Pods,
  SUM(pod_status = 'Running')              AS Running_Pods,
  SUM(pod_status = 'STOPPED')              AS Stopped_Pods,
  SUM(billing_type = 'monthly')            AS Monthly_Pods,
  SUM(billing_type = 'hourly')             AS Hourly_Pods,
  SUM(billing_type IS NULL)                AS Untracked_Pods,
  SUM(sharing_ratio = 1)                   AS Dedicated_Pods,
  SUM(sharing_ratio = 2)                   AS Shared_2to1_Pods,
  SUM(sharing_ratio = 3)                   AS Shared_3to1_Pods,
  CASE
    WHEN SUM(billing_type='monthly') > 0 AND SUM(billing_type='hourly') > 0 THEN 'Both'
    WHEN SUM(billing_type='monthly') > 0 THEN 'Monthly'
    WHEN SUM(billing_type='hourly')  > 0 THEN 'Hourly'
    ELSE 'Unknown'
  END AS Billing_Mix,
  CASE
    WHEN SUM(sharing_ratio=1) > 0 AND SUM(sharing_ratio>1) > 0 THEN 'Mixed'
    WHEN SUM(sharing_ratio=1) > 0 THEN 'Dedicated'
    WHEN SUM(sharing_ratio>1) > 0 THEN 'Dynamic/Shared'
    ELSE 'Unknown'
  END AS Provisioning_Mix,
  CASE
    WHEN SUM(pod_status='Running') = 0 THEN 'All pods stopped'
    WHEN SUM(pod_status='STOPPED') > 0
      THEN CONCAT(SUM(pod_status='Running'),' running, ',SUM(pod_status='STOPPED'),' stopped')
    ELSE 'All running'
  END AS Status_Note
FROM final
WHERE owner_email IS NOT NULL
GROUP BY owner_email, signup, owner_class
ORDER BY signup, owner_email;
`;

const SUMMARY_SQL = /* sql */ `
${COMMON_CTES}
, per_customer AS (
  SELECT owner_email, signup,
    MAX(billing_type='monthly') AS hm,
    MAX(billing_type='hourly')  AS hh,
    MAX(sharing_ratio=1) AS hd,
    MAX(sharing_ratio=2) AS h2,
    MAX(sharing_ratio=3) AS h3,
    MAX(pod_status='Running') AS h_run,
    MAX(pod_status='STOPPED') AS h_stop
  FROM final
  WHERE owner_class = 'customer'
  GROUP BY owner_email, signup
)
SELECT
  DATE_FORMAT(signup, '%Y-%m')                                          AS Signup_Month,
  DATE_FORMAT(signup, '%M %Y')                                          AS Month_Label,
  COUNT(*)                                                              AS Active_Subscribers,
  SUM(COALESCE(h_run,0))                                                AS Has_Running_Pod,
  SUM(COALESCE(h_stop,0) AND NOT COALESCE(h_run,0))                     AS Only_Stopped_Pods,
  SUM(COALESCE(hm,0))                                                   AS Monthly_Customers,
  SUM(COALESCE(hh,0))                                                   AS Hourly_Customers,
  SUM(COALESCE(hm,0) AND COALESCE(hh,0))                                AS Has_Both,
  SUM(COALESCE(hd,0))                                                   AS Dedicated_Customers,
  SUM(COALESCE(h2,0))                                                   AS Shared_2to1_Customers,
  SUM(COALESCE(h3,0))                                                   AS Shared_3to1_Customers
FROM per_customer
GROUP BY Signup_Month, Month_Label
ORDER BY Signup_Month;
`;

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

// ── Stripe enrichment (optional) ──────────────────────────────────────
// One owner_email can have multiple Stripe customer rows in customer_cache
// (signup duplicates). We sum across all of them to get the full picture.
type StripeAgg = { name: string; balanceCents: number; lifetimeRevenueCents: number };

async function fetchStripeForEmail(
  s: Stripe,
  customerIds: string[],
): Promise<StripeAgg> {
  const agg: StripeAgg = { name: "", balanceCents: 0, lifetimeRevenueCents: 0 };
  for (const id of customerIds) {
    try {
      const customer = await s.customers.retrieve(id);
      if ("deleted" in customer && customer.deleted) continue;
      const c = customer as Stripe.Customer;
      if (!agg.name && c.name) agg.name = c.name;
      agg.balanceCents += c.balance ?? 0;
      for await (const charge of s.charges.list({ customer: id, limit: 100 })) {
        if (charge.status === "succeeded" && !charge.refunded) {
          agg.lifetimeRevenueCents += charge.amount - (charge.amount_refunded ?? 0);
        }
      }
    } catch (err) {
      console.warn(`  ! Stripe lookup failed for ${id}: ${(err as Error).message}`);
    }
  }
  return agg;
}

async function enrichWithStripe(
  conn: mysql.Connection,
  s: Stripe,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) return rows;

  // Email -> all stripe customer IDs that match
  const emails = rows.map((r) => String(r.Email));
  const [idRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT email, id FROM packetdb.customer_cache WHERE email IN (?)`,
    [emails],
  );
  const idsByEmail = new Map<string, string[]>();
  for (const r of idRows as Array<{ email: string; id: string }>) {
    if (!idsByEmail.has(r.email)) idsByEmail.set(r.email, []);
    idsByEmail.get(r.email)!.push(r.id);
  }

  // Fetch with limited concurrency to keep Stripe happy
  const CONCURRENCY = 6;
  const enriched: Array<Record<string, unknown>> = [];
  console.log(`[stripe] enriching ${rows.length} customers (concurrency ${CONCURRENCY})...`);
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (row) => {
        const ids = idsByEmail.get(String(row.Email)) ?? [];
        const agg = await fetchStripeForEmail(s, ids);
        return {
          ...row,
          Stripe_Customer_IDs: ids.join("|"),
          Stripe_Name: agg.name,
          Wallet_Balance_USD: (Math.abs(Math.min(0, agg.balanceCents)) / 100).toFixed(2),
          Lifetime_Revenue_USD: (agg.lifetimeRevenueCents / 100).toFixed(2),
        };
      }),
    );
    enriched.push(...results);
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}\r`);
  }
  process.stdout.write("\n");
  return enriched;
}

// ── README content for the Google Sheet ───────────────────────────────
function buildActiveSubscribersReadme(
  generatedAt: string,
  stats: { withStripe: boolean; podCount: number; customerCount: number },
): string[] {
  return [
    "# Active Subscribers Report",
    "",
    `Generated: ${generatedAt}`,
    `Pods this run: ${stats.podCount}     Customers this run: ${stats.customerCount}`,
    stats.withStripe ? "Stripe enrichment: ON (Wallet_Balance and Lifetime_Revenue are live)" : "Stripe enrichment: OFF (no live Stripe lookup this run)",
    "",
    "## What counts as 'active'",
    "An active pod = an HAI instance with latest status in {Running, STOPPED}.",
    "Failed / DEPROVISIONING_FAILED / deprovisioned pods are deliberately excluded.",
    "Stopped pods are kept because the customer is still paying reservation rate.",
    "",
    "## Data sources by dimension",
    "Pod existence + status .... HAI: instances + instance_pod_status_histories (latest row per pod)",
    "Pool sharing ratio ........ HAI: gpuaas_pools.sharing_ratio (1 = Dedicated, >1 = Dynamic N:1)",
    "Pod owner (Stripe payer) .. Packet: pod_metadata.stripe_customer_id (fallback: HAI team_admin)",
    "Billing type (mo / hr) .... Packet: pod_metadata.billing_type",
    "Signup month .............. Packet: MIN(customer_cache.stripe_created_at) per email",
    "",
    "## Tabs in this sheet",
    "Summary ......... One row per Stripe-signup month. # active subscribers, billing mix, pool mix.",
    "Per Customer .... One row per customer with all their flags + a free-text Status_Note.",
    "Per Pod ......... One row per active pod with full attribution.",
    "",
    "## Summary tab — column dictionary",
    "Signup_Month .............. Calendar month the customer's Stripe account was created (YYYY-MM)",
    "Active_Subscribers ........ # distinct customers in that signup cohort still active today",
    "Has_Running_Pod ........... Subset with at least one Running pod",
    "Only_Stopped_Pods ......... Subset whose pods are all in Stopped state (still paying reservation)",
    "Monthly_Customers ......... # with at least one monthly-billed pod",
    "Hourly_Customers .......... # with at least one hourly-billed pod",
    "Has_Both .................. # who have both monthly AND hourly pods at the same time",
    "Dedicated_Customers ....... # with at least one pod on a sharing_ratio=1 pool",
    "Shared_2to1_Customers ..... # with at least one pod on a sharing_ratio=2 pool",
    "Shared_3to1_Customers ..... # with at least one pod on a sharing_ratio=3 pool",
    "",
    "## Per Customer tab — column dictionary",
    "Email .................... Customer's Stripe email",
    "Signup_Month ............. YYYY-MM (from Stripe customer.created)",
    "Owner_Class .............. 'customer' (real), 'internal' (@hosted.ai), or 'orphan/internal' (no team)",
    "Active_Pods .............. Count of their currently-active pods",
    "Running_Pods / Stopped_Pods .. Split by latest HAI status",
    "Monthly_Pods / Hourly_Pods ... Split by Packet billing_type",
    "Untracked_Pods ........... Pods in HAI but not in packet.pod_metadata (direct-HAI / marketplace)",
    "Dedicated_Pods ........... Pods on sharing_ratio=1 pools",
    "Shared_2to1_Pods / 3to1 ... Pods on sharing_ratio 2 or 3 pools",
    "Billing_Mix .............. 'Monthly' / 'Hourly' / 'Both' / 'Unknown'",
    "Provisioning_Mix ......... 'Dedicated' / 'Dynamic/Shared' / 'Mixed' / 'Unknown'",
    "Status_Note .............. Free-text like 'All running' or '1 running, 2 stopped'",
    ...(stats.withStripe ? [
      "Stripe_Customer_IDs ...... All cus_xxx tied to this email (pipe-separated)",
      "Stripe_Name .............. Display name from Stripe",
      "Wallet_Balance_USD ....... Current wallet credit (Stripe stores negative balance for credit; we flip the sign)",
      "Lifetime_Revenue_USD ..... Sum of all succeeded charges minus refunds across all linked cus_xxx",
    ] : []),
    "",
    "## Per Pod tab — column dictionary",
    "Owner_Email .............. Resolved owner (packet > hai_admin > hai_member fallback)",
    "Owner_Source ............. Which lookup path won: 'packet' / 'hai_admin' / 'hai_member' / 'unknown'",
    "Instance_ID .............. HAI's i-xxx instance ID",
    "Pod_Name ................. Customer-given pod name",
    "Pod_Status ............... 'Running' or 'STOPPED' (others are filtered out)",
    "Pod_Created .............. When the pod was first created in HAI",
    "Billing_Type ............. From Packet's pod_metadata. Blank = direct-HAI pod (not Packet-billed)",
    "Packet_Product ........... GPU product name from Packet's catalog",
    "Pool_ID / Pool_Name ...... HAI's pool",
    "Sharing_Ratio ............ 1 = Dedicated, 2 = 2:1 shared, 3 = 3:1 shared",
    "Security_Level ........... HAI's pool tag (Security / medium / low)",
    "GPU_Model ................ NVIDIA model name from HAI",
    "Provisioning ............. Derived label: 'Dedicated' or 'Dynamic (N:1)'",
    "",
    "## Caveats / known issues",
    "- 'Untracked' pods = a customer has an HAI pod that Packet didn't launch (marketplace / direct-HAI).",
    "  They still count as active subscribers; their billing just isn't on Packet's books.",
    "- Internal hosted.ai employees (@hosted.ai) are filtered out of the Summary tab but stay visible",
    "  in Per Customer / Per Pod with Owner_Class='internal' so you can sanity-check.",
    "- Each run OVERWRITES these tabs. There is no historical archive in this sheet.",
    "- If a column gets renamed or a new flag added, the next run will rewrite headers — anything",
    "  linked from another sheet by column letter may break. Linking by column name is safer.",
  ];
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`[report] connecting to packetdb @ ${packetCfg.host ?? packetCfg.socketPath}`);
  console.log(`[report] connecting to hai_user_panel @ ${haiCfg.host ?? haiCfg.socketPath}`);

  // We only need one connection — both DBs are on the same MariaDB instance.
  // We use the packet connection because every query qualifies tables with the schema name.
  const conn = await mysql.createConnection(packetCfg);

  // Sanity check: confirm we can see both schemas.
  try {
    const [check] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT
        (SELECT COUNT(*) FROM hai_user_panel.instances) AS hai_ok,
        (SELECT COUNT(*) FROM packetdb.customer_cache) AS packet_ok
    `);
    const row = (check as mysql.RowDataPacket[])[0] as { hai_ok: number; packet_ok: number };
    console.log(`[report] hai_user_panel.instances rows: ${row.hai_ok}`);
    console.log(`[report] packetdb.customer_cache rows: ${row.packet_ok}`);
  } catch (e) {
    console.error("[report] couldn't reach both DBs. Either the DB user lacks SELECT on one,");
    console.error("[report] or one of the schemas isn't loaded. Original error:");
    console.error((e as Error).message);
    await conn.end();
    process.exit(1);
  }

  const [perPodRows]      = await conn.query<mysql.RowDataPacket[]>(PER_POD_SQL);
  const [perCustomerRows] = await conn.query<mysql.RowDataPacket[]>(PER_CUSTOMER_SQL);
  const [summaryRows]     = await conn.query<mysql.RowDataPacket[]>(SUMMARY_SQL);

  // Optional: enrich per-customer rows with live Stripe data
  let customerOut = perCustomerRows as Array<Record<string, unknown>>;
  if (withStripe && stripe) {
    // Only enrich real customers — skip internal/orphan rows
    const customers = customerOut.filter((r) => r.Owner_Class === "customer");
    const others    = customerOut.filter((r) => r.Owner_Class !== "customer");
    const enriched  = await enrichWithStripe(conn, stripe, customers);
    customerOut = [...enriched, ...others];
  }

  if (sheetId) {
    // Sheet output: write README + 3 tabs, skip CSVs
    const sheets = await getSheetsClient();
    console.log(`[sheets] writing to spreadsheet ${sheetId}`);

    const generatedAt = new Date().toISOString();
    await writeReadmeTab(sheets, sheetId, "About", buildActiveSubscribersReadme(generatedAt, {
      withStripe,
      podCount: perPodRows.length,
      customerCount: customerOut.length,
    }));
    await writeTab(sheets, sheetId, "Summary",
      rowsToGrid(summaryRows as Record<string, unknown>[]),
      `Active subscribers, grouped by Stripe signup month\nOne row per signup month. Counts are # of unique customers. A customer with both monthly and hourly pods is counted in BOTH columns plus once in "Has_Both". See the "About" tab for the column dictionary and methodology.`);
    await writeTab(sheets, sheetId, "Per Customer",
      rowsToGrid(customerOut),
      `One row per active customer\nFlags show whether the customer has any monthly/hourly pod, any dedicated/shared pod, plus a free-text Status_Note (e.g. "1 running, 2 stopped"). Internal hosted.ai employees are flagged via Owner_Class. See the "About" tab for column meanings.`);
    await writeTab(sheets, sheetId, "Per Pod",
      rowsToGrid(perPodRows as Record<string, unknown>[]),
      `One row per active pod (Running or Stopped)\nFailed / DEPROVISIONING_FAILED zombie pods are excluded. Each row is a single pod with its owner, billing, pool, and sharing ratio. See the "About" tab for column meanings.`);
    console.log(`[sheets] done. https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  } else {
    // No sheet → write CSVs locally
    const detailPath   = resolve(outDir, `active-pods-detail-${today}.csv`);
    const customerPath = resolve(outDir, `active-subscribers-per-customer-${today}.csv`);
    const summaryPath  = resolve(outDir, `active-subscribers-summary-by-month-${today}.csv`);

    writeFileSync(detailPath,   rowsToCsv(perPodRows as Record<string, unknown>[]));
    writeFileSync(customerPath, rowsToCsv(customerOut));
    writeFileSync(summaryPath,  rowsToCsv(summaryRows as Record<string, unknown>[]));

    console.log("");
    console.log(`Wrote ${perPodRows.length} pod rows   -> ${detailPath}`);
    console.log(`Wrote ${perCustomerRows.length} customer rows -> ${customerPath}`);
    console.log(`Wrote ${summaryRows.length} month rows    -> ${summaryPath}`);
  }

  await conn.end();
  console.log("");
  console.log("Summary by signup month:");
  console.table(summaryRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
