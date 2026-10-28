#!/usr/bin/env npx tsx
/**
 * repoint-monthly.ts — re-point jason@matsuno.ai's monthly pod_metadata rows
 * from the dead pool-106 instances (node that went down) to the recreated
 * live instances. Mapping verified against hai_user_panel (deleted_at + name).
 *
 * Only instance_id + subscription_id + deploy_status change. stripe_subscription_id,
 * billing_type=monthly, pool_id, prepaid_* are preserved. pool_id stays 106
 * (only read at subscription-cancel; monthly billing/dashboard key on instance_id).
 *
 * The 3 new instances have NO pod_metadata row (verified), so this is a pure
 * repoint — nothing is deleted. Wrapped in a transaction. DRY RUN unless --live.
 *
 * Usage: npx tsx scripts/repoint-monthly.ts [--live]
 */
import { readFileSync } from "fs";
import { createConnection } from "mysql2/promise";

const SUB = "sub_1TTBCDS6o7Q7HHHVEeZwUQKk";
// dead instance (current instance_id on the monthly row)  →  recreated live instance
const MAP = [
  { name: "Monthly-1", old: "i-58941ca3-6401-41f1-88ae-d75c3faa30ef", new: "i-8dca1112-50fa-499b-bb73-33cde3929337" }, // → Monthly-01
  { name: "Monthly-3", old: "i-2f628054-255a-4e5f-b9c8-037b0f6635b4", new: "i-238f9013-66c4-4e83-b817-984034b32d3f" }, // → Monthly-03
  { name: "Monthly-4", old: "i-c315d6ca-e006-4011-a947-95969e90ccbb", new: "i-9f3e6a24-08eb-433e-8cb5-8cb45046aa23" }, // → Monthly-04
];

const LIVE = process.argv.includes("--live");

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq === -1) continue;
  let v = t.slice(eq + 1).trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  env[t.slice(0, eq).trim()] = v;
}
const m = env.DATABASE_URL!.match(/^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+?)(\?.*)?$/)!;
const cfg = { user: m[1], password: decodeURIComponent(m[2]), host: m[3], port: +m[4], database: m[5] };

async function main() {
  if (cfg.host !== "localhost" && cfg.host !== "127.0.0.1") {
    console.error(`Refusing: DATABASE_URL host is ${cfg.host}, not local.`); process.exit(1);
  }
  const db = await createConnection(cfg);
  console.log(`${LIVE ? "LIVE" : "DRY RUN"} on ${cfg.host}/${cfg.database}\n`);
  await db.beginTransaction();
  try {
    for (const { name, old, nu = "" } of MAP.map((x) => ({ ...x, nu: x.new }))) {
      const [oldRows] = await db.query<any[]>(
        `SELECT id, display_name, pool_id, billing_type, stripe_subscription_id, hourly_rate_cents FROM pod_metadata WHERE instance_id = ?`, [old]);
      const [newRows] = await db.query<any[]>(`SELECT id FROM pod_metadata WHERE instance_id = ?`, [nu]);
      if (oldRows.length !== 1) throw new Error(`${name}: old ${old} -> expected 1 row, got ${oldRows.length}`);
      const o = oldRows[0];
      if (o.billing_type !== "monthly" || o.stripe_subscription_id !== SUB)
        throw new Error(`${name}: old row not monthly/${SUB} (${o.billing_type}/${o.stripe_subscription_id})`);
      if (newRows.length !== 0) throw new Error(`${name}: new ${nu} already has a pod_metadata row (${newRows[0].id}) — investigate, not a clean repoint`);
      console.log(`${name} (${o.display_name}): ${old} → ${nu}  [pool ${o.pool_id} kept, hourly_rate=${o.hourly_rate_cents ?? "null"}]`);
      if (LIVE) {
        await db.query(
          `UPDATE pod_metadata SET instance_id = ?, subscription_id = ?, deploy_status = 'running', updated_at = NOW() WHERE id = ?`,
          [nu, `instance-${nu}`, o.id]);
      }
    }
    if (LIVE) { await db.commit(); console.log("\nCommitted. Re-run scripts/recover-jason.ts to verify."); }
    else { await db.rollback(); console.log("\nDry run — nothing written. Re-run with --live."); }
  } catch (e) {
    await db.rollback(); console.error("\nRolled back:", (e as Error).message); process.exit(1);
  } finally { await db.end(); }
}
main();
