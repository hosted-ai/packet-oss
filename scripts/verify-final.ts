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

  const [rows] = await packet.query<any[]>(`SELECT id, email FROM customer_cache`);
  const emailByCusId = new Map<string, string>();
  for (const r of rows as Array<{ id: string; email: string }>) {
    if (r.email) emailByCusId.set(r.id, r.email.toLowerCase());
  }

  const live = [...await listAll("active"), ...await listAll("trialing"), ...await listAll("past_due")];

  // Map every live sub → email, count unique emails, and find any cus_id NOT in customer_cache
  const emailToSubs = new Map<string, { qty: number; usd: number; subs: string[] }>();
  let unmappedCusIds: string[] = [];

  for (const s of live) {
    const cusId = typeof s.customer === "string" ? s.customer : s.customer.id;
    const email = emailByCusId.get(cusId);
    if (!email) {
      unmappedCusIds.push(cusId);
      continue;
    }
    const qty = s.items.data.reduce((a, it) => a + (it.quantity ?? 1), 0);
    const usd = s.items.data.reduce((a, it) => {
      const p = it.price;
      if (!p?.unit_amount || !p?.recurring) return a;
      const per = p.unit_amount * (it.quantity ?? 1);
      const ic = p.recurring.interval_count ?? 1;
      if (p.recurring.interval === "month") return a + per / ic;
      if (p.recurring.interval === "year") return a + per / (12 * ic);
      return a;
    }, 0) / 100;

    if (!emailToSubs.has(email)) emailToSubs.set(email, { qty: 0, usd: 0, subs: [] });
    const rec = emailToSubs.get(email)!;
    rec.qty += qty;
    rec.usd += usd;
    rec.subs.push(s.id);
  }

  console.log(`=== Live subs total: ${live.length} ===`);
  console.log(`Distinct emails: ${emailToSubs.size}`);
  console.log(`Unmapped cus_ids (not in customer_cache): ${unmappedCusIds.length}`);
  if (unmappedCusIds.length) console.log(`  →`, unmappedCusIds);

  console.log(`\n=== Per email: subs / pod-units / monthly $ ===`);
  const sorted = [...emailToSubs.entries()].sort((a, b) => b[1].usd - a[1].usd);
  let totalQty = 0, totalUsd = 0;
  for (const [email, rec] of sorted) {
    totalQty += rec.qty;
    totalUsd += rec.usd;
    console.log(`  ${email.padEnd(40)} subs=${String(rec.subs.length).padStart(2)} qty=${String(rec.qty).padStart(2)} $${rec.usd.toFixed(2).padStart(9)}/mo`);
  }
  console.log(`  ${"TOTAL".padEnd(40)} subs=${String(live.length).padStart(2)} qty=${String(totalQty).padStart(2)} $${totalUsd.toFixed(2).padStart(9)}/mo`);

  await packet.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
