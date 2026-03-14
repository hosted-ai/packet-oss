import { NextRequest, NextResponse } from 'next/server';
import { isPro } from '@/lib/edition';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

/** GPU catalog for display names. */
const GPU_NAMES: Record<string, string> = {
  'rtx-pro-6000': 'RTX PRO 6000',
  'b200': 'NVIDIA B200',
  'h200': 'NVIDIA H200',
  'h100': 'NVIDIA H100',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    // In Pro edition with multi-tenancy, resolve tenant GPU types
    let allowedGpuTypes: string[] = Object.keys(GPU_NAMES);
    let statusPageEnabled = true;

    if (isPro()) {
      try {
        const { getTenantFromRequest } = await import('@/lib/tenant');
        const tenant = await getTenantFromRequest(request);
        statusPageEnabled = tenant.statusPageEnabled;
        allowedGpuTypes = tenant.allowedGpuTypes;
      } catch {
        // Fall through to default behavior
      }
    }

    if (!statusPageEnabled) {
      return NextResponse.json(
        { error: 'Status page is not enabled for this tenant' },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    // Build per-GPU statuses. All operational for now;
    // real monitoring integration will replace this later.
    const gpus = allowedGpuTypes.map((gpuType) => ({
      gpuType,
      name: GPU_NAMES[gpuType] ?? gpuType,
      status: 'operational' as const,
    }));

    // Overall status derived from individual GPU statuses
    const allOperational = gpus.every((g) => g.status === 'operational');
    const overallStatus = allOperational ? 'operational' : 'degraded';

    return NextResponse.json(
      {
        status: overallStatus,
        gpus,
        uptime: { '30d': 99.95, '90d': 99.92 },
        lastChecked: new Date().toISOString(),
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error('Status API error:', error);
    return NextResponse.json(
      { error: 'Failed to load system status' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
