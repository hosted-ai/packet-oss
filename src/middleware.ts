import { NextRequest, NextResponse } from "next/server";

/**
 * Block bogus POST requests to non-API page routes.
 *
 * Bots repeatedly send POST to page routes. Next.js 16 App Router
 * interprets POST-with-body to page routes as server action invocations.
 * Since this codebase has zero registered server actions, every such
 * request triggers: Error: Failed to find Server Action "x"
 *
 * This middleware intercepts those requests, returning 405 silently.
 */
export function middleware(request: NextRequest) {
  if (request.method !== "POST") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  return new NextResponse(null, { status: 405, statusText: "Method Not Allowed" });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
