import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// cron-scheduler.ts exposes only start/stop; the scheduling math (daily-window
// match, interval elapsed, catch-up) is internal and is exercised here through
// the public API by controlling the clock (fake timers), CRON_SECRET, fetch,
// and the fs state file. We mock fs so the disk-backed last-run state is
// in-memory and deterministic.

let fileStore: Record<string, string> = {};
vi.mock("fs", () => ({
  readFileSync: (p: string) => {
    if (fileStore[p] === undefined) {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return fileStore[p];
  },
  writeFileSync: (p: string, data: string) => {
    fileStore[p] = data;
  },
  mkdirSync: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// The module reads CRON_SECRET/PORT at import time into module constants, so it
// must be (re)imported AFTER we set env. We use vi.resetModules + dynamic import
// per test to get a clean job list and fresh constants each time.
type SchedulerModule = typeof import("@/lib/cron-scheduler");

async function loadScheduler(env: {
  secret?: string;
  port?: string;
}): Promise<SchedulerModule> {
  vi.resetModules();
  if (env.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = env.secret;
  if (env.port === undefined) delete process.env.PORT;
  else process.env.PORT = env.port;
  return import("@/lib/cron-scheduler");
}

const savedSecret = process.env.CRON_SECRET;
const savedPort = process.env.PORT;

beforeEach(() => {
  fileStore = {};
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
});

describe("startCronScheduler — guards", () => {
  it("does nothing (no timer) when CRON_SECRET is unset", async () => {
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const sched = await loadScheduler({ secret: undefined });
    sched.startCronScheduler();
    // No tick timer scheduled → advancing time fires no fetches.
    vi.advanceTimersByTime(60_000);
    expect(mockFetch).not.toHaveBeenCalled();
    sched.stopCronScheduler();
  });

  it("starts once and ignores a duplicate start call", async () => {
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    const warn = console.log as unknown as ReturnType<typeof vi.fn>;
    sched.startCronScheduler();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("Already running")
      )
    ).toBe(true);
    sched.stopCronScheduler();
  });
});

describe("daily job scheduling", () => {
  it("runs a daily job exactly at its UTC window via the tick", async () => {
    // midnight-status-email fires at 00:00 UTC. Start at 23:59:30 so the first
    // 30s tick lands on 00:00:00.
    vi.setSystemTime(new Date("2026-06-15T23:59:30Z"));
    const sched = await loadScheduler({ secret: "s3cr3t", port: "3001" });
    sched.startCronScheduler();

    await vi.advanceTimersByTimeAsync(30_000); // → 00:00:00 UTC, tick runs

    expect(mockFetch).toHaveBeenCalled();
    const midnightCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("/api/cron/midnight-status-email")
    );
    expect(midnightCall).toBeDefined();
    expect(midnightCall![0]).toBe(
      "http://localhost:3001/api/cron/midnight-status-email"
    );
    expect(midnightCall![1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer s3cr3t",
      },
    });
    sched.stopCronScheduler();
  });

  it("posts the daily ops summary at 00:30 UTC (after the last billing-sync run of the prior day)", async () => {
    vi.setSystemTime(new Date("2026-06-15T00:29:30Z"));
    const sched = await loadScheduler({ secret: "s3cr3t", port: "3001" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000); // → 00:30:00 UTC, tick runs
    const opsCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("/api/cron/daily-ops-summary")
    );
    expect(opsCall).toBeDefined();
    sched.stopCronScheduler();
  });

  it("does NOT run a daily job whose window has not arrived (no catch-up)", async () => {
    // baremetal-lifecycle fires at 08:00 UTC. At 06:00 with no prior run the
    // window hasn't matched AND catch-up is not due (it's still in the future).
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000); // tick at 06:00:30
    const dailyCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("baremetal-lifecycle")
    );
    expect(dailyCall).toBeUndefined();
    sched.stopCronScheduler();
  });

  it("does not re-run a daily job that already ran today (persisted state)", async () => {
    // Seed disk state marking the midnight job as already run today, then sit
    // at a time where its window does NOT match and catch-up is suppressed
    // (already ran today). It must not fire again.
    const stateFile = `${process.cwd()}/data/.cron-state.json`;
    fileStore[stateFile] = JSON.stringify({
      "midnight-status-email": "2026-06-15T00:00:05.000Z",
    });
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    const midnightCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("midnight-status-email")
    );
    expect(midnightCall).toBeUndefined();
    sched.stopCronScheduler();
  });
});

describe("catch-up after boot", () => {
  it("runs a daily job that already missed its window today", async () => {
    // baremetal-lifecycle fires at 08:00 UTC. Boot at 09:00 with no prior run
    // → catch-up should fire it ~10s after start.
    vi.setSystemTime(new Date("2026-06-15T09:00:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(10_000); // boot catch-up setTimeout
    const call = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("baremetal-lifecycle")
    );
    expect(call).toBeDefined();
    sched.stopCronScheduler();
  });

  it("does NOT catch up a daily job whose window is still in the future today", async () => {
    vi.setSystemTime(new Date("2026-06-15T06:00:00Z")); // before 08:00 lifecycle
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(10_000);
    const call = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("baremetal-lifecycle")
    );
    expect(call).toBeUndefined();
    sched.stopCronScheduler();
  });
});

describe("interval jobs", () => {
  it("runs an interval job immediately on the first tick (no prior run)", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000); // first tick
    const call = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("check-pending-deploys")
    );
    expect(call).toBeDefined();
    sched.stopCronScheduler();
  });
});

describe("executeJob error handling + state persistence", () => {
  it("persists last-run state to disk after a job runs", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    const stateFile = `${process.cwd()}/data/.cron-state.json`;
    expect(fileStore[stateFile]).toBeDefined();
    const persisted = JSON.parse(fileStore[stateFile]);
    // The 2.5-min interval job should have recorded a last-run timestamp.
    expect(persisted["check-pending-deploys"]).toBeDefined();
    sched.stopCronScheduler();
  });

  it("swallows a non-ok job response without throwing", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    // Advancing must not reject; the non-ok response is logged, not thrown.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => String(c[0]).includes("failed")
      )
    ).toBe(true);
    sched.stopCronScheduler();
  });

  it("swallows a fetch rejection without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    // The rejected fetch is caught inside executeJob; advancing must not throw.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => String(c[0]).includes("error")
      )
    ).toBe(true);
    sched.stopCronScheduler();
  });
});

describe("stopCronScheduler", () => {
  it("clears the tick timer so no further jobs fire", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    const callsAfterFirst = mockFetch.mock.calls.length;
    sched.stopCronScheduler();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
  });

  it("allows a fresh start after stop (resets the started flag)", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:30:00Z"));
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();
    sched.stopCronScheduler();
    sched.startCronScheduler();
    const warn = console.log as unknown as ReturnType<typeof vi.fn>;
    // A clean restart should NOT log the duplicate-start guard.
    expect(
      warn.mock.calls.filter((c) =>
        String(c[0]).includes("Already running")
      ).length
    ).toBe(0);
    sched.stopCronScheduler();
  });
});

describe("CRON_HANDED_OVER gate", () => {
  afterEach(() => {
    delete process.env.CRON_HANDED_OVER;
  });

  it("names in the env are excluded from ticks and boot catch-up", async () => {
    // The gate reads the env at module load, so exercise it in isolation.
    vi.resetModules();
    process.env.CRON_HANDED_OVER = "check-pending-deploys, daily-ops-summary";
    const mod = await import("@/lib/cron-scheduler");
    const names = mod.activeJobNames();
    expect(names).not.toContain("check-pending-deploys");
    expect(names).not.toContain("daily-ops-summary");
    expect(names).toContain("midnight-status-email");
  });

  it("the startup banner names only the jobs that will actually fire", async () => {
    // The cutover runbook reads this line to confirm a handover took, so a
    // handed-over job appearing here reads as "still scheduled".
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    process.env.CRON_HANDED_OVER = "check-pending-deploys";
    const sched = await loadScheduler({ secret: "s3cr3t" });
    sched.startCronScheduler();

    const lines = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0])
    );
    const banner = lines.find((l) => l.includes("Started with"));
    expect(banner).toBeDefined();
    expect(banner).not.toContain("check-pending-deploys");
    expect(banner).toContain("midnight-status-email");
    expect(
      lines.some(
        (l) => l.includes("Handed over to packet-api") && l.includes("check-pending-deploys")
      )
    ).toBe(true);

    sched.stopCronScheduler();
  });
});
