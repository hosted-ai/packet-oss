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

const JASON_CUSTOMERS = [
  "cus_UiJ2KYJrCNxWd3",
  "cus_UiJ8pUKTZHYkxS",
  "cus_UiJBR86fTk7hyo",
  "cus_UiJCJotv86n8dw",
  "cus_UMgs7nwV6R7QgE",
  "cus_US5MTzdOhSOvlF",
];

async function main() {
  let totalSubs = 0;
  let totalUnits = 0;
  for (const cusId of JASON_CUSTOMERS) {
    // List ALL subs for this customer, all statuses
    const subs: Stripe.Subscription[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await stripe.subscriptions.list({ customer: cusId, status: "all", limit: 100, starting_after: cursor });
      subs.push(...page.data);
      if (!page.has_more) break;
      cursor = page.data[page.data.length - 1].id;
    }
    const live = subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status));
    console.log(`\n${cusId} — ${subs.length} subs total, ${live.length} live`);
    for (const s of subs) {
      const qty = s.items.data.reduce((a, it) => a + (it.quantity ?? 1), 0);
      const usd = s.items.data.reduce((a, it) => {
        const p = it.price;
        if (!p?.unit_amount || !p?.recurring) return a;
        return a + (p.unit_amount * (it.quantity ?? 1)) / 100;
      }, 0);
      const tag = ["active","trialing","past_due"].includes(s.status) ? "★" : " ";
      console.log(`  ${tag} ${s.id}  ${s.status.padEnd(10)} qty=${qty}  $${usd.toFixed(2)}/period  created=${new Date(s.created*1000).toISOString().slice(0,10)}`);
      if (["active", "trialing", "past_due"].includes(s.status)) {
        totalSubs += 1;
        totalUnits += qty;
      }
    }
  }
  console.log(`\n=== Jason totals across all 6 cus accounts ===`);
  console.log(`Live (active/trialing/past_due) subs:  ${totalSubs}`);
  console.log(`Sum of qty across live subs:           ${totalUnits}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
