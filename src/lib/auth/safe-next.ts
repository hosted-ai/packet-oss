/**
 * Validate a post-login redirect ("next") target before it is signed into a
 * magic-link token and again before it is honoured.
 *
 * A legitimate `next` value is any same-origin, root-relative app path — a
 * /dashboard CTA, a shared page, a marketing `?ref=` deep link — which is how
 * the destination survives the login round-trip (PA-335). API routes are
 * excluded (a redirect there would just dump JSON); everything else that fails
 * the open-redirect guards below is rejected to a safe `undefined`.
 *
 * Defends against open-redirect: scheme-relative `//host`, absolute URLs,
 * backslashes, encoded slashes (%2f/%5c), path traversal (..), userinfo `@`,
 * and any path outside the allowlist.
 */
export function sanitizeNextPath(next: unknown, appUrl: string): string | undefined {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return undefined;

  // Must be root-relative — not scheme-relative ("//host") or "/\host", not absolute.
  if (next[0] !== "/" || next[1] === "/" || next[1] === "\\") return undefined;

  // Reject encoding / traversal / userinfo tricks before normalisation.
  const lower = next.toLowerCase();
  if (
    lower.includes("\\") ||
    lower.includes("..") ||
    lower.includes("@") ||
    lower.includes("%2f") ||
    lower.includes("%5c") ||
    lower.includes("%2e")
  ) {
    return undefined;
  }

  let base: URL;
  try {
    base = new URL(appUrl);
  } catch {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return undefined;
  }

  // Resolving the relative path must not have escaped the app's origin.
  if (url.origin !== base.origin) return undefined;

  // API routes are never a user-facing destination — redirecting there dumps
  // raw JSON at the visitor. Everything else that reached this point is a
  // same-origin, root-relative app path and is safe to honour.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return undefined;

  return url.pathname + url.search;
}
