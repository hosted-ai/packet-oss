import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { getTemplateDefault, getRegisteredDefaultSlugs } from "@/lib/email/template-defaults";

/**
 * GET /api/admin/email-templates/defaults?slug=xxx
 *
 * Returns the code-based fallback HTML/text for a given email template slug.
 * Used by the admin Email Templates tab to pre-fill the editor with the actual
 * email content when an admin wants to customise a template.
 *
 * Without a slug query param, returns the list of slugs that have defaults.
 */
export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = request.nextUrl.searchParams.get("slug");

  // If no slug provided, return list of available slugs
  if (!slug) {
    return NextResponse.json({
      slugs: getRegisteredDefaultSlugs(),
    });
  }

  const defaults = getTemplateDefault(slug);

  if (!defaults) {
    return NextResponse.json(
      { error: `No default template found for slug "${slug}"` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    slug,
    subject: defaults.subject,
    html: defaults.html,
    text: defaults.text,
  });
}
