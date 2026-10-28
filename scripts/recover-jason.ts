#!/usr/bin/env npx tsx
/**
 * recover-jason.ts — READ-ONLY diagnosis for a lost monthly-sub → pod mapping.
 *
 * Prints, for an email:
 *   - Stripe customer(s) + hostedai_team_id + all subs (status/price/period/metadata)
 *   - pod_metadata rows for that stripe customer AND that team
 *   - live HAI instances for the team (the NEW pods the customer recreated)
 *
 * Reads .env.local (local DATABASE_URL + prod STRIPE / HAI keys). Touches nothing.
 *
 * Usage: npx tsx scripts/recover-jason.ts jason@matsuno.ai
 */
import { readFileSync } from "fs";
import Stripe from "stripe";
import { createConnection } from "mysql2/promise";

const EMAIL = process.argv[2] || "jason@matsuno.ai";

// --- env ---
const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[k] = v;
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY!);

function parseMysqlUrl(url: string) {
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+?)(\?.*)?$/);
  if (!m) throw new Error("bad DATABASE_URL");
  return { user: m[1], password: decodeURIComponent(m[2]), host: m[3], port: +m[4], database: m[5] };
}

async function haiInstances(teamId: string) {
  if (!env.HOSTEDAI_API_URL || !env.HOSTEDAI_API_KEY) return null;
  const url = `${env.HOSTEDAI_API_URL}/api/instances/unified?team_id=${teamId}`;
  const r = await fetch(url, { headers: { "X-API-Key": env.HOSTEDAI_API_KEY } });
  if (!r.ok) return `HAI ${r.status}: ${(await r.text()).slice(0, 200)}`;
  return r.json();
}

async function main() {
  const db = await createConnection(parseMysqlUrl(env.DATABASE_URL!));
  const dbName = parseMysqlUrl(env.DATABASE_URL!).database;
  console.log(`DB: ${parseMysqlUrl(env.DATABASE_URL!).host}/${dbName}  (must be LOCAL)\n`);

  // 1. Stripe customers by email
  const custs = await stripe.customers.list({ email: EMAIL, limit: 100 });
  console.log(`=== Stripe customers for ${EMAIL}: ${custs.data.length} ===`);
  const teamIds = new Set<string>();
  for (const c of custs.data) {
    const team = c.metadata?.hostedai_team_id || "";
    if (team) teamIds.add(team);
    console.log(`cus=${c.id}  team=${team || "-"}  primary=${c.metadata?.primary_stripe_customer_id || "-"}  bal=${c.balance}`);
    for (const st of ["active", "past_due", "canceled", "unpaid"] as const) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: st, limit: 100 });
      for (const s of subs.data) {
        const price = s.items.data.map((i) => `${i.price.unit_amount}c x${i.quantity}/${i.price.recurring?.interval}`).join(",");
        const end = new Date((s.current_period_end ?? 0) * 1000).toISOString().slice(0, 10);
        console.log(`   sub=${s.id}  status=${s.status}  ${price}  end=${end}  meta=${JSON.stringify(s.metadata)}`);
      }
    }
  }

  // 2. pod_metadata for those stripe customers
  const custIds = custs.data.map((c) => c.id);
  if (custIds.length) {
    const [pods] = await db.query(
      `SELECT subscription_id, instance_id, stripe_subscription_id, billing_type, pool_id, display_name, deploy_status, created_at
       FROM pod_metadata WHERE stripe_customer_id IN (${custIds.map(() => "?").join(",")}) ORDER BY created_at`,
      custIds
    );
    console.log(`\n=== pod_metadata by stripe_customer_id: ${(pods as any[]).length} ===`);
    for (const p of pods as any[]) console.log(JSON.stringify(p));
  }

  // 3. teams to look up in the user-panel DB dump for the recreated pods
  console.log(`\n=== team_ids to find recreated pods for (query user-panel DB dump) ===`);
  console.log([...teamIds].join(", ") || "(none — customer has no hostedai_team_id metadata)");
  void haiInstances; // ponytail: live HAI lookup unused — recreated pods come from the dump

  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
