import { NextRequest, NextResponse } from "next/server";

/**
 * Block bogus POST requests to non-API page routes.
 *
 * Bots (e.g. 87.120.191.67, 64.89.160.33) repeatedly send POST /
 * with a body. Next.js 16 App Router interprets POST-with-body to
 * page routes as server action invocations. Since this codebase has
 * zero registered server actions, every such request triggers:
 *
 *   Error: Failed to find Server Action "x"
 *
 * This middleware intercepts those requests before they reach the
 * server action handler, returning 405 Method Not Allowed silently.
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || 'localhost';
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-host', hostname);

  if (request.method !== "POST") {
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // Allow all POST requests to API routes and Next.js internals
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // Any POST to a non-API route is not a legitimate request
  // (no server actions exist in this codebase)
  return new NextResponse(null, { status: 405, statusText: "Method Not Allowed" });
}

export const config = {
  // Run on all routes except static files and images
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
