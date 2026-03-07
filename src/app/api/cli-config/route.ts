import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || 'GPU Cloud';
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@example.com';

    return NextResponse.json(
      {
        brandName,
        apiBaseUrl: `${baseUrl}/api/v1`,
        dashboardUrl: baseUrl,
        docsUrl: `${baseUrl}/docs`,
        statusUrl: `${baseUrl}/status`,
        supportEmail,
        version: '1.0.0',
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error('CLI config error:', error);
    return NextResponse.json(
      { error: 'Failed to load CLI configuration' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
