/**
 * Bare-metal provisioning engine (pick #2) — multi-server aware.
 *
 * An order provisions order.serverCount HAI baremetal instances (HAI `quantity`).
 * Each instance is an independent fulfillment with its own SSH/IP, tracked as a
 * BareMetalServer child row. The ORDER goes "active" only when ALL its servers
 * are Active (all-or-nothing); a partial/short fulfillment holds the order for
 * ops. Single-server orders (serverCount = 1) behave exactly as before.
 *
 * startProvisioning(orderId): after payment is confirmed, claim the order (CAS
 * payment_received→provisioning), subscribe N instances, persist a server row
 * per returned subscription, then aggregate (activate if all Active). B200 nodes
 * are not auto-assigned — instances usually come back "Requested" and a human
 * assigns nodes on the HAI panel, so we nudge ops and let the poller finish.
 *
 * pollProvisioningOrders(): cron-driven. Re-checks each in-flight order's server
 * rows against HAI, fills SSH for the ones that went Active, activates the order
 * once ALL are Active, retries paid-but-unstarted orders, and fires a one-shot
 * "stuck" alarm.
 *
 * Reconciliation: HAI's subscribe is NOT idempotent. Instances are named after
 * the order's invoiceNumber (HAI suffixes "-1..-N" for quantity > 1); before
 * re-subscribing we adopt existing instances matching that name prefix.
 */

import { prisma } from "@/lib/prisma";
import { trackGA4Event } from "@/lib/analytics/ga4";
import { posthogTrackEvent } from "@/lib/analytics/posthog";
import { getStripe } from "@/lib/stripe";
import {
  subscribeToBaremetal,
  getBaremetalInstance,
  listBaremetalInstances,
  terminateBaremetal,
  type BaremetalSubscription,
} from "@/lib/hostedai/baremetal";
import { sendEmail } from "@/lib/email/client";
import {
  emailLayout,
  emailButtonTeal,
  emailText,
  emailMuted,
  emailSuccessBox,
  emailDetailBox,
  emailSignoff,
  escapeHtml,
  plainTextFooter,
} from "@/lib/email/utils";
import { getSetting } from "@/lib/settings";
import { getBrandName, getSupportEmail, getDashboardUrl } from "@/lib/branding";
import { isRegionInMaintenance } from "@/lib/maintenance/regions";
import type { BareMetalOrder, BareMetalServer } from "@prisma/client";

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Release EVERY HAI node backing an order — one subscription per server. A
 * multi-server order has N BareMetalServer rows, each with its own HAI
 * subscription; releasing only the order's primary subscription would leak the
 * other N-1 nodes (and keep billing them). HAI termination is 404-tolerant, so
 * a retry after a partial failure is safe. Throws on the first hard failure so
 * callers can avoid flipping the DB to a terminal state.
 */
export async function releaseOrderHaiNodes(
  orderId: string,
  teamId: string,
  primarySubId: string | null
): Promise<void> {
  const servers = await prisma.bareMetalServer.findMany({
    where: { orderId, haiSubscriptionId: { not: null } },
    select: { haiSubscriptionId: true },
  });
  const subIds = Array.from(
    new Set(
      [primarySubId, ...servers.map((s) => s.haiSubscriptionId)].filter(
        (s): s is string => !!s
      )
    )
  );
  for (const subId of subIds) {
    await terminateBaremetal(subId, teamId);
  }
  // PA-328: releasing a bare-metal node in HAI does NOT reset it — the node stays
  // bound to its previous OS and won't match new orders (the User Panel shows
  // "OS: undefined undefined" / "No compatible nodes") until ops manually reset
  // it. Alert ops so the freed node is made available again. This lives in the
  // shared release path on purpose: every termination route (admin Terminate,
  // admin Cancel & refund, and the expiry cron) goes through here, and we only
  // fire when a node was actually released.
  if (subIds.length > 0) {
    await notifyNodeResetRequired(orderId, subIds.length);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function opsEmailAddress(): Promise<string> {
  return (await getSetting("BAREMETAL_OPS_EMAIL")) || getSupportEmail();
}

export async function notifyOps(subject: string, lines: string[]): Promise<void> {
  try {
    const to = await opsEmailAddress();
    // Internal ops alert — branded house layout for consistency; lines may carry
    // inline <strong>, so render them as paragraphs without escaping.
    const body = `
      ${emailText(`<strong style="font-size:16px;">${escapeHtml(subject)}</strong>`)}
      ${lines.map((l) => emailText(l)).join("")}
      ${emailMuted("Internal bare-metal operations alert.")}
    `;
    await sendEmail({
      to,
      subject: `[${getBrandName()} BareMetal] ${subject}`,
      html: emailLayout({ preheader: subject, body }),
      text: `${subject}\n\n${lines.join("\n")}`,
    });
  } catch (err) {
    console.error("[BareMetal] ops notification failed (non-fatal):", err);
  }
}

/**
 * PA-328: warn ops that HAI node(s) freed by a termination must be reset before
 * they can serve new orders. A released bare-metal node is not reset automatically;
 * until an operator runs Reset Node → Test connection → Rescan resources on the HAI
 * Admin Panel, it reports "OS: undefined" and matches no new orders. Best-effort
 * (notifyOps swallows its own errors), so it can never fail a termination.
 */
async function notifyNodeResetRequired(orderId: string, nodeCount: number): Promise<void> {
  const order = await prisma.bareMetalOrder
    .findUnique({
      where: { id: orderId },
      select: { invoiceNumber: true, gpuType: true, region: true },
    })
    .catch(() => null);
  const ref = order ? `${order.invoiceNumber} (${order.gpuType}, ${order.region})` : orderId;
  const plural = nodeCount > 1;
  await notifyOps(`Node reset required after terminating ${order?.invoiceNumber ?? orderId}`, [
    `Order ${ref} was terminated and ${plural ? `its ${nodeCount} HAI nodes were` : "its HAI node was"} released.`,
    `Heads up: a released bare-metal node is NOT reset automatically. Until it is, the User Panel shows "OS: undefined undefined" and new orders in that region see "No compatible nodes".`,
    `In the HAI Admin Panel, for ${plural ? "each freed node" : "the freed node"}: Reset Node → Test connection → Rescan resources. Only then is it available for new orders.`,
  ]);
}

async function notifyCustomerProvisioned(order: BareMetalOrder): Promise<void> {
  try {
    const brand = getBrandName();
    const plural = order.serverCount > 1;
    const dash = getDashboardUrl();
    const subject = plural
      ? `Your ${order.serverCount}× ${order.gpuType} bare metal servers are ready`
      : `Your ${order.gpuType} bare metal server is ready`;

    const sshCommand =
      order.sshCommand || `ssh ${order.sshUser ?? "user"}@${order.ipAddress ?? "?"}`;
    const connectBlock = plural
      ? emailText(
          `All <strong>${order.serverCount}</strong> servers are provisioned. Connection details for each are in your dashboard under Bare Metal.`,
        )
      : emailDetailBox(
          `<p style="margin:0 0 4px 0;font-size:12px;color:#5b6476;text-transform:uppercase;letter-spacing:0.4px;">Connect</p>
           <p style="margin:0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#0b0f1c;word-break:break-all;">${escapeHtml(sshCommand)}</p>`,
        );

    const body = `
      ${emailSuccessBox(
        `<p style="margin:0;font-size:16px;font-weight:600;color:#065f46;">${
          plural ? `Your ${order.serverCount} servers are ready` : "Your server is ready"
        }</p>`,
      )}
      ${emailText(
        `Your bare metal ${plural ? "servers" : "server"} for order <strong>${escapeHtml(order.invoiceNumber)}</strong> ${
          plural ? "are" : "is"
        } provisioned and ready to use.`,
      )}
      ${connectBlock}
      ${emailButtonTeal("Open your dashboard", dash)}
      ${emailMuted(
        "The password is fetched on demand in your dashboard (we never email it). Server details and status live under Bare Metal.",
      )}
      ${emailSignoff()}
    `;

    await sendEmail({
      to: order.email,
      subject,
      html: emailLayout({
        preheader: plural
          ? `Your ${order.serverCount} bare metal servers are ready`
          : "Your bare metal server is ready",
        body,
      }),
      text:
        `Your bare metal ${plural ? "servers" : "server"} for order ${order.invoiceNumber} ${
          plural ? "are" : "is"
        } provisioned and ready.\n` +
        (plural ? `Connection details for each server are in your dashboard.\n` : `Connect: ${sshCommand}\n`) +
        `\nOpen your dashboard: ${dash}\nThe password is available on demand in your dashboard (never emailed).\n\n` +
        `The ${brand} Team\n${plainTextFooter()}`,
    });
  } catch (err) {
    console.error(`[BareMetal] customer ready-email failed for ${order.id} (non-fatal):`, err);
  }
}

// ---------------------------------------------------------------------------
// Server-row helpers
// ---------------------------------------------------------------------------

export function sshFieldsFromSub(sub: BaremetalSubscription) {
  const sshCommand =
    sub.ssh_host && sub.ssh_user
      ? `ssh ${sub.ssh_user}@${sub.ssh_host}${sub.ssh_port && sub.ssh_port !== 22 ? ` -p ${sub.ssh_port}` : ""}`
      : null;
  return {
    ipAddress: sub.ssh_host ?? null,
    sshUser: sub.ssh_user ?? null,
    sshPort: sub.ssh_port ?? null,
    sshCommand,
    hostname: sub.name ?? null,
  };
}

const ACTIVE = "Active";
function subIsActive(sub: BaremetalSubscription): boolean {
  return sub.status === ACTIVE && !!sub.ssh_host;
}

/**
 * Upsert one server row from a HAI subscription. Keyed by (orderId,
 * haiSubscriptionId) so re-polls update in place; sequence is preserved on
 * update and only set on create.
 */
async function upsertServerFromSub(
  orderId: string,
  sub: BaremetalSubscription,
  sequence: number,
): Promise<void> {
  const subId = String(sub.id);
  const ssh = sshFieldsFromSub(sub);
  const status = sub.status ?? "Requested";
  const provisionedDate = subIsActive(sub) ? new Date() : undefined;
  const existing = await prisma.bareMetalServer.findFirst({
    where: { orderId, haiSubscriptionId: subId },
    select: { id: true, provisionedDate: true },
  });
  // PA-688: capture the physical node HAI assigned. Written on EVERY sync, not
  // just create — a queued order has no node yet and gets one when it flips
  // Requested → Active. Only written when present, so a partial HAI response
  // can never erase an id we already captured.
  const nodeIdField = sub.node_id ? { haiNodeId: sub.node_id } : {};
  if (existing) {
    await prisma.bareMetalServer.update({
      where: { id: existing.id },
      data: {
        status,
        label: sub.name ?? undefined,
        haiInstanceId: sub.name ?? undefined,
        ...ssh,
        ...nodeIdField,
        // Stamp provisionedDate once, the first time it goes Active.
        ...(provisionedDate && !existing.provisionedDate ? { provisionedDate } : {}),
      },
    });
  } else {
    await prisma.bareMetalServer.create({
      data: {
        orderId,
        haiSubscriptionId: subId,
        haiInstanceId: sub.name ?? null,
        label: sub.name ?? null,
        sequence,
        status,
        ...ssh,
        ...nodeIdField,
        provisionedDate: provisionedDate ?? null,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Activation (order-level, gated on ALL servers ready)
// ---------------------------------------------------------------------------

export function addMonths(date: Date, months: number): Date {
  // UTC arithmetic: local setMonth shifts the instant by an hour whenever the
  // contract crosses a DST boundary, so expiry drifted on non-UTC hosts.
  const d = new Date(date);
  const intendedMonth = (((d.getUTCMonth() + months) % 12) + 12) % 12;
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCMonth() !== intendedMonth) d.setUTCDate(0);
  return d;
}

// The pre-active states a normal provisioning run activates FROM.
const DEFAULT_ACTIVATE_FROM = ["payment_received", "provisioning"];

export interface ActivateOrderFields {
  contractMonths: number;
  haiSubscriptionId?: string;
  ipAddress?: string | null;
  sshUser?: string | null;
  sshPort?: number | null;
  sshCommand?: string | null;
  hostname?: string | null;
  updatedBy: string;
  // --- Backfill overrides (PA-819). Omit all three for normal provisioning. ---
  // The REAL handover date, when the hardware went to the customer before Packet
  // recorded it. Drives investor revenue attribution, so it must be the true date
  // rather than the moment we happened to key the order in.
  provisionedDate?: Date;
  // Explicit contract end. Normally derived as provisionedDate + contractMonths;
  // passed in when the term was agreed against a different start.
  expiresAt?: Date;
  // Statuses to CAS from. A backfilled order jumps straight here from
  // invoice_generated/wire_transfer_pending without transiting payment_received,
  // so the provisioning poller never sees it and cannot auto-provision hardware
  // the customer already has.
  fromStatuses?: string[];
  // Terminal state for a contract whose term ALREADY ended before we recorded it
  // ("expired"). Deliberately not "active": the daily lifecycle cron auto-
  // terminates active orders past expiresAt, which would release a HAI node that
  // may already be reclaimed and email the customer. Investor accrual still
  // counts expired orders (ACTIVATED_ORDER_STATUSES), capped at expiresAt.
  targetStatus?: "active" | "expired";
}

/**
 * The ONLY writer of status="active" (and of the backfill-only "expired" landing
 * state — see targetStatus). CAS from the pre-active states so a re-run on an
 * already-activated order is a 0-row no-op (provisionedDate + expiresAt stamped
 * exactly once). The SSH/HAI fields written here are the order's denormalised
 * PRIMARY (server[0]) — the per-server details live on BareMetalServer rows.
 * Returns rows updated (1 on the real transition, else 0).
 */
export async function activateOrder(
  orderId: string,
  fields: ActivateOrderFields,
): Promise<number> {
  const start = fields.provisionedDate ?? new Date();
  const data: Record<string, unknown> = {
    status: fields.targetStatus ?? "active",
    provisionedDate: start,
    expiresAt: fields.expiresAt ?? addMonths(start, fields.contractMonths),
    provisionError: null,
    updatedBy: fields.updatedBy,
  };
  if (fields.haiSubscriptionId !== undefined) data.haiSubscriptionId = fields.haiSubscriptionId;
  if (fields.ipAddress !== undefined) data.ipAddress = fields.ipAddress;
  if (fields.sshUser !== undefined) data.sshUser = fields.sshUser;
  if (fields.sshPort !== undefined) data.sshPort = fields.sshPort;
  if (fields.sshCommand !== undefined) data.sshCommand = fields.sshCommand;
  if (fields.hostname !== undefined) data.hostname = fields.hostname;

  const result = await prisma.bareMetalOrder.updateMany({
    where: { id: orderId, status: { in: fields.fromStatuses ?? DEFAULT_ACTIVATE_FROM } },
    data,
  });
  return result.count;
}

export interface AggregateResult {
  total: number; // server rows that exist
  ready: number; // rows that are Active with SSH
  expected: number; // order.serverCount
  activated: boolean; // this call flipped the order to active
}

/**
 * Read an order's server rows and, when ALL expected servers are Active with
 * SSH, activate the order (all-or-nothing). The order's primary SSH columns are
 * set from server[0] (lowest sequence) as the denormalised fallback. Idempotent.
 */
async function aggregateOrder(orderId: string): Promise<AggregateResult> {
  const order = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  const servers = await prisma.bareMetalServer.findMany({
    where: { orderId },
    orderBy: { sequence: "asc" },
  });
  const expected = order?.serverCount ?? servers.length;
  const ready = servers.filter((s) => s.status === ACTIVE && !!s.ipAddress).length;
  const allReady = expected > 0 && servers.length >= expected && ready >= expected;

  let activated = false;
  if (order && allReady) {
    const primary = servers[0];
    const count = await activateOrder(orderId, {
      contractMonths: order.contractMonths,
      haiSubscriptionId: primary.haiSubscriptionId ?? undefined,
      ipAddress: primary.ipAddress,
      sshUser: primary.sshUser,
      sshPort: primary.sshPort,
      sshCommand: primary.sshCommand,
      hostname: primary.hostname,
      updatedBy: "baremetal-provisioner",
    });
    if (count === 1) {
      activated = true;
      console.log(`[BareMetal] order ${orderId} → active (all ${expected} servers ready)`);

      // GA4 + PostHog: bare_metal_provisioned — node goes live
      if (order.stripeCustomerId) {
        trackGA4Event(order.stripeCustomerId, "bare_metal_provisioned").catch(() => {});
        posthogTrackEvent(order.stripeCustomerId, "bare_metal_provisioned").catch(() => {});
      }

      await notifyCustomerProvisioned({
        ...order,
        ipAddress: primary.ipAddress,
        sshUser: primary.sshUser,
        sshPort: primary.sshPort,
        sshCommand: primary.sshCommand,
        hostname: primary.hostname,
      });
    }
  }
  return { total: servers.length, ready, expected, activated };
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * The order's HAI team, falling back to the Stripe customer's hostedai_team_id
 * for orders created before the customer had a team. Returns "" when it cannot be
 * resolved (callers treat that as a hard configuration error). Never throws — a
 * Stripe outage must not look like "customer has no team".
 */
export async function resolveOrderTeamId(order: {
  id: string;
  teamId: string;
  stripeCustomerId: string;
}): Promise<string> {
  if (order.teamId) return order.teamId;
  try {
    const stripe = await getStripe();
    const customer = await stripe.customers.retrieve(order.stripeCustomerId);
    if (!("deleted" in customer && customer.deleted)) {
      return customer.metadata?.hostedai_team_id || "";
    }
  } catch (err) {
    console.error(`[BareMetal] team resolution failed for order ${order.id}:`, err);
  }
  return "";
}

/**
 * Provision the N HAI subscriptions for a paid order. Idempotent and safe to
 * call repeatedly (webhook, admin retry, cron catch-up).
 */
export async function startProvisioning(orderId: string): Promise<void> {
  const order = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    console.error(`[BareMetal] startProvisioning: order ${orderId} not found`);
    return;
  }
  if (order.status !== "payment_received") {
    console.log(`[BareMetal] startProvisioning: order ${orderId} is "${order.status}" — skipping`);
    return;
  }

  const teamId = await resolveOrderTeamId(order);

  const missing: string[] = [];
  if (!teamId) missing.push("HAI team (customer has no hostedai_team_id)");
  if (!order.haiRegionId) missing.push("region (order has no haiRegionId)");
  if (missing.length) {
    const msg = `Cannot provision: missing ${missing.join(" + ")}`;
    await prisma.bareMetalOrder.update({ where: { id: orderId }, data: { provisionError: msg } });
    await notifyOps(`Order ${order.invoiceNumber} cannot be provisioned`, [
      msg,
      `Order: ${order.id} (${order.serverCount}× ${order.gpuType}, ${order.contractMonths}mo, ${order.email})`,
      `Fix the configuration, then use "Retry provisioning" in the admin panel.`,
    ]);
    return;
  }

  // Region maintenance gate — BEFORE the claim, so the order stays
  // payment_received and the cron self-heals when maintenance lifts.
  const bmMaint = await isRegionInMaintenance(order.haiRegionId);
  if (bmMaint.inMaintenance) {
    const alerted = await prisma.bareMetalOrder.updateMany({
      where: { id: orderId, maintenanceHeldAlertedAt: null },
      data: { maintenanceHeldAlertedAt: new Date() },
    });
    if (alerted.count === 1) {
      await notifyOps(`Order ${order.invoiceNumber} held — region in maintenance`, [
        `Region ${order.haiRegionId} is in maintenance; provisioning is paused.`,
        `Order: ${order.id} (${order.serverCount}× ${order.gpuType}, ${order.contractMonths}mo, ${order.email})`,
        `It auto-provisions when the region's maintenance is lifted — no action needed unless urgent.`,
      ]);
    }
    console.log(`[BareMetal] order ${orderId} held — region ${order.haiRegionId} in maintenance`);
    return;
  }

  // Claim the order — only one caller transitions payment_received→provisioning.
  const claimed = await prisma.bareMetalOrder.updateMany({
    where: { id: orderId, status: "payment_received" },
    data: { status: "provisioning", teamId, provisionError: null, maintenanceHeldAlertedAt: null, updatedBy: "baremetal-provisioner" },
  });
  if (claimed.count !== 1) return; // lost the race

  const serverCount = Math.max(1, order.serverCount);

  try {
    // If we already have server rows (a prior attempt subscribed), don't
    // re-subscribe — just re-poll + aggregate. Otherwise adopt existing HAI
    // instances by name prefix, or subscribe fresh.
    const existingRows = await prisma.bareMetalServer.count({ where: { orderId } });

    if (existingRows === 0) {
      const adopted = await adoptExistingSubs(order.invoiceNumber, teamId);
      let subs: BaremetalSubscription[];
      if (adopted.length > 0) {
        console.log(`[BareMetal] order ${orderId}: adopting ${adopted.length} existing HAI sub(s)`);
        subs = adopted;
      } else {
        const product = order.catalogId
          ? await prisma.bareMetalProduct.findUnique({ where: { id: order.catalogId } })
          : null;
        subs = await subscribeToBaremetal({
          team_id: teamId,
          region_id: order.haiRegionId!,
          name: order.invoiceNumber, // HAI suffixes -1..-N for quantity > 1
          service_id: order.haiServiceId ?? undefined,
          quantity: serverCount,
          ...(product?.haiInstanceTypeId ? { instance_type_id: product.haiInstanceTypeId } : {}),
          ...(product?.haiImageId ? { image_id: product.haiImageId } : {}),
        });
        if (subs.length === 0) throw new Error("HAI subscribe returned no subscriptions");
      }
      // Persist EVERY returned subscription as a server row — never drop subs
      // (subs we don't track would become orphaned, billable HAI instances).
      let seq = 1;
      for (const sub of subs) {
        if (!sub?.id) continue;
        await upsertServerFromSub(orderId, sub, seq++);
      }
      // Mirror the primary sub onto the order for the denormalised fallback.
      const first = subs.find((s) => s?.id);
      if (first) {
        await prisma.bareMetalOrder.update({
          where: { id: orderId },
          data: { haiSubscriptionId: String(first.id) },
        });
      }
      // Short fulfillment: HAI returned fewer than we asked for — hold + alert
      // (the others may still be orphaned on the HAI side).
      if (subs.filter((s) => s?.id).length !== serverCount) {
        await notifyOps(`Order ${order.invoiceNumber}: HAI returned ${subs.length}/${serverCount} instances`, [
          `Requested ${serverCount} servers but HAI returned ${subs.length}. The order is HELD (not active).`,
          `Order: ${order.id} (${order.gpuType}, ${order.email}). Investigate on the HAI panel.`,
        ]);
      }
    }

    // Re-check each server against HAI + aggregate (activates if all ready).
    await pollOrderServers(order.id, teamId, { provisioned: 0, stillWaiting: 0, retried: 0, stuckAlerts: 0, errors: 0 });
    const agg = await aggregateOrder(orderId);
    if (!agg.activated && agg.ready < agg.expected) {
      console.log(`[BareMetal] order ${orderId}: ${agg.ready}/${agg.expected} servers ready — awaiting node assignment`);
      await notifyOps(`Order ${order.invoiceNumber} needs ${agg.expected - agg.ready} node(s) assigned`, [
        `Payment received for <strong>${serverCount}× ${order.gpuType}</strong> × ${order.contractMonths} months (${order.email}).`,
        `${agg.ready} of ${serverCount} instances are Active; the rest are <strong>Requested</strong> (name prefix ${order.invoiceNumber}).`,
        `Assign compatible node(s) on the HAI panel — the dashboard picks up SSH automatically and the order activates once all ${serverCount} are ready.`,
      ]);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[BareMetal] provisioning failed for order ${orderId}:`, msg);
    // Alert once per distinct error — the catch-up cron retries this same order
    // every cycle, and an unchanged failure would otherwise re-alert forever.
    const alreadyAlerted = order.provisionError?.toLowerCase() === msg.toLowerCase();
    await prisma.bareMetalOrder.updateMany({
      where: { id: orderId, status: "provisioning" },
      data: { status: "payment_received", provisionError: msg },
    });
    if (!alreadyAlerted) {
      await notifyOps(`Order ${order.invoiceNumber} provisioning FAILED`, [
        `HAI subscribe failed: ${msg}`,
        `The cron will retry automatically; or use "Retry provisioning" in the admin panel.`,
      ]);
    }
  }
}

/** Existing HAI instances for this order, matched by name prefix (invoiceNumber or invoiceNumber-N). */
async function adoptExistingSubs(invoiceNumber: string, teamId: string): Promise<BaremetalSubscription[]> {
  const all = await listBaremetalInstances(teamId);
  return all.filter((s) => s.name === invoiceNumber || (s.name ?? "").startsWith(`${invoiceNumber}-`));
}

// ---------------------------------------------------------------------------
// Cron poller
// ---------------------------------------------------------------------------

export interface PollResult {
  provisioned: number;
  stillWaiting: number;
  retried: number;
  stuckAlerts: number;
  errors: number;
}

async function setErrorAndAlertOnce(
  order: BareMetalOrder,
  message: string,
  result: PollResult,
): Promise<void> {
  result.errors++;
  if (order.provisionError === message) return;
  await prisma.bareMetalOrder.update({ where: { id: order.id }, data: { provisionError: message } });
  await notifyOps(`Order ${order.invoiceNumber} needs attention`, [
    message,
    `Customer: ${order.email} — ${order.serverCount}× ${order.gpuType} × ${order.contractMonths}mo.`,
  ]);
}

/**
 * Poll every server row of one in-flight order against HAI, update each row's
 * status/SSH, alert once on a terminal failure, then aggregate (activate the
 * order if all servers are Active). Returns a short human note for the refresh UI.
 */
async function pollOrderServers(
  orderId: string,
  teamId: string,
  result: PollResult,
): Promise<{ note: string; ready: number; expected: number }> {
  const order = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  if (!order) return { note: "Order not found", ready: 0, expected: 0 };
  if (!teamId) {
    await setErrorAndAlertOnce(order, "Order has no HAI team — cannot poll. Resolve the team, then Retry provisioning.", result);
    return { note: "Order has no HAI team — ops alerted", ready: 0, expected: order.serverCount };
  }

  const servers = await prisma.bareMetalServer.findMany({ where: { orderId } });
  let terminalSeen = false;
  for (const server of servers) {
    if (!server.haiSubscriptionId) continue;
    if (server.status === ACTIVE && server.ipAddress) continue; // already done
    try {
      const sub = await getBaremetalInstance(server.haiSubscriptionId, teamId);
      if (sub.status === "Active" && !sub.ssh_host) {
        await setErrorAndAlertOnce(order, `Server ${server.label ?? server.haiSubscriptionId} is Active but has no SSH host — check the node on the HAI panel.`, result);
        continue;
      }
      await upsertServerFromSub(orderId, sub, server.sequence);
      if (sub.status === "Terminated" || sub.status === "Failed" || sub.status === "Deleting") {
        terminalSeen = true;
        await setErrorAndAlertOnce(order, `Server ${server.label ?? server.haiSubscriptionId} is ${sub.status} for this paid order — investigate on the HAI panel.`, result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("(404)") || msg.includes("(403)")) {
        await setErrorAndAlertOnce(order, `Server ${server.label ?? server.haiSubscriptionId} is not retrievable (${msg.slice(0, 120)}).`, result);
      } else {
        result.errors++;
        console.error(`[BareMetal] poll failed for order ${orderId} server ${server.id}:`, err);
      }
    }
  }

  const agg = await aggregateOrder(orderId);
  if (agg.activated) result.provisioned++;
  else if (!terminalSeen) result.stillWaiting++;

  const note = agg.activated
    ? `All ${agg.expected} servers Active — order provisioned`
    : terminalSeen
      ? `A server is in a terminal state — ops alerted`
      : `${agg.ready}/${agg.expected} servers ready — awaiting node assignment`;
  return { note, ready: agg.ready, expected: agg.expected };
}

export async function pollProvisioningOrders(): Promise<PollResult> {
  const result: PollResult = { provisioned: 0, stillWaiting: 0, retried: 0, stuckAlerts: 0, errors: 0 };

  // 1. Catch-up: paid orders that never started provisioning.
  const pending = await prisma.bareMetalOrder.findMany({
    where: {
      status: "payment_received",
      paymentReceivedDate: { lte: new Date(Date.now() - 2 * 60_000) },
    },
    select: { id: true },
  });
  for (const { id } of pending) {
    result.retried++;
    await startProvisioning(id).catch((err) => {
      result.errors++;
      console.error(`[BareMetal] cron retry failed for ${id}:`, err);
    });
  }

  // 1b. Crash-orphan recovery: an order claimed (provisioning) but with NO
  // server rows — the process died after the claim but before subscribing.
  // Adopt existing HAI instances by name prefix, else release the claim.
  const orphanCandidates = await prisma.bareMetalOrder.findMany({
    where: {
      status: "provisioning",
      updatedAt: { lte: new Date(Date.now() - 10 * 60_000) },
    },
  });
  for (const order of orphanCandidates) {
    const rows = await prisma.bareMetalServer.count({ where: { orderId: order.id } });
    if (rows > 0) continue; // has server rows — handled by the in-flight poll below
    try {
      const existing = order.teamId ? await adoptExistingSubs(order.invoiceNumber, order.teamId) : [];
      if (existing.length > 0) {
        let seq = 1;
        for (const sub of existing) if (sub?.id) await upsertServerFromSub(order.id, sub, seq++);
        console.log(`[BareMetal] orphan order ${order.id}: adopted ${existing.length} HAI sub(s)`);
      } else {
        await prisma.bareMetalOrder.updateMany({
          where: { id: order.id, status: "provisioning" },
          data: { status: "payment_received", provisionError: "provisioning interrupted — retrying" },
        });
        result.retried++;
      }
    } catch (err) {
      result.errors++;
      console.error(`[BareMetal] orphan recovery failed for ${order.id}:`, err);
    }
  }

  // 2. Poll in-flight provisioning orders (those that have server rows).
  const inFlight = await prisma.bareMetalOrder.findMany({ where: { status: "provisioning" } });
  for (const order of inFlight) {
    const rows = await prisma.bareMetalServer.count({ where: { orderId: order.id } });
    if (rows === 0) continue; // orphan handled above
    await pollOrderServers(order.id, order.teamId, result);
  }

  // 3. One-shot stuck alarm past the estimated provision date
  const stuck = await prisma.bareMetalOrder.findMany({
    where: {
      status: "provisioning",
      stuckAlertedAt: null,
      estimatedProvisionDate: { not: null, lt: new Date() },
    },
  });
  for (const order of stuck) {
    result.stuckAlerts++;
    await prisma.bareMetalOrder.update({ where: { id: order.id }, data: { stuckAlertedAt: new Date() } });
    await notifyOps(`Order ${order.invoiceNumber} is STUCK past its estimated date`, [
      `Estimated provision date ${order.estimatedProvisionDate?.toISOString().slice(0, 10)} has passed and not all nodes are assigned.`,
      `Customer: ${order.email} — ${order.serverCount}× ${order.gpuType} × ${order.contractMonths}mo.`,
      `Assign the remaining node(s) on the HAI panel (instances named ${order.invoiceNumber}-*).`,
    ]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// On-demand refresh (customer/admin "Refresh" button)
// ---------------------------------------------------------------------------

export interface RefreshOutcome {
  orderStatus: string;
  changed: boolean;
  note: string;
}

/**
 * Refresh ONE order against HAI immediately — the same logic the cron applies,
 * without the wait. Safe to spam: transitions are CAS-guarded and idempotent.
 */
export async function refreshOrder(orderId: string): Promise<RefreshOutcome> {
  const before = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  if (!before) return { orderStatus: "unknown", changed: false, note: "Order not found" };

  const result: PollResult = { provisioned: 0, stillWaiting: 0, retried: 0, stuckAlerts: 0, errors: 0 };
  let note = "Nothing to refresh for this order status";

  if (before.status === "payment_received") {
    await startProvisioning(orderId);
    note = "Provisioning kicked off";
  } else if (before.status === "provisioning") {
    const rows = await prisma.bareMetalServer.count({ where: { orderId } });
    if (rows === 0 && before.teamId) {
      // Claimed but nothing subscribed — adopt by name prefix (human intent, no age gate).
      const existing = await adoptExistingSubs(before.invoiceNumber, before.teamId).catch(() => []);
      if (existing.length > 0) {
        let seq = 1;
        for (const sub of existing) if (sub?.id) await upsertServerFromSub(orderId, sub, seq++);
      }
    }
    const poll = await pollOrderServers(orderId, before.teamId, result);
    note = poll.note;
  } else if (before.status === "active" && before.teamId) {
    // Re-sync each server's SSH from HAI (node records may have changed).
    const servers = await prisma.bareMetalServer.findMany({ where: { orderId } });
    let synced = 0;
    for (const server of servers) {
      if (!server.haiSubscriptionId) continue;
      try {
        const sub = await getBaremetalInstance(server.haiSubscriptionId, before.teamId);
        if (sub.status === "Active" && sub.ssh_host) {
          await upsertServerFromSub(orderId, sub, server.sequence);
          synced++;
        }
      } catch {
        /* transient — skip */
      }
    }
    note = synced > 0 ? `Re-synced ${synced} server(s) from HAI` : "No server details changed";
  }

  const after = await prisma.bareMetalOrder.findUnique({ where: { id: orderId } });
  return {
    orderStatus: after?.status ?? before.status,
    changed: after?.status !== before.status || after?.provisionError !== before.provisionError,
    note,
  };
}

// Re-export the type for callers that thread server rows through.
export type { BareMetalServer };
