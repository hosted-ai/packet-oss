#!/usr/bin/env npx tsx
/**
 * PA-688: report/repair `BareMetalServer.haiNodeId` — the PHYSICAL HAI node
 * behind each provisioned bare-metal fulfillment.
 *
 * The DAILY bare-metal lifecycle cron already runs this same sweep
 * automatically (`backfillMissingNodeIds` in src/lib/baremetal/node-ids.ts), so
 * this script exists for two things: seeing the detail per row, and forcing a
 * pass without waiting for 08:00 UTC.
 *
 * Dry-run by default — prints what it would change and writes nothing.
 *
 * Usage:
 *   npx tsx scripts/backfill-baremetal-node-ids.ts                # dry run
 *   npx tsx scripts/backfill-baremetal-node-ids.ts --apply        # write
 *   npx tsx scripts/backfill-baremetal-node-ids.ts --limit 200    # widen the cap
 */

import { prisma } from "../src/lib/prisma";
import { backfillMissingNodeIds } from "../src/lib/baremetal/node-ids";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : 500;

async function main() {
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) {
    console.error("--limit must be a positive number");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Scanning provisioned server rows with no HAI node id (cap ${LIMIT})${APPLY ? "" : " — DRY RUN, nothing will be written"}\n`
  );

  const r = await backfillMissingNodeIds({ limit: LIMIT, apply: APPLY });

  if (r.scanned === 0) {
    console.log("Nothing to do — every provisioned server row already has a node id.");
    return;
  }

  for (const row of r.resolved) {
    console.log(`  ✓ ${row.invoiceNumber} sub=${row.subId} → node ${row.nodeId}  [${row.source}]`);
  }
  for (const row of r.unresolved) {
    console.log(`  ✗ ${row.invoiceNumber} — ${row.reason}`);
  }

  const bySub = r.resolved.filter((x) => x.source === "subscription").length;
  const byLog = r.resolved.filter((x) => x.source === "audit-log").length;
  console.log(
    `\n── Summary ──\n` +
      `  scanned:    ${r.scanned}\n` +
      `  resolved:   ${r.resolved.length} (subscription: ${bySub}, audit-log: ${byLog})\n` +
      `  written:    ${r.written}\n` +
      `  unresolved: ${r.unresolved.length}`
  );

  // Partial coverage must never read as success: whatever stays unresolved shows
  // at region level only, with no per-machine history on the investor dashboard.
  if (r.unresolved.length > 0) {
    console.log(
      `\n  ⚠ The rows above marked ✗ have no recoverable node id. Investigate before\n` +
        `    treating the backfill as complete.`
    );
  }
  if (!APPLY && r.resolved.length > 0) {
    console.log(`\nRe-run with --apply to write.`);
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
