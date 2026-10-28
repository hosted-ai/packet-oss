/**
 * Internal Cron Scheduler
 *
 * Lightweight scheduler that runs inside the Next.js server process.
 * No external dependencies — uses setInterval with cron-style scheduling.
 *
 * Jobs call the local API routes via fetch("http://localhost:PORT/api/cron/..."),
 * keeping the same auth pattern as external cron callers.
 *
 * Last-run state is persisted to disk so daily jobs survive server restarts.
 * On startup, any daily job whose scheduled time has already passed today
 * (and hasn't run yet) is executed immediately as a catch-up.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const CRON_SECRET = process.env.CRON_SECRET;
const PORT = process.env.PORT || "3001";
const BASE_URL = `http://localhost:${PORT}`;
const STATE_FILE = join(process.cwd(), "data", ".cron-state.json");

interface CronJob {
  name: string;
  path: string; // e.g. "/api/cron/midnight-status-email"
  /** Cron schedule: { hour, minute } in UTC, or interval in ms */
  schedule:
    | { type: "daily"; hour: number; minute: number }
    | { type: "interval"; ms: number };
  method?: "GET" | "POST";
  lastRun?: Date;
  enabled: boolean;
}

const jobs: CronJob[] = [
  {
    // The PodMetadata row is the only link between a paid subscription and the
    // pod it deployed. Whoever fails to write it — a swallowed error here, a
    // deploy made straight on the platform — the customer sees "Not Deployed"
    // and can deploy a second pod on one subscription. Repair from what the
    // platform is actually running.
    name: "reconcile-monthly-deploys",
    path: "/api/cron/reconcile-monthly-deploys",
    schedule: { type: "interval", ms: 900_000 }, // 15 min
    method: "POST",
    enabled: true,
  },
  {
    // A Stripe webhook we answer with a non-2xx leaves the customer unlinked
    // and the launch wizard empty, and nothing else notices — Stripe just
    // retries into the same failure. Sweep for undelivered events instead.
    name: "replay-stuck-webhooks",
    path: "/api/cron/replay-stuck-webhooks",
    schedule: { type: "interval", ms: 300_000 }, // 5 min
    method: "POST",
    enabled: true,
  },
  {
    // handleWalletTopup marks the Stripe event processed before it writes the
    // invoice, and invoice generation swallows its own errors — so a lost
    // invoice is permanent, silent, and only surfaces when a customer asks
    // support for a receipt. Issue the missing ones instead.
    name: "reconcile-wallet-invoices",
    path: "/api/cron/reconcile-wallet-invoices",
    schedule: { type: "interval", ms: 1_800_000 }, // 30 min
    method: "POST",
    enabled: true,
  },
  {
    // A provider quota refusal holds mail — sign-in links included — until the
    // provider's reset, so the queue is drained often enough to deliver promptly.
    name: "resend-deferred-email",
    path: "/api/cron/resend-deferred-email",
    schedule: { type: "interval", ms: 600_000 }, // 10 min
    method: "POST",
    enabled: true,
  },
  {
    name: "midnight-status-email",
    path: "/api/cron/midnight-status-email",
    schedule: { type: "daily", hour: 0, minute: 0 }, // midnight UTC
    method: "POST",
    enabled: true,
  },
  {
    // PA-158: reconciliation safety net for orphaned "provisioning" PodMetadata
    // rows. The POST /api/instances handler spawns a fire-and-forget monitor
    // that handles the happy path; this catches deploys orphaned by a server
    // restart and ensures the wallet pre-charge is refunded if HAI never
    // started the pod. Belt-and-suspenders alongside the system crontab —
    // ensures coverage in OSS and dev where the .deb cron isn't installed.
    name: "check-pending-deploys",
    path: "/api/cron/check-pending-deploys",
    schedule: { type: "interval", ms: 150_000 }, // 2.5 min
    method: "POST",
    enabled: true,
  },
  {
    // Bare-metal term-prepay provisioning: catch-up paid orders, poll
    // Requested→Active (manual node assignment on the HAI panel can take
    // hours/days), promote to provisioned with real SSH details, and fire
    // the one-shot stuck alarm. See docs/baremetal-term-prepay-plan.md.
    name: "baremetal-provisioning",
    path: "/api/cron/baremetal-provisioning",
    schedule: { type: "interval", ms: 300_000 }, // 5 min
    method: "POST",
    enabled: true,
  },
  {
    // Bare-metal lifecycle (daily): termination reminders in the final week,
    // auto-terminate at expiry (release HAI), and refund-aging ops alerts.
    // See src/lib/baremetal/lifecycle.ts.
    name: "baremetal-lifecycle",
    path: "/api/cron/baremetal-lifecycle",
    schedule: { type: "daily", hour: 8, minute: 0 }, // 08:00 UTC
    method: "POST",
    enabled: true,
  },
  {
    // Daily Operating Summary: post 7 KPIs to the ops Mattermost channel.
    // No-ops if MATTERMOST_OPS_WEBHOOK_URL isn't set. The route guards against
    // a duplicate post via OPS_SUMMARY_LAST_POSTED (catch-up/restart safe).
    // Post time is fixed here (not config-driven) so catch-up logic keys off it.
    name: "daily-ops-summary",
    path: "/api/cron/daily-ops-summary",
    // 00:30 UTC = 6:00 AM IST — right after the last ~5-min billing-sync run of
    // the prior day has landed, so yesterday's revenue window is complete and
    // the live snapshot aligns with the window boundary.
    schedule: { type: "daily", hour: 0, minute: 30 },
    method: "POST",
    enabled: true,
  },
];

// CRON_HANDED_OVER names jobs packet-api's in-process scheduler now owns
// ("all" hands over everything). A job must run in exactly one scheduler.
const HANDED_OVER = new Set(
  (process.env.CRON_HANDED_OVER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function handedOver(name: string): boolean {
  return HANDED_OVER.has("all") || HANDED_OVER.has(name);
}

let started = false;
let tickInterval: ReturnType<typeof setInterval> | null = null;

// ── State persistence ────────────────────────────────────────────────────

type CronState = Record<string, string>; // job name → ISO date string of last run

function loadState(): CronState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: CronState): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[Cron Scheduler] Failed to save state:", err);
  }
}

function utcDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ── Scheduling logic ─────────────────────────────────────────────────────

function shouldRunNow(job: CronJob, now: Date): boolean {
  if (job.schedule.type === "daily") {
    const { hour, minute } = job.schedule;
    if (now.getUTCHours() !== hour || now.getUTCMinutes() !== minute) {
      return false;
    }
    // Don't run if we already ran today
    if (job.lastRun && utcDateString(job.lastRun) === utcDateString(now)) {
      return false;
    }
    return true;
  }
  if (job.schedule.type === "interval") {
    if (!job.lastRun) return true;
    return now.getTime() - job.lastRun.getTime() >= job.schedule.ms;
  }
  return false;
}

/**
 * Check if a daily job missed its window today (scheduled time already
 * passed but it hasn't run yet). Used for catch-up after restarts.
 */
function needsCatchUp(job: CronJob, now: Date): boolean {
  if (job.schedule.type !== "daily") return false;
  const { hour, minute } = job.schedule;

  // Has the scheduled time already passed today?
  const scheduledMinute = hour * 60 + minute;
  const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (currentMinute <= scheduledMinute) return false;

  // Did it already run today?
  if (job.lastRun && utcDateString(job.lastRun) === utcDateString(now)) {
    return false;
  }

  return true;
}

async function executeJob(job: CronJob): Promise<void> {
  const url = `${BASE_URL}${job.path}`;
  const method = job.method || "POST";

  console.log(`[Cron Scheduler] Running job: ${job.name}`);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (CRON_SECRET) {
      headers["Authorization"] = `Bearer ${CRON_SECRET}`;
    }

    const response = await fetch(url, { method, headers });

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `[Cron Scheduler] Job ${job.name} failed: ${response.status} - ${body}`,
      );
    } else {
      const result = await response.json();
      console.log(
        `[Cron Scheduler] Job ${job.name} completed:`,
        JSON.stringify(result).slice(0, 200),
      );
    }
  } catch (error) {
    console.error(`[Cron Scheduler] Job ${job.name} error:`, error);
  }

  job.lastRun = new Date();

  // Persist last run to disk
  const state = loadState();
  state[job.name] = job.lastRun.toISOString();
  saveState(state);
}

function tick() {
  const now = new Date();
  for (const job of jobs) {
    if (!job.enabled || handedOver(job.name)) continue;
    if (shouldRunNow(job, now)) {
      executeJob(job).catch((err) =>
        console.error(`[Cron Scheduler] Unhandled error in ${job.name}:`, err),
      );
    }
  }
}

export function startCronScheduler(): void {
  if (started) {
    console.log("[Cron Scheduler] Already running, skipping duplicate start");
    return;
  }

  if (!CRON_SECRET) {
    console.warn("[Cron Scheduler] CRON_SECRET not set — scheduler disabled");
    return;
  }

  started = true;

  // Restore persisted last-run dates
  const state = loadState();
  for (const job of jobs) {
    if (state[job.name]) {
      job.lastRun = new Date(state[job.name]);
    }
  }

  // Check every 30 seconds (sufficient granularity for daily jobs)
  tickInterval = setInterval(tick, 30_000);

  // After boot, catch up any daily jobs that missed their window today
  setTimeout(() => {
    const now = new Date();
    for (const job of jobs) {
      if (!job.enabled || handedOver(job.name)) continue;
      if (needsCatchUp(job, now)) {
        console.log(
          `[Cron Scheduler] Catch-up: ${job.name} missed its window today, running now`,
        );
        executeJob(job).catch((err) =>
          console.error(`[Cron Scheduler] Catch-up error in ${job.name}:`, err),
        );
      }
    }
    // Also run normal tick
    tick();
  }, 10_000);

  // This banner is the ops check that a handover took, so it must name what
  // will actually fire — not every job compiled in.
  const active = activeJobNames();
  console.log(
    `[Cron Scheduler] Started with ${active.length} job(s): ${active.join(", ")}`,
  );

  const handed = jobs
    .filter((j) => j.enabled && handedOver(j.name))
    .map((j) => j.name);
  if (handed.length > 0) {
    console.log(
      `[Cron Scheduler] Handed over to packet-api, not scheduled here: ${handed.join(", ")}`,
    );
  }
}

// activeJobNames lists the jobs this scheduler will actually run — enabled
// and not handed over to packet-api. Read by tests and ops checks.
export function activeJobNames(): string[] {
  return jobs
    .filter((j) => j.enabled && !handedOver(j.name))
    .map((j) => j.name);
}

export function stopCronScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  started = false;
  console.log("[Cron Scheduler] Stopped");
}
