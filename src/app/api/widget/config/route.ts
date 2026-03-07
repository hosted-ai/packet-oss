import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'GPU Cloud';

    return NextResponse.json(
      {
        brandName,
        primaryColor: '#1a4fff',
        accentColor: '#18b6a8',
        logoUrl: '/packet-logo.png',
        dashboardUrl,
        stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('Widget config error:', error);
    return NextResponse.json(
      { error: 'Failed to load widget configuration' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
