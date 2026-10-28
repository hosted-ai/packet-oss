import { describe, it, expect } from "vitest";
import {
  computeStorageCharge,
  storageIntervalHours,
  type StorageAccumulatorState,
} from "@/lib/storage-billing";

// Production rate: 0.004 cents/GB/hr ≈ $0.00004/GB/hr
const RATE_CENTS_PER_GB_HR = 0.004;
const HALF_HOUR = 0.5;


function emptyState(windowStartedAt: number): StorageAccumulatorState {
  return { pendingCents: 0, pendingGbHours: 0, windowStartedAt };
}

describe("computeStorageCharge — bug repro for PA-159", () => {
  it("does not bill on a single 30-min interval when raw cost is sub-cent", () => {
    // PA-159 bug: 400GB × 0.004c × 0.5h = 0.8c. Old code Math.round'd to 1c.
    // Accumulator should NOT charge yet.
    const t0 = 1_700_000_000;
    const result = computeStorageCharge(
      emptyState(t0),
      400,
      RATE_CENTS_PER_GB_HR,
      HALF_HOUR,
      t0 + 30 * 60,
    );

    expect(result.charge).toBeNull();
    expect(result.newState.pendingCents).toBeCloseTo(0.8, 6);
    expect(result.newState.windowStartedAt).toBe(t0);
  });

  it("does not over-charge tiny storage volumes (10GB → $0.292/mo, not $14.60/mo)", () => {
    // 10GB at 0.004c/GB/hr for 1 month (730h) = 29.2c expected.
    // Old code: 10GB × 0.004c × 0.5h = 0.02c → Math.round = 0 → never charges.
    // OR if rate happened to round up: $14.60/mo floor.
    // Accumulator: should accumulate exactly 29.2c over the month.
    const intervalsPerMonth = 730 * 2; // 30-min intervals in 730h month
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;
    let totalBilled = 0;

    for (let i = 0; i < intervalsPerMonth; i++) {
      now += 30 * 60;
      const r = computeStorageCharge(state, 10, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
      if (r.charge) totalBilled += r.charge.cents;
      state = r.newState;
    }

    // Expected: 10 × 0.004 × 730 = 29.2 cents. Allow ±1c rounding floor.
    expect(totalBilled).toBeGreaterThanOrEqual(28);
    expect(totalBilled).toBeLessThanOrEqual(30);
  });

  it("flushes when accumulated cents cross 1, and carries the remainder forward", () => {
    // 400GB × 0.004c × 0.5h = 0.8c per interval.
    // After 2 intervals: 1.6c → bill 1c, carry 0.6c.
    // After 3rd interval: 0.6 + 0.8 = 1.4c → bill 1c, carry 0.4c.
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;

    now += 30 * 60;
    const r1 = computeStorageCharge(state, 400, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
    expect(r1.charge).toBeNull();
    state = r1.newState;

    now += 30 * 60;
    const r2 = computeStorageCharge(state, 400, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
    expect(r2.charge).not.toBeNull();
    expect(r2.charge!.cents).toBe(1);
    expect(r2.newState.pendingCents).toBeCloseTo(0.6, 6);
    expect(r2.newState.windowStartedAt).toBe(now); // window resets on flush
    state = r2.newState;

    now += 30 * 60;
    const r3 = computeStorageCharge(state, 400, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
    expect(r3.charge).not.toBeNull();
    expect(r3.charge!.cents).toBe(1);
    expect(r3.newState.pendingCents).toBeCloseTo(0.4, 6);
  });
});

describe("computeStorageCharge — description content", () => {
  it("description includes billed GB-hours, true rate, and the accrued-since date", () => {
    // Run enough intervals at 400GB to flush.
    let state = emptyState(Date.UTC(2026, 3, 29, 6, 0) / 1000);
    let now = state.windowStartedAt;

    let charge: NonNullable<ReturnType<typeof computeStorageCharge>["charge"]> | null = null;
    while (!charge) {
      now += 30 * 60;
      const r = computeStorageCharge(state, 400, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
      state = r.newState;
      charge = r.charge;
    }

    expect(charge.description).toContain("GB-hrs");
    expect(charge.description).toContain("$0.000040/GB/hr"); // true rate, not $0.0000
    expect(charge.description).toContain("accrued since 2026-04-29 06:00 UTC");
    expect(charge.description).not.toContain("$0.0000/GB/hr");
    expect(charge.description).not.toContain("rounded up");
    expect(charge.description).not.toContain("avg");
  });

  it("computes average GB across windows where storage changed", () => {
    // 30 min at 1000GB, then 30 min at 0GB → avg should be 500GB across the window.
    // 1000 × 0.004 × 0.5 = 2c → flushes immediately on first interval.
    // Use a smaller volume so it spans 2 intervals: 100GB → 0.2c, then 1000GB → 2c. Total 2.2c.
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;

    now += 30 * 60;
    const r1 = computeStorageCharge(state, 100, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
    expect(r1.charge).toBeNull();
    state = r1.newState;

    now += 30 * 60;
    const r2 = computeStorageCharge(state, 1000, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
    expect(r2.charge).not.toBeNull();
    // gbHours = 100×0.5 + 1000×0.5 = 550. window = 1h. avg = 550GB.
    expect(r2.charge!.avgGb).toBeCloseTo(550, 1);
    // 2c billed at 0.004c/GB-hr = 500 GB-hrs; the 0.2c remainder carries forward.
    expect(r2.charge!.description).toContain("500.00 GB-hrs");
  });
});

describe("computeStorageCharge — edge cases", () => {
  it("preserves window when storage is zero (no charge, no reset)", () => {
    const t0 = 1_700_000_000;
    const state: StorageAccumulatorState = {
      pendingCents: 0.5,
      pendingGbHours: 100,
      windowStartedAt: t0,
    };

    const result = computeStorageCharge(state, 0, RATE_CENTS_PER_GB_HR, HALF_HOUR, t0 + 30 * 60);

    expect(result.charge).toBeNull();
    expect(result.newState.pendingCents).toBe(0.5);
    expect(result.newState.pendingGbHours).toBe(100);
    expect(result.newState.windowStartedAt).toBe(t0);
  });

  it("handles zero rate (storage pricing disabled) without charging", () => {
    const t0 = 1_700_000_000;
    const result = computeStorageCharge(emptyState(t0), 1000, 0, HALF_HOUR, t0 + 30 * 60);

    expect(result.charge).toBeNull();
    expect(result.newState.pendingCents).toBe(0);
  });

  it("flushes on first interval when interval cost ≥ 1c (rate change scenario)", () => {
    // If admin raises rate, accumulator becomes a no-op: each interval flushes immediately.
    const t0 = 1_700_000_000;
    const highRate = 1.0; // 1 cent/GB/hr
    const result = computeStorageCharge(emptyState(t0), 100, highRate, HALF_HOUR, t0 + 30 * 60);

    // 100GB × 1c × 0.5h = 50c
    expect(result.charge).not.toBeNull();
    expect(result.charge!.cents).toBe(50);
    expect(result.newState.pendingCents).toBeCloseTo(0, 6);
  });
});

describe("PA-168 — avg GB drift when accrual interval ≠ real elapsed", () => {
  // Storage syncs fire when ≥25 min have elapsed (sync runs on a ~5-min cadence),
  // so real intervals run ~25-30 min, not exactly 30. The accumulator hits a fixed
  // GB-hours threshold (1¢ / 0.004 = 250 GB-hrs) regardless of volume, so the
  // displayed "avg" = 250 / realWindowHours — a timing artifact, not the volume.

  it("BUG: a steady 100GB volume reports inflated avg GB when accrued at a fixed 30-min interval", () => {
    // Reproduces prod: real intervals are 27 min, but the buggy caller passes a
    // fixed HALF_HOUR. After 5 intervals: 250 GB-hrs over 2.25h real → 111GB shown.
    const REAL_MIN = 27;
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;
    let charge: NonNullable<ReturnType<typeof computeStorageCharge>["charge"]> | null = null;

    while (!charge) {
      now += REAL_MIN * 60;
      const r = computeStorageCharge(state, 100, RATE_CENTS_PER_GB_HR, HALF_HOUR, now);
      state = r.newState;
      charge = r.charge;
    }

    expect(charge.cents).toBe(1);
    expect(charge.avgGb).toBe(111); // wrong — volume is steady 100GB
  });

  it("FIX: feeding real elapsed hours keeps avg GB == the true volume", () => {
    // Same 27-min real intervals, but accrue with real elapsed via storageIntervalHours.
    const REAL_MIN = 27;
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;
    let lastSync = now; // windowStartedAt == first metering's lastSync
    let charge: NonNullable<ReturnType<typeof computeStorageCharge>["charge"]> | null = null;

    while (!charge) {
      const prev = now;
      now += REAL_MIN * 60;
      const h = storageIntervalHours(now, prev, 30, 60); // = 0.45h
      const r = computeStorageCharge(state, 100, RATE_CENTS_PER_GB_HR, h, now);
      state = r.newState;
      lastSync = now;
      charge = r.charge;
    }
    void lastSync;

    expect(charge.cents).toBe(1);
    expect(charge.avgGb).toBe(100); // correct
    expect(charge.description).toContain("250.00 GB-hrs");
  });

  it("FIX: avg GB stays exact across jittery real intervals (25-30 min mix)", () => {
    // Mirrors the screenshot's mixed window lengths. With real-elapsed accrual the
    // numerator and denominator telescope, so the average is the volume exactly.
    const INTERVALS_MIN = [25, 28, 26, 30, 27, 25, 29, 26, 30, 28, 25, 27, 26, 29, 30];
    let state = emptyState(1_700_000_000);
    let now = 1_700_000_000;
    let totalBilled = 0;
    let totalMinutes = 0;

    for (const min of INTERVALS_MIN) {
      const prev = now;
      now += min * 60;
      totalMinutes += min;
      const h = storageIntervalHours(now, prev, 30, 60);
      const r = computeStorageCharge(state, 100, RATE_CENTS_PER_GB_HR, h, now);
      if (r.charge) {
        expect(r.charge.avgGb).toBe(100); // never drifts
        totalBilled += r.charge.cents;
      }
      state = r.newState;
    }

    // Billing tracks real elapsed: 100GB × 0.004c × (minutes/60).
    const expectedCents = 100 * RATE_CENTS_PER_GB_HR * (totalMinutes / 60);
    expect(totalBilled).toBeGreaterThanOrEqual(Math.floor(expectedCents) - 1);
    expect(totalBilled).toBeLessThanOrEqual(Math.ceil(expectedCents));
  });
});

describe("storageIntervalHours", () => {
  const NOW = 1_700_000_000;

  it("returns real elapsed hours when a prior sync timestamp exists", () => {
    expect(storageIntervalHours(NOW, NOW - 27 * 60, 30, 60)).toBeCloseTo(0.45, 6);
    expect(storageIntervalHours(NOW, NOW - 25 * 60, 30, 60)).toBeCloseTo(25 / 60, 6);
  });

  it("falls back to the nominal interval on the first metering", () => {
    expect(storageIntervalHours(NOW, null, 30, 60)).toBe(0.5);
    expect(storageIntervalHours(NOW, NaN, 30, 60)).toBe(0.5);
    expect(storageIntervalHours(NOW, 0, 30, 60)).toBe(0.5);
  });

  it("caps the interval so a sync outage can't bill an unbounded chunk", () => {
    expect(storageIntervalHours(NOW, NOW - 6 * 3600, 30, 60)).toBe(1.0); // 6h elapsed → capped at 60 min
  });

  it("returns 0 on clock skew (negative elapsed), accruing nothing", () => {
    expect(storageIntervalHours(NOW, NOW + 100, 30, 60)).toBe(0);
  });
});

// The description is a customer-facing Stripe statement line, so both the common
// one-interval charge and a months-long accrual are pinned to an exact string.
describe("computeStorageCharge — description names what was billed", () => {
  const START = Date.UTC(2026, 8, 1, 22, 27) / 1000;

  it("a charge covering exactly one capped interval reads as the GB-hours billed", () => {
    const r = computeStorageCharge(emptyState(START), 5000, RATE_CENTS_PER_GB_HR, HALF_HOUR, START + 1800);

    expect(r.charge!.cents).toBe(10);
    expect(r.charge!.description).toBe(
      "Storage: 2500.00 GB-hrs @ $0.000040/GB/hr (accrued since 2026-09-01 22:27 UTC)",
    );
  });

  it("a months-long accrual states the accrued-since date, never a 0GB average", () => {
    // A small volume crosses 1c after ~111 days; the window is unbounded, the
    // billed GB-hours are not.
    const windowStartedAt = Date.UTC(2026, 4, 13, 6, 43) / 1000;
    const nowSec = Date.UTC(2026, 8, 1, 22, 57) / 1000;
    const state: StorageAccumulatorState = { pendingCents: 0.999, pendingGbHours: 249.75, windowStartedAt };

    const r = computeStorageCharge(state, 1, RATE_CENTS_PER_GB_HR, 1, nowSec);

    expect(r.charge!.cents).toBe(1);
    expect(r.charge!.description).toBe(
      "Storage: 250.00 GB-hrs @ $0.000040/GB/hr (accrued since 2026-05-13 06:43 UTC)",
    );
    expect(r.charge!.description).not.toContain("0GB");
    expect(r.charge!.description).not.toContain("2680");
  });

  it("rate x billed GB-hours equals the cents charged", () => {
    const r = computeStorageCharge(emptyState(START), 800, RATE_CENTS_PER_GB_HR, HALF_HOUR, START + 1800);

    const gbHours = parseFloat(r.charge!.description.match(/([\d.]+) GB-hrs/)![1]);
    expect(gbHours * RATE_CENTS_PER_GB_HR).toBeCloseTo(r.charge!.cents, 6);
  });
});
