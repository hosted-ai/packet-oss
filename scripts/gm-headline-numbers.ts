#!/usr/bin/env npx tsx
/**
 * GM headline numbers (one-off).
 *
 *   Active Subscribers          = # Stripe customers with ≥1 active subscription
 *   Lifetime Revenue (recognized) = sum of packetdb.wallet_transaction debits
 *                                  (gpu_usage, gpu_deploy, stopped_reservation,
 *                                   storage, bare_metal) up to cutoff
 *   Total Wallet Top-up         = sum of Stripe succeeded charges (net of refunds)
 *   MRR                         = sum of active Stripe subscription items (per month)
 *
 * Source: live Stripe API + local packetdb dump.
 * Run: pnpm tsx scripts/gm-headline-numbers.ts --until=2026-06-14
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import mysql from "mysql2/promise";
import Stripe from "stripe";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY missing");
  process.exit(1);
}

const untilArg = process.argv.find((a) => a.startsWith("--until="))?.split("=")[1];
const untilTs = untilArg ? Math.floor(new Date(untilArg + "T23:59:59Z").getTime() / 1000) : null;
const untilSql = untilArg ? `${untilArg} 23:59:59` : null;

// Parse DATABASE_URL
const dbUrl = process.env.DATABASE_URL!;
const m = dbUrl.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(\w+)/);
if (!m) { console.error("can't parse DATABASE_URL"); process.exit(1); }
const [, user, pass, host, port, database] = m;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function main() {
  const conn = await mysql.createConnection({ host, port: Number(port), user, password: pass, database });

  // 1. Recognized revenue
  const where = untilSql ? `AND created_at <= '${untilSql}'` : "";
  const [recRows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT type, SUM(amount_cents) AS cents
    FROM wallet_transaction
    WHERE amount_cents > 0
      AND type IN ('gpu_usage','gpu_deploy','stopped_reservation','storage','bare_metal')
      ${where}
    GROUP BY type
  `);
  let recognizedCents = 0;
  const recByType: Record<string, number> = {};
  for (const r of recRows as Array<{ type: string; cents: number }>) {
    recByType[r.type] = Number(r.cents);
    recognizedCents += Number(r.cents);
  }

  await conn.end();

  // 2. Wallet top-ups (gross Stripe cash inflow)
  console.log("[stripe] streaming charges...");
  let topupCents = 0;
  let chargeCount = 0;
  for await (const ch of stripe.charges.list({ limit: 100 })) {
    if (untilTs && ch.created > untilTs) continue;
    if (ch.status !== "succeeded") continue;
    const net = ch.amount - (ch.amount_refunded ?? 0);
    if (net <= 0) continue;
    topupCents += net;
    chargeCount += 1;
    if (chargeCount % 500 === 0) process.stdout.write(`  ${chargeCount}...\r`);
  }
  process.stdout.write("\n");

  // 3. Active subscriptions + MRR
  console.log("[stripe] streaming active subscriptions...");
  const subCustomers = new Set<string>();
  let mrrCents = 0;
  for await (const sub of stripe.subscriptions.list({ status: "active", limit: 100 })) {
    if (untilTs && sub.created > untilTs) continue;
    subCustomers.add(typeof sub.customer === "string" ? sub.customer : sub.customer.id);
    for (const it of sub.items.data) {
      const p = it.price;
      if (!p.unit_amount || !p.recurring) continue;
      const per = p.unit_amount * (it.quantity ?? 1);
      const ic = p.recurring.interval_count ?? 1;
      if (p.recurring.interval === "month") mrrCents += per / ic;
      else if (p.recurring.interval === "year") mrrCents += per / (12 * ic);
      else if (p.recurring.interval === "week") mrrCents += (per * 52) / (12 * ic);
      else if (p.recurring.interval === "day") mrrCents += (per * 30) / ic;
    }
  }

  const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  console.log("");
  console.log(`Cutoff:                          ${untilArg ?? "(none — current)"}`);
  console.log(`Active Subscribers:              ${subCustomers.size}`);
  console.log(`Lifetime Revenue (recognized):   ${fmt(recognizedCents)}`);
  for (const t of Object.keys(recByType).sort((a, b) => recByType[b] - recByType[a])) {
    console.log(`    ${t.padEnd(22)} ${fmt(recByType[t])}`);
  }
  console.log(`Total Wallet Top-ups (gross):    ${fmt(topupCents)}`);
  console.log(`MRR (active Stripe subs):        ${fmt(mrrCents)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
