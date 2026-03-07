import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import fs from "fs";
import path from "path";
import sharp from "sharp";

// Helper to verify admin session
function getAdminSession(request: NextRequest): { email: string } | null {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken);
}

// Image dimensions for hero images (larger than cluster cards)
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 600;

// POST - Upload hero image for GPU offering
export async function POST(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const gpuId = formData.get("gpuId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB for hero images)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB" },
        { status: 400 }
      );
    }

    // Generate filename - use gpuId if provided, otherwise generate unique name
    let filename: string;
    if (gpuId) {
      // Use a consistent filename based on GPU ID for easier reference
      filename = `gpu_${gpuId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.webp`;
    } else {
      filename = `gpu_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.webp`;
    }

    // Ensure clusters directory exists
    const clustersDir = path.join(process.cwd(), "public", "clusters");
    if (!fs.existsSync(clustersDir)) {
      fs.mkdirSync(clustersDir, { recursive: true });
    }

    // Process image with Sharp: resize and convert to webp
    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const processedBuffer = await sharp(inputBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: "cover",
        position: "center",
      })
      .webp({ quality: 90 })
      .toBuffer();

    // Write processed file
    const filePath = path.join(clustersDir, filename);
    fs.writeFileSync(filePath, processedBuffer);

    // Return the public URL path with cache-busting timestamp
    const imageUrl = `/clusters/${filename}?v=${Date.now()}`;

    console.log(`GPU hero image uploaded by ${session.email}: ${imageUrl} (${processedBuffer.length} bytes)`);

    return NextResponse.json({ success: true, imageUrl });
  } catch (error) {
    console.error("Failed to upload GPU hero image:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 }
    );
  }
}
