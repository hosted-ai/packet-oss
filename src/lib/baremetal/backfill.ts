/**
 * Backfill a bare-metal order whose servers are ALREADY with the customer.
 *
 * PA-819. A number of servers were handed over before Packet could record them:
 * payment landed late or short, sales released hardware ahead of payment, or the
 * nodes came online days apart so one order could not be provisioned in one go.
 * Those orders are missing from the investor dashboard entirely, and no normal
 * code path can fix them — provisioning would build a SECOND machine and reset the
 * OS password on the one the customer is working on.
 *
 * So this records reality instead of causing it:
 *   - server rows carry the REAL handover dates (investor accrual reads them)
 *   - the order lands active (or expired, below) WITHOUT transiting
 *     payment_received, so the provisioning poller never sees it
 *   - activation goes through activateOrder directly, never aggregateOrder, so
 *     notifyCustomerProvisioned is never called — no "your new server is ready"
 *     email for hardware the customer has had for weeks
 *
 * Two modes per server:
 *   adopt     — the HAI instance already exists (assigned by hand on the HAI
 *               panel); Packet only records it. No HAI writes at all.
 *   subscribe — Packet creates the HAI subscription pinned to a node. Not enabled
 *               yet; see the subscribe branch.
 *
 * Already-ended terms land as "expired", not "active": the daily lifecycle cron
 * auto-terminates active orders past expiresAt, which would release a node that
 * may already be reclaimed and email the customer. Investor accrual still counts
 * expired orders, capped at expiresAt.
 */

import { prisma } from "@/lib/prisma";
import { getBaremetalInstance } from "@/lib/hostedai/baremetal";
import type { BaremetalSubscription } from "@/lib/hostedai/baremetal";
import {
  activateOrder,
  addMonths,
  resolveOrderTeamId,
  sshFieldsFromSub,
} from "./provision";

export interface BackfillServerInput {
  sequence: number;
  mode: "adopt" | "subscribe";
  /** adopt: the HAI subscription/instance id to record. */
  haiSubscriptionId?: string;
  /** The physical HAI node. Overrides HAI's own node_id when both are present. */
  haiNodeId?: number;
  /** The REAL date this server was handed to the customer (ISO). */
  provisionedDate: string;
}

export interface BackfillServerResult {
  sequence: number;
  ok: boolean;
  haiSubscriptionId?: string;
  haiNodeId?: number;
  note?: string;
  error?: string;
}

export interface BackfillInput {
  servers: BackfillServerInput[];
  /** Order-level handover date. Defaults to the EARLIEST server date. */
  orderProvisionedDate?: string;
  /** Contract end. Defaults to orderProvisionedDate + contractMonths. */
  expiresAt?: string;
  updatedBy: string;
}

export interface BackfillOutcome {
  ok: boolean;
  /** Terminal state written on success. */
  status?: "active" | "expired";
  orderProvisionedDate?: string;
  expiresAt?: string;
  teamId?: string;
  results: BackfillServerResult[];
  /** Set when the whole operation was refused before touching anything. */
  error?: string;
  /** "precondition" → 400; "partial" → 502 (some servers could not be resolved). */
  code?: "precondition" | "partial";
}

/** Statuses an order can be backfilled FROM. */
const BACKFILLABLE = ["invoice_generated", "wire_transfer_pending", "payment_received"];

/** What we resolved for one server before any DB write happens. */
interface ResolvedServer {
  input: BackfillServerInput;
  haiSubscriptionId: string;
  haiInstanceId: string | null;
  label: string | null;
  status: string;
  haiNodeId: number;
  provisionedDate: Date;
  ssh: ReturnType<typeof sshFieldsFromSub>;
  note?: string;
}

export async function backfillOrder(
  orderId: string,
  input: BackfillInput,
): Promise<BackfillOutcome> {
  const fail = (error: string): BackfillOutcome => ({ ok: false, error, code: "precondition", results: [] });

  const order = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  if (!order) return fail("Order not found");

  // --- Preconditions (nothing is written until all of these hold) -------------
  if (!order.paymentReceivedDate) {
    return fail("Record the payment first — mark the invoice paid, then map the servers.");
  }
  if (!BACKFILLABLE.includes(order.status)) {
    return fail(`Cannot backfill — order is "${order.status}"`);
  }
  if (input.servers.length !== order.serverCount) {
    return fail(
      `This order covers ${order.serverCount} server(s) — map all of them at once (got ${input.servers.length}).`,
    );
  }
  const sequences = new Set(input.servers.map((s) => s.sequence));
  if (sequences.size !== input.servers.length) {
    return fail("Duplicate server sequence in the request.");
  }
  // Investor bare-metal ownership is keyed on the order's region, so a null one
  // would silently drop this order out of the dashboard we are fixing.
  if (!order.haiRegionId) {
    return fail("This order has no HAI region — set it before backfilling, or revenue won't attribute.");
  }
  const teamId = await resolveOrderTeamId(order);
  if (!teamId) {
    return fail(
      "This order has no HAI team (the Stripe customer has no hostedai_team_id) — set it before backfilling.",
    );
  }

  const dates = input.servers.map((s) => new Date(s.provisionedDate));
  if (dates.some((d) => Number.isNaN(d.getTime()))) return fail("Invalid handover date.");
  // Earliest, not latest: the order went live for the customer when its FIRST
  // server did, and accrual should start there.
  const orderStart = input.orderProvisionedDate
    ? new Date(input.orderProvisionedDate)
    : new Date(Math.min(...dates.map((d) => d.getTime())));
  if (Number.isNaN(orderStart.getTime())) return fail("Invalid order handover date.");
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : addMonths(orderStart, order.contractMonths);
  if (Number.isNaN(expiresAt.getTime())) return fail("Invalid contract end date.");

  const targetStatus: "active" | "expired" = expiresAt.getTime() <= Date.now() ? "expired" : "active";

  // Subscribing means asking HAI to build something. For a term that already
  // ended there is nothing to build, and creating it would immediately be
  // terminated by the lifecycle cron.
  if (targetStatus === "expired" && input.servers.some((s) => s.mode === "subscribe")) {
    return fail(
      `This contract ended on ${expiresAt.toISOString().slice(0, 10)} — it can only be recorded (adopt), not provisioned.`,
    );
  }

  // Adopting an instance already recorded against another order would count the
  // same hardware twice in investor revenue.
  const adoptIds = input.servers
    .filter((s) => s.mode === "adopt" && s.haiSubscriptionId)
    .map((s) => s.haiSubscriptionId as string);
  if (adoptIds.length) {
    const clash = await prisma.bareMetalServer.findFirst({
      where: { haiSubscriptionId: { in: adoptIds }, orderId: { not: orderId } },
      select: { haiSubscriptionId: true, orderId: true },
    });
    if (clash) {
      return fail(
        `HAI instance ${clash.haiSubscriptionId} is already recorded against another order (${clash.orderId}) — adopting it twice would double-count its revenue.`,
      );
    }
  }

  // --- Resolve every server against HAI BEFORE writing anything --------------
  // A failure here leaves the DB untouched, so a retry is a clean re-run rather
  // than a reconciliation of half-written rows.
  const resolved: ResolvedServer[] = [];
  const results: BackfillServerResult[] = [];

  for (const s of input.servers) {
    if (s.mode === "subscribe") {
      results.push({
        sequence: s.sequence,
        ok: false,
        error:
          "Subscribe mode is not enabled yet — assign the node on the HAI admin panel (with bypass_password_reset on), then adopt the instance here.",
      });
      continue;
    }
    if (!s.haiSubscriptionId) {
      results.push({ sequence: s.sequence, ok: false, error: "Pick the HAI instance to adopt." });
      continue;
    }

    // HAI is the source of truth for ssh/status/node. Best-effort: these servers
    // are known to be live, so a HAI blip must not block recording them — we fall
    // back to the admin's node id and say so in the result.
    let sub: BaremetalSubscription | null = null;
    let note: string | undefined;
    try {
      sub = await getBaremetalInstance(s.haiSubscriptionId, teamId);
    } catch (err) {
      note = `HAI could not be read (${err instanceof Error ? err.message : String(err)}) — recorded from the values you supplied.`;
    }

    const haiNodeId = sub?.node_id ?? s.haiNodeId;
    if (!haiNodeId) {
      results.push({
        sequence: s.sequence,
        ok: false,
        error:
          "No HAI node id for this instance — pick the node, otherwise its revenue lands unattributed on the investor dashboard.",
      });
      continue;
    }

    resolved.push({
      input: s,
      haiSubscriptionId: String(s.haiSubscriptionId),
      haiInstanceId: sub?.name ?? null,
      label: sub?.name ?? null,
      // These machines are in service; if HAI didn't answer, say so rather than
      // recording "Requested" for a server the customer is using.
      status: sub?.status ?? "Active",
      haiNodeId,
      provisionedDate: new Date(s.provisionedDate),
      ssh: sub ? sshFieldsFromSub(sub) : { ipAddress: null, sshUser: null, sshPort: null, sshCommand: null, hostname: null },
      note,
    });
    results.push({
      sequence: s.sequence,
      ok: true,
      haiSubscriptionId: String(s.haiSubscriptionId),
      haiNodeId,
      note,
    });
  }

  if (results.some((r) => !r.ok)) {
    return { ok: false, code: "partial", results };
  }

  // --- Write: server rows, then the order ------------------------------------
  for (const r of resolved) {
    // Keyed by (orderId, sequence): these orders normally have no rows at all,
    // and keying on sequence makes a re-run update in place instead of
    // duplicating servers.
    const existing = await prisma.bareMetalServer.findFirst({
      where: { orderId, sequence: r.input.sequence },
      select: { id: true },
    });
    const data = {
      haiSubscriptionId: r.haiSubscriptionId,
      haiInstanceId: r.haiInstanceId,
      label: r.label,
      status: r.status,
      haiNodeId: r.haiNodeId,
      provisionedDate: r.provisionedDate,
      provisionError: null,
      ...r.ssh,
    };
    if (existing) {
      await prisma.bareMetalServer.update({ where: { id: existing.id }, data });
    } else {
      await prisma.bareMetalServer.create({
        data: { orderId, sequence: r.input.sequence, ...data },
      });
    }
  }

  const primary = [...resolved].sort((a, b) => a.input.sequence - b.input.sequence)[0];
  const count = await activateOrder(orderId, {
    contractMonths: order.contractMonths,
    provisionedDate: orderStart,
    expiresAt,
    targetStatus,
    // Includes "provisioning" on purpose, which BACKFILLABLE does not.
    //
    // A backfillable order may sit in payment_received — exactly the status the
    // provisioning poller claims every 5 minutes, CASing it to provisioning. If
    // that lands between this function's preconditions and this activation, the
    // CAS finds provisioning, matches nothing, and returns 0. The order is then
    // stranded with its server rows written and its status not active, and the
    // poller's next pass sees serverCount rows all Active with IPs and activates
    // it ITSELF — through aggregateOrder, which emails the customer "your server
    // is ready" for hardware they have had for weeks and stamps provisionedDate =
    // today, destroying the real handover dates this whole path exists to record.
    //
    // Accepting provisioning means whoever wins the CAS, the order is active with
    // the real dates before that pass runs. Not a novel transition —
    // activateOrder's own default fromStatuses already allows it.
    fromStatuses: [...BACKFILLABLE, "provisioning"],
    haiSubscriptionId: primary.haiSubscriptionId,
    ...primary.ssh,
    updatedBy: input.updatedBy,
  });
  if (count === 0) {
    return {
      ok: false,
      code: "partial",
      // Deliberately does not name a status: `order` was read before the writes
      // above, so order.status is stale here — quoting it named the status the
      // order had LEFT, sending the admin looking for the wrong thing.
      error:
        "Server rows were recorded, but the order changed state before it could be activated — reload and check it, then re-run if it is still not active.",
      results,
    };
  }

  await prisma.bareMetalOrder.update({
    where: { id: orderId },
    data: {
      backfilledAt: new Date(),
      // Persist the resolved team: terminate/cancel and the auto-terminate cron
      // release HAI nodes with order.teamId, which would fail if left blank.
      ...(order.teamId ? {} : { teamId }),
    },
  });

  return {
    ok: true,
    status: targetStatus,
    orderProvisionedDate: orderStart.toISOString(),
    expiresAt: expiresAt.toISOString(),
    teamId,
    results,
  };
}
