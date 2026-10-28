import { readFileSync } from "fs";
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

function monthlyCents(s: Stripe.Subscription) {
  let cents = 0;
  for (const it of s.items.data) {
    const p = it.price;
    if (!p.unit_amount || !p.recurring) continue;
    const per = p.unit_amount * (it.quantity ?? 1);
    const ic = p.recurring.interval_count ?? 1;
    if (p.recurring.interval === "month") cents += per / ic;
    else if (p.recurring.interval === "year") cents += per / (12 * ic);
  }
  return cents;
}

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
  // Distribution: how many subs each customer has, and pod-count per sub
  const all = [...await listAll("active"), ...await listAll("trialing"), ...await listAll("past_due")];
  const byCustomer = new Map<string, Stripe.Subscription[]>();
  for (const s of all) {
    const c = typeof s.customer === "string" ? s.customer : s.customer.id;
    if (!byCustomer.has(c)) byCustomer.set(c, []);
    byCustomer.get(c)!.push(s);
  }
  const multi = [...byCustomer.entries()].filter(([, subs]) => subs.length > 1);
  console.log(`=== Customers with >1 active sub: ${multi.length} ===`);
  for (const [cust, subs] of multi) {
    console.log(`${cust}  ${subs.length} subs:  ${subs.map(s => `${s.id}(${s.status})`).join(", ")}`);
  }
  // Item counts per sub (multiple line items can exist on a sub)
  const multiItem = all.filter((s) => s.items.data.length > 1);
  console.log(`\n=== Subs with >1 line item: ${multiItem.length} ===`);
  for (const s of multiItem) {
    const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
    console.log(`${s.id} cus=${cust} items=${s.items.data.length} qtys=${s.items.data.map(i => i.quantity).join("/")}`);
  }
  console.log(`\nTotal subs: ${all.length}   distinct customers: ${byCustomer.size}`);

  // Print line-item quantities for all subs, looking for qty > 1
  console.log("\n=== Line item quantities ===");
  let totalQty = 0;
  for (const s of all) {
    const qty = s.items.data.reduce((acc, it) => acc + (it.quantity ?? 1), 0);
    totalQty += qty;
    if (qty > 1) {
      const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
      console.log(`${s.id} cus=${cust} qty=${qty}`);
    }
  }
  console.log(`Sum of item quantities across all live subs: ${totalQty}`);
  return;

  const pastDue = await listAll("past_due");
  console.log("=== past_due subs ===");
  for (const s of pastDue) {
    const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
    const mrr = monthlyCents(s);
    console.log(`${s.id}  cus=${cust}  mrr=$${(mrr/100).toFixed(2)}  current_period_end=${new Date((s.current_period_end ?? 0)*1000).toISOString()}`);
  }
  const pdMrr = pastDue.reduce((s, x) => s + monthlyCents(x), 0);
  console.log(`Total past_due MRR: $${(pdMrr/100).toFixed(2)}\n`);

  const canceled = await listAll("canceled");
  // Sort recent first by canceled_at
  const recent = canceled
    .filter((s) => s.canceled_at)
    .sort((a, b) => (b.canceled_at ?? 0) - (a.canceled_at ?? 0))
    .slice(0, 10);

  console.log("=== 10 most recently canceled subs ===");
  for (const s of recent) {
    const when = new Date((s.canceled_at ?? 0) * 1000).toISOString();
    const cust = typeof s.customer === "string" ? s.customer : s.customer.id;
    const mrr = monthlyCents(s);
    console.log(`${when}  ${s.id}  cus=${cust}  mrr=$${(mrr/100).toFixed(2)}  status=${s.status}`);
  }

  // Subs canceled in last 48h
  const cutoff = Math.floor(Date.now()/1000) - 48*3600;
  const recent48h = canceled.filter((s) => (s.canceled_at ?? 0) >= cutoff);
  const lost = recent48h.reduce((sum, s) => sum + monthlyCents(s), 0);
  console.log(`\nCanceled in last 48h: ${recent48h.length} subs, $${(lost/100).toFixed(2)} MRR lost`);
}
main().catch(e => { console.error(e); process.exit(1); });
