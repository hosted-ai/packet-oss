// PA-354: calendar-month proration for monthly-billed subscriptions.
// The load-bearing behaviors: whole-calendar-day granularity, month-by-month
// day counts across boundaries, and null endedAt meaning "active through the
// window end". Getting these wrong misstates investor revenue/payouts.

import { describe, it, expect } from "vitest";
import {
  prorateMonthlyCents,
  dailyMonthlyEstimateCents,
  overlapsWindow,
} from "@/lib/subscription-proration";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sub = (startedAt: string, endedAt: string | null, priceCents = 31000) => ({
  startedAt: d(startedAt),
  endedAt: endedAt ? d(endedAt) : null,
  priceCents,
});

describe("prorateMonthlyCents", () => {
  it("bills the full price for a subscription active the whole month", () => {
    expect(
      prorateMonthlyCents(sub("2026-01-01", null), d("2026-07-01"), d("2026-07-31")),
    ).toBe(31000);
  });

  it("prorates a mid-month start by remaining days", () => {
    // June has 30 days; active Jun 16–30 = 15 days → half the price
    expect(
      prorateMonthlyCents(sub("2026-06-16", null, 30000), d("2026-06-01"), d("2026-06-30")),
    ).toBe(15000);
  });

  it("prorates a mid-month termination", () => {
    // Active Jul 1–10 of a 31-day month
    expect(
      prorateMonthlyCents(sub("2026-01-01", "2026-07-10"), d("2026-07-01"), d("2026-07-31")),
    ).toBe(Math.round((31000 / 31) * 10));
  });

  it("uses each month's own day count across a boundary", () => {
    // Jan 20 – Feb 28: 12 days of Jan (31-day month) + full Feb (28 days)
    const expected = Math.round((31000 / 31) * 12) + Math.round((31000 / 28) * 28);
    expect(
      prorateMonthlyCents(sub("2026-01-20", "2026-02-28"), d("2026-01-01"), d("2026-02-28")),
    ).toBe(expected);
  });

  it("handles leap-year February", () => {
    // 2028 is a leap year — full Feb = full price over 29 days
    expect(
      prorateMonthlyCents(sub("2028-02-01", null, 29000), d("2028-02-01"), d("2028-02-29")),
    ).toBe(29000);
  });

  it("returns 0 when the subscription ended before the window", () => {
    expect(
      prorateMonthlyCents(sub("2026-01-01", "2026-05-31"), d("2026-07-01"), d("2026-07-31")),
    ).toBe(0);
  });

  it("returns 0 when the subscription starts after the window", () => {
    expect(
      prorateMonthlyCents(sub("2026-08-02", null), d("2026-07-01"), d("2026-07-31")),
    ).toBe(0);
  });

  it("counts a single active day as one whole day", () => {
    expect(
      prorateMonthlyCents(sub("2026-07-10", "2026-07-10"), d("2026-07-01"), d("2026-07-31")),
    ).toBe(Math.round(31000 / 31));
  });

  it("clamps a still-active subscription to the window end (month-to-date)", () => {
    // Window Jul 1–15 = 15 of 31 days
    expect(
      prorateMonthlyCents(sub("2026-01-01", null), d("2026-07-01"), d("2026-07-15")),
    ).toBe(Math.round((31000 / 31) * 15));
  });

  it("ignores non-positive prices", () => {
    expect(
      prorateMonthlyCents(sub("2026-01-01", null, 0), d("2026-07-01"), d("2026-07-31")),
    ).toBe(0);
  });
});

describe("dailyMonthlyEstimateCents", () => {
  it("sums price/daysInMonth for every subscription active that day", () => {
    const subs = [sub("2026-06-01", null, 31000), sub("2026-07-10", null, 15500)];
    // Jul 15: both active → 31000/31 + 15500/31
    expect(dailyMonthlyEstimateCents(subs, d("2026-07-15"))).toBe(1000 + 500);
    // Jul 5: only the first is active
    expect(dailyMonthlyEstimateCents(subs, d("2026-07-05"))).toBe(1000);
  });

  it("excludes subscriptions ended before the day", () => {
    expect(dailyMonthlyEstimateCents([sub("2026-06-01", "2026-07-10")], d("2026-07-11"))).toBe(0);
    expect(dailyMonthlyEstimateCents([sub("2026-06-01", "2026-07-10")], d("2026-07-10"))).toBe(1000);
  });
});

describe("overlapsWindow", () => {
  it("detects overlap for active and closed windows", () => {
    expect(overlapsWindow(sub("2026-06-01", null), d("2026-07-01"), d("2026-07-31"))).toBe(true);
    expect(overlapsWindow(sub("2026-06-01", "2026-07-01"), d("2026-07-01"), d("2026-07-31"))).toBe(true);
    expect(overlapsWindow(sub("2026-06-01", "2026-06-30"), d("2026-07-01"), d("2026-07-31"))).toBe(false);
    expect(overlapsWindow(sub("2026-08-01", null), d("2026-07-01"), d("2026-07-31"))).toBe(false);
  });
});
