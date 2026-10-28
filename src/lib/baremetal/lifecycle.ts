/**
 * Bare-metal order lifecycle cron — one daily pass with three independent jobs:
 *
 *   1. Termination reminders — for active orders whose contract ends within the
 *      next 15 days, send a reminder every 3 days (escalating tone), guarded by
 *      lastTerminationReminderOn so sends stay >= 3 days apart (and a same-day
 *      re-run is a no-op). A guaranteed FINAL NOTICE also fires on the last day
 *      even if the 3-day cadence wouldn't land there.
 *   2. Auto-terminate — active orders past expiresAt: release the HAI node
 *      (idempotent — 404 = already gone), flip to terminated, email the customer.
 *      On HAI failure leave the order active, raise a one-shot ops alarm, retry
 *      next run (so a node is never silently left running OR falsely terminated).
 *   3. Refund-aging — refund_pending orders older than N days where finance
 *      hasn't paid out: one-shot ops alert so money owed never goes silent.
 *
 * All per-order work is isolated in try/catch so one bad row never halts the
 * batch. Date math is UTC-day-aligned for the reminder idempotency guard.
 */

import { prisma } from "@/lib/prisma";
import { notifyOps, releaseOrderHaiNodes } from "./provision";
import { sendTerminationReminderEmail, sendTerminatedEmail } from "./lifecycle-emails";
import { backfillMissingNodeIds } from "./node-ids";

const REMINDER_WINDOW_DAYS = 15;
const REMINDER_INTERVAL_DAYS = 3;
const REFUND_AGING_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface LifecycleResult {
  remindersSent: number;
  terminated: number;
  terminateFailed: number;
  refundAgingAlerts: number;
  errors: number;
  /** PA-688: server rows whose HAI node id was repaired this run. */
  nodeIdsResolved: number;
  /** Rows still missing a node id — a standing value means investigate. */
  nodeIdsUnresolved: number;
}

export async function runBareMetalLifecycle(now: Date = new Date()): Promise<LifecycleResult> {
  const result: LifecycleResult = {
    remindersSent: 0,
    terminated: 0,
    terminateFailed: 0,
    refundAgingAlerts: 0,
    errors: 0,
    nodeIdsResolved: 0,
    nodeIdsUnresolved: 0,
  };

  // --- Pass 1: termination reminders (active, ending within the window) --------
  const today = startOfDayUTC(now);
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * DAY_MS);
  // Cadence guard: eligible when no reminder has been sent yet, or the last one
  // was >= REMINDER_INTERVAL_DAYS ago (UTC-day aligned) — so reminders land every
  // 3 days across the 15-day window, not daily.
  const reminderCutoff = new Date(today.getTime() - REMINDER_INTERVAL_DAYS * DAY_MS);
  // Guaranteed FINAL NOTICE: orders expiring within a day always get one more
  // reminder (daysLeft → 1 → urgent copy), even if the 3-day cadence wouldn't
  // land on the last day. Still capped to once per day via lastTerminationReminderOn.
  const finalNoticeBy = new Date(now.getTime() + DAY_MS);
  const dueReminders = await prisma.bareMetalOrder.findMany({
    where: {
      status: "active",
      expiresAt: { gt: now, lte: windowEnd },
      OR: [
        { lastTerminationReminderOn: null },
        { lastTerminationReminderOn: { lte: reminderCutoff } },
        { AND: [{ expiresAt: { lte: finalNoticeBy } }, { lastTerminationReminderOn: { lt: today } }] },
      ],
    },
  });
  for (const order of dueReminders) {
    try {
      const daysLeft = Math.max(
        1,
        Math.ceil((order.expiresAt!.getTime() - now.getTime()) / DAY_MS),
      );
      await sendTerminationReminderEmail(order, daysLeft);
      await prisma.bareMetalOrder.update({
        where: { id: order.id },
        data: { lastTerminationReminderOn: today },
      });
      result.remindersSent++;
    } catch (err) {
      result.errors++;
      console.error(`[BareMetal] reminder failed for ${order.id}:`, err);
    }
  }

  // --- Pass 2: auto-terminate (active, past expiry) ----------------------------
  const expired = await prisma.bareMetalOrder.findMany({
    where: { status: "active", expiresAt: { lte: now } },
  });
  for (const order of expired) {
    try {
      // Release every node backing the order (one HAI sub per server) — 404-tolerant.
      await releaseOrderHaiNodes(order.id, order.teamId, order.haiSubscriptionId);
      // CAS so a manual terminate racing this cron resolves to one winner.
      const upd = await prisma.bareMetalOrder.updateMany({
        where: { id: order.id, status: "active" },
        data: {
          status: "terminated",
          terminatedAt: now,
          terminationReason: order.terminationReason ?? "Contract term ended",
          updatedBy: "baremetal-lifecycle",
        },
      });
      if (upd.count === 1) {
        await sendTerminatedEmail(order);
        result.terminated++;
      }
    } catch (err) {
      result.terminateFailed++;
      // One-shot ops alarm: HAI release failed — node may still be running.
      if (!order.expiryAlertedAt) {
        await prisma.bareMetalOrder
          .update({ where: { id: order.id }, data: { expiryAlertedAt: now } })
          .catch(() => {});
        await notifyOps(`Auto-terminate FAILED for ${order.invoiceNumber}`, [
          `Order ${order.invoiceNumber} (${order.gpuType}) is past its contract end but the HAI node could not be released.`,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          `Release it on the HAI panel; the cron will retry and flip the order to terminated.`,
        ]);
      }
      console.error(`[BareMetal] auto-terminate failed for ${order.id}:`, err);
    }
  }

  // --- Pass 3: refund-aging (refund_pending too long, finance hasn't paid out) --
  const agingCutoff = new Date(now.getTime() - REFUND_AGING_DAYS * DAY_MS);
  const aging = await prisma.bareMetalOrder.findMany({
    where: {
      status: "refund_pending",
      refundAgingAlertedAt: null,
      cancelledAt: { lt: agingCutoff },
    },
  });
  for (const order of aging) {
    try {
      await notifyOps(`Refund PENDING > ${REFUND_AGING_DAYS}d for ${order.invoiceNumber}`, [
        `Order ${order.invoiceNumber} was cancelled with a refund of ${(
          (order.refundAmountCents ?? 0) / 100
        ).toLocaleString(undefined, { style: "currency", currency: "USD" })} owed,`,
        `but it has sat in refund_pending for over ${REFUND_AGING_DAYS} days.`,
        `Confirm finance issued the refund, then mark it refunded in the admin panel.`,
      ]);
      await prisma.bareMetalOrder.update({
        where: { id: order.id },
        data: { refundAgingAlertedAt: now },
      });
      result.refundAgingAlerts++;
    } catch (err) {
      result.errors++;
      console.error(`[BareMetal] refund-aging alert failed for ${order.id}:`, err);
    }
  }

  // --- Pass 4: repair missing HAI node ids (PA-688) ----------------------------
  // Idempotent and self-extinguishing: only NULL rows are selected, so once
  // history is repaired this costs nothing. Lives on the DAILY cron rather than
  // the 5-minute provisioning one because it's hygiene, not provisioning
  // latency — and a capped daily sweep keeps a permanently unresolvable row
  // (HAI purged its audit log) from being retried every 5 minutes forever.
  //
  // Deliberately last and fully isolated: a HAI outage here must not prevent
  // terminations or refund alerts above from running.
  try {
    const backfill = await backfillMissingNodeIds({ limit: 25, apply: true });
    result.nodeIdsResolved = backfill.written;
    result.nodeIdsUnresolved = backfill.unresolved.length;
    if (backfill.written > 0) {
      console.log(`[BareMetal] resolved ${backfill.written} missing HAI node id(s)`);
    }
    if (backfill.unresolved.length > 0) {
      // Visible on purpose: these orders show at region level only, with no
      // per-machine history on the investor dashboard.
      console.warn(
        `[BareMetal] ${backfill.unresolved.length} server row(s) still have no HAI node id:`,
        backfill.unresolved.map((u) => u.invoiceNumber).join(", ")
      );
    }
  } catch (err) {
    result.errors++;
    console.error("[BareMetal] node-id backfill pass failed:", err);
  }

  return result;
}
