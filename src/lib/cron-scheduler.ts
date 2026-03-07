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
const STATE_FILE = join(process.cwd(), ".cron-state.json");

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
    name: "midnight-status-email",
    path: "/api/cron/midnight-status-email",
    schedule: { type: "daily", hour: 0, minute: 0 }, // midnight UTC
    method: "POST",
    enabled: true,
  },
];

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
      console.error(`[Cron Scheduler] Job ${job.name} failed: ${response.status} - ${body}`);
    } else {
      const result = await response.json();
      console.log(`[Cron Scheduler] Job ${job.name} completed:`, JSON.stringify(result).slice(0, 200));
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
    if (!job.enabled) continue;
    if (shouldRunNow(job, now)) {
      executeJob(job).catch((err) =>
        console.error(`[Cron Scheduler] Unhandled error in ${job.name}:`, err)
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
      if (!job.enabled) continue;
      if (needsCatchUp(job, now)) {
        console.log(`[Cron Scheduler] Catch-up: ${job.name} missed its window today, running now`);
        executeJob(job).catch((err) =>
          console.error(`[Cron Scheduler] Catch-up error in ${job.name}:`, err)
        );
      }
    }
    // Also run normal tick
    tick();
  }, 10_000);

  const enabledJobs = jobs.filter((j) => j.enabled);
  console.log(
    `[Cron Scheduler] Started with ${enabledJobs.length} job(s): ${enabledJobs.map((j) => j.name).join(", ")}`
  );
}

export function stopCronScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  started = false;
  console.log("[Cron Scheduler] Stopped");
}
