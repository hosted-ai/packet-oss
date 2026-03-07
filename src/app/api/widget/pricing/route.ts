import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

/** GPU catalog with specs for display purposes. */
const GPU_CATALOG: Record<string, { name: string; vram: string; architecture: string }> = {
  'rtx-pro-6000': { name: 'RTX PRO 6000', vram: '96GB GDDR7', architecture: 'Blackwell' },
  'b200': { name: 'NVIDIA B200', vram: '180GB HBM3e', architecture: 'Blackwell' },
  'h200': { name: 'NVIDIA H200', vram: '141GB HBM3e', architecture: 'Hopper' },
  'h100': { name: 'NVIDIA H100', vram: '80GB HBM3', architecture: 'Hopper' },
};

/** Default pricing for GPU Cloud. */
const DEFAULT_PRICING: Record<string, { hourlyRateCents: number; monthlyRateCents: number | null }> = {
  'rtx-pro-6000': { hourlyRateCents: 66, monthlyRateCents: 19900 },
  'b200': { hourlyRateCents: 225, monthlyRateCents: null },
  'h200': { hourlyRateCents: 150, monthlyRateCents: null },
  'h100': { hourlyRateCents: 249, monthlyRateCents: null },
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const pricing = Object.entries(DEFAULT_PRICING).map(([gpuType, prices]) => {
      const specs = GPU_CATALOG[gpuType];
      return {
        gpuType,
        name: specs?.name ?? gpuType,
        hourlyRateCents: prices.hourlyRateCents,
        monthlyRateCents: prices.monthlyRateCents,
        specs: specs
          ? { vram: specs.vram, architecture: specs.architecture }
          : null,
      };
    });

    return NextResponse.json(pricing, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Widget pricing error:', error);
    return NextResponse.json(
      { error: 'Failed to load pricing' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
