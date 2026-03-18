import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/admin";
import { setSetting } from "@/lib/settings";
import fs from "fs";
import path from "path";
import sharp from "sharp";

function getAdminSession(request: NextRequest): { email: string } | null {
  const sessionToken = request.cookies.get("admin_session")?.value;
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken);
}

const MAX_WIDTH = 400;
const MAX_HEIGHT = 100;

export async function POST(request: NextRequest) {
  const session = getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("logo") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No logo file provided" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" },
        { status: 400 }
      );
    }

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 2MB" },
        { status: 400 }
      );
    }

    const brandingDir = path.join(process.cwd(), "public", "branding");
    if (!fs.existsSync(brandingDir)) {
      fs.mkdirSync(brandingDir, { recursive: true });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    let filename: string;
    let outputBuffer: Buffer;

    if (file.type === "image/svg+xml") {
      // SVGs are served as-is (Sharp has limited SVG support)
      filename = `logo_${Date.now()}.svg`;
      outputBuffer = inputBuffer;
    } else {
      filename = `logo_${Date.now()}.webp`;
      outputBuffer = await sharp(inputBuffer)
        .resize(MAX_WIDTH, MAX_HEIGHT, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
    }

    const filePath = path.join(brandingDir, filename);
    fs.writeFileSync(filePath, outputBuffer);

    const logoUrl = `/branding/${filename}?v=${Date.now()}`;

    // Persist to platform settings so branding picks it up
    await setSetting("NEXT_PUBLIC_LOGO_URL", logoUrl);

    console.log(`Logo uploaded by ${session.email}: ${logoUrl} (${outputBuffer.length} bytes)`);

    return NextResponse.json({ success: true, logoUrl });
  } catch (error) {
    console.error("Failed to upload logo:", error);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 }
    );
  }
}
