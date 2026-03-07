import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

/** GPU catalog for display names. */
const GPU_TYPES: { gpuType: string; name: string }[] = [
  { gpuType: 'rtx-pro-6000', name: 'RTX PRO 6000' },
  { gpuType: 'b200', name: 'NVIDIA B200' },
  { gpuType: 'h200', name: 'NVIDIA H200' },
  { gpuType: 'h100', name: 'NVIDIA H100' },
];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    // Build per-GPU statuses. All operational for now;
    // real monitoring integration will replace this later.
    const gpus = GPU_TYPES.map(({ gpuType, name }) => ({
      gpuType,
      name,
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
