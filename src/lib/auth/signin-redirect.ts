/**
 * Build the URL we bounce an unauthenticated / expired-session visitor to,
 * preserving the deep link they were trying to reach.
 *
 * PA-335: previously the bounce dropped the original destination, so after
 * signup the user landed on a generic page and the welcome email pointed
 * nowhere useful. We now capture the current location as `?next=<path+search>`.
 * `/account` forwards that through signup/signin; the server re-sanitises it
 * with `sanitizeNextPath` before signing it into the magic-link token, so the
 * value here is a hint, not a trust boundary.
 *
 * @param base    sign-in path to send them to (e.g. "/account", "/admin/login").
 * @param current where they are now — `window.location.pathname + window.location.search`.
 */
export function buildSignInRedirect(base: string, current: string): string {
  // Dummy origin: these are root-relative app paths, so the origin is irrelevant
  // — we only ever return pathname + search.
  const url = new URL(base, "http://internal");
  url.searchParams.set("reason", "session_expired");

  const next = captureNext(current, url.pathname);
  if (next) url.searchParams.set("next", next);

  return url.pathname + url.search;
}

function captureNext(current: unknown, signInPath: string): string | undefined {
  if (typeof current !== "string" || current[0] !== "/") return undefined;
  let pathname: string;
  try {
    pathname = new URL(current, "http://internal").pathname;
  } catch {
    return undefined;
  }
  // Nothing worth preserving for the bare root, and never capture the sign-in
  // page itself (it would just loop the visitor back here after login).
  if (pathname === "/" || pathname === signInPath) return undefined;
  return current;
}
