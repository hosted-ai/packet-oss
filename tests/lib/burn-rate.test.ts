// A stopped B200 reserving at 100% billed $23.60/hr while the wallet card
// showed only the running pods' rate — runway and the per-second ticker both
// understated the real drain. These pin the shared burn computation.

import { describe, it, expect } from "vitest";
import { computeHourlyBurn } from "@/lib/burn-rate";

describe("computeHourlyBurn", () => {
  const subs = [
    { status: "running", hourlyRate: 23.6 },
    { status: "running", hourlyRate: 3.75 },
    { status: "stopped", hourlyRate: 23.6 },
  ];

  it("counts a stopped pod's reservation at the stopped-rate percentage", () => {
    const burn = computeHourlyBurn(subs, 100);
    expect(burn.runningHourly).toBeCloseTo(27.35);
    expect(burn.stoppedHourly).toBeCloseTo(23.6);
    expect(burn.totalHourly).toBeCloseTo(50.95);
    expect(burn.stoppedBillableCount).toBe(1);
  });

  it("scales the reservation by the percentage", () => {
    const burn = computeHourlyBurn(subs, 25);
    expect(burn.stoppedHourly).toBeCloseTo(5.9);
    expect(burn.totalHourly).toBeCloseTo(33.25);
  });

  it("a zero stopped rate means stopped pods burn nothing", () => {
    const burn = computeHourlyBurn(subs, 0);
    expect(burn.stoppedHourly).toBe(0);
    expect(burn.stoppedBillableCount).toBe(0);
    expect(burn.totalHourly).toBeCloseTo(27.35);
  });

  it("ignores bare-metal rows and unknown statuses", () => {
    const burn = computeHourlyBurn(
      [
        { status: "stopped", nature: "baremetal", hourlyRate: 99 },
        { status: "online", hourlyRate: 99 },
        { status: "exited", hourlyRate: 10 },
      ],
      50,
    );
    expect(burn.runningHourly).toBe(0);
    expect(burn.stoppedHourly).toBeCloseTo(5);
  });
});
