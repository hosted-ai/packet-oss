/**
 * Marketing funnel cohort windows.
 *
 * The funnel is cohort-based: every stage is scoped to users who SIGNED UP within
 * the selected window (`signed_up_at`). This maps the UI's cohort dropdown value to
 * a Prisma date filter on `signedUpAt`.
 *
 * Accepted values (must match MarketingTab's <select>):
 *   "lifetime" | "7d" | "15d" | "30d" | "90d" | "180d" | "365d" | "month:YYYY-MM"
 * Anything unknown (or "lifetime") → no filter (whole population).
 *
 * `now` is injectable for deterministic tests.
 */
export function cohortSignupFilter(
  cohort: string | null | undefined,
  now: Date = new Date()
): { gte?: Date; lt?: Date } {
  if (!cohort || cohort === "lifetime") return {};

  const monthMatch = /^month:(\d{4})-(\d{2})$/.exec(cohort);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]); // 1-12
    if (month < 1 || month > 12) return {};
    // UTC month bounds — deterministic regardless of server TZ, and matches how
    // signedUpAt is stored (UTC). "June 2026" = [2026-06-01T00:00Z, 2026-07-01T00:00Z).
    return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
  }

  const days: Record<string, number> = {
    "7d": 7,
    "15d": 15,
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
  };
  const n = days[cohort];
  if (!n) return {};
  return { gte: new Date(now.getTime() - n * 24 * 60 * 60 * 1000) };
}
