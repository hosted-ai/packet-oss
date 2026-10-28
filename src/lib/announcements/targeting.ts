/**
 * Canonical announcement targeting and display values.
 *
 * `dashboard_announcement.target_type` and `.display_type` are free VARCHARs, and
 * every consumer tests them with positive equality (`=== "all"`, `=== "banner"`),
 * so a row holding anything else matches no branch and the announcement silently
 * disappears. These helpers canonicalise at the read boundary so those predicates
 * become total, and validate at the write boundary so new rows stay in the set.
 */

export const TARGET_TYPES = ["all", "pools"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const DISPLAY_TYPES = ["banner", "modal", "both"] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];

export function isTargetType(value: unknown): value is TargetType {
  return typeof value === "string" && (TARGET_TYPES as readonly string[]).includes(value);
}

export function isDisplayType(value: unknown): value is DisplayType {
  return typeof value === "string" && (DISPLAY_TYPES as readonly string[]).includes(value);
}

// Pool ids are stored as a JSON array string; anything unparseable is no pools.
export function parseTargetPoolIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  } catch {
    return [];
  }
}

// An unrecognised target degrades to "all" so a bad value cannot hide an
// announcement — unless it carries pool ids, which keep it restricted.
export function canonicalTargetType(
  targetType: string | null | undefined,
  targetPoolIds?: string | null
): TargetType {
  const normalised = targetType?.trim().toLowerCase();
  if (normalised === "pools") return "pools";
  if (normalised === "all") return "all";
  return parseTargetPoolIds(targetPoolIds).length > 0 ? "pools" : "all";
}

// An unrecognised display type degrades to "banner", the one every surface renders.
export function canonicalDisplayType(displayType: string | null | undefined): DisplayType {
  const normalised = displayType?.trim().toLowerCase();
  return isDisplayType(normalised) ? normalised : "banner";
}
