/**
 * Edition detection for Pro vs open-source builds.
 *
 * The edition is determined by a single env var `EDITION` at build time:
 *   - "oss"  → open-source edition (generic branding, no premium features)
 *   - unset / anything else → Pro edition
 *
 * The export-oss pipeline sets EDITION=oss in the OSS .env.
 */

export type Edition = "pro" | "oss";

let _edition: Edition | null = null;

function resolveEdition(): Edition {
  if (_edition) return _edition;
  _edition =
    process.env.NEXT_PUBLIC_EDITION === "oss" ||
    process.env.EDITION === "oss"
      ? "oss"
      : "pro";
  return _edition;
}

/** Current edition identifier */
export function getEdition(): Edition {
  return resolveEdition();
}

/** True when running the open-source build */
export function isOSS(): boolean {
  return resolveEdition() === "oss";
}

/** True when running the Pro build */
export function isPro(): boolean {
  return resolveEdition() === "pro";
}

/**
 * Guard for premium-only code paths.
 * Returns `true` only in Pro edition — use to hide tabs, routes, features.
 *
 * Example:
 *   if (hasPremiumFeature("token-factory")) { ... }
 */
export function hasPremiumFeature(_feature: string): boolean {
  // In the OSS build, premium feature source files are physically removed
  // by the export pipeline. This guard is a runtime safety net for any
  // shared code that conditionally references premium functionality.
  return isPro();
}
