import { describe, it, expect } from "vitest";
import { cohortSignupFilter } from "@/lib/marketing-cohort";

describe("cohortSignupFilter", () => {
  it("lifetime / empty / unknown → no filter (whole population)", () => {
    expect(cohortSignupFilter("lifetime")).toEqual({});
    expect(cohortSignupFilter(null)).toEqual({});
    expect(cohortSignupFilter(undefined)).toEqual({});
    expect(cohortSignupFilter("bogus")).toEqual({});
  });

  it("relative window → gte = now - N days, no upper bound", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const { gte, lt } = cohortSignupFilter("30d", now);
    expect(lt).toBeUndefined();
    expect(gte?.toISOString()).toBe(new Date("2026-05-16T12:00:00Z").toISOString());
  });

  it("each relative window maps to the right day count", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
    for (const [w, n] of [["7d", 7], ["15d", 15], ["90d", 90], ["180d", 180], ["365d", 365]] as const) {
      const { gte } = cohortSignupFilter(w, now);
      expect(daysBetween(gte!, now)).toBe(n);
    }
  });

  it("month:YYYY-MM → [1st of month, 1st of next month) in UTC", () => {
    const { gte, lt } = cohortSignupFilter("month:2026-06");
    expect(gte?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("December rolls the upper bound into next year (UTC)", () => {
    const { gte, lt } = cohortSignupFilter("month:2025-12");
    expect(gte?.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(lt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("invalid month → no filter", () => {
    expect(cohortSignupFilter("month:2026-13")).toEqual({});
    expect(cohortSignupFilter("month:2026-00")).toEqual({});
  });
});
