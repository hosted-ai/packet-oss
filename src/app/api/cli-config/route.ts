import { NextRequest, NextResponse } from 'next/server';
import { isPro } from '@/lib/edition';
import { getBrandName, getDashboardUrl, getSupportEmail } from '@/lib/branding';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    // In Pro edition with multi-tenancy, resolve tenant from request
    if (isPro()) {
      try {
        const { getTenantFromRequest } = await import('@/lib/tenant');
        const tenant = await getTenantFromRequest(request);

        const primaryDomain = tenant.isDefault
          ? new URL(getDashboardUrl()).hostname
          : tenant.domains[0] || new URL(getDashboardUrl()).hostname;

        const baseUrl = `https://${primaryDomain}`;

        return NextResponse.json(
          {
            brandName: tenant.brandName,
            apiBaseUrl: `${baseUrl}/api/v1`,
            dashboardUrl: baseUrl,
            docsUrl: tenant.isDefault ? `${baseUrl}/docs` : `${baseUrl}/api-docs`,
            statusUrl: `${baseUrl}/status`,
            supportEmail: tenant.supportEmail,
            version: '1.0.0',
          },
          { headers: CORS_HEADERS },
        );
      } catch {
        // Fall through to default behavior
      }
    }

    // OSS / default behavior
    const baseUrl = getDashboardUrl();

    return NextResponse.json(
      {
        brandName: getBrandName(),
        apiBaseUrl: `${baseUrl}/api/v1`,
        dashboardUrl: baseUrl,
        docsUrl: `${baseUrl}/docs`,
        statusUrl: `${baseUrl}/status`,
        supportEmail: getSupportEmail(),
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
