/**
 * PA-688: resolve `BareMetalServer.haiNodeId` for rows that don't have it.
 *
 * New provisions capture the node id directly (`upsertServerFromSub` in
 * provision.ts), so this only ever repairs history: rows written before that
 * existed, or the rare case where HAI hadn't assigned a node while we were
 * polling. It is called from the DAILY bare-metal lifecycle cron and by
 * `scripts/backfill-baremetal-node-ids.ts`, which share this implementation.
 *
 * Why it's safe to run on a schedule:
 *  - **Idempotent.** Only rows with `haiNodeId IS NULL` are selected, so a
 *    resolved row is never touched again and re-running writes nothing.
 *  - **Self-extinguishing.** The candidate set only shrinks; in steady state it
 *    is empty and the sweep costs zero API calls.
 *  - **Bounded.** `limit` caps rows per run, so even a permanently unresolvable
 *    row (HAI purged its audit log) costs at most `limit × 2` calls a day rather
 *    than growing without end.
 *  - **Never guesses.** Only a node id from HAI's own records is written — see
 *    `nodeIdFromAuditLogs`. Attributing by IP address was tried and reverted:
 *    HAI recycles addresses between machines, which silently moved one node's
 *    contracts onto another.
 */

import { prisma } from "@/lib/prisma";
import { getBaremetalInstance, getBaremetalAuditLogs } from "@/lib/hostedai/baremetal";

export type NodeIdSource = "subscription" | "audit-log";

export interface ResolvedNodeId {
  serverId: string;
  invoiceNumber: string;
  subId: string;
  nodeId: number;
  source: NodeIdSource;
}

export interface UnresolvedNodeId {
  serverId: string;
  invoiceNumber: string;
  reason: string;
}

export interface NodeIdBackfillResult {
  scanned: number;
  written: number;
  resolved: ResolvedNodeId[];
  unresolved: UnresolvedNodeId[];
}

/**
 * Newest SUCCESSFUL audit row carrying a node id — a subscription can be moved
 * between nodes, so the latest assignment wins.
 *
 * Failed rows are excluded deliberately: a failed reassignment still records the
 * TARGET node_id, and if it were the most recent row we'd write a node the
 * subscription never ran on. HAI writes exactly "Success" / "Failure"
 * (models/baremetalauditlog/baremetal_audit_log.go). Allow-listing means an
 * unrecognised status leaves the row unresolved and reported — recoverable,
 * unlike a wrong id written by a one-shot repair.
 */
export function nodeIdFromAuditLogs(
  logs: Awaited<ReturnType<typeof getBaremetalAuditLogs>>
): number | null {
  const succeeded = (status?: string): boolean => status?.toLowerCase() === "success";
  const withNode = logs
    .filter((l) => typeof l.node_id === "number" && l.node_id! > 0 && succeeded(l.status))
    .sort((a, b) => {
      const at = a.started_at ? Date.parse(a.started_at) : 0;
      const bt = b.started_at ? Date.parse(b.started_at) : 0;
      return bt - at;
    });
  return withNode.length > 0 ? withNode[0].node_id! : null;
}

export async function backfillMissingNodeIds(
  opts: { limit?: number; apply?: boolean; delayMs?: number } = {}
): Promise<NodeIdBackfillResult> {
  const { limit = 25, apply = false, delayMs = 150 } = opts;

  const servers = await prisma.bareMetalServer.findMany({
    where: {
      haiNodeId: null,
      haiSubscriptionId: { not: null },
      // Only rows that actually reached hardware. The investor view skips any row
      // without a provisionedDate (no usage period), so resolving the rest buys
      // nothing and costs 2 HAI calls each.
      provisionedDate: { not: null },
    },
    select: {
      id: true,
      haiSubscriptionId: true,
      order: { select: { invoiceNumber: true, teamId: true } },
    },
    orderBy: { provisionedDate: "desc" }, // most recent first — likeliest to resolve
    take: limit,
  });

  const result: NodeIdBackfillResult = {
    scanned: servers.length,
    written: 0,
    resolved: [],
    unresolved: [],
  };

  for (const [i, s] of servers.entries()) {
    // Gentle on HAI: tripping a rate limit mid-run would half-resolve the set.
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const subId = s.haiSubscriptionId!;
    const invoiceNumber = s.order?.invoiceNumber ?? "(no order)";
    const teamId = s.order?.teamId ?? "";
    let nodeId: number | null = null;
    let source: NodeIdSource | null = null;
    const notes: string[] = [];

    // Source 1 — live subscription (Requested/Active only).
    if (teamId) {
      try {
        const sub = await getBaremetalInstance(subId, teamId);
        if (sub?.node_id) {
          nodeId = sub.node_id;
          source = "subscription";
        } else {
          notes.push("subscription returned no node_id");
        }
      } catch (err) {
        notes.push(`subscription lookup failed (${err instanceof Error ? err.message : String(err)})`);
      }
    } else {
      notes.push("order has no teamId");
    }

    // Source 2 — audit log. HAI soft-deletes released subscriptions and excludes
    // them from the normal getters, but the audit rows survive with the node id.
    if (nodeId == null) {
      try {
        const fromLogs = nodeIdFromAuditLogs(await getBaremetalAuditLogs(subId));
        if (fromLogs != null) {
          nodeId = fromLogs;
          source = "audit-log";
        } else {
          notes.push("no successful audit-log row carried a node_id");
        }
      } catch (err) {
        notes.push(`audit-log lookup failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    if (nodeId != null && source) {
      result.resolved.push({ serverId: s.id, invoiceNumber, subId, nodeId, source });
      if (apply) {
        await prisma.bareMetalServer.update({
          where: { id: s.id },
          data: { haiNodeId: nodeId },
        });
        result.written++;
      }
    } else {
      result.unresolved.push({ serverId: s.id, invoiceNumber, reason: notes.join("; ") });
    }
  }

  return result;
}
