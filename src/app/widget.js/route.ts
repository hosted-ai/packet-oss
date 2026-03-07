import { NextResponse } from 'next/server';
import { widgetBundle, WIDGET_BUNDLE_VERSION } from '@/widget/widget-bundle';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /widget.js
 *
 * Serves the self-contained widget loader JavaScript bundle.
 * This is included on tenant marketing sites via a <script> tag:
 *
 *   <script src="https://dashboard.tenant.com/widget.js"></script>
 *
 * The bundle auto-initializes, discovers [data-packet-widget] elements,
 * and exposes window.PacketWidget for programmatic use.
 */
export async function GET() {
  const headers = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Widget-Version': WIDGET_BUNDLE_VERSION,
    ...CORS_HEADERS,
  };

  return new NextResponse(widgetBundle, {
    status: 200,
    headers,
  });
}
