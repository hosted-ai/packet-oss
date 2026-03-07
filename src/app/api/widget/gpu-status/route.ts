import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
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
    // For now, mark all GPU types as "available".
    // Real hosted.ai availability integration will be added later.
    const statuses = GPU_TYPES.map(({ gpuType, name }) => ({
      gpuType,
      name,
      status: 'available' as const,
    }));

    return NextResponse.json(statuses, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Widget GPU status error:', error);
    return NextResponse.json(
      { error: 'Failed to load GPU status' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
