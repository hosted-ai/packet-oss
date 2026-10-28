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
const m = process.env.DATABASE_URL!.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(\w+)/)!;
const [, user, pass, host, port] = m;

async function listAll(status: Stripe.SubscriptionListParams.Status) {
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

async function main() {
  const packet = await mysql.createConnection({ host, port: Number(port), user, password: pass, database: "packetdb" });
  const hai = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: process.env.USER, database: "hai_user_panel" });

  // cus_id → email
  const [emailRows] = await packet.query<any[]>(`SELECT id, email FROM customer_cache`);
  const emailByCusId = new Map<string, string>();
  for (const r of emailRows as Array<{ id: string; email: string }>) {
    if (r.email) emailByCusId.set(r.id, r.email.toLowerCase());
  }

  // Live HAI pod instance_ids
  const [haiPodRows] = await hai.query<any[]>(`SELECT id FROM instances WHERE deleted_at IS NULL AND nature='pod'`);
  const liveInstanceIds = new Set((haiPodRows as Array<{ id: string }>).map((r) => r.id));

  // Per email: count live monthly pods + live hourly pods (from packet pod_metadata × HAI live)
  const [pmRows] = await packet.query<any[]>(`SELECT instance_id, stripe_customer_id, billing_type FROM pod_metadata WHERE instance_id IS NOT NULL`);
  type Tally = { monthlyPods: number; hourlyPods: number };
  const tallyByEmail = new Map<string, Tally>();
  for (const r of pmRows as Array<{ instance_id: string; stripe_customer_id: string; billing_type: string | null }>) {
    if (!liveInstanceIds.has(r.instance_id)) continue;
    const email = emailByCusId.get(r.stripe_customer_id);
    if (!email) continue;
    if (!tallyByEmail.has(email)) tallyByEmail.set(email, { monthlyPods: 0, hourlyPods: 0 });
    const t = tallyByEmail.get(email)!;
    if (r.billing_type === "monthly") t.monthlyPods++;
    else if (r.billing_type === "hourly") t.hourlyPods++;
  }

  // Stripe live subs → per-email sub count + qty
  const live = [...await listAll("active"), ...await listAll("trialing"), ...await listAll("past_due")];
  type SubAgg = { subCount: number; qty: number; mrr: number };
  const subByEmail = new Map<string, SubAgg>();
  for (const s of live) {
    const cid = typeof s.customer === "string" ? s.customer : s.customer.id;
    const email = emailByCusId.get(cid) ?? cid;
    const qty = s.items.data.reduce((a, it) => a + (it.quantity ?? 1), 0);
    const mrr = s.items.data.reduce((a, it) => {
      const p = it.price;
      if (!p?.unit_amount || !p?.recurring) return a;
      const per = p.unit_amount * (it.quantity ?? 1);
      const ic = p.recurring.interval_count ?? 1;
      if (p.recurring.interval === "month") return a + per / ic;
      if (p.recurring.interval === "year") return a + per / (12 * ic);
      return a;
    }, 0);
    if (!subByEmail.has(email)) subByEmail.set(email, { subCount: 0, qty: 0, mrr: 0 });
    const agg = subByEmail.get(email)!;
    agg.subCount += 1;
    agg.qty += qty;
    agg.mrr += mrr;
  }

  // Customers with >1 sub OR sub with qty>1 (= multi-pod-monthly customers)
  console.log("=== Customers with multiple monthly subs / pod-units ===");
  console.log("(qty > 1 means the customer has multiple monthly pods)\n");
  const multi = [...subByEmail.entries()]
    .filter(([, a]) => a.subCount > 1 || a.qty > 1)
    .sort((a, b) => b[1].mrr - a[1].mrr);
  for (const [email, agg] of multi) {
    console.log(`  ${email.padEnd(35)} ${agg.subCount} sub(s)  ${agg.qty} pod-units  $${(agg.mrr/100).toFixed(2)}/mo`);
  }

  // Overlap: monthly AND hourly customers
  console.log("\n=== Customers with BOTH monthly subscription AND live hourly pod ===");
  for (const [email, t] of tallyByEmail.entries()) {
    if (t.hourlyPods > 0 && subByEmail.has(email)) {
      const s = subByEmail.get(email)!;
      console.log(`  ${email.padEnd(35)} monthly: ${t.monthlyPods} pods (${s.qty} billed), hourly: ${t.hourlyPods} pods`);
    }
  }

  // Hourly-only customers (counted in "Total subscribers" but not in monthly)
  console.log("\n=== Customers with hourly pods only (no monthly sub) ===");
  for (const [email, t] of tallyByEmail.entries()) {
    if (t.hourlyPods > 0 && !subByEmail.has(email)) {
      console.log(`  ${email.padEnd(35)} hourly: ${t.hourlyPods} pods`);
    }
  }

  await packet.end();
  await hai.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
