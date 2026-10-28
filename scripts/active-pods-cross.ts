import { readFileSync } from "fs";
import mysql from "mysql2/promise";
import Stripe from "stripe";

const envPath = "/Users/codewave/Desktop/projects/HostedAI/packet/.env.local";
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Two DB connections:
//   - packetdb via packetai/TCP
//   - hai_user_panel via OS-user socket (no grants on packetdb user)
const m = process.env.DATABASE_URL!.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(\w+)/)!;
const [, packetUser, packetPass, packetHost, packetPort] = m;

async function listAllSubs(status: Stripe.SubscriptionListParams.Status) {
  const out: Stripe.Subscription[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({ status, limit: 100, starting_after: cursor });
    out.push(...page.data);
    if (!page.has_more) break;
    cursor = page.data[page.data.length - 1].id;
  }
  return out;
}

function mrrCentsFromSubs(subs: Stripe.Subscription[]) {
  let cents = 0;
  for (const s of subs) {
    for (const it of s.items.data) {
      const p = it.price;
      if (!p.unit_amount || !p.recurring) continue;
      const per = p.unit_amount * (it.quantity ?? 1);
      const ic = p.recurring.interval_count ?? 1;
      if (p.recurring.interval === "month") cents += per / ic;
      else if (p.recurring.interval === "year") cents += per / (12 * ic);
      else if (p.recurring.interval === "week") cents += (per * 52) / (12 * ic);
      else if (p.recurring.interval === "day") cents += (per * 30) / ic;
    }
  }
  return cents;
}

async function main() {
  const packet = await mysql.createConnection({
    host: packetHost, port: Number(packetPort), user: packetUser, password: packetPass, database: "packetdb",
  });
  const hai = await mysql.createConnection({
    socketPath: "/tmp/mysql.sock", user: process.env.USER, database: "hai_user_panel",
  });

  // HAI: all live pods (not deleted)
  const [haiPods] = await hai.query<any[]>(
    `SELECT id, name, team_id, created_at FROM instances WHERE deleted_at IS NULL AND nature='pod'`,
  );
  const liveInstanceIds = new Set((haiPods as Array<{ id: string }>).map((r) => r.id));
  const totalActivePods = liveInstanceIds.size;

  // Map instance_id → packet pod_metadata (owner, billing type, sub id)
  const [packetPods] = await packet.query<any[]>(
    `SELECT instance_id, stripe_customer_id, stripe_subscription_id, billing_type
     FROM pod_metadata WHERE instance_id IS NOT NULL`,
  );
  type PM = { instance_id: string; stripe_customer_id: string; stripe_subscription_id: string | null; billing_type: string | null };
  const byInstance = new Map<string, PM>();
  for (const r of packetPods as PM[]) byInstance.set(r.instance_id, r);

  let monthlyPods = 0;
  let hourlyPods = 0;
  let untrackedPods = 0;
  const monthlyCustomers = new Set<string>();
  const hourlyCustomers = new Set<string>();
  for (const iid of liveInstanceIds) {
    const meta = byInstance.get(iid);
    if (!meta) { untrackedPods++; continue; }
    if (meta.billing_type === "monthly") {
      monthlyPods++;
      if (meta.stripe_customer_id) monthlyCustomers.add(meta.stripe_customer_id);
    } else if (meta.billing_type === "hourly") {
      hourlyPods++;
      if (meta.stripe_customer_id) hourlyCustomers.add(meta.stripe_customer_id);
    } else {
      untrackedPods++;
    }
  }

  // Build cus_id → email map (many customers have multiple cus_ids; dedupe by email)
  const [emailMapRows] = await packet.query<any[]>(`SELECT id, email FROM customer_cache`);
  const emailByCusId = new Map<string, string>();
  for (const r of emailMapRows as Array<{ id: string; email: string }>) {
    if (r.email) emailByCusId.set(r.id, r.email.toLowerCase());
  }

  // Stripe subs (manual pagination, robust)
  const activeSubs   = await listAllSubs("active");
  const trialingSubs = await listAllSubs("trialing");
  const pastDueSubs  = await listAllSubs("past_due");
  const liveSubs = [...activeSubs, ...trialingSubs, ...pastDueSubs];

  const liveSubCusIds = new Set(
    liveSubs.map((s) => (typeof s.customer === "string" ? s.customer : s.customer.id)),
  );
  const liveSubEmails = new Set<string>();
  for (const cid of liveSubCusIds) {
    const e = emailByCusId.get(cid);
    if (e) liveSubEmails.add(e);
    else liveSubEmails.add(cid); // unknown → treat as its own bucket
  }
  // Packet bills multiple monthly pods either as (a) line-item qty>1 on a single sub
  // or (b) multiple separate subs across cus_ids for the same email.
  // So "# active monthly subscriptions" = sum of line-item qty across all live subs.
  const subUnits = liveSubs.reduce(
    (acc, s) => acc + s.items.data.reduce((a, it) => a + (it.quantity ?? 1), 0),
    0,
  );

  // Dedupe hourly customers by email too
  const hourlyEmails = new Set<string>();
  for (const cid of hourlyCustomers) {
    const e = emailByCusId.get(cid);
    hourlyEmails.add(e ?? cid);
  }
  const monthlyPodEmails = new Set<string>();
  for (const cid of monthlyCustomers) {
    const e = emailByCusId.get(cid);
    monthlyPodEmails.add(e ?? cid);
  }

  // Total subscribers = customers paying for monthly (Stripe sub) ∪ customers with live hourly pod
  const totalSubscribers = new Set<string>([...liveSubEmails, ...hourlyEmails]);
  const overlap = [...liveSubEmails].filter((e) => hourlyEmails.has(e)).length;
  const mrr = mrrCentsFromSubs(liveSubs);
  const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Lifetime recognized revenue from packetdb wallet_transaction (everything to date)
  const [recRows] = await packet.query<any[]>(`
    SELECT type, SUM(amount_cents) AS cents FROM wallet_transaction
    WHERE amount_cents > 0
      AND type IN ('gpu_usage','gpu_deploy','stopped_reservation','storage','bare_metal')
    GROUP BY type
  `);
  let recognizedCents = 0;
  for (const r of recRows as Array<{ cents: number }>) recognizedCents += Number(r.cents);

  // Latest wallet_transaction timestamp (dump freshness)
  const [latestRows] = await packet.query<any[]>(
    `SELECT MAX(created_at) AS latest FROM wallet_transaction`,
  );
  const latestTxn = (latestRows as Array<{ latest: Date }>)[0].latest;

  // Total wallet top-ups (gross Stripe cash inflow, all-time, net of refunds)
  let topupCents = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await stripe.charges.list({ limit: 100, starting_after: cursor });
    for (const ch of page.data) {
      if (ch.status !== "succeeded") continue;
      const net = ch.amount - (ch.amount_refunded ?? 0);
      if (net > 0) topupCents += net;
    }
    if (!page.has_more) break;
    cursor = page.data[page.data.length - 1].id;
  }

  console.log("");
  console.log("=== GM headline numbers (HAI cross-confirmed) ===");
  console.log(`Total active pods (HAI live):                    ${totalActivePods}`);
  console.log(`  monthly:    ${monthlyPods}`);
  console.log(`  hourly:     ${hourlyPods}`);
  console.log(`  untracked:  ${untrackedPods}  (HAI pod with no packet pod_metadata)`);
  console.log(`Active customers with a monthly subscription:    ${liveSubEmails.size}    (was ${liveSubCusIds.size} by cus_id — dedup'd by email)`);
  console.log(`Total active monthly subscriptions (pod units):  ${subUnits}`);
  console.log(`  Stripe sub objects:                            ${liveSubs.length}`);
  console.log(`Total subscribers (monthly + hourly, distinct):  ${totalSubscribers.size}`);
  console.log(`  monthly subscribers (Stripe, by email):        ${liveSubEmails.size}`);
  console.log(`  hourly subscribers (live pod, by email):       ${hourlyEmails.size}`);
  console.log(`  overlap (both):                                ${overlap}`);
  console.log(`  (monthly pod owners in HAI, by email:          ${monthlyPodEmails.size})`);
  console.log(`Lifetime revenue (recognized):                   ${fmt(recognizedCents)}`);
  console.log(`Total wallet topup (gross Stripe inflow):        ${fmt(topupCents)}`);
  console.log(`MRR (active+trialing+past_due):                  ${fmt(mrr)}`);
  console.log("");
  console.log(`Dump freshness — latest wallet_transaction: ${latestTxn?.toISOString()}`);
  console.log(`Stripe: active=${activeSubs.length} trialing=${trialingSubs.length} past_due=${pastDueSubs.length}`);

  await hai.end();
  await packet.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
