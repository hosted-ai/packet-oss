#!/usr/bin/env npx tsx
/**
 * fix-jason-monthly-metadata.ts
 *
 * Makes jason@matsuno.ai's ORIGINAL 5-unit monthly customer (cus_US5M…)
 * consistent with the 4 newer monthly customers, so /api/account/verify stops
 * dropping its subscription → the spare "slot 5/5" deploy card appears.
 *
 * Three metadata writes (Stripe metadata updates MERGE — untouched keys preserved):
 *   1. cus_US5M.billing_type = "monthly"                 → customer-resolver includes it in monthlyCustomerIds
 *   2. cus_US5M.primary_stripe_customer_id = cus_UMgs    → cancel-webhook can resolve teamId for this sub
 *   3. cus_UMgs.monthly_stripe_customer_ids += cus_US5M  → second link path (read-modify-write, dedup)
 *
 * Writes to LIVE Stripe (not a DB). READ-ONLY unless --apply.
 *   npx tsx scripts/fix-jason-monthly-metadata.ts            # forward dry-run
 *   npx tsx scripts/fix-jason-monthly-metadata.ts --apply    # forward apply (snapshots before-state to backup file)
 *   npx tsx scripts/fix-jason-monthly-metadata.ts --revert            # revert dry-run
 *   npx tsx scripts/fix-jason-monthly-metadata.ts --revert --apply    # revert apply (restores exact before-state)
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import Stripe from "stripe";

const EMAIL = "jason@matsuno.ai";
const PRIMARY = "cus_UMgs7nwV6R7QgE";
const ORIGINAL = "cus_US5MTzdOhSOvlF";
const EXPECTED_TEAM = "9f3c88a5-bc13-48b3-bb21-0022881b0815";
const KNOWN_MONTHLY = ["cus_UiJ2KYJrCNxWd3","cus_UiJ8pUKTZHYkxS","cus_UiJBR86fTk7hyo","cus_UiJCJotv86n8dw"];
const BACKUP_FILE = "scripts/.jason-meta-backup.json";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

const env: Record<string,string> = {};
for (const l of readFileSync(".env.local","utf-8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const i=t.indexOf("=");if(i<0)continue;let v=t.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);env[t.slice(0,i).trim()]=v;}
const stripe = new Stripe(env.STRIPE_SECRET_KEY!);

async function getCust(id: string): Promise<Stripe.Customer> {
  const c = await stripe.customers.retrieve(id);
  if ("deleted" in c && c.deleted) throw new Error(`${id} is deleted`);
  return c as Stripe.Customer;
}
// Stripe deletes a metadata key when set to "". null in our snapshot = key was absent.
const restoreVal = (v: string | null) => (v == null ? "" : v);

async function forward() {
  const orig = await getCust(ORIGINAL), prim = await getCust(PRIMARY);
  if (orig.email?.toLowerCase() !== EMAIL) throw new Error(`GUARD: ${ORIGINAL} email is ${orig.email}`);
  if (prim.email?.toLowerCase() !== EMAIL) throw new Error(`GUARD: ${PRIMARY} email is ${prim.email}`);
  if (prim.metadata?.hostedai_team_id !== EXPECTED_TEAM) throw new Error(`GUARD: ${PRIMARY} team is ${prim.metadata?.hostedai_team_id}`);
  const curIds = (prim.metadata?.monthly_stripe_customer_ids || "").split(",").filter(Boolean);
  const missing = KNOWN_MONTHLY.filter((id) => !curIds.includes(id));
  if (missing.length) throw new Error(`GUARD: ${PRIMARY}.monthly_stripe_customer_ids missing ${missing.join(",")} — list changed`);

  console.log(`cus_US5M now:  billing_type=${orig.metadata?.billing_type ?? "(none)"}  primary=${orig.metadata?.primary_stripe_customer_id ?? "(none)"}`);
  console.log(`cus_UMgs now:  monthly_ids=[${curIds.join(", ")}]\n`);

  const origPatch: Record<string,string> = {};
  if (orig.metadata?.billing_type !== "monthly") origPatch.billing_type = "monthly";
  if (orig.metadata?.primary_stripe_customer_id !== PRIMARY) origPatch.primary_stripe_customer_id = PRIMARY;
  const newIds = curIds.includes(ORIGINAL) ? null : [...curIds, ORIGINAL].join(",");

  console.log("PLAN (forward):");
  Object.keys(origPatch).length ? Object.entries(origPatch).forEach(([k,v]) => console.log(`  cus_US5M.${k}: ${(orig.metadata as any)?.[k] ?? "(none)"} -> ${v}`)) : console.log("  cus_US5M: already correct");
  console.log(newIds ? `  cus_UMgs.monthly_stripe_customer_ids: -> [${newIds}]` : `  cus_UMgs.monthly_stripe_customer_ids: already has ${ORIGINAL}`);

  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  // Snapshot exact before-state for revert
  writeFileSync(BACKUP_FILE, JSON.stringify({
    savedAtIso: new Date().toISOString(),
    [ORIGINAL]: { billing_type: orig.metadata?.billing_type ?? null, primary_stripe_customer_id: orig.metadata?.primary_stripe_customer_id ?? null },
    [PRIMARY]: { monthly_stripe_customer_ids: prim.metadata?.monthly_stripe_customer_ids ?? null },
  }, null, 2));
  console.log(`\nBackup written: ${BACKUP_FILE}`);

  if (Object.keys(origPatch).length) await stripe.customers.update(ORIGINAL, { metadata: origPatch });
  if (newIds) await stripe.customers.update(PRIMARY, { metadata: { monthly_stripe_customer_ids: newIds } });

  const o2 = await getCust(ORIGINAL), p2 = await getCust(PRIMARY);
  console.log(`\nAFTER:\n  cus_US5M:  billing_type=${o2.metadata?.billing_type}  primary=${o2.metadata?.primary_stripe_customer_id}\n  cus_UMgs:  monthly_ids=[${p2.metadata?.monthly_stripe_customer_ids}]`);
  const ok = o2.metadata?.billing_type === "monthly" && o2.metadata?.primary_stripe_customer_id === PRIMARY && (p2.metadata?.monthly_stripe_customer_ids||"").split(",").includes(ORIGINAL);
  console.log(ok ? "\n✓ All three in place." : "\n✗ Verification FAILED."); if (!ok) process.exit(1);
}

async function revert() {
  // Prefer exact snapshot; fall back to known-original (both keys absent; 4-id list)
  let snap: any;
  if (existsSync(BACKUP_FILE)) { snap = JSON.parse(readFileSync(BACKUP_FILE, "utf-8")); console.log(`Using backup ${BACKUP_FILE} (saved ${snap.savedAtIso})`); }
  else { snap = { [ORIGINAL]: { billing_type: null, primary_stripe_customer_id: null }, [PRIMARY]: { monthly_stripe_customer_ids: KNOWN_MONTHLY.join(",") } }; console.log("No backup file — using known-original fallback"); }

  const o = snap[ORIGINAL], p = snap[PRIMARY];
  console.log("\nPLAN (revert):");
  console.log(`  cus_US5M.billing_type -> ${o.billing_type ?? "(delete)"}`);
  console.log(`  cus_US5M.primary_stripe_customer_id -> ${o.primary_stripe_customer_id ?? "(delete)"}`);
  console.log(`  cus_UMgs.monthly_stripe_customer_ids -> [${p.monthly_stripe_customer_ids ?? "(delete)"}]`);

  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --revert --apply."); return; }
  await stripe.customers.update(ORIGINAL, { metadata: { billing_type: restoreVal(o.billing_type), primary_stripe_customer_id: restoreVal(o.primary_stripe_customer_id) } });
  await stripe.customers.update(PRIMARY, { metadata: { monthly_stripe_customer_ids: restoreVal(p.monthly_stripe_customer_ids) } });
  const o2 = await getCust(ORIGINAL), p2 = await getCust(PRIMARY);
  console.log(`\nAFTER REVERT:\n  cus_US5M:  billing_type=${o2.metadata?.billing_type ?? "(none)"}  primary=${o2.metadata?.primary_stripe_customer_id ?? "(none)"}\n  cus_UMgs:  monthly_ids=[${p2.metadata?.monthly_stripe_customer_ids ?? ""}]`);
}

async function main() {
  console.log(`${REVERT ? "REVERT " : ""}${APPLY ? "APPLY" : "DRY RUN"} — Stripe key ...${(env.STRIPE_SECRET_KEY||"").slice(-4)}\n`);
  await (REVERT ? revert() : forward());
}
main().catch((e) => { console.error("\n" + (e as Error).message); process.exit(1); });
