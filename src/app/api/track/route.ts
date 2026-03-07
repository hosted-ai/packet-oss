import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/ratelimit";

/**
 * POST /api/track
 *
 * Lightweight, anonymous page-view recorder. Called client-side on every
 * marketing page load. No auth, no PII, no cookies.
 *
 * Body: { sessionId, page, referrer?, utm? }
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`track:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ ok: true }); // silent drop, don't reveal rate limit
  }

  try {
    const body = await request.json();
    const { sessionId, page, referrer, utm } = body;

    if (!sessionId || !page) {
      return NextResponse.json({ ok: true }); // silent drop for malformed
    }

    // Sanitize inputs (max lengths)
    const clean = {
      sessionId: String(sessionId).slice(0, 64),
      page: String(page).slice(0, 500),
      referrer: referrer ? String(referrer).slice(0, 1000) : null,
      utmSource: utm?.utm_source ? String(utm.utm_source).slice(0, 200) : null,
      utmMedium: utm?.utm_medium ? String(utm.utm_medium).slice(0, 200) : null,
      utmCampaign: utm?.utm_campaign ? String(utm.utm_campaign).slice(0, 200) : null,
      utmContent: utm?.utm_content ? String(utm.utm_content).slice(0, 200) : null,
      utmTerm: utm?.utm_term ? String(utm.utm_term).slice(0, 200) : null,
    };

    await prisma.pageView.create({ data: clean });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never fail visibly
  }
}
