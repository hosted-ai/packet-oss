/**
 * Stopped-instance reservation billing.
 *
 * Bug (seen in prod/staging): a stopped GPU at 50% was billed ~15x a running
 * GPU at 100% for the same 30-min interval ($751.90 vs $50). Root cause: the
 * sync route charged a FLEET-WIDE AVERAGE of every pod's hourlyRateCents, so an
 * expensive (or stale terminated) pod inflated the rate applied to a cheap
 * stopped pod. Each pod must be priced at its OWN rate.
 *
 * computeStoppedCharge() is the extracted pure calc: each stopped pod priced at
 * its own WHOLE-INSTANCE rate (PodMetadata.hourlyRateCents already covers every
 * GPU in the pod — a "2 x A100" product is priced for both — so it is NOT
 * multiplied by gpuCount), summed, then × percent × interval.
 */
import { describe, it, expect } from "vitest";
import {
  computeStoppedCharge,
  stoppedPoolCharges,
  wasStoppedBilledRecently,
} from "@/lib/stopped-billing";

describe("computeStoppedCharge", () => {
  it("charges a single stopped pod the stopped % of ITS OWN rate (not a fleet avg)", () => {
    // $100/hr pod, 50%, 30 min → $25 (half of the $50 running charge).
    const r = computeStoppedCharge([{ gpuCount: 1, podHourlyRateCents: 10000 }], 50, 30);
    expect(r).toEqual({ stoppedGpuCount: 1, stoppedCostCents: 2500 });
  });

  it("at 100% equals the running charge for the interval", () => {
    const r = computeStoppedCharge([{ gpuCount: 1, podHourlyRateCents: 10000 }], 100, 30);
    expect(r.stoppedCostCents).toBe(5000); // $50, same as running @ $100/hr x 30min
  });

  it("does NOT multiply the whole-instance rate by gpuCount (vgpu_count>1 landmine)", () => {
    // A 2-GPU pod priced at $200/hr — the product price ("2 x ...") already covers
    // both GPUs — at 100%, 30 min → $200 × 0.5h = $100. The old per-GPU logic would
    // have billed $200 × 2 × 0.5h = $200, double-charging. gpuCount stays in the
    // display count but never enters the charge math.
    const r = computeStoppedCharge([{ gpuCount: 2, podHourlyRateCents: 20000 }], 100, 30);
    expect(r.stoppedCostCents).toBe(10000);
    expect(r.stoppedCostCents).not.toBe(20000); // the ×gpuCount overcharge
    expect(r.stoppedGpuCount).toBe(2); // display only
  });

  it("bills each pod at its own rate — never a blended average (regression: $751.90)", () => {
    // A cheap $100/hr pod + an expensive $750/hr pod, both stopped, 50%, 30min.
    // Own whole-instance rates summed: (10000 + 75000) = 85000/hr × 0.5 × 0.5h = 21250.
    // The old fleet-average logic blended these and overcharged the cheap pod.
    const r = computeStoppedCharge(
      [
        { gpuCount: 1, podHourlyRateCents: 10000 },
        { gpuCount: 8, podHourlyRateCents: 75000 },
      ],
      50,
      30,
    );
    expect(r).toEqual({ stoppedGpuCount: 9, stoppedCostCents: 21250 });
  });

  it("a cheap stopped pod's charge is unaffected by an expensive one (the actual bug)", () => {
    // The reported bug: one stopped $100/hr GPU billed $751.90 because pricier
    // pods polluted the average. Here the cheap pod alone is always exactly $25.
    const cheapAlone = computeStoppedCharge([{ gpuCount: 1, podHourlyRateCents: 10000 }], 50, 30);
    expect(cheapAlone.stoppedCostCents).toBe(2500);
    expect(cheapAlone.stoppedCostCents).toBeLessThan(5000); // always < running
  });

  it("skips pods with no known rate instead of guessing (no avg fallback)", () => {
    const r = computeStoppedCharge(
      [
        { gpuCount: 1, podHourlyRateCents: 0 }, // unpriced → not billed, not counted
        { gpuCount: 2, podHourlyRateCents: 20000 },
      ],
      50,
      30,
    );
    // Only the priced pod: 20000/hr × 0.5 × 0.5h = 5000 ($50); its 2 GPUs counted for display.
    expect(r).toEqual({ stoppedGpuCount: 2, stoppedCostCents: 5000 });
  });

  it("returns zero when nothing is stopped", () => {
    expect(computeStoppedCharge([], 50, 30)).toEqual({ stoppedGpuCount: 0, stoppedCostCents: 0 });
  });

  it("returns zero cost when the stopped rate is 0%", () => {
    const r = computeStoppedCharge([{ gpuCount: 1, podHourlyRateCents: 10000 }], 0, 30);
    expect(r.stoppedCostCents).toBe(0);
    expect(r.stoppedGpuCount).toBe(1);
  });

  it("rounds to the nearest cent", () => {
    // 3333 × 0.25 × 0.5 = 416.625 → 417
    const r = computeStoppedCharge([{ gpuCount: 1, podHourlyRateCents: 3333 }], 25, 30);
    expect(r.stoppedCostCents).toBe(417);
  });

  it("treats a fractional/zero gpuCount as at least 1 GPU for the display count", () => {
    const r = computeStoppedCharge([{ gpuCount: 0, podHourlyRateCents: 10000 }], 100, 30);
    expect(r).toEqual({ stoppedGpuCount: 1, stoppedCostCents: 5000 });
  });
});

describe("stoppedPoolCharges — per-pool pricing for the pool-tagged ledger rows", () => {
  it("single pool (the common case): one row exactly equal to the whole-fleet Stripe charge", () => {
    const pods = [
      { gpuCount: 1, podHourlyRateCents: 10000, poolId: 143 },
      { gpuCount: 2, podHourlyRateCents: 20000, poolId: 143 },
    ];
    const whole = computeStoppedCharge(pods, 50, 30); // what Stripe is charged (unchanged)
    const rows = stoppedPoolCharges(pods, 50, 30);
    expect(rows).toEqual([{ poolId: 143, amountCents: 7500, gpuCount: 3 }]);
    expect(rows[0].amountCents).toBe(whole.stoppedCostCents);
    expect(rows[0].gpuCount).toBe(whole.stoppedGpuCount);
  });

  it("prices each pool independently with the same per-pod math", () => {
    const rows = stoppedPoolCharges(
      [
        { gpuCount: 8, podHourlyRateCents: 75000, poolId: 1 },
        { gpuCount: 1, podHourlyRateCents: 25000, poolId: 2 },
      ],
      50,
      30,
    );
    // Pool 1: 75000/hr × 0.5 × 0.5h = 18750; pool 2: 25000/hr × 0.5 × 0.5h = 6250.
    expect(rows).toEqual([
      { poolId: 1, amountCents: 18750, gpuCount: 8 },
      { poolId: 2, amountCents: 6250, gpuCount: 1 },
    ]);
  });

  it("excludes unpriced pods, same as computeStoppedCharge (never attribute what wasn't billed)", () => {
    const rows = stoppedPoolCharges(
      [
        { gpuCount: 1, podHourlyRateCents: 0, poolId: 1 }, // unpriced → skipped
        { gpuCount: 1, podHourlyRateCents: 10000, poolId: 2 },
      ],
      50,
      30,
    );
    expect(rows).toEqual([{ poolId: 2, amountCents: 2500, gpuCount: 1 }]);
  });

  it("returns no rows when nothing is billable", () => {
    expect(stoppedPoolCharges([], 50, 30)).toEqual([]);
    expect(
      stoppedPoolCharges([{ gpuCount: 1, podHourlyRateCents: 0, poolId: 1 }], 50, 30),
    ).toEqual([]);
    // 0% rate → 0¢ everywhere → no ledger rows (matches the charge gate in sync).
    expect(
      stoppedPoolCharges([{ gpuCount: 2, podHourlyRateCents: 10000, poolId: 7 }], 0, 30),
    ).toEqual([]);
  });

  it("keeps an unknown pool as its own null-tagged row", () => {
    const rows = stoppedPoolCharges(
      [
        { gpuCount: 1, podHourlyRateCents: 10000, poolId: null },
        { gpuCount: 1, podHourlyRateCents: 10000, poolId: 5 },
      ],
      50,
      30,
    );
    expect(rows).toEqual([
      { poolId: null, amountCents: 2500, gpuCount: 1 },
      { poolId: 5, amountCents: 2500, gpuCount: 1 },
    ]);
  });
});

describe("wasStoppedBilledRecently — dedup guard", () => {
  const NOW = 1_000_000;

  it("returns true when a stopped_reservation charge is within the window", () => {
    const txns = [{ created: NOW - 60, metadata: { billing_type: "stopped_reservation" } }];
    expect(wasStoppedBilledRecently(txns, NOW, 300)).toBe(true);
  });

  it("returns false when the only stopped charge is older than the window", () => {
    const txns = [{ created: NOW - 600, metadata: { billing_type: "stopped_reservation" } }];
    expect(wasStoppedBilledRecently(txns, NOW, 300)).toBe(false);
  });

  it("ignores other charge types (GPU usage, storage)", () => {
    const txns = [
      { created: NOW - 10, metadata: { billing_type: "storage" } },
      { created: NOW - 10, metadata: null },
      { created: NOW - 10 },
    ];
    expect(wasStoppedBilledRecently(txns, NOW, 300)).toBe(false);
  });

  it("returns false for an empty transaction list", () => {
    expect(wasStoppedBilledRecently([], NOW, 300)).toBe(false);
  });

  it("detects a duplicate among a mix of recent transactions", () => {
    const txns = [
      { created: NOW - 5, metadata: { billing_type: "pod_usage" } },
      { created: NOW - 120, metadata: { billing_type: "stopped_reservation" } },
      { created: NOW - 5, metadata: { billing_type: "storage" } },
    ];
    expect(wasStoppedBilledRecently(txns, NOW, 300)).toBe(true);
  });
});
