import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import {
  getGpuOfferingsData,
  createGpuOffering,
  updateGpuOffering,
  deleteGpuOffering,
  updateProofSection,
  updateCarouselSettings,
  GpuOffering,
  ProofSection,
  CarouselSettings,
} from "@/lib/gpu-offerings";

// Helper to verify admin session
function getAdminSession(request: NextRequest): { email: string } | null {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken);
}

// GET - Get all GPU offerings data (including settings)
export async function GET(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = getGpuOfferingsData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch GPU offerings:", error);
    return NextResponse.json(
      { error: "Failed to fetch GPU offerings" },
      { status: 500 }
    );
  }
}

// POST - Create a new GPU offering
export async function POST(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields = ["name", "fullName", "hourlyPrice", "memory", "location"];
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate hero content
    if (!body.hero || typeof body.hero !== "object") {
      return NextResponse.json(
        { error: "Missing hero content" },
        { status: 400 }
      );
    }

    const heroRequired = ["pill", "headline", "subhead", "description", "hourlyNote", "monthlyNote"];
    for (const field of heroRequired) {
      if (!body.hero[field]) {
        return NextResponse.json(
          { error: `Missing hero field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate pricing content
    if (!body.pricing || typeof body.pricing !== "object") {
      return NextResponse.json(
        { error: "Missing pricing content" },
        { status: 400 }
      );
    }

    const offerData: Omit<GpuOffering, "id"> = {
      name: body.name,
      fullName: body.fullName,
      image: body.image || "/clusters/default.jpeg",
      hourlyPrice: Number(body.hourlyPrice),
      memory: body.memory,
      hero: {
        pill: body.hero.pill,
        headline: body.hero.headline,
        subhead: body.hero.subhead,
        description: body.hero.description,
        hourlyNote: body.hero.hourlyNote,
        monthlyNote: body.hero.monthlyNote,
        signals: body.hero.signals || [],
      },
      pricing: {
        title: body.pricing.title || body.name,
        subtitle: body.pricing.subtitle || body.memory,
        features: body.pricing.features || [],
      },
      location: body.location,
      sortOrder: body.sortOrder ?? 0,
      active: body.active ?? true,
    };

    const newOffering = createGpuOffering(offerData);
    console.log(`GPU offering created by ${session.email}: ${newOffering.id}`);

    return NextResponse.json({ success: true, offering: newOffering });
  } catch (error) {
    console.error("Failed to create GPU offering:", error);
    return NextResponse.json(
      { error: "Failed to create GPU offering" },
      { status: 500 }
    );
  }
}

// PUT - Update an existing GPU offering, proof section, or carousel settings
export async function PUT(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Handle proof section update
    if (body.updateType === "proofSection") {
      if (!body.proofSection || !body.proofSection.stats) {
        return NextResponse.json(
          { error: "Missing proof section data" },
          { status: 400 }
        );
      }

      const updated = updateProofSection(body.proofSection as ProofSection);
      console.log(`Proof section updated by ${session.email}`);
      return NextResponse.json({ success: true, proofSection: updated });
    }

    // Handle carousel settings update
    if (body.updateType === "carouselSettings") {
      if (!body.carouselSettings) {
        return NextResponse.json(
          { error: "Missing carousel settings" },
          { status: 400 }
        );
      }

      const updated = updateCarouselSettings(body.carouselSettings as CarouselSettings);
      console.log(`Carousel settings updated by ${session.email}`);
      return NextResponse.json({ success: true, carouselSettings: updated });
    }

    // Handle GPU offering update
    if (!body.id) {
      return NextResponse.json(
        { error: "Offering ID is required" },
        { status: 400 }
      );
    }

    const updates: Partial<Omit<GpuOffering, "id">> = {};

    // Only include fields that were provided
    if (body.name !== undefined) updates.name = body.name;
    if (body.fullName !== undefined) updates.fullName = body.fullName;
    if (body.image !== undefined) updates.image = body.image;
    if (body.hourlyPrice !== undefined) updates.hourlyPrice = Number(body.hourlyPrice);
    if (body.memory !== undefined) updates.memory = body.memory;
    if (body.hero !== undefined) updates.hero = body.hero;
    if (body.pricing !== undefined) updates.pricing = body.pricing;
    if (body.location !== undefined) updates.location = body.location;
    if (body.sortOrder !== undefined) updates.sortOrder = Number(body.sortOrder);
    if (body.active !== undefined) updates.active = body.active;

    const updatedOffering = updateGpuOffering(body.id, updates);

    if (!updatedOffering) {
      return NextResponse.json({ error: "Offering not found" }, { status: 404 });
    }

    console.log(`GPU offering updated by ${session.email}: ${body.id}`);

    return NextResponse.json({ success: true, offering: updatedOffering });
  } catch (error) {
    console.error("Failed to update GPU offering:", error);
    return NextResponse.json(
      { error: "Failed to update GPU offering" },
      { status: 500 }
    );
  }
}

// DELETE - Remove a GPU offering
export async function DELETE(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json(
        { error: "Offering ID is required" },
        { status: 400 }
      );
    }

    const deleted = deleteGpuOffering(body.id);

    if (!deleted) {
      return NextResponse.json({ error: "Offering not found" }, { status: 404 });
    }

    console.log(`GPU offering deleted by ${session.email}: ${body.id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete GPU offering:", error);
    return NextResponse.json(
      { error: "Failed to delete GPU offering" },
      { status: 500 }
    );
  }
}
